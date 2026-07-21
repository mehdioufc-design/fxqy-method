import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildDecodeValidationCommand,
  buildFfmpegCommand,
  buildStreamHashCommand,
  detectMediaCapabilities,
  parsePresetOptions,
  probeMedia,
  scanMp4Atoms,
  trustedExistingMediaPath,
  trustedPathWithin,
  verifyOutputAnalysis,
  verifyRemuxInvariants,
  type ValidationCommandSpec,
} from "../lib/media";
import {
  detectMediaToolPaths,
  generateSyntheticTestVideos,
} from "../scripts/generate-test-videos";

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

function execute(
  command: Pick<ValidationCommandSpec, "executable" | "args">,
  timeoutMs = 180_000,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, [...command.args], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      const output = Buffer.concat(stdout).toString("utf8");
      const diagnostic = Buffer.concat(stderr).toString("utf8");
      if (timedOut) {
        reject(new Error(`${path.basename(command.executable)} exceeded the integration timeout.`));
      } else if (code !== 0) {
        reject(new Error(`Media command failed (${code}): ${diagnostic.slice(-2_000)}`));
      } else {
        resolve({ stdout: output, stderr: diagnostic });
      }
    });
  });
}

function normalizedHashes(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

const mediaTools = await detectMediaToolPaths();
if (!mediaTools) {
  console.warn(
    "[media integration] SKIPPED: FFmpeg and FFprobe were not both available. Install them or set FFMPEG_PATH and FFPROBE_PATH.",
  );
}

describe.runIf(mediaTools !== null)("real FFmpeg and FFprobe processing", () => {
  const tools = mediaTools!;

  it("produces a verified BT.709 constant-60-FPS fast-start export without needless upscaling", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tto-ffmpeg-safe-"));
    try {
      const fixtures = await generateSyntheticTestVideos(root, tools);
      const source = await trustedExistingMediaPath(root, fixtures.source24);
      const sourceAnalysis = await probeMedia(source, {
        ffprobePath: tools.ffprobe,
        timeoutMs: 60_000,
        packetScanTimeoutMs: 60_000,
      });
      const capabilities = await detectMediaCapabilities({
        ffmpegPath: tools.ffmpeg,
        timeoutMs: 30_000,
      });
      expect(capabilities.encoders).toContain("libx264");

      const output = trustedPathWithin(root, path.join(root, "safe-60.mp4"));
      const command = buildFfmpegCommand({
        input: source,
        output,
        analysis: sourceAnalysis,
        options: parsePresetOptions({
          preset: "tiktok-safe",
          fps: 60,
          performance: "maximum-cpu",
          fitMode: "crop",
          scaling: "lanczos",
          toneMap: "auto",
          enhancements: {
            sharpening: 0,
            denoise: 0,
            deband: 0,
            brightness: 0,
            contrast: 1,
            saturation: 1,
            gamma: 1,
            audioNormalize: false,
          },
        }),
        capabilities,
        ffmpegPath: tools.ffmpeg,
      });
      await execute(command);

      const trustedOutput = await trustedExistingMediaPath(root, output);
      const outputAnalysis = await probeMedia(trustedOutput, {
        ffprobePath: tools.ffprobe,
        timeoutMs: 60_000,
        packetScanTimeoutMs: 60_000,
      });
      const atoms = await scanMp4Atoms(trustedOutput);
      const verification = verifyOutputAnalysis(command.expected, outputAnalysis, atoms);
      expect(verification.issues).toEqual([]);
      expect(verification.ok).toBe(true);
      expect(outputAnalysis.video).toMatchObject({
        width: 360,
        height: 640,
        pixelFormat: "yuv420p",
        color: { primaries: "bt709", transfer: "bt709", space: "bt709" },
      });
      expect(outputAnalysis.video.fps.kind).toBe("constant");
      expect(outputAnalysis.video.fps.measured).toBeCloseTo(60, 2);
      expect(atoms.webOptimized).toBe(true);

      await execute(buildDecodeValidationCommand(trustedOutput, outputAnalysis, tools.ffmpeg));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 240_000);

  it("keeps the full source duration when optical flow creates a real CFR120 timeline", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tto-ffmpeg-optical-"));
    try {
      const sourcePath = path.join(root, "source-30.mp4");
      await execute({
        executable: tools.ffmpeg,
        args: [
          "-hide_banner", "-loglevel", "error", "-y",
          "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30:duration=0.5",
          "-c:v", "libx264", "-pix_fmt", "yuv420p",
          "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
          "-movflags", "+faststart", sourcePath,
        ],
      });
      const source = await trustedExistingMediaPath(root, sourcePath);
      const sourceAnalysis = await probeMedia(source, {
        ffprobePath: tools.ffprobe,
        timeoutMs: 60_000,
        packetScanTimeoutMs: 60_000,
      });
      const capabilities = await detectMediaCapabilities({ ffmpegPath: tools.ffmpeg, timeoutMs: 30_000 });
      expect(capabilities.filters).toContain("minterpolate");

      const output = trustedPathWithin(root, path.join(root, "optical-120.mp4"));
      const command = buildFfmpegCommand({
        input: source,
        output,
        analysis: sourceAnalysis,
        options: parsePresetOptions({
          preset: "master-120",
          codec: "h264",
          resolution: "1080p",
          cadence: "optical-flow",
          performance: "maximum-cpu",
        }),
        capabilities,
        ffmpegPath: tools.ffmpeg,
      });
      await execute(command, 120_000);

      const trustedOutput = await trustedExistingMediaPath(root, output);
      const outputAnalysis = await probeMedia(trustedOutput, {
        ffprobePath: tools.ffprobe,
        timeoutMs: 60_000,
        packetScanTimeoutMs: 60_000,
      });
      const atoms = await scanMp4Atoms(trustedOutput);
      expect(verifyOutputAnalysis(command.expected, outputAnalysis, atoms)).toMatchObject({ ok: true, issues: [] });
      expect(outputAnalysis.video.fps.measured).toBeCloseTo(120, 2);
      expect(outputAnalysis.file.durationSeconds).toBeCloseTo(sourceAnalysis.file.durationSeconds, 2);
      expect(outputAnalysis.video.fps.sampleCount).toBeGreaterThanOrEqual(59);
      expect(outputAnalysis.video.fps.sampleCount).toBeLessThanOrEqual(61);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("fast-start remuxes compatible media without changing encoded stream payloads", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tto-ffmpeg-remux-"));
    try {
      const fixtures = await generateSyntheticTestVideos(root, tools);
      const source = await trustedExistingMediaPath(root, fixtures.source24);
      const sourceAnalysis = await probeMedia(source, {
        ffprobePath: tools.ffprobe,
        timeoutMs: 60_000,
        packetScanTimeoutMs: 60_000,
      });
      expect(sourceAnalysis.remux.eligible).toBe(true);

      const output = trustedPathWithin(root, path.join(root, "fast-start-remux.mp4"));
      const command = buildFfmpegCommand({
        input: source,
        output,
        analysis: sourceAnalysis,
        options: parsePresetOptions({ preset: "lossless-remux" }),
        capabilities: { encoders: [], filters: [], diagnostics: [] },
        ffmpegPath: tools.ffmpeg,
      });
      expect(command.encoder).toBe("copy");
      await execute(command);

      const trustedOutput = await trustedExistingMediaPath(root, output);
      const outputAnalysis = await probeMedia(trustedOutput, {
        ffprobePath: tools.ffprobe,
        timeoutMs: 60_000,
        packetScanTimeoutMs: 60_000,
      });
      const atoms = await scanMp4Atoms(trustedOutput);
      expect(atoms.valid).toBe(true);
      expect(atoms.webOptimized).toBe(true);
      expect(verifyRemuxInvariants(sourceAnalysis, outputAnalysis)).toMatchObject({
        ok: true,
        issues: [],
      });

      const [sourceHash, outputHash] = await Promise.all([
        execute(buildStreamHashCommand(source, sourceAnalysis, tools.ffmpeg)),
        execute(buildStreamHashCommand(trustedOutput, outputAnalysis, tools.ffmpeg)),
      ]);
      expect(normalizedHashes(outputHash.stdout)).toEqual(normalizedHashes(sourceHash.stdout));
      await execute(buildDecodeValidationCommand(trustedOutput, outputAnalysis, tools.ffmpeg));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
