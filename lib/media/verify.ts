import type { MediaAnalysis } from "./contracts";
import type { ExpectedOutput } from "./ffmpeg-command";
import type { Mp4AtomScan } from "./mp4-atoms";
import type { TrustedMediaPath } from "./trusted-path";

export interface VerificationIssue {
  readonly code: string;
  readonly message: string;
}

export interface VerificationResult {
  readonly ok: boolean;
  readonly issues: readonly VerificationIssue[];
}

export interface ValidationCommandSpec {
  readonly executable: string;
  readonly args: readonly string[];
  readonly redactedArgs: readonly string[];
}

function validationExecutable(value: string): string {
  if (!value || value.length > 4_096 || /[\0\r\n]/.test(value)) {
    throw new Error("The configured FFmpeg executable path is invalid.");
  }
  return value;
}

/**
 * Builds a full decode validation command. Execute with spawn(..., {shell:false})
 * and require exit code zero before publishing an export.
 */
export function buildDecodeValidationCommand(
  input: TrustedMediaPath,
  analysis: MediaAnalysis,
  ffmpegPath = "ffmpeg",
): ValidationCommandSpec {
  const executable = validationExecutable(ffmpegPath);
  const args = [
    "-hide_banner",
    "-v",
    "error",
    "-xerror",
    "-protocol_whitelist",
    "file",
    "-i",
    input,
    "-map",
    `0:${analysis.video.streamIndex}`,
  ];
  if (analysis.audio) args.push("-map", `0:${analysis.audio.streamIndex}?`);
  args.push("-f", "null", "-");
  return {
    executable,
    args,
    redactedArgs: args.map((argument) => (argument === input ? "<private-output>" : argument)),
  };
}

/** Builds encoded packet-payload SHA-256 output for lossless-remux stream comparison. */
export function buildStreamHashCommand(
  input: TrustedMediaPath,
  analysis: MediaAnalysis,
  ffmpegPath = "ffmpeg",
): ValidationCommandSpec {
  const executable = validationExecutable(ffmpegPath);
  const args = [
    "-hide_banner",
    "-v",
    "error",
    "-protocol_whitelist",
    "file",
    "-i",
    input,
    "-map",
    `0:${analysis.video.streamIndex}`,
  ];
  if (analysis.audio) args.push("-map", `0:${analysis.audio.streamIndex}?`);
  args.push("-c", "copy", "-f", "streamhash", "-hash", "sha256", "-");
  return {
    executable,
    args,
    redactedArgs: args.map((argument) => (argument === input ? "<private-media>" : argument)),
  };
}

function issue(issues: VerificationIssue[], code: string, message: string): void {
  issues.push({ code, message });
}

export function verifyOutputAnalysis(
  expected: ExpectedOutput,
  actual: MediaAnalysis,
  atoms?: Mp4AtomScan,
): VerificationResult {
  const issues: VerificationIssue[] = [];
  if (actual.video.width !== expected.width || actual.video.height !== expected.height) {
    issue(
      issues,
      "RESOLUTION_MISMATCH",
      `Expected ${expected.width}×${expected.height}, received ${actual.video.width}×${actual.video.height}.`,
    );
  }
  if (actual.video.codec !== expected.codec) {
    issue(issues, "CODEC_MISMATCH", `Expected ${expected.codec}, received ${actual.video.codec}.`);
  }
  if (actual.video.pixelFormat !== expected.pixelFormat) {
    issue(
      issues,
      "PIXEL_FORMAT_MISMATCH",
      `Expected ${expected.pixelFormat}, received ${actual.video.pixelFormat ?? "unknown"}.`,
    );
  }
  if (actual.video.rotation !== 0) {
    issue(issues, "ROTATION_REMAINS", "Output still contains a nonzero display rotation.");
  }
  if (actual.video.fieldOrder && !["progressive", "unknown"].includes(actual.video.fieldOrder)) {
    issue(issues, "NOT_PROGRESSIVE", "Output is not marked progressive.");
  }
  if (expected.frameRateKind === "constant" && actual.video.fps.kind !== "constant") {
    issue(issues, "NOT_CFR", "Output packet cadence is not constant.");
  }
  if (
    expected.frameRate !== undefined &&
    (!actual.video.fps.measured || Math.abs(actual.video.fps.measured - expected.frameRate) > 0.02)
  ) {
    issue(
      issues,
      "FRAME_RATE_MISMATCH",
      `Expected ${expected.frameRate} FPS, received ${actual.video.fps.measured ?? "unknown"}.`,
    );
  }
  if (
    expected.preset !== "lossless-remux" &&
    Math.abs(actual.file.durationSeconds - expected.durationSeconds) > Math.min(
      0.25,
      Math.max(0.08, 2 / (expected.frameRate ?? 30)),
    )
  ) {
    issue(issues, "DURATION_MISMATCH", "Output duration differs from the source beyond frame-rounding tolerance.");
  }
  if (expected.preset !== "lossless-remux") {
    if (actual.video.color.primaries !== expected.color.primaries) {
      issue(issues, "COLOR_PRIMARIES_MISMATCH", "Output colour primaries do not match the resolved export plan.");
    }
    if (actual.video.color.transfer !== expected.color.transfer) {
      issue(issues, "COLOR_TRANSFER_MISMATCH", "Output transfer characteristics do not match the export plan.");
    }
    if (actual.video.color.space !== expected.color.space) {
      issue(issues, "COLOR_SPACE_MISMATCH", "Output colour space does not match the export plan.");
    }
    const actualRange = ["pc", "jpeg"].includes(actual.video.color.range ?? "")
      ? "pc"
      : ["tv", "mpeg"].includes(actual.video.color.range ?? "")
        ? "tv"
        : undefined;
    if (actualRange !== expected.color.range) {
      issue(issues, "COLOR_RANGE_MISMATCH", "Output colour range does not match the export plan.");
    }
  }
  if (
    actual.timing.missingPts > 0 ||
    actual.timing.missingDts > 0 ||
    actual.timing.nonMonotonicDts > 0 ||
    actual.timing.nonPositiveDurations > 0
  ) {
    issue(issues, "TIMESTAMP_ERROR", "Output contains invalid packet timestamps.");
  }
  if (
    actual.timing.avDurationDeltaSeconds !== undefined &&
    actual.timing.avDurationDeltaSeconds > Math.max(0.25, actual.file.durationSeconds * 0.01)
  ) {
    issue(issues, "AV_DURATION_MISMATCH", "Output audio/video duration mismatch exceeds tolerance.");
  }
  if (atoms) {
    if (!atoms.valid) issue(issues, "INVALID_MP4", "Output MP4 atom structure failed validation.");
    if (atoms.webOptimized !== true) issue(issues, "NOT_FASTSTART", "Output moov atom is not before media data.");
    if (atoms.fragmented === true) issue(issues, "FRAGMENTED_MP4", "Output is fragmented rather than a flat MP4.");
  } else if (actual.file.webOptimized !== true) {
    issue(issues, "NOT_FASTSTART", "Output was not verified as fast-start MP4.");
  }

  return { ok: issues.length === 0, issues };
}

export function verifyRemuxInvariants(source: MediaAnalysis, output: MediaAnalysis): VerificationResult {
  const issues: VerificationIssue[] = [];
  if (source.video.codec !== output.video.codec) {
    issue(issues, "VIDEO_CODEC_CHANGED", "Lossless remux changed the video codec.");
  }
  if (source.video.width !== output.video.width || source.video.height !== output.video.height) {
    issue(issues, "VIDEO_DIMENSIONS_CHANGED", "Lossless remux changed video dimensions.");
  }
  if (source.video.pixelFormat !== output.video.pixelFormat) {
    issue(issues, "PIXEL_FORMAT_CHANGED", "Lossless remux changed video pixel format.");
  }
  if (source.video.profile && source.video.profile !== output.video.profile) {
    issue(issues, "VIDEO_PROFILE_CHANGED", "Lossless remux changed the reported video profile.");
  }
  if (source.video.level && source.video.level !== output.video.level) {
    issue(issues, "VIDEO_LEVEL_CHANGED", "Lossless remux changed the reported video level.");
  }
  for (const field of ["primaries", "transfer", "space"] as const) {
    const sourceValue = source.video.color[field];
    if (sourceValue && sourceValue !== output.video.color[field]) {
      issue(issues, `COLOR_${field.toUpperCase()}_CHANGED`, `Lossless remux changed the video colour ${field}.`);
    }
  }
  const normalizedRange = (value: string | undefined) => {
    if (["pc", "jpeg"].includes(value ?? "")) return "pc";
    if (["tv", "mpeg"].includes(value ?? "")) return "tv";
    return value;
  };
  if (
    source.video.color.range &&
    normalizedRange(source.video.color.range) !== normalizedRange(output.video.color.range)
  ) {
    issue(issues, "COLOR_RANGE_CHANGED", "Lossless remux changed the video colour range.");
  }
  if (source.audio?.codec !== output.audio?.codec) {
    issue(issues, "AUDIO_CODEC_CHANGED", "Lossless remux changed or removed the primary audio codec.");
  }
  const durationTolerance = source.timing.negativeStart
    ? Math.max(0.25, source.file.durationSeconds * 0.01)
    : 0.05;
  if (Math.abs(source.file.durationSeconds - output.file.durationSeconds) > durationTolerance) {
    issue(issues, "DURATION_CHANGED", "Lossless remux changed duration beyond timestamp-rounding tolerance.");
  }
  return { ok: issues.length === 0, issues };
}

export function assertVerified(result: VerificationResult): void {
  if (!result.ok) {
    throw new Error(result.issues.map((entry) => `${entry.code}: ${entry.message}`).join(" "));
  }
}
