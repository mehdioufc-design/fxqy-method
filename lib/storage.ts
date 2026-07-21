import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { mkdir, open, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getAppConfig } from "./config";
import {
  ensureStorageDirectories,
  getStoragePaths,
  isPathInside,
  resolveContainedPath,
  safeDisplayFilename,
} from "./paths";

export class StorageError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.status = status;
  }
}

export type StoredUpload = Readonly<{
  id: string;
  originalName: string;
  storageKey: string;
  absolutePath: string;
  bytes: number;
  sha256: string;
}>;

export function availableDiskBytes(target = getStoragePaths().dataRoot): number {
  ensureStorageDirectories();
  const info = fs.statfsSync(target);
  const bytes = Number(info.bavail) * Number(info.bsize);
  return Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
}

export function assertDiskHeadroom(expectedBytes: number): void {
  const config = getAppConfig();
  const required = Math.max(0, expectedBytes) + config.minimumFreeBytes;
  if (availableDiskBytes() < required) {
    throw new StorageError(
      "DISK_FULL",
      "There is not enough free local disk space for this operation.",
      507,
    );
  }
}

export async function streamUploadToPrivateStorage(
  request: Request,
  configuredMaximumBytes = getAppConfig().maxUploadBytes,
): Promise<StoredUpload> {
  const config = getAppConfig();
  const maximumBytes = Math.max(
    1,
    Math.min(config.maxUploadBytes, Math.trunc(configuredMaximumBytes)),
  );
  const declaredText = request.headers.get("content-length");
  if (declaredText && (!/^\d+$/.test(declaredText) || Number(declaredText) > maximumBytes)) {
    throw new StorageError("UPLOAD_TOO_LARGE", "The upload exceeds the configured size limit.", 413);
  }
  const declared = declaredText ? Number(declaredText) : 0;
  assertDiskHeadroom(Math.max(declared, Math.min(maximumBytes, 256 * 1024 * 1024)));
  if (!request.body) throw new StorageError("EMPTY_UPLOAD", "No video data was received.");

  const id = randomUUID();
  const storageKey = path.posix.join("uploads", `${id}.source`);
  const paths = ensureStorageDirectories();
  const absolutePath = resolveContainedPath(paths.mediaRoot, storageKey);
  const originalName = decodeUploadName(request.headers.get("x-file-name"));
  const digest = createHash("sha256");
  let bytes = 0;
  const timeout = AbortSignal.timeout(30 * 60_000);
  const signal = AbortSignal.any([request.signal, timeout]);

  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maximumBytes) {
        callback(new StorageError("UPLOAD_TOO_LARGE", "The upload exceeds the configured size limit.", 413));
        return;
      }
      digest.update(chunk);
      callback(null, chunk);
    },
  });

  const handle = await open(absolutePath, "wx", 0o600);
  try {
    const webStream = Readable.fromWeb(request.body as import("node:stream/web").ReadableStream);
    await pipeline(webStream, limiter, handle.createWriteStream(), { signal });
    if (bytes <= 0) throw new StorageError("EMPTY_UPLOAD", "The uploaded file was empty.");
    if (declared > 0 && bytes !== declared) {
      throw new StorageError("INCOMPLETE_UPLOAD", "The upload ended before the declared file size was received.");
    }
    return Object.freeze({
      id,
      originalName,
      storageKey,
      absolutePath,
      bytes,
      sha256: digest.digest("hex"),
    });
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(absolutePath).catch(() => undefined);
    if (error instanceof StorageError) throw error;
    if (signal.aborted) throw new StorageError("UPLOAD_TIMEOUT", "The upload was cancelled or timed out.", 408);
    throw new StorageError("UPLOAD_FAILED", "The video could not be stored safely.");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export function projectedWorkspaceBytes(outputBytes: number): number {
  return Math.ceil(Math.max(0, outputBytes) * 2.1 + 256 * 1024 * 1024);
}

export async function createJobAttemptDirectory(jobId: string, attempt: number): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId) || !Number.isSafeInteger(attempt) || attempt < 1) {
    throw new StorageError("INVALID_STORAGE_KEY", "A processing workspace could not be created.");
  }
  const root = getStoragePaths().tempRoot;
  const target = resolveContainedPath(root, path.join(jobId, `attempt-${attempt}-${randomUUID()}`));
  await mkdir(target, { recursive: true, mode: 0o700 });
  return target;
}

export async function removeJobAttemptDirectory(target: string): Promise<void> {
  const root = path.resolve(getStoragePaths().tempRoot);
  const resolved = path.resolve(target);
  if (!isPathInside(root, resolved) || resolved === root) {
    throw new StorageError("INVALID_STORAGE_KEY", "Refusing to remove an unsafe temporary path.");
  }
  const entry = await stat(resolved).catch(() => null);
  if (!entry) return;
  const link = await fs.promises.lstat(resolved);
  if (link.isSymbolicLink()) throw new StorageError("INVALID_STORAGE_KEY", "Refusing to remove a linked temporary path.");
  await rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

export async function deleteMediaKey(relativeKey: string): Promise<void> {
  const root = getStoragePaths().mediaRoot;
  const target = resolveContainedPath(root, relativeKey);
  const entry = await fs.promises.lstat(target).catch(() => null);
  if (!entry) return;
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new StorageError("INVALID_STORAGE_KEY", "The stored media target was not a regular file.");
  }
  await unlink(target);
}

function decodeUploadName(value: string | null): string {
  if (!value || value.length > 2_048) return "video";
  try {
    return safeDisplayFilename(decodeURIComponent(value), "video");
  } catch {
    return safeDisplayFilename(value, "video");
  }
}
