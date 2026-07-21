import type { MediaAnalysis, RemuxDecision } from "./contracts";

export function evaluateRemuxEligibility(
  analysis: Omit<MediaAnalysis, "remux"> | MediaAnalysis,
): RemuxDecision {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const fixes: string[] = [];
  const { video, audio, timing, file } = analysis;

  if (video.codec !== "h264" && video.codec !== "hevc") {
    blockers.push("The video codec is not a conservative MP4 upload codec and must be re-encoded.");
  }
  if (video.codec === "h264" && video.pixelFormat !== "yuv420p") {
    blockers.push("H.264 remux requires progressive yuv420p video for broad compatibility.");
  }
  if (
    video.codec === "hevc" &&
    video.pixelFormat !== "yuv420p" &&
    video.pixelFormat !== "yuv420p10le"
  ) {
    blockers.push("The HEVC pixel format is not conservatively compatible with MP4 upload workflows.");
  }
  if (video.fieldOrder && !["progressive", "unknown"].includes(video.fieldOrder)) {
    blockers.push("Interlaced video cannot be made progressive by remuxing.");
  }
  if (video.rotation !== 0) {
    blockers.push("Rotation metadata must be rendered into the pixels by re-encoding for a clean orientation.");
  }
  if (video.width % 2 !== 0 || video.height % 2 !== 0) {
    blockers.push("Odd video dimensions are not suitable for the conservative 4:2:0 remux profile.");
  }
  if (video.fps.kind !== "constant") {
    blockers.push("Variable or indeterminate frame cadence cannot be converted to CFR without re-encoding.");
  }
  if (video.fps.measured && (video.fps.measured < 23 || video.fps.measured > 60.01)) {
    blockers.push("The measured frame rate is outside the documented 23–60 FPS upload range.");
  }
  if (Math.min(video.displayWidth, video.displayHeight) < 360) {
    blockers.push("One video dimension is below 360 pixels.");
  }
  if (Math.max(video.displayWidth, video.displayHeight) > 4096) {
    blockers.push("One video dimension exceeds 4096 pixels.");
  }
  if (audio && audio.codec !== "aac") {
    blockers.push("The audio codec must be converted to AAC for the conservative MP4 remux profile.");
  }
  if (
    timing.missingPts > 0 ||
    timing.missingDts > 0 ||
    timing.nonMonotonicDts > 0 ||
    timing.nonPositiveDurations > 0
  ) {
    blockers.push("Critical packet timestamp errors cannot be safely repaired by a lossless remux.");
  }
  if (
    timing.avDurationDeltaSeconds !== undefined &&
    timing.avDurationDeltaSeconds > Math.max(0.25, file.durationSeconds * 0.01)
  ) {
    blockers.push("The audio/video duration mismatch requires re-encoding or deliberate timeline repair.");
  }

  if (!video.color.primaries || !video.color.transfer || !video.color.space) {
    warnings.push("Colour metadata is incomplete and will remain incomplete in a lossless remux.");
  }
  if (video.codec === "hevc") {
    warnings.push("HEVC is supported by some upload paths, but H.264 remains the safer compatibility choice.");
  }
  if (file.webOptimized === false) fixes.push("Move the MP4 moov atom before media data (fast start).");
  if (timing.negativeStart) fixes.push("Shift a benign shared negative start offset to zero.");
  fixes.push("Remove nonessential global metadata while preserving encoded media streams.");

  return {
    eligible: blockers.length === 0,
    fixes,
    warnings,
    blockers,
    recommendedPreset: blockers.length > 0 ? "tiktok-safe" : undefined,
  };
}

