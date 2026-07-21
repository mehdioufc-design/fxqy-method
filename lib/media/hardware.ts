import { spawn } from "node:child_process";
import { z } from "zod";

export const EncoderNameSchema = z.enum([
  "libx264",
  "libx265",
  "h264_nvenc",
  "hevc_nvenc",
  "h264_qsv",
  "hevc_qsv",
  "h264_amf",
  "hevc_amf",
  "h264_videotoolbox",
  "hevc_videotoolbox",
]);
export type EncoderName = z.infer<typeof EncoderNameSchema>;

export const OptionalFilterNameSchema = z.enum([
  "zscale",
  "tonemap",
  "minterpolate",
  "loudnorm",
  "hqdn3d",
  "deband",
  "bwdif",
]);
export type OptionalFilterName = z.infer<typeof OptionalFilterNameSchema>;

export interface EncoderDiagnostic {
  readonly encoder: EncoderName;
  readonly compiled: boolean;
  readonly runtimeUsable: boolean;
  readonly reason?: string;
}

export interface MediaCapabilities {
  readonly ffmpegVersion?: string;
  readonly encoders: readonly EncoderName[];
  readonly filters: readonly OptionalFilterName[];
  readonly diagnostics: readonly EncoderDiagnostic[];
}

export const EMPTY_MEDIA_CAPABILITIES: MediaCapabilities = Object.freeze({
  encoders: [],
  filters: [],
  diagnostics: [],
});

const HARDWARE_ENCODERS = new Set<EncoderName>([
  "h264_nvenc",
  "hevc_nvenc",
  "h264_qsv",
  "hevc_qsv",
  "h264_amf",
  "hevc_amf",
  "h264_videotoolbox",
  "hevc_videotoolbox",
]);

export function parseEncoderListing(output: string): EncoderName[] {
  const encoders = new Set<EncoderName>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*[A-Z.]{6}\s+([^\s]+)/.exec(line);
    if (!match) continue;
    const parsed = EncoderNameSchema.safeParse(match[1]);
    if (parsed.success) encoders.add(parsed.data);
  }
  return [...encoders];
}

export function parseFilterListing(output: string): OptionalFilterName[] {
  const filters = new Set<OptionalFilterName>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*[TSC.]{3}\s+([^\s]+)/.exec(line);
    if (!match) continue;
    const parsed = OptionalFilterNameSchema.safeParse(match[1]);
    if (parsed.success) filters.add(parsed.data);
  }
  return [...filters];
}

interface CaptureResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function validateExecutable(executable: string): string {
  if (!executable || executable.length > 4_096 || /[\0\r\n]/.test(executable)) {
    throw new Error("The configured FFmpeg executable path is invalid.");
  }
  return executable;
}

async function capture(
  executable: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<CaptureResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const maximum = 8 * 1024 * 1024;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stdout) < maximum) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stderr) < maximum) stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

async function testHardwareEncoder(
  executable: string,
  encoder: EncoderName,
  timeoutMs: number,
): Promise<{ usable: boolean; reason?: string }> {
  const result = await capture(
    executable,
    [
      "-hide_banner",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=128x128:r=30:d=0.1",
      "-frames:v",
      "2",
      "-an",
      "-vf",
      "format=nv12",
      "-c:v",
      encoder,
      "-f",
      "null",
      "-",
    ],
    timeoutMs,
  );
  const reason = result.stderr.trim().split(/\r?\n/).at(-1)?.slice(0, 500);
  return result.exitCode === 0 ? { usable: true } : { usable: false, reason: reason || "Runtime test failed." };
}

export interface DetectCapabilitiesOptions {
  readonly ffmpegPath?: string;
  readonly timeoutMs?: number;
}

/** Detects compiled components, then performs a real tiny encode for every hardware encoder. */
export async function detectMediaCapabilities(
  options: DetectCapabilitiesOptions = {},
): Promise<MediaCapabilities> {
  const executable = validateExecutable(options.ffmpegPath ?? "ffmpeg");
  const timeoutMs = options.timeoutMs ?? 15_000;
  const [versionResult, encodersResult, filtersResult] = await Promise.all([
    capture(executable, ["-hide_banner", "-version"], timeoutMs),
    capture(executable, ["-hide_banner", "-encoders"], timeoutMs),
    capture(executable, ["-hide_banner", "-filters"], timeoutMs),
  ]);
  if (encodersResult.exitCode !== 0 || filtersResult.exitCode !== 0) {
    throw new Error("FFmpeg capability discovery failed.");
  }

  const compiledEncoders = parseEncoderListing(encodersResult.stdout + encodersResult.stderr);
  const filters = parseFilterListing(filtersResult.stdout + filtersResult.stderr);
  const diagnostics: EncoderDiagnostic[] = [];
  const usable = new Set<EncoderName>();

  await Promise.all(
    compiledEncoders.map(async (encoder) => {
      if (!HARDWARE_ENCODERS.has(encoder)) {
        usable.add(encoder);
        diagnostics.push({ encoder, compiled: true, runtimeUsable: true });
        return;
      }
      try {
        const test = await testHardwareEncoder(executable, encoder, timeoutMs);
        diagnostics.push({
          encoder,
          compiled: true,
          runtimeUsable: test.usable,
          reason: test.reason,
        });
        if (test.usable) usable.add(encoder);
      } catch (error) {
        diagnostics.push({
          encoder,
          compiled: true,
          runtimeUsable: false,
          reason: error instanceof Error ? error.message.slice(0, 500) : "Runtime test failed.",
        });
      }
    }),
  );

  return {
    ffmpegVersion: (versionResult.stdout || versionResult.stderr).split(/\r?\n/)[0]?.slice(0, 500),
    encoders: compiledEncoders.filter((encoder) => usable.has(encoder)),
    filters,
    diagnostics: diagnostics.sort((left, right) => left.encoder.localeCompare(right.encoder)),
  };
}

