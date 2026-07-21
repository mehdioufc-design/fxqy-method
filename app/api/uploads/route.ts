import { apiErrorResponse, requireApiSession, requireMutationSession } from "@/lib/api";
import { getAppConfig } from "@/lib/config";
import { maintenanceState, mediaAssets } from "@/lib/db";
import { jsonResponse } from "@/lib/http-security";
import { probeMedia, trustedExistingMediaPath } from "@/lib/media";
import { getOwnerSettings } from "@/lib/owner-settings";
import {
  deleteMediaKey,
  StorageError,
  streamUploadToPrivateStorage,
} from "@/lib/storage";
import { assetView } from "@/lib/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1_800;

export async function POST(request: Request): Promise<Response> {
  let storageKey: string | undefined;
  let assetId: string | undefined;
  try {
    const session = requireMutationSession(request);
    if (maintenanceState.get().locked) {
      throw new StorageError("MAINTENANCE_ACTIVE", "Local storage maintenance is in progress.", 423);
    }
    const stored = await streamUploadToPrivateStorage(
      request,
      getOwnerSettings(session.owner.id).maxUploadBytes,
    );
    storageKey = stored.storageKey;
    assetId = stored.id;
    const now = Date.now();
    const asset = mediaAssets.create({
      id: stored.id,
      ownerId: session.owner.id,
      originalName: stored.originalName,
      storageKey: stored.storageKey,
      bytes: stored.bytes,
      probedMime: null,
      sha256: stored.sha256,
      status: "analyzing",
      createdAt: now,
      expiresAt: null,
    });

    try {
      const trusted = await trustedExistingMediaPath(getAppConfig().mediaRoot, stored.absolutePath);
      const analysis = await probeMedia(trusted, {
        ffprobePath: getAppConfig().ffprobePath,
        signal: request.signal,
        sha256: stored.sha256,
      });
      if (analysis.file.durationSeconds <= 0 || analysis.video.width > 16_384 || analysis.video.height > 16_384) {
        throw new Error("Invalid media dimensions or duration.");
      }
      mediaAssets.setAnalysis(asset.id, session.owner.id, analysis, "ready");
      const ready = mediaAssets.get(asset.id, session.owner.id);
      if (!ready) throw new Error("The analysed source could not be reloaded.");
      return jsonResponse({ ok: true, asset: assetView(ready) }, { status: 201 });
    } catch {
      mediaAssets.markDeleted(asset.id, session.owner.id);
      await deleteMediaKey(stored.storageKey).catch(() => undefined);
      throw new StorageError(
        "INVALID_MEDIA",
        "FFprobe could not validate a readable video stream in this file.",
        415,
      );
    }
  } catch (error) {
    if (storageKey) await deleteMediaKey(storageKey).catch(() => undefined);
    if (assetId) {
      const session = (() => {
        try { return requireApiSession(request); } catch { return null; }
      })();
      if (session) mediaAssets.setStatus(assetId, session.owner.id, "failed");
    }
    return apiErrorResponse(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const session = requireApiSession(request);
    const assets = mediaAssets
      .list(session.owner.id, 50)
      .filter((asset) => asset.status === "ready" && asset.analysis)
      .map(assetView);
    return jsonResponse({ assets });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
