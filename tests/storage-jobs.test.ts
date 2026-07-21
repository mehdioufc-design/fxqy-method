import { createHash, randomUUID } from "node:crypto";
import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getAppConfig } from "../lib/config";
import {
  jobs,
  mediaAssets,
  SINGLE_OWNER_ID,
} from "../lib/db";
import {
  MediaToolError,
  probeMedia,
  trustedExistingMediaPath,
} from "../lib/media";
import {
  contentDispositionAttachment,
  ensureStorageDirectories,
  getStoragePaths,
  resolveContainedPath,
  safeDisplayFilename,
} from "../lib/paths";
import {
  createJobAttemptDirectory,
  deleteMediaKey,
  removeJobAttemptDirectory,
  StorageError,
  streamUploadToPrivateStorage,
} from "../lib/storage";
import {
  cleanExpiredKnownFiles,
  processNextQueuedJob,
  runWorker,
} from "../worker/worker";
import {
  IsolatedAppEnvironment,
} from "./helpers/isolated-app-environment";

const environment = new IsolatedAppEnvironment();

beforeAll(async () => environment.start());
beforeEach(async () => environment.reset());
afterAll(async () => environment.dispose());

function streamingRequest(
  chunks: readonly Uint8Array[],
  headers: Record<string, string> = {},
): Request {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
  return new Request("http://localhost:3000/api/uploads", {
    method: "POST",
    body,
    headers,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

async function pathExists(candidate: string): Promise<boolean> {
  return stat(candidate).then(() => true, () => false);
}

function createAsset(options: {
  id?: string;
  storageKey?: string;
  bytes?: number;
  expiresAt?: number | null;
  status?: "staged" | "analyzing" | "ready" | "failed" | "deleted";
} = {}) {
  const id = options.id ?? randomUUID();
  const now = Date.now();
  return mediaAssets.create({
    id,
    ownerId: SINGLE_OWNER_ID,
    originalName: "private-source.mp4",
    storageKey: options.storageKey ?? path.posix.join("uploads", `${id}.source`),
    bytes: options.bytes ?? 1,
    probedMime: "video/mp4",
    sha256: null,
    status: options.status ?? "ready",
    createdAt: now,
    expiresAt: options.expiresAt ?? null,
  });
}

function createQueuedJob(sourceAssetId: string, id = randomUUID()) {
  return jobs.create({
    id,
    ownerId: SINGLE_OWNER_ID,
    sourceAssetId,
    preset: "tiktok-safe",
    settings: { preset: "tiktok-safe" },
    status: "queued",
    phase: "Queued",
    progress: 0,
    createdAt: Date.now(),
  });
}

describe.sequential("private upload storage", () => {
  it("streams unusual filenames into UUID-owned private paths and hashes the content", async () => {
    const content = Buffer.from("small private upload payload");
    const hostileName = "..\\holiday/clip \u0000 \u30c6\u30b9\u30c8 \"final\"?.MP4 ";
    const request = streamingRequest([content.subarray(0, 8), content.subarray(8)], {
      "content-length": String(content.length),
      "x-file-name": encodeURIComponent(hostileName),
    });

    const stored = await streamUploadToPrivateStorage(request, 1_024);
    const roots = getStoragePaths();
    expect(stored.originalName).toBe(".._holiday_clip \u30c6\u30b9\u30c8 _final__.MP4");
    expect(stored.storageKey).toMatch(/^uploads\/[0-9a-f-]{36}\.source$/i);
    expect(stored.absolutePath).toBe(resolveContainedPath(roots.mediaRoot, stored.storageKey));
    expect(stored.bytes).toBe(content.length);
    expect(stored.sha256).toBe(createHash("sha256").update(content).digest("hex"));
    await expect(stat(stored.absolutePath)).resolves.toMatchObject({ size: content.length });
  });

  it("enforces the streaming limit even without Content-Length and removes partial data", async () => {
    const roots = ensureStorageDirectories();
    const request = streamingRequest([
      Buffer.alloc(20, 1),
      Buffer.alloc(20, 2),
      Buffer.alloc(20, 3),
    ], { "x-file-name": "large.mp4" });

    await expect(streamUploadToPrivateStorage(request, 32)).rejects.toMatchObject({
      name: "StorageError",
      code: "UPLOAD_TOO_LARGE",
      status: 413,
    });
    expect(await readdir(roots.uploadsRoot)).toEqual([]);
  });

  it("rejects oversized declarations, incomplete bodies, and empty uploads", async () => {
    await expect(
      streamUploadToPrivateStorage(
        streamingRequest([Buffer.from("tiny")], { "content-length": "999" }),
        32,
      ),
    ).rejects.toMatchObject({ code: "UPLOAD_TOO_LARGE" });

    await expect(
      streamUploadToPrivateStorage(
        streamingRequest([Buffer.from("short")], { "content-length": "12" }),
        32,
      ),
    ).rejects.toMatchObject({ code: "INCOMPLETE_UPLOAD" });

    await expect(streamUploadToPrivateStorage(streamingRequest([]), 32)).rejects.toMatchObject({
      code: "EMPTY_UPLOAD",
    });
    expect(await readdir(getStoragePaths().uploadsRoot)).toEqual([]);
  });

  it("rejects extension-only impostors through FFprobe and erases their private bytes", async () => {
    const body = Buffer.from("This is text with an MP4 extension, not a media stream.");
    const stored = await streamUploadToPrivateStorage(streamingRequest([body], {
      "x-file-name": encodeURIComponent("looks-valid.mp4"),
      "content-length": String(body.length),
      "content-type": "video/mp4",
    }));
    const trusted = await trustedExistingMediaPath(getAppConfig().mediaRoot, stored.absolutePath);
    let rejection: unknown;
    try {
      await probeMedia(trusted, {
        ffprobePath: getAppConfig().ffprobePath,
        timeoutMs: 10_000,
        packetScanTimeoutMs: 10_000,
      });
    } catch (error) {
      rejection = error;
    } finally {
      await deleteMediaKey(stored.storageKey);
    }

    expect(rejection).toBeInstanceOf(MediaToolError);
    expect(rejection).toMatchObject({
      code: expect.stringMatching(/^(PROBE_FAILED|SPAWN_FAILED)$/),
    });
    expect(await readdir(getStoragePaths().uploadsRoot)).toEqual([]);
  });

  it("blocks traversal and emits safe download filenames", () => {
    const root = getStoragePaths().mediaRoot;
    for (const key of ["../owner.sqlite", "uploads/../../owner.sqlite", "C:\\private\\video.mp4", "/etc/passwd", "\0.mp4"]) {
      expect(() => resolveContainedPath(root, key)).toThrow();
    }

    expect(safeDisplayFilename("../../my\\clip:<bad>*?.mp4")).toBe(".._.._my_clip__bad___.mp4");
    const disposition = contentDispositionAttachment("\u30de\u30a4\u52d5\u753b \"one\".mp4\r\nX-Evil: yes");
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition).not.toContain("\r");
    expect(disposition).not.toContain("\n");
    expect(disposition).not.toContain("X-Evil:");
  });
});

describe.sequential("temporary files and job terminal states", () => {
  it("removes only validated per-attempt directories", async () => {
    const jobId = randomUUID();
    const attempt = await createJobAttemptDirectory(jobId, 1);
    await writeFile(path.join(attempt, "candidate.mp4"), Buffer.from("temporary output"));
    await removeJobAttemptDirectory(attempt);
    expect(await pathExists(attempt)).toBe(false);

    await expect(removeJobAttemptDirectory(environment.root)).rejects.toBeInstanceOf(StorageError);
    expect(await pathExists(environment.root)).toBe(true);
  });

  it("settles a cancellation requested while a job is still queued", async () => {
    const asset = createAsset();
    const job = createQueuedJob(asset.id);
    expect(jobs.requestCancellation(job.id, SINGLE_OWNER_ID)).toBe(true);
    expect(jobs.get(job.id)?.status).toBe("cancel_requested");

    const controller = new AbortController();
    controller.abort();
    await runWorker(controller.signal);
    expect(jobs.get(job.id)).toMatchObject({
      status: "cancelled",
      phase: "Cancelled",
      errorCode: "CANCELLED",
    });
  });

  it("fails safely and cleans its attempt output when the source is missing", async () => {
    const asset = createAsset({ bytes: 123 });
    const job = createQueuedJob(asset.id);

    await expect(processNextQueuedJob("missing-source-test")).resolves.toBe(true);
    const failed = jobs.get(job.id);
    expect(failed).toMatchObject({
      status: "failed",
      phase: "Failed",
    });
    expect(failed?.errorCode).toMatch(/SOURCE_|PROCESSING_/);
    expect(failed?.safeErrorMessage).not.toContain(getStoragePaths().mediaRoot);

    const jobTempRoot = path.join(getStoragePaths().tempRoot, job.id);
    const remaining = await readdir(jobTempRoot).catch(() => []);
    expect(remaining).toEqual([]);
  });

  it("deletes expired known sources but preserves one referenced by active work", async () => {
    const roots = ensureStorageDirectories();
    const now = Date.now();
    const expired = createAsset({ expiresAt: now - 1 });
    const protectedAsset = createAsset({ expiresAt: now - 1 });
    const expiredPath = resolveContainedPath(roots.mediaRoot, expired.storageKey);
    const protectedPath = resolveContainedPath(roots.mediaRoot, protectedAsset.storageKey);
    await writeFile(expiredPath, Buffer.from("expired"));
    await writeFile(protectedPath, Buffer.from("active"));
    createQueuedJob(protectedAsset.id);

    await cleanExpiredKnownFiles(now);

    expect(await pathExists(expiredPath)).toBe(false);
    expect(mediaAssets.get(expired.id)).toMatchObject({ status: "deleted", expiresAt: null });
    expect(await pathExists(protectedPath)).toBe(true);
    expect(mediaAssets.get(protectedAsset.id)?.status).toBe("ready");
  });
});
