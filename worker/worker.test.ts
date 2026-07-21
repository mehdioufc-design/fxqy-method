import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

describe.sequential("processing worker lifecycle", () => {
  let dataRoot = "";
  let workerModule: typeof import("./worker");
  let databaseModule: typeof import("../lib/db");
  let pathsModule: typeof import("../lib/paths");
  let configModule: typeof import("../lib/config");
  const previousEnvironment: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const name of [
      "APP_ORIGIN",
      "DATA_ROOT",
      "MIN_FREE_BYTES",
    ]) {
      previousEnvironment[name] = process.env[name];
    }
    dataRoot = await mkdtemp(path.join(os.tmpdir(), "tto-worker-test-"));
    process.env.APP_ORIGIN = "http://localhost:3000";
    process.env.DATA_ROOT = dataRoot;
    process.env.MIN_FREE_BYTES = String(128 * 1024 * 1024);

    configModule = await import("../lib/config");
    configModule.resetAppConfigForTests();
    databaseModule = await import("../lib/db");
    pathsModule = await import("../lib/paths");
    workerModule = await import("./worker");
    databaseModule.owners.ensureLocal();
  });

  afterAll(async () => {
    databaseModule.closeDatabase();
    configModule.resetAppConfigForTests();
    await rm(dataRoot, { recursive: true, force: true });
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  test("starts idle and shuts down through its abort signal", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25);
    await workerModule.runWorker(controller.signal);
    clearTimeout(timer);
  });

  test("removes only expired known exports and preserves source history", async () => {
    const storage = pathsModule.ensureStorageDirectories();
    const assetId = randomUUID();
    const sourceKey = path.posix.join("uploads", `${assetId}.source`);
    const sourcePath = pathsModule.resolveContainedPath(storage.mediaRoot, sourceKey);
    await writeFile(sourcePath, Buffer.from("private-source"));
    const now = Date.now();
    databaseModule.mediaAssets.create({
      id: assetId,
      ownerId: databaseModule.SINGLE_OWNER_ID,
      originalName: "source.mp4",
      storageKey: sourceKey,
      bytes: 14,
      probedMime: "video/mp4",
      sha256: null,
      status: "ready",
      createdAt: now,
      expiresAt: null,
    });
    const jobId = randomUUID();
    databaseModule.jobs.create({
      id: jobId,
      ownerId: databaseModule.SINGLE_OWNER_ID,
      sourceAssetId: assetId,
      preset: "tiktok-safe",
      settings: { preset: "tiktok-safe" },
      status: "completed",
      phase: "Completed",
      progress: 100,
      createdAt: now,
    });
    const exportId = randomUUID();
    const exportKey = path.posix.join("exports", `${exportId}.mp4`);
    const exportPath = pathsModule.resolveContainedPath(storage.mediaRoot, exportKey);
    await writeFile(exportPath, Buffer.from("verified-export"));
    databaseModule.exportsRepository.create({
      id: exportId,
      ownerId: databaseModule.SINGLE_OWNER_ID,
      jobId,
      storageKey: exportKey,
      displayName: "verified.mp4",
      bytes: 15,
      sha256: null,
      media: { verified: true },
      createdAt: now,
      expiresAt: now - 1,
      deletedAt: null,
    });

    await workerModule.cleanExpiredKnownFiles(now);

    await expect(stat(exportPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(sourcePath)).resolves.toMatchObject({ size: 14 });
    const expired = databaseModule.exportsRepository.get(
      exportId,
      databaseModule.SINGLE_OWNER_ID,
    );
    expect(expired?.deletedAt).toBe(now);
    expect(expired?.expiresAt).toBeNull();
  });

  test("does not fabricate work when the queue is empty", async () => {
    await expect(workerModule.processNextQueuedJob()).resolves.toBe(false);
  });

  test("names exports after the source with the FXQYMethod suffix", () => {
    expect(workerModule.outputDisplayName("Video.mp4")).toBe("Video.FXQYMethod.mp4");
    expect(workerModule.outputDisplayName("my holiday.mov")).toBe("my holiday.FXQYMethod.mp4");
  });
});
