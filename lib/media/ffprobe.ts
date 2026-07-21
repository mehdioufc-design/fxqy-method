import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

import { parseFfprobeAnalysis, primaryVideoStreamIndex } from "./analysis";
import type { MediaAnalysis } from "./contracts";
import { scanMp4Atoms } from "./mp4-atoms";
import { PacketTimingAccumulator } from "./packet-timing";
import { RawFfprobeSchema, selectPrimaryVideoStream } from "./probe-schema";
import { parseRational } from "./rational";
import type { TrustedMediaPath } from "./trusted-path";

const MAX_PROBE_JSON_BYTES = 32 * 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES = 128 * 1024;

export class MediaToolError extends Error {
  readonly code:
    | "BINARY_INVALID"
    | "SPAWN_FAILED"
    | "TIMEOUT"
    | "CANCELLED"
    | "OUTPUT_TOO_LARGE"
    | "PROBE_FAILED";
  readonly exitCode?: number;

  constructor(
    code: MediaToolError["code"],
    message: string,
    options: { cause?: unknown; exitCode?: number } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "MediaToolError";
    this.code = code;
    this.exitCode = options.exitCode;
  }
}

export interface FfprobeOptions {
  readonly ffprobePath?: string;
  readonly timeoutMs?: number;
  readonly packetScanTimeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly sha256?: string;
}

function validateBinary(binary: string): string {
  if (!binary || binary.length > 4_096 || /[\0\r\n]/.test(binary)) {
    throw new MediaToolError("BINARY_INVALID", "The configured FFprobe executable path is invalid.");
  }
  return binary;
}

function boundedAppend(existing: string, chunk: Buffer, maximum: number): string {
  if (Buffer.byteLength(existing) >= maximum) return existing;
  const remaining = maximum - Buffer.byteLength(existing);
  return existing + chunk.subarray(0, remaining).toString("utf8");
}

function privacySafeDiagnostic(value: string, input: TrustedMediaPath): string {
  return value
    .split(input)
    .join("<private-media>")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 2_000);
}

async function captureFfprobeJson(
  executable: string,
  input: TrustedMediaPath,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const args = [
    "-hide_banner",
    "-v",
    "error",
    "-protocol_whitelist",
    "file",
    "-print_format",
    "json",
    "-show_error",
    "-show_format",
    "-show_streams",
    input,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = "";
    let settled = false;

    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      action();
    };
    const terminate = () => {
      if (!child.killed) child.kill("SIGKILL");
    };
    const onAbort = () => {
      terminate();
      settle(() => reject(new MediaToolError("CANCELLED", "Media analysis was cancelled.")));
    };
    const timer = setTimeout(() => {
      terminate();
      settle(() => reject(new MediaToolError("TIMEOUT", "FFprobe exceeded the analysis timeout.")));
    }, timeoutMs);
    timer.unref();

    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_PROBE_JSON_BYTES) {
        terminate();
        settle(() =>
          reject(new MediaToolError("OUTPUT_TOO_LARGE", "FFprobe returned an unexpectedly large response.")),
        );
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = boundedAppend(stderr, chunk, MAX_DIAGNOSTIC_BYTES);
    });
    child.once("error", (error) => {
      settle(() =>
        reject(new MediaToolError("SPAWN_FAILED", "FFprobe could not be started.", { cause: error })),
      );
    });
    child.once("close", (exitCode) => {
      settle(() => {
        const jsonText = Buffer.concat(stdoutChunks).toString("utf8");
        if (exitCode !== 0) {
          reject(
            new MediaToolError(
              "PROBE_FAILED",
              privacySafeDiagnostic(stderr, input) || "FFprobe rejected the uploaded media.",
              { exitCode: exitCode ?? undefined },
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(jsonText) as unknown);
        } catch (error) {
          reject(new MediaToolError("PROBE_FAILED", "FFprobe returned invalid JSON.", { cause: error }));
        }
      });
    });
  });
}

async function scanVideoPackets(
  executable: string,
  input: TrustedMediaPath,
  streamIndex: number,
  timeBaseSeconds: number | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const args = [
    "-hide_banner",
    "-v",
    "warning",
    "-protocol_whitelist",
    "file",
    "-select_streams",
    String(streamIndex),
    "-show_packets",
    "-show_entries",
    "packet=pts_time,dts_time,duration_time,size,flags",
    "-of",
    "compact=p=0:nk=0",
    input,
  ];

  return new Promise<ReturnType<PacketTimingAccumulator["finish"]>>((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const accumulator = new PacketTimingAccumulator(timeBaseSeconds);
    let remainder = "";
    let stderr = "";
    let settled = false;
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      action();
    };
    const terminate = () => {
      if (!child.killed) child.kill("SIGKILL");
    };
    const onAbort = () => {
      terminate();
      settle(() => reject(new MediaToolError("CANCELLED", "Packet analysis was cancelled.")));
    };
    const timer = setTimeout(() => {
      terminate();
      settle(() => reject(new MediaToolError("TIMEOUT", "Packet analysis exceeded its timeout.")));
    }, timeoutMs);
    timer.unref();

    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      remainder += chunk.toString("utf8");
      let newline = remainder.indexOf("\n");
      while (newline >= 0) {
        accumulator.pushCompactLine(remainder.slice(0, newline));
        remainder = remainder.slice(newline + 1);
        newline = remainder.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = boundedAppend(stderr, chunk, MAX_DIAGNOSTIC_BYTES);
    });
    child.once("error", (error) => {
      settle(() =>
        reject(new MediaToolError("SPAWN_FAILED", "FFprobe packet scan could not be started.", { cause: error })),
      );
    });
    child.once("close", (exitCode) => {
      settle(() => {
        if (exitCode !== 0) {
          reject(
            new MediaToolError("PROBE_FAILED", privacySafeDiagnostic(stderr, input) || "FFprobe packet scan failed.", {
              exitCode: exitCode ?? undefined,
            }),
          );
          return;
        }
        if (remainder.trim()) accumulator.pushCompactLine(remainder);
        resolve(accumulator.finish());
      });
    });
  });
}

/** Runs a bounded base probe, full streamed packet timing scan, and read-only MP4 box inspection. */
export async function probeMedia(
  input: TrustedMediaPath,
  options: FfprobeOptions = {},
): Promise<MediaAnalysis> {
  const executable = validateBinary(options.ffprobePath ?? "ffprobe");
  const rawInput = await captureFfprobeJson(
    executable,
    input,
    options.timeoutMs ?? 60_000,
    options.signal,
  );
  const raw = RawFfprobeSchema.parse(rawInput);
  const primaryVideo = selectPrimaryVideoStream(raw);
  if (!primaryVideo) return parseFfprobeAnalysis(rawInput);
  const index = primaryVideoStreamIndex(rawInput);
  const timeBase = parseRational(primaryVideo.time_base)?.value;
  const [packetTiming, mp4, fileStat] = await Promise.all([
    scanVideoPackets(
      executable,
      input,
      index,
      timeBase,
      options.packetScanTimeoutMs ?? 5 * 60_000,
      options.signal,
    ),
    scanMp4Atoms(input),
    stat(input),
  ]);

  return parseFfprobeAnalysis(rawInput, {
    packetTiming,
    mp4,
    fileBytes: fileStat.size,
    sha256: options.sha256,
  });
}
