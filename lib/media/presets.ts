import { z } from "zod";

export const PerformanceModeSchema = z.enum([
  "fast-hardware",
  "balanced",
  "maximum-cpu",
]);
export type PerformanceMode = z.infer<typeof PerformanceModeSchema>;

export const FitModeSchema = z.enum(["crop", "fit", "blurred-background"]);
export type FitMode = z.infer<typeof FitModeSchema>;

export const OutputResolutionSchema = z.enum(["1080p", "2k"]);
export type OutputResolution = z.infer<typeof OutputResolutionSchema>;

const DEFAULT_ENHANCEMENTS = Object.freeze({
  sharpening: 0,
  denoise: 0,
  deband: 0,
  brightness: 0,
  contrast: 1,
  saturation: 1,
  gamma: 1,
  audioNormalize: false,
});

export const EnhancementOptionsSchema = z
  .object({
    sharpening: z.number().min(0).max(0.6).default(0),
    denoise: z.number().min(0).max(0.5).default(0),
    deband: z.number().min(0).max(1).default(0),
    brightness: z.number().min(-0.1).max(0.1).default(0),
    contrast: z.number().min(0.8).max(1.2).default(1),
    saturation: z.number().min(0.8).max(1.2).default(1),
    gamma: z.number().min(0.8).max(1.2).default(1),
    audioNormalize: z.boolean().default(false),
  })
  .strict();
export type EnhancementOptions = z.infer<typeof EnhancementOptionsSchema>;

const TikTokSafeOptionsSchema = z
  .object({
    preset: z.literal("tiktok-safe"),
    fps: z.union([z.literal(30), z.literal(60)]).default(60),
    resolution: OutputResolutionSchema.default("1080p"),
    performance: PerformanceModeSchema.default("balanced"),
    fitMode: FitModeSchema.default("crop"),
    scaling: z.enum(["lanczos", "bicubic"]).default("lanczos"),
    toneMap: z.enum(["auto", "mobius", "hable"]).default("auto"),
    enhancements: EnhancementOptionsSchema.default(DEFAULT_ENHANCEMENTS),
  })
  .strict();

const MaximumQualityOptionsSchema = z
  .object({
    preset: z.literal("maximum-quality"),
    codec: z.enum(["h264", "hevc"]).default("h264"),
    frameRate: z.enum(["preserve", "30", "60"]).default("preserve"),
    performance: PerformanceModeSchema.default("balanced"),
    fitMode: FitModeSchema.default("crop"),
    scaling: z.enum(["lanczos", "bicubic"]).default("lanczos"),
    preserveHdr: z.boolean().default(true),
    toneMap: z.enum(["auto", "mobius", "hable"]).default("auto"),
    enhancements: EnhancementOptionsSchema.default(DEFAULT_ENHANCEMENTS),
  })
  .strict();

const Master120OptionsSchema = z
  .object({
    preset: z.literal("master-120"),
    codec: z.enum(["h264", "hevc"]).default("hevc"),
    resolution: OutputResolutionSchema.default("2k"),
    cadence: z.enum(["native", "duplicate", "optical-flow"]),
    performance: PerformanceModeSchema.default("balanced"),
    fitMode: FitModeSchema.default("crop"),
    scaling: z.enum(["lanczos", "bicubic"]).default("lanczos"),
    preserveHdr: z.boolean().default(true),
    toneMap: z.enum(["auto", "mobius", "hable"]).default("auto"),
    enhancements: EnhancementOptionsSchema.default(DEFAULT_ENHANCEMENTS),
  })
  .strict();

const LosslessRemuxOptionsSchema = z
  .object({
    preset: z.literal("lossless-remux"),
  })
  .strict();

export const PresetOptionsSchema = z.discriminatedUnion("preset", [
  TikTokSafeOptionsSchema,
  MaximumQualityOptionsSchema,
  Master120OptionsSchema,
  LosslessRemuxOptionsSchema,
]);

export type PresetOptions = z.infer<typeof PresetOptionsSchema>;
export type TikTokSafeOptions = z.infer<typeof TikTokSafeOptionsSchema>;
export type MaximumQualityOptions = z.infer<typeof MaximumQualityOptionsSchema>;
export type Master120Options = z.infer<typeof Master120OptionsSchema>;
export type LosslessRemuxOptions = z.infer<typeof LosslessRemuxOptionsSchema>;

export function parsePresetOptions(input: unknown): PresetOptions {
  return PresetOptionsSchema.parse(input);
}
