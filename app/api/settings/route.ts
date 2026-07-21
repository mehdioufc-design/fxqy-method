import { z } from "zod";
import { apiErrorResponse, requireApiSession, requireMutationSession } from "@/lib/api";
import { getAppConfig } from "@/lib/config";
import { settingsRepository } from "@/lib/db";
import { jsonResponse, readSmallJsonObject } from "@/lib/http-security";
import { getOwnerSettings, settingsView } from "@/lib/owner-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EnhancementsSchema = z
  .object({
    lanczos: z.boolean().optional(),
    normalizeAudio: z.boolean().optional(),
    captionGuides: z.boolean().optional(),
    sharpen: z.number().finite().min(0).max(1).optional(),
    denoise: z.number().finite().min(0).max(1).optional(),
    deband: z.number().finite().min(0).max(1).optional(),
  })
  .strict();

const SettingsInputSchema = z
  .object({
    defaultPreset: z.enum(["tiktok-safe", "maximum-quality", "master-120", "lossless-remux"]),
    performance: z.enum(["fast-hardware", "balanced", "maximum-cpu"]),
    maxUploadBytes: z.number().int().min(1024 * 1024),
    retentionHours: z.number().int().min(1).max(8_760),
    outputRetentionDays: z.number().int().min(1).max(3_650).nullable(),
    enhancements: EnhancementsSchema,
  })
  .strict();

export async function GET(request: Request): Promise<Response> {
  try {
    const session = requireApiSession(request);
    return jsonResponse({ settings: settingsView(getOwnerSettings(session.owner.id)) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const session = requireMutationSession(request);
    const input = SettingsInputSchema.parse(await readSmallJsonObject(request));
    if (input.maxUploadBytes > getAppConfig().maxUploadBytes) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "UPLOAD_LIMIT_TOO_HIGH",
            message: "The owner upload limit cannot exceed the MAX_UPLOAD_BYTES environment ceiling.",
          },
        },
        { status: 400 },
      );
    }
    const saved = settingsRepository.update({
      ownerId: session.owner.id,
      defaultPreset: input.defaultPreset,
      performanceMode: input.performance.replaceAll("-", "_") as "fast_hardware" | "balanced" | "maximum_cpu",
      maxUploadBytes: input.maxUploadBytes,
      tempRetentionHours: input.retentionHours,
      outputRetentionDays: input.outputRetentionDays,
      enhancements: input.enhancements,
    });
    return jsonResponse({ ok: true, settings: settingsView(saved) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
