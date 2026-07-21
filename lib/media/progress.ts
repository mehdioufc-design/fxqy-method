export interface FfmpegProgressUpdate {
  readonly frame?: number;
  readonly fps?: number;
  readonly speed?: number;
  readonly totalSizeBytes?: number;
  readonly duplicateFrames?: number;
  readonly droppedFrames?: number;
  readonly outTimeSeconds?: number;
  readonly progress: "continue" | "end";
}

function finite(value: string | undefined): number | undefined {
  if (!value || value === "N/A") return undefined;
  const number = Number(value.replace(/x$/, ""));
  return Number.isFinite(number) ? number : undefined;
}

function parseClock(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value);
  if (!match) return undefined;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(seconds) ? seconds : undefined;
}

export class FfmpegProgressParser {
  #buffer = "";
  #fields = new Map<string, string>();

  push(chunk: string | Buffer): FfmpegProgressUpdate[] {
    this.#buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const updates: FfmpegProgressUpdate[] = [];
    let newline = this.#buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#buffer.slice(0, newline).replace(/\r$/, "");
      this.#buffer = this.#buffer.slice(newline + 1);
      const separator = line.indexOf("=");
      if (separator > 0) {
        const key = line.slice(0, separator);
        const value = line.slice(separator + 1);
        this.#fields.set(key, value);
        if (key === "progress" && (value === "continue" || value === "end")) {
          updates.push(this.#createUpdate(value));
          this.#fields.clear();
        }
      }
      newline = this.#buffer.indexOf("\n");
    }
    return updates;
  }

  flush(): FfmpegProgressUpdate[] {
    if (!this.#buffer) return [];
    const updates = this.push("\n");
    this.#buffer = "";
    return updates;
  }

  #createUpdate(progress: "continue" | "end"): FfmpegProgressUpdate {
    const outTimeUs = finite(this.#fields.get("out_time_us"));
    // Older FFmpeg versions call this value out_time_ms while still reporting microseconds.
    const legacyOutTimeUs = finite(this.#fields.get("out_time_ms"));
    const outTimeSeconds =
      outTimeUs !== undefined
        ? outTimeUs / 1_000_000
        : legacyOutTimeUs !== undefined
          ? legacyOutTimeUs / 1_000_000
          : parseClock(this.#fields.get("out_time"));
    return {
      frame: finite(this.#fields.get("frame")),
      fps: finite(this.#fields.get("fps")),
      speed: finite(this.#fields.get("speed")),
      totalSizeBytes: finite(this.#fields.get("total_size")),
      duplicateFrames: finite(this.#fields.get("dup_frames")),
      droppedFrames: finite(this.#fields.get("drop_frames")),
      outTimeSeconds,
      progress,
    };
  }
}

export function progressFraction(
  update: FfmpegProgressUpdate,
  durationSeconds: number,
): number | undefined {
  if (update.progress === "end") return 1;
  if (!update.outTimeSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return undefined;
  return Math.max(0, Math.min(0.995, update.outTimeSeconds / durationSeconds));
}

/** Removes control characters and known private paths before persisting a status line. */
export function sanitizeFfmpegDiagnostic(
  line: string,
  privatePaths: readonly string[] = [],
  maximumLength = 2_000,
): string {
  let sanitized = line.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  for (const privatePath of privatePaths) {
    if (!privatePath) continue;
    sanitized = sanitized.split(privatePath).join("<private-media>");
  }
  return sanitized.slice(0, Math.max(0, maximumLength));
}

