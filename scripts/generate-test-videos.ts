import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getAppConfig } from "../lib/config";

export interface MediaToolPaths {
  readonly ffmpeg: string;
  readonly ffprobe: string;
}

export interface SyntheticVideoFixtures {
  readonly source24: string;
}

interface ProcessResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runProcess(
  executable: string,
  args: readonly string[],
  timeoutMs = 30_000,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
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
      if (timedOut) {
        reject(new Error(`${path.basename(executable)} exceeded its test timeout.`));
        return;
      }
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function executableWorks(executable: string): Promise<boolean> {
  try {
    return (await runProcess(executable, ["-version"], 10_000)).code === 0;
  } catch {
    return false;
  }
}

/** Returns null only when at least one required media binary cannot be started. */
export async function detectMediaToolPaths(): Promise<MediaToolPaths | null> {
  const config = getAppConfig();
  const ffmpeg = config.ffmpegPath;
  const ffprobe = config.ffprobePath;
  const [hasFfmpeg, hasFfprobe] = await Promise.all([
    executableWorks(ffmpeg),
    executableWorks(ffprobe),
  ]);
  return hasFfmpeg && hasFfprobe ? { ffmpeg, ffprobe } : null;
}

/** Creates original, copyright-free, tiny media fixtures using FFmpeg lavfi sources. */
export async function generateSyntheticTestVideos(
  outputDirectory: string,
  tools: MediaToolPaths,
): Promise<SyntheticVideoFixtures> {
  const outputRoot = path.resolve(outputDirectory);
  await mkdir(outputRoot, { recursive: true });
  const source24 = path.join(outputRoot, "synthetic-24fps-bt709.mp4");
  const result = await runProcess(
    tools.ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=360x640:rate=24:duration=0.75",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:sample_rate=48000:duration=0.75",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-colorspace",
      "bt709",
      "-color_range",
      "tv",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "48000",
      "-shortest",
      source24,
    ],
    60_000,
  );
  if (result.code !== 0) {
    const diagnostic = result.stderr.trim().split(/\r?\n/).slice(-4).join(" ").slice(0, 1_000);
    throw new Error(`Synthetic video generation failed: ${diagnostic || "FFmpeg returned a nonzero status."}`);
  }
  return { source24 };
}

async function main(): Promise<void> {
  const tools = await detectMediaToolPaths();
  if (!tools) {
    throw new Error(
      "FFmpeg and FFprobe are required. Install both or set FFMPEG_PATH and FFPROBE_PATH.",
    );
  }
  const outputDirectory = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve("work", "synthetic-test-videos");
  const fixtures = await generateSyntheticTestVideos(outputDirectory, tools);
  console.log(`Generated synthetic fixture: ${fixtures.source24}`);
}

const executedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (executedPath === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Synthetic fixture generation failed.");
    process.exitCode = 1;
  });
}
