import { z } from "zod";
import { parsePresetOptions, type PresetOptions } from "./media";

const DashboardOptionsSchema = z
  .object({
    preset: z.enum(["tiktok-safe", "maximum-quality", "master-120", "lossless-remux"]),
    performance: z.enum(["fast-hardware", "balanced", "maximum-cpu"]),
    safeFps: z.union([z.literal(30), z.literal(60)]),
    outputResolution: z.enum(["1080p", "2k"]),
    codec: z.enum(["h264", "hevc"]),
    fitMode: z.enum(["crop", "fit", "blurred-background"]),
    masterCadence: z.enum(["native", "duplicate", "optical-flow"]),
    lanczos: z.boolean(),
    sharpen: z.number().finite(),
    denoise: z.number().finite(),
    deband: z.number().finite(),
    brightness: z.number().finite(),
    contrast: z.number().finite(),
    saturation: z.number().finite(),
    toneMapHdr: z.boolean(),
    normalizeAudio: z.boolean(),
    captionGuides: z.boolean(),
  })
  .strict();

const JobRequestSchema = z
  .object({
    assetId: z.string().uuid(),
    preset: z.enum(["tiktok-safe", "maximum-quality", "master-120", "lossless-remux"]),
    options: DashboardOptionsSchema,
  })
  .strict();

export type ValidatedJobRequest = Readonly<{
  assetId: string;
  options: PresetOptions;
}>;

/** Converts the finite dashboard model into the stricter media-core schema. */
export function parseDashboardJobRequest(input: unknown): ValidatedJobRequest {
  const request = JobRequestSchema.parse(input);
  if (request.preset !== request.options.preset) {
    throw new z.ZodError([]);
  }
  if (request.preset === "lossless-remux") {
    return { assetId: request.assetId, options: parsePresetOptions({ preset: request.preset }) };
  }

  const enhancements = {
    sharpening: 0,
    denoise: 0,
    deband: 0,
    brightness: 0,
    contrast: 1,
    saturation: 1,
    gamma: 1,
    audioNormalize: false,
  };

  if (request.preset === "tiktok-safe") {
    return {
      assetId: request.assetId,
      options: parsePresetOptions({
        preset: request.preset,
        fps: request.options.safeFps,
        resolution: request.options.outputResolution,
        performance: request.options.performance,
        fitMode: request.options.fitMode,
        scaling: request.options.lanczos ? "lanczos" : "bicubic",
        toneMap: "auto",
        enhancements,
      }),
    };
  }

  if (request.preset === "maximum-quality") {
    return {
      assetId: request.assetId,
      options: parsePresetOptions({
        preset: request.preset,
        codec: request.options.codec,
        frameRate: "preserve",
        performance: request.options.performance,
        fitMode: request.options.fitMode,
        scaling: request.options.lanczos ? "lanczos" : "bicubic",
        preserveHdr: true,
        toneMap: "auto",
        enhancements,
      }),
    };
  }

  return {
    assetId: request.assetId,
    options: parsePresetOptions({
      preset: request.preset,
      codec: request.options.codec,
      resolution: request.options.outputResolution,
      cadence: request.options.masterCadence,
      performance: request.options.performance,
      fitMode: request.options.fitMode,
      scaling: request.options.lanczos ? "lanczos" : "bicubic",
      preserveHdr: true,
      toneMap: "auto",
      enhancements,
    }),
  };
}
