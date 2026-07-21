import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { getStoragePaths, isPathInside } from "./paths";

export async function directoryBytes(root: string): Promise<number> {
  let total = 0;
  const pending = [path.resolve(root)];
  while (pending.length) {
    const current = pending.pop()!;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const target = path.resolve(current, entry.name);
      if (!isPathInside(root, target) || target === path.resolve(root) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile()) total += (await stat(target).catch(() => null))?.size ?? 0;
    }
  }
  return total;
}

/** Removes only verified direct children of the application-owned temp root. */
export async function purgeTemporaryFiles(): Promise<void> {
  const root = path.resolve(getStoragePaths().tempRoot);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const target = path.resolve(root, entry.name);
    if (!isPathInside(root, target) || target === root) {
      throw new Error("An unsafe temporary path was encountered.");
    }
    await rm(target, { recursive: entry.isDirectory() && !entry.isSymbolicLink(), force: true, maxRetries: 3 });
  }
}
