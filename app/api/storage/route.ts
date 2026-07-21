import { z } from "zod";
import { apiErrorResponse, requireApiSession, requireMutationSession } from "@/lib/api";
import { exportsRepository, mediaAssets, settingsRepository } from "@/lib/db";
import { jsonResponse, readSmallJsonObject } from "@/lib/http-security";
import { getOwnerSettings } from "@/lib/owner-settings";
import { getStoragePaths } from "@/lib/paths";
import { availableDiskBytes } from "@/lib/storage";
import { directoryBytes } from "@/lib/storage-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function storagePayload(ownerId: number) {
  const paths = getStoragePaths();
  const settings = getOwnerSettings(ownerId);
  const assets = mediaAssets.list(ownerId, 500).filter((item) => item.status !== "deleted");
  const exportsList = exportsRepository.list(ownerId, 500);
  const sourceBytes = assets.reduce((sum, item) => sum + item.bytes, 0);
  const exportBytes = exportsList.reduce((sum, item) => sum + item.bytes, 0);
  const tempBytes = await directoryBytes(paths.tempRoot);
  return {
    summary: {
      usedBytes: sourceBytes + exportBytes + tempBytes,
      sourceBytes,
      exportBytes,
      tempBytes,
      freeBytes: availableDiskBytes(),
      maxUploadBytes: settings.maxUploadBytes,
      retentionHours: settings.tempRetentionHours,
    },
    assets: assets.map((item) => ({
      id: item.id,
      originalName: item.originalName,
      bytes: item.bytes,
      createdAt: new Date(item.createdAt).toISOString(),
      status: item.status,
    })),
    exports: exportsList.map((item) => ({
      id: item.id,
      displayName: item.displayName,
      bytes: item.bytes,
      createdAt: new Date(item.createdAt).toISOString(),
      status: "verified",
    })),
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const session = requireApiSession(request);
    return jsonResponse(await storagePayload(session.owner.id));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const session = requireMutationSession(request);
    const input = z.object({ retentionHours: z.number().int().min(1).max(8_760) }).strict()
      .parse(await readSmallJsonObject(request));
    const current = getOwnerSettings(session.owner.id);
    settingsRepository.update({
      ownerId: current.ownerId,
      defaultPreset: current.defaultPreset,
      performanceMode: current.performanceMode,
      maxUploadBytes: current.maxUploadBytes,
      tempRetentionHours: input.retentionHours,
      outputRetentionDays: current.outputRetentionDays,
      enhancements: current.enhancements,
    });
    return jsonResponse({ ok: true, ...(await storagePayload(session.owner.id)) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
