import { randomUUID } from "node:crypto";
import { apiErrorResponse, requireApiSession, requireMutationSession } from "@/lib/api";
import { jobs, maintenanceState, mediaAssets } from "@/lib/db";
import { jsonResponse, readSmallJsonObject } from "@/lib/http-security";
import { parseDashboardJobRequest } from "@/lib/job-options";
import { StorageError } from "@/lib/storage";
import { jobView, parseStoredAnalysis } from "@/lib/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const session = requireMutationSession(request);
    if (maintenanceState.get().locked) {
      throw new StorageError("MAINTENANCE_ACTIVE", "Local storage maintenance is in progress.", 423);
    }
    const body = await readSmallJsonObject(request, 32 * 1024);
    const validated = parseDashboardJobRequest(body);
    const asset = mediaAssets.get(validated.assetId, session.owner.id);
    const analysis = asset ? parseStoredAnalysis(asset.analysis) : null;
    if (!asset || asset.status !== "ready" || asset.deletedAt || !analysis) {
      throw new StorageError("SOURCE_NOT_READY", "The selected source is unavailable or has not passed analysis.", 409);
    }
    if (validated.options.preset === "lossless-remux" && !analysis.remux.eligible) {
      const reason = analysis.remux.blockers[0] ?? "This source requires a standards-compliant re-encode.";
      throw new StorageError("REMUX_INELIGIBLE", `${reason} Choose the encoded 60 FPS export instead.`, 409);
    }
    const now = Date.now();
    const job = jobs.create({
      id: randomUUID(),
      ownerId: session.owner.id,
      sourceAssetId: asset.id,
      preset: validated.options.preset,
      settings: validated.options,
      status: "queued",
      phase: "Waiting for local worker",
      progress: 0,
      createdAt: now,
    });
    return jsonResponse({ ok: true, job: jobView(job) }, { status: 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const session = requireApiSession(request);
    const url = new URL(request.url);
    const parsedLimit = Number(url.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(100, Math.trunc(parsedLimit))) : 100;
    return jsonResponse({ jobs: jobs.list(session.owner.id, limit).map(jobView) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
