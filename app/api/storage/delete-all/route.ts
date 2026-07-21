import { apiErrorResponse, requireMutationSession } from "@/lib/api";
import {
  compactPrivateDatabase,
  deleteAllOwnerMediaHistory,
  exportsRepository,
  jobs,
  maintenanceState,
  mediaAssets,
} from "@/lib/db";
import { jsonResponse, readSmallJsonObject } from "@/lib/http-security";
import { deleteMediaKey, StorageError } from "@/lib/storage";
import { purgeTemporaryFiles } from "@/lib/storage-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function POST(request: Request): Promise<Response> {
  let acquired = false;
  try {
    const session = requireMutationSession(request);
    const body = await readSmallJsonObject(request);
    if (body.confirmation !== "DELETE ALL FILES") {
      throw new StorageError("CONFIRMATION_REQUIRED", "Enter the exact deletion phrase.", 400);
    }
    acquired = maintenanceState.tryAcquire("delete-all", { ownerId: session.owner.id });
    if (!acquired) throw new StorageError("MAINTENANCE_ACTIVE", "Another storage operation is already running.", 423);

    const allJobs = jobs.listAll(session.owner.id);
    const allAssets = mediaAssets.listAll(session.owner.id);
    const allExports = exportsRepository.listAll(session.owner.id);
    for (const job of allJobs) {
      if (["queued", "analyzing", "processing"].includes(job.status)) {
        jobs.requestCancellation(job.id, session.owner.id);
        if (job.status === "queued") {
          jobs.setStatus(job.id, session.owner.id, "cancelled", {
            phase: "Cancelled for storage deletion",
            completedAt: Date.now(),
          });
        }
      }
    }

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const active = jobs.listAll(session.owner.id).some((job) =>
        ["analyzing", "processing", "cancel_requested"].includes(job.status),
      );
      if (!active) break;
      await pause(250);
    }
    const stillActive = jobs.listAll(session.owner.id).some((job) =>
      ["analyzing", "processing", "cancel_requested"].includes(job.status),
    );
    if (stillActive) {
      throw new StorageError(
        "JOBS_STILL_STOPPING",
        "A processing job is still stopping. Wait a moment, then try deletion again.",
        409,
      );
    }

    for (const item of allExports) await deleteMediaKey(item.storageKey).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    for (const item of allAssets) await deleteMediaKey(item.storageKey).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await purgeTemporaryFiles();
    deleteAllOwnerMediaHistory(session.owner.id);
    compactPrivateDatabase();
    return jsonResponse({
      ok: true,
      deleted: { assets: allAssets.length, exports: allExports.length, jobs: allJobs.length },
    });
  } catch (error) {
    return apiErrorResponse(error);
  } finally {
    if (acquired) maintenanceState.release();
  }
}
