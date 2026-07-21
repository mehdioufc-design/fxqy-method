import { z } from "zod";

export const FrameRateKindSchema = z.enum(["constant", "variable", "indeterminate"]);
export type FrameRateKind = z.infer<typeof FrameRateKindSchema>;

export const AnalysisWarningCodeSchema = z.enum([
  "VARIABLE_FRAME_RATE",
  "UPLOAD_CODEC_REENCODE_REQUIRED",
  "UNUSUAL_PIXEL_FORMAT",
  "TIMESTAMP_ERRORS",
  "MISSING_COLOR_METADATA",
  "HDR_TO_SDR_REQUIRED",
  "LOW_RESOLUTION_SOURCE",
  "EXTREMELY_LOW_BITRATE",
  "INCONSISTENT_FRAME_RATE_METADATA",
  "AUDIO_VIDEO_DURATION_MISMATCH",
  "INTERLACED_SOURCE",
  "ROTATION_METADATA",
  "MULTIPLE_VIDEO_STREAMS",
  "MULTIPLE_AUDIO_STREAMS",
  "NOT_WEB_OPTIMIZED",
  "FRAGMENTED_MP4",
  "FRAME_RATE_OUTSIDE_UPLOAD_GUIDANCE",
]);

export const AnalysisWarningSchema = z
  .object({
    code: AnalysisWarningCodeSchema,
    severity: z.enum(["info", "warning", "error"]),
    message: z.string().min(1).max(600),
  })
  .strict();
export type AnalysisWarning = z.infer<typeof AnalysisWarningSchema>;

export const RemuxDecisionSchema = z
  .object({
    eligible: z.boolean(),
    fixes: z.array(z.string().min(1).max(300)).max(20),
    warnings: z.array(z.string().min(1).max(300)).max(20),
    blockers: z.array(z.string().min(1).max(300)).max(20),
    recommendedPreset: z.enum(["tiktok-safe", "maximum-quality"]).optional(),
  })
  .strict();
export type RemuxDecision = z.infer<typeof RemuxDecisionSchema>;

export const PacketTimingSummarySchema = z
  .object({
    sampleCount: z.number().int().nonnegative(),
    sampledCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
    missingPts: z.number().int().nonnegative(),
    missingDts: z.number().int().nonnegative(),
    nonMonotonicDts: z.number().int().nonnegative(),
    nonPositiveDurations: z.number().int().nonnegative(),
    negativeStart: z.boolean(),
    medianDurationSeconds: z.number().positive().optional(),
    measuredFps: z.number().positive().optional(),
    kind: FrameRateKindSchema,
    maximumGapSeconds: z.number().nonnegative().optional(),
    maximumKeyframeGapSeconds: z.number().nonnegative().optional(),
    tinyPacketCount: z.number().int().nonnegative(),
  })
  .strict();
export type PacketTimingSummary = z.infer<typeof PacketTimingSummarySchema>;

const ColorMetadataSchema = z
  .object({
    primaries: z.string().max(64).optional(),
    transfer: z.string().max(64).optional(),
    space: z.string().max(64).optional(),
    range: z.string().max(64).optional(),
  })
  .strict();

export const MediaAnalysisSchema = z
  .object({
    schemaVersion: z.literal(1),
    file: z
      .object({
        bytes: z.number().int().nonnegative(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
        containerNames: z.array(z.string().min(1).max(64)).max(16),
        durationSeconds: z.number().nonnegative(),
        bitrate: z.number().nonnegative().optional(),
        probeScore: z.number().nonnegative().optional(),
        webOptimized: z.boolean().nullable(),
        fragmentedMp4: z.boolean().nullable(),
      })
      .strict(),
    video: z
      .object({
        streamIndex: z.number().int().nonnegative(),
        codec: z.string().min(1).max(64),
        profile: z.string().max(128).optional(),
        level: z.string().max(64).optional(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        displayWidth: z.number().int().positive(),
        displayHeight: z.number().int().positive(),
        dar: z.number().positive().optional(),
        sar: z.string().max(64).optional(),
        pixelFormat: z.string().max(64).optional(),
        fieldOrder: z.string().max(64).optional(),
        bitrate: z.number().nonnegative().optional(),
        color: ColorMetadataSchema,
        rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
        fps: z
          .object({
            avgText: z.string().max(64).optional(),
            nominalText: z.string().max(64).optional(),
            measured: z.number().positive().optional(),
            kind: FrameRateKindSchema,
            sampleCount: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
    audio: z
      .object({
        streamIndex: z.number().int().nonnegative(),
        codec: z.string().min(1).max(64),
        sampleRate: z.number().int().positive().optional(),
        channels: z.number().int().positive().optional(),
        channelLayout: z.string().max(128).optional(),
        durationSeconds: z.number().nonnegative().optional(),
        bitrate: z.number().nonnegative().optional(),
      })
      .strict()
      .optional(),
    timing: z
      .object({
        missingPts: z.number().int().nonnegative(),
        missingDts: z.number().int().nonnegative(),
        nonMonotonicDts: z.number().int().nonnegative(),
        nonPositiveDurations: z.number().int().nonnegative(),
        negativeStart: z.boolean(),
        maximumGapSeconds: z.number().nonnegative().optional(),
        maximumKeyframeGapSeconds: z.number().nonnegative().optional(),
        avDurationDeltaSeconds: z.number().nonnegative().optional(),
        tinyVideoPacketCount: z.number().int().nonnegative().optional(),
        suspiciousFrameMetadata: z.boolean(),
      })
      .strict(),
    hdr: z.boolean(),
    warnings: z.array(AnalysisWarningSchema).max(50),
    remux: RemuxDecisionSchema,
  })
  .strict();

export type MediaAnalysis = z.infer<typeof MediaAnalysisSchema>;
