import fs from "node:fs";
import path from "node:path";
import { getAppConfig } from "./config";

export type StoragePaths = Readonly<{
  dataRoot: string;
  databasePath: string;
  mediaRoot: string;
  uploadsRoot: string;
  exportsRoot: string;
  previewsRoot: string;
  trashRoot: string;
  tempRoot: string;
}>;

export function getStoragePaths(): StoragePaths {
  const config = getAppConfig();
  return Object.freeze({
    dataRoot: config.dataRoot,
    databasePath: config.databasePath,
    mediaRoot: config.mediaRoot,
    uploadsRoot: path.join(config.mediaRoot, "uploads"),
    exportsRoot: path.join(config.mediaRoot, "exports"),
    previewsRoot: path.join(config.mediaRoot, "previews"),
    trashRoot: path.join(config.dataRoot, ".trash"),
    tempRoot: config.tempRoot,
  });
}

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/** Resolve a server-owned relative storage key without following it. */
export function resolveContainedPath(root: string, relativeKey: string): string {
  if (
    !relativeKey ||
    path.isAbsolute(relativeKey) ||
    relativeKey.includes("\0") ||
    /^[a-zA-Z]:/.test(relativeKey)
  ) {
    throw new Error("Invalid storage key.");
  }
  const resolved = path.resolve(root, relativeKey);
  if (!isPathInside(root, resolved) || resolved === path.resolve(root)) {
    throw new Error("Storage key escapes its configured root.");
  }
  return resolved;
}

/** Also verifies symlinks/reparse points for an existing target. */
export function resolveExistingContainedPath(root: string, relativeKey: string): string {
  const resolved = resolveContainedPath(root, relativeKey);
  const realRoot = fs.realpathSync(root);
  const realTarget = fs.realpathSync(resolved);
  if (!isPathInside(realRoot, realTarget) || realTarget === realRoot) {
    throw new Error("Resolved storage target escapes its configured root.");
  }
  return realTarget;
}

export function ensureStorageDirectories(): StoragePaths {
  const paths = getStoragePaths();
  const directories = [
    paths.dataRoot,
    path.dirname(paths.databasePath),
    paths.mediaRoot,
    paths.uploadsRoot,
    paths.exportsRoot,
    paths.previewsRoot,
    paths.trashRoot,
    paths.tempRoot,
  ];
  for (const directory of directories) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("A configured storage directory is not a real directory.");
    }
  }
  return paths;
}

export function safeDisplayFilename(value: string, fallback = "video.mp4"): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 180);
  if (!normalized || normalized === "." || normalized === "..") return fallback;
  return normalized;
}

export function contentDispositionAttachment(filename: string): string {
  const safe = safeDisplayFilename(filename);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(safe).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function isSafeObjectId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
