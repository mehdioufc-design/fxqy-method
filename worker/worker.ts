import { spawn } from "node:child_process";
import { constants as fsConstants, createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  open,
  readdir,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { getAppConfig } from "../lib/config";
import {
  closeDatabase,
  exportsRepository,
  getDatabase,
  jobs,
  maintenanceState,
  mediaAssets,
  settingsRepository,
  type ProcessingJob,
} from "../lib/db";
import {
  buildDecodeValidationCommand,
  buildFfmpegCommand,
  buildStreamHashCommand,
  detectMediaCapabilities,
  EMPTY_MEDIA_CAPABILITIES,
  FfmpegProgressParser,
  MediaConfigurationError,
  MediaToolError,
  parsePresetOptions,
  probeMedia,
  progressFraction,
  sanitizeFfmpegDiagnostic,
  trustedExistingMediaPath,
  trustedPathWithin,
  verifyOutputAnalysis,
  verifyRemuxInvariants,
  type CommandSpec,
  type FfmpegProgressUpdate,
  type MediaAnalysis,
  type MediaCapabilities,
  type TrustedMediaPath,
  type ValidationCommandSpec,
} from "../lib/media";
import {
  getStoragePaths,
  isPathInside,
  resolveContainedPath,
  safeDisplayFilename,
} from "../lib/paths";
import {
  assertDiskHeadroom,
  createJobAttemptDirectory,
  deleteMediaKey,
  projectedWorkspaceBytes,
  removeJobAttemptDirectory,
  StorageError,
} from "../lib/storage";

const LEASE_MS = 30_000;
const LEASE_REFRESH_MS = 8_000;
const CANCEL_POLL_MS = 750;
const IDLE_POLL_MS = 750;
const RECOVERY_INTERVAL_MS = 30_000;
const CLEANUP_INTERVAL_MS = 15 * 60_000;
const CAPABILITY_CACHE_MS = 10 * 60_000;
const CAPABILITY_FAILURE_CACHE_MS = 15_000;
const GRACEFUL_STOP_MS = 3_000;
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES = 128 * 1024;

type JobAbortKind = "cancelled" | "timeout" | "shutdown" | "lease-lost";

class JobAbortError extends Error {
  readonly kind: JobAbortKind;

  constructor(kind: JobAbortKind) {
    super(kind);
    this.name = "JobAbortError";
    this.kind = kind;
  }
}

class WorkerJobError extends Error {
  readonly code: string;
  readonly safeMessage: string;

  constructor(code: string, safeMessage: string, options: { cause?: unknown } = {}) {
    super(safeMessage, options);
    this.name = "WorkerJobError";
    this.code = code.slice(0, 80);
    this.safeMessage = safeMessage.slice(0, 500);
  }
}

type ExecutableSpec = Pick<ValidationCommandSpec, "executable" | "args" | "redactedArgs">;

type RunCommandOptions = Readonly<{
  signal: AbortSignal;
  cwd: string;
  privatePaths: readonly string[];
  captureStdout?: boolean;
  onStdout?: (chunk: Buffer) => void;
  onDiagnostic?: (line: string) => void;
}>;

type RunCommandResult = Readonly<{
  stdout: string;
  lastDiagnostic: string;
}>;

type CapabilityCache = {
  ffmpegPath: string;
  expiresAt: number;
  promise: Promise<MediaCapabilities>;
};

let capabilityCache: CapabilityCache | undefined;

function abortWith(controller: AbortController, kind: JobAbortKind): void {
  if (!controller.signal.aborted) controller.abort(new JobAbortError(kind));
}

function abortError(signal: AbortSignal): JobAbortError {
  return signal.reason instanceof JobAbortError
    ? signal.reason
    : new JobAbortError("shutdown");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function restrictedSubprocessEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
    "LD_LIBRARY_PATH",
    "DYLD_LIBRARY_PATH",
    "CUDA_VISIBLE_DEVICES",
    "LIBVA_DRIVER_NAME",
    "LIBVA_DRIVERS_PATH",
  ] as const;
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV ?? "production",
  };
  for (const name of allowed) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

function boundedTail(existing: string, addition: string, maximum: number): string {
  const combined = existing + addition;
  if (Buffer.byteLength(combined, "utf8") <= maximum) return combined;
  return Buffer.from(combined, "utf8").subarray(-maximum).toString("utf8");
}

async function runCommand(
  specification: ExecutableSpec,
  options: RunCommandOptions,
): Promise<RunCommandResult> {
  throwIfAborted(options.signal);
  return new Promise((resolve, reject) => {
    const child = spawn(specification.executable, [...specification.args], {
      shell: false,
      windowsHide: true,
      cwd: options.cwd,
      env: restrictedSubprocessEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let settled = false;
    let hardKillTimer: NodeJS.Timeout | undefined;
    let stdout = "";
    let stdoutBytes = 0;
    let diagnosticBuffer = "";
    let diagnosticRemainder = "";

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      if (hardKillTimer) clearTimeout(hardKillTimer);
      options.signal.removeEventListener("abort", requestStop);
      action();
    };

    const forceStop = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    };

    function requestStop(): void {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        child.stdin.write("q\n");
        child.stdin.end();
      } catch {
        // A process that already closed stdin will be force-stopped below if necessary.
      }
      hardKillTimer = setTimeout(forceStop, GRACEFUL_STOP_MS);
      hardKillTimer.unref();
    }

    child.stdin.on("error", () => undefined);
    if (options.signal.aborted) requestStop();
    options.signal.addEventListener("abort", requestStop, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      options.onStdout?.(chunk);
      if (!options.captureStdout) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_CAPTURE_BYTES) {
        forceStop();
        finish(() =>
          reject(
            new WorkerJobError(
              "PROCESS_OUTPUT_TOO_LARGE",
              "A media validation command returned an unexpectedly large response.",
            ),
          ),
        );
        return;
      }
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      diagnosticRemainder += chunk.toString("utf8");
      if (Buffer.byteLength(diagnosticRemainder, "utf8") > MAX_DIAGNOSTIC_BYTES * 2) {
        diagnosticRemainder = "";
        const omitted = "An oversized FFmpeg diagnostic line was omitted.";
        diagnosticBuffer = boundedTail(diagnosticBuffer, `${omitted}\n`, MAX_DIAGNOSTIC_BYTES);
        options.onDiagnostic?.(omitted);
        return;
      }
      let newline = diagnosticRemainder.indexOf("\n");
      while (newline >= 0) {
        const rawLine = diagnosticRemainder.slice(0, newline).replace(/\r$/, "");
        diagnosticRemainder = diagnosticRemainder.slice(newline + 1);
        const line = sanitizeFfmpegDiagnostic(rawLine, options.privatePaths).trim();
        if (line) diagnosticBuffer = boundedTail(diagnosticBuffer, `${line}\n`, MAX_DIAGNOSTIC_BYTES);
        if (line) options.onDiagnostic?.(line);
        newline = diagnosticRemainder.indexOf("\n");
      }
    });

    child.once("error", (error) => {
      finish(() => {
        if (options.signal.aborted) {
          reject(abortError(options.signal));
          return;
        }
        reject(
          new WorkerJobError(
            "PROCESS_START_FAILED",
            "The local media processor could not be started. Check System Diagnostics.",
            { cause: error },
          ),
        );
      });
    });

    child.once("close", (exitCode) => {
      const finalDiagnostic = sanitizeFfmpegDiagnostic(
        diagnosticRemainder,
        options.privatePaths,
      ).trim();
      if (finalDiagnostic) {
        diagnosticBuffer = boundedTail(
          diagnosticBuffer,
          `${finalDiagnostic}\n`,
          MAX_DIAGNOSTIC_BYTES,
        );
        options.onDiagnostic?.(finalDiagnostic);
      }
      finish(() => {
        if (options.signal.aborted) {
          reject(abortError(options.signal));
          return;
        }
        if (exitCode !== 0) {
          reject(
            new WorkerJobError(
              "MEDIA_PROCESS_FAILED",
              "FFmpeg could not complete this processing stage. Review the private job log and System Diagnostics.",
            ),
          );
          return;
        }
        const lastDiagnostic = diagnosticBuffer.trim().split(/\r?\n/).at(-1)?.slice(0, 500) ?? "";
        resolve({ stdout, lastDiagnostic });
      });
    });
  });
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function done(): void {
      signal.removeEventListener("abort", cancelled);
      resolve();
    }
    function cancelled(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancelled);
      reject(abortError(signal));
    }
    signal.addEventListener("abort", cancelled, { once: true });
  });
}

async function sha256File(filename: string, signal: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  const digest = createHash("sha256");
  const stream = createReadStream(filename, { signal });
  try {
    for await (const chunk of stream) {
      throwIfAborted(signal);
      digest.update(chunk as Buffer);
    }
  } catch (error) {
    if (signal.aborted) throw abortError(signal);
    throw error;
  } finally {
    stream.destroy();
  }
  return digest.digest("hex");
}

async function syncFile(filename: string): Promise<void> {
  const handle = await open(filename, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function publishCandidate(candidate: string, destination: string): Promise<void> {
  let copiedTemporary: string | undefined;
  let destinationCreated = false;
  await chmod(candidate, 0o600);
  try {
    try {
      await rename(candidate, destination);
      destinationCreated = true;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EXDEV")) {
        throw error;
      }
      copiedTemporary = `${destination}.publishing-${randomUUID()}`;
      await copyFile(candidate, copiedTemporary, fsConstants.COPYFILE_EXCL);
      await chmod(copiedTemporary, 0o600);
      await syncFile(copiedTemporary);
      await rename(copiedTemporary, destination);
      copiedTemporary = undefined;
      destinationCreated = true;
      await unlink(candidate).catch(() => undefined);
    }
    const published = await lstat(destination);
    if (!published.isFile() || published.isSymbolicLink() || published.size <= 0) {
      throw new WorkerJobError(
        "PUBLISH_VALIDATION_FAILED",
        "The verified output could not be published to private storage.",
      );
    }
    await chmod(destination, 0o600);
  } catch (error) {
    if (copiedTemporary) await unlink(copiedTemporary).catch(() => undefined);
    if (destinationCreated) await unlink(destination).catch(() => undefined);
    throw error;
  }
}

async function getCapabilities(signal: AbortSignal): Promise<MediaCapabilities> {
  throwIfAborted(signal);
  const config = getAppConfig();
  const now = Date.now();
  if (
    capabilityCache &&
    capabilityCache.ffmpegPath === config.ffmpegPath &&
    capabilityCache.expiresAt > now
  ) {
    return capabilityCache.promise;
  }
  const promise = detectMediaCapabilities({
    ffmpegPath: config.ffmpegPath,
    timeoutMs: 15_000,
  });
  capabilityCache = {
    ffmpegPath: config.ffmpegPath,
    expiresAt: now + CAPABILITY_CACHE_MS,
    promise,
  };
  try {
    const capabilities = await promise;
    throwIfAborted(signal);
    return capabilities;
  } catch (error) {
    if (capabilityCache?.promise === promise) {
      capabilityCache.expiresAt = Date.now() + CAPABILITY_FAILURE_CACHE_MS;
    }
    throw error;
  }
}

export function clearCapabilityCacheForTests(): void {
  capabilityCache = undefined;
}

function startJobMonitor(
  job: ProcessingJob,
  workerId: string,
  controller: AbortController,
  shutdownSignal: AbortSignal,
): () => void {
  const config = getAppConfig();
  let nextLeaseRefresh = Date.now();
  const onShutdown = () => abortWith(controller, "shutdown");
  shutdownSignal.addEventListener("abort", onShutdown, { once: true });
  if (shutdownSignal.aborted) onShutdown();

  const timeout = setTimeout(() => abortWith(controller, "timeout"), config.jobTimeoutMs);
  timeout.unref();
  const poll = setInterval(() => {
    if (controller.signal.aborted) return;
    const current = jobs.get(job.id, job.ownerId);
    if (!current || current.workerId !== workerId) {
      abortWith(controller, "lease-lost");
      return;
    }
    if (current.status === "cancel_requested") {
      abortWith(controller, "cancelled");
      return;
    }
    if (!["analyzing", "processing"].includes(current.status)) {
      abortWith(controller, "lease-lost");
      return;
    }
    const now = Date.now();
    if (now >= nextLeaseRefresh) {
      const refreshed = jobs.refreshLease(
        job.id,
        job.ownerId,
        workerId,
        now + LEASE_MS,
        now,
      );
      if (!refreshed) {
        abortWith(controller, "lease-lost");
        return;
      }
      nextLeaseRefresh = now + LEASE_REFRESH_MS;
    }
  }, CANCEL_POLL_MS);
  poll.unref();

  return () => {
    clearInterval(poll);
    clearTimeout(timeout);
    shutdownSignal.removeEventListener("abort", onShutdown);
  };
}

function transitionToProcessing(job: ProcessingJob, workerId: string, now = Date.now()): void {
  const changed = getDatabase().prepare(
    `UPDATE jobs SET status = 'processing', phase = 'Encoding and muxing',
     started_at = COALESCE(started_at, ?), updated_at = ?
     WHERE id = ? AND owner_id = ? AND worker_id = ? AND status = 'analyzing'`,
  ).run(now, now, job.id, job.ownerId, workerId).changes;
  if (changed === 1) return;
  const current = jobs.get(job.id, job.ownerId);
  if (current?.status === "cancel_requested") throw new JobAbortError("cancelled");
  throw new JobAbortError("lease-lost");
}

function completeOwnedJob(job: ProcessingJob, workerId: string, now: number): void {
  const changed = getDatabase().prepare(
    `UPDATE jobs SET status = 'completed', phase = 'Completed', progress = 100,
     error_code = NULL, safe_error_message = NULL, completed_at = ?, updated_at = ?,
     worker_id = NULL, lease_until = NULL
     WHERE id = ? AND owner_id = ? AND worker_id = ? AND status = 'processing'`,
  ).run(now, now, job.id, job.ownerId, workerId).changes;
  if (changed === 1) return;
  const current = jobs.get(job.id, job.ownerId);
  if (current?.status === "cancel_requested") throw new JobAbortError("cancelled");
  throw new JobAbortError("lease-lost");
}

function normalizedStreamHash(output: string): string {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export function outputDisplayName(originalName: string): string {
  const base = originalName.replace(/\.[^.]+$/, "").trim() || "Video";
  return safeDisplayFilename(`${base}.FXQYMethod.mp4`, "Video.FXQYMethod.mp4");
}

function safeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof WorkerJobError) {
    return { code: error.code, message: error.safeMessage };
  }
  if (error instanceof StorageError) {
    return { code: error.code, message: error.message.slice(0, 500) };
  }
  if (error instanceof MediaConfigurationError) {
    return { code: error.code, message: error.message.slice(0, 500) };
  }
  if (error instanceof MediaToolError) {
    const code = error.code === "SPAWN_FAILED" ? "PROCESS_START_FAILED" : `MEDIA_${error.code}`;
    const message =
      error.code === "SPAWN_FAILED"
        ? "A required local media tool could not be started. Check System Diagnostics."
        : error.code === "TIMEOUT"
          ? "Media analysis exceeded its safe time limit."
          : error.code === "PROBE_FAILED"
            ? "The stored file could not be read as supported video media."
            : "The media analysis stage could not be completed.";
    return { code, message };
  }
  return {
    code: "PROCESSING_FAILED",
    message: "The video could not be processed safely. Review System Diagnostics and try again.",
  };
}

function assertVerification(
  result: ReturnType<typeof verifyOutputAnalysis>,
  code: string,
  telemetryLog: (line: string) => void,
): void {
  if (result.ok) return;
  telemetryLog(`Verification failed: ${result.issues.map((issue) => issue.code).join(", ")}`);
  throw new WorkerJobError(
    code,
    "The completed file failed standards verification and was not published.",
  );
}

async function verifyDecode(
  output: TrustedMediaPath,
  analysis: MediaAnalysis,
  signal: AbortSignal,
  attemptDirectory: string,
  privatePaths: readonly string[],
  telemetryLog: (line: string) => void,
): Promise<void> {
  const command = buildDecodeValidationCommand(output, analysis, getAppConfig().ffmpegPath);
  await runCommand(command, {
    signal,
    cwd: attemptDirectory,
    privatePaths,
    onDiagnostic: telemetryLog,
  });
}

async function compareRemuxStreamHashes(
  source: TrustedMediaPath,
  sourceAnalysis: MediaAnalysis,
  output: TrustedMediaPath,
  outputAnalysis: MediaAnalysis,
  signal: AbortSignal,
  attemptDirectory: string,
  privatePaths: readonly string[],
  telemetryLog: (line: string) => void,
): Promise<void> {
  const sourceCommand = buildStreamHashCommand(source, sourceAnalysis, getAppConfig().ffmpegPath);
  const outputCommand = buildStreamHashCommand(output, outputAnalysis, getAppConfig().ffmpegPath);
  const sourceHash = await runCommand(sourceCommand, {
    signal,
    cwd: attemptDirectory,
    privatePaths,
    captureStdout: true,
    onDiagnostic: telemetryLog,
  });
  const outputHash = await runCommand(outputCommand, {
    signal,
    cwd: attemptDirectory,
    privatePaths,
    captureStdout: true,
    onDiagnostic: telemetryLog,
  });
  const expected = normalizedStreamHash(sourceHash.stdout);
  const actual = normalizedStreamHash(outputHash.stdout);
  if (!expected || expected !== actual) {
    throw new WorkerJobError(
      "REMUX_STREAM_HASH_MISMATCH",
      "The remux did not preserve encoded video/audio stream payloads and was not published.",
    );
  }
}

async function runEncoding(
  command: CommandSpec,
  durationSeconds: number,
  signal: AbortSignal,
  attemptDirectory: string,
  privatePaths: readonly string[],
  onProgress: (update: FfmpegProgressUpdate, fraction: number | undefined) => void,
  onDiagnostic: (line: string) => void,
): Promise<void> {
  const parser = new FfmpegProgressParser();
  const consume = (chunk: Buffer) => {
    for (const update of parser.push(chunk)) {
      onProgress(update, progressFraction(update, durationSeconds));
    }
  };
  await runCommand(command, {
    signal,
    cwd: attemptDirectory,
    privatePaths,
    onStdout: consume,
    onDiagnostic,
  });
  for (const update of parser.flush()) {
    onProgress(update, progressFraction(update, durationSeconds));
  }
}

export async function processClaimedJob(
  job: ProcessingJob,
  workerId: string,
  shutdownSignal: AbortSignal,
): Promise<void> {
  const config = getAppConfig();
  const controller = new AbortController();
  const stopMonitor = startJobMonitor(job, workerId, controller, shutdownSignal);
  const signal = controller.signal;
  let attemptDirectory: string | undefined;
  let publishedKey: string | undefined;
  let publishedExportId: string | undefined;
  let committed = false;
  let monitorStopped = false;
  const logTail = [...job.logTail].slice(-30);
  let telemetry: Record<string, unknown> = {
    stage: "preparing",
    attempt: job.attempt,
  };
  let progress = Math.max(1, job.progress);
  let phase = "Preparing source";
  let lastTelemetryWrite = 0;

  const addLog = (line: string) => {
    const sanitized = sanitizeFfmpegDiagnostic(
      line,
      attemptDirectory ? [attemptDirectory] : [],
      500,
    ).replace(/[\r\n]/g, " ").trim();
    if (!sanitized) return;
    logTail.push(sanitized);
    if (logTail.length > 40) logTail.splice(0, logTail.length - 40);
  };

  const persist = (
    nextPhase: string,
    nextProgress: number,
    update: Record<string, unknown> = {},
    force = true,
  ) => {
    const now = Date.now();
    phase = nextPhase;
    progress = Math.max(progress, Math.min(100, nextProgress));
    telemetry = { ...telemetry, ...update, stage: nextPhase };
    if (!force && now - lastTelemetryWrite < 500) return;
    jobs.updateTelemetry(job.id, job.ownerId, phase, progress, telemetry, logTail, now);
    lastTelemetryWrite = now;
  };

  try {
    attemptDirectory = await createJobAttemptDirectory(job.id, Math.max(1, job.attempt));
    throwIfAborted(signal);
    const storage = getStoragePaths();
    const asset = mediaAssets.get(job.sourceAssetId, job.ownerId);
    if (!asset || asset.deletedAt !== null || asset.status === "deleted") {
      throw new WorkerJobError(
        "SOURCE_UNAVAILABLE",
        "The source video is no longer available in private storage.",
      );
    }

    const sourceAbsolute = resolveContainedPath(storage.mediaRoot, asset.storageKey);
    const source = await trustedExistingMediaPath(storage.mediaRoot, sourceAbsolute);
    const sourceStat = await stat(source);
    if (sourceStat.size <= 0 || sourceStat.size !== asset.bytes) {
      throw new WorkerJobError(
        "SOURCE_INTEGRITY_FAILED",
        "The stored source file no longer matches its upload record.",
      );
    }
    assertDiskHeadroom(projectedWorkspaceBytes(Math.max(asset.bytes, 64 * 1024 * 1024)));
    persist("Checking source integrity", 3, { sourceBytes: sourceStat.size });
    const sourceSha256 = await sha256File(source, signal);
    if (asset.sha256 && sourceSha256 !== asset.sha256.toLowerCase()) {
      throw new WorkerJobError(
        "SOURCE_INTEGRITY_FAILED",
        "The stored source file failed its integrity check.",
      );
    }

    persist("Analysing source", 6, { sourceSha256Verified: Boolean(asset.sha256) });
    const sourceAnalysis = await probeMedia(source, {
      ffprobePath: config.ffprobePath,
      timeoutMs: 2 * 60_000,
      packetScanTimeoutMs: Math.min(15 * 60_000, Math.max(5 * 60_000, config.jobTimeoutMs / 4)),
      signal,
      sha256: sourceSha256,
    });
    mediaAssets.setAnalysis(asset.id, job.ownerId, sourceAnalysis, "ready");
    throwIfAborted(signal);

    const options = parsePresetOptions(job.settings);
    if (job.preset && job.preset !== options.preset) {
      throw new WorkerJobError(
        "INVALID_JOB_OPTIONS",
        "The stored job preset and validated processing options do not match.",
      );
    }
    const capabilities =
      options.preset === "lossless-remux"
        ? EMPTY_MEDIA_CAPABILITIES
        : await getCapabilities(signal);
    const candidateAbsolute = path.join(attemptDirectory, "verified-candidate.mp4");
    const candidate = trustedPathWithin(attemptDirectory, candidateAbsolute);
    const command = buildFfmpegCommand({
      input: source,
      output: candidate,
      analysis: sourceAnalysis,
      options,
      capabilities,
      ffmpegPath: config.ffmpegPath,
    });
    assertDiskHeadroom(projectedWorkspaceBytes(command.estimatedSize.upperBoundBytes));
    addLog(`Validated export plan: ${options.preset}; encoder: ${command.encoder}.`);
    for (const disclosure of command.disclosures) addLog(disclosure);
    telemetry = {
      ...telemetry,
      preset: options.preset,
      encoder: command.encoder,
      expected: command.expected,
      estimatedSize: command.estimatedSize,
      disclosures: command.disclosures,
    };
    transitionToProcessing(job, workerId);
    persist("Encoding and muxing", 12, {}, true);

    await runEncoding(
      command,
      sourceAnalysis.file.durationSeconds,
      signal,
      attemptDirectory,
      [source, candidate],
      (update, fraction) => {
        const encodedProgress = fraction === undefined ? progress : 12 + fraction * 70;
        const etaSeconds =
          update.outTimeSeconds !== undefined &&
          update.speed !== undefined &&
          update.speed > 0
            ? Math.max(0, (sourceAnalysis.file.durationSeconds - update.outTimeSeconds) / update.speed)
            : undefined;
        persist(
          "Encoding and muxing",
          encodedProgress,
          {
            ffmpeg: {
              frame: update.frame,
              fps: update.fps,
              speed: update.speed,
              outputBytes: update.totalSizeBytes,
              duplicateFrames: update.duplicateFrames,
              droppedFrames: update.droppedFrames,
              outTimeSeconds: update.outTimeSeconds,
              etaSeconds,
            },
          },
          update.progress === "end",
        );
      },
      addLog,
    );
    throwIfAborted(signal);

    const candidateStat = await stat(candidate);
    if (!candidateStat.isFile() || candidateStat.size <= 0) {
      throw new WorkerJobError(
        "OUTPUT_MISSING",
        "FFmpeg finished without producing a usable output file.",
      );
    }
    persist("Hashing output", 84, { outputBytes: candidateStat.size });
    const outputSha256 = await sha256File(candidate, signal);
    persist("Probing output", 87, { outputSha256 });
    const outputAnalysis = await probeMedia(candidate, {
      ffprobePath: config.ffprobePath,
      timeoutMs: 2 * 60_000,
      packetScanTimeoutMs: Math.min(15 * 60_000, Math.max(5 * 60_000, config.jobTimeoutMs / 4)),
      signal,
      sha256: outputSha256,
    });

    const outputVerification = verifyOutputAnalysis(command.expected, outputAnalysis);
    assertVerification(outputVerification, "OUTPUT_VERIFICATION_FAILED", addLog);
    let fullDecodeVerified = false;
    if (options.preset === "lossless-remux") {
      const invariantResult = verifyRemuxInvariants(sourceAnalysis, outputAnalysis);
      assertVerification(invariantResult, "REMUX_INVARIANT_FAILED", addLog);
      persist("Verifying preserved media streams", 92, { remuxInvariantsVerified: true });
      await compareRemuxStreamHashes(
        source,
        sourceAnalysis,
        candidate,
        outputAnalysis,
        signal,
        attemptDirectory,
        [source, candidate],
        addLog,
      );
      telemetry = { ...telemetry, remuxStreamHashesVerified: true };
      const tinyPacketCount = sourceAnalysis.timing.tinyVideoPacketCount ?? 0;
      const tinyPacketRatio = sourceAnalysis.video.fps.sampleCount > 0
        ? tinyPacketCount / sourceAnalysis.video.fps.sampleCount
        : 0;
      if (sourceAnalysis.video.fps.sampleCount > 20 && tinyPacketRatio > 0.02) {
        persist("Validating unusual packet pattern", 95, {
          remuxInvariantsVerified: true,
          unusualSmallPackets: true,
        });
        await verifyDecode(
          candidate,
          outputAnalysis,
          signal,
          attemptDirectory,
          [source, candidate],
          addLog,
        );
        fullDecodeVerified = true;
        telemetry = { ...telemetry, remuxFullDecodeVerified: true };
      }
    } else {
      persist("Full decode validation", 92, { standardsVerified: true });
      await verifyDecode(
        candidate,
        outputAnalysis,
        signal,
        attemptDirectory,
        [source, candidate],
        addLog,
      );
      fullDecodeVerified = true;
    }

    throwIfAborted(signal);
    persist("Publishing verified export", 98, {
      fullDecodeVerified,
      losslessStreamsVerified: options.preset === "lossless-remux",
      outputAnalysis,
    });

    const exportId = randomUUID();
    publishedExportId = exportId;
    publishedKey = path.posix.join("exports", `${exportId}.mp4`);
    const publishedAbsolute = resolveContainedPath(storage.mediaRoot, publishedKey);
    if (!isPathInside(storage.exportsRoot, publishedAbsolute)) {
      throw new WorkerJobError(
        "INVALID_EXPORT_PATH",
        "The verified output could not be assigned a safe private storage key.",
      );
    }
    await publishCandidate(candidate, publishedAbsolute);
    throwIfAborted(signal);
    const publishedStat = await stat(publishedAbsolute);
    if (publishedStat.size !== candidateStat.size) {
      throw new WorkerJobError(
        "PUBLISH_VALIDATION_FAILED",
        "The published output did not match the verified candidate size.",
      );
    }

    const now = Date.now();
    const outputRetentionDays = settingsRepository.get(job.ownerId)?.outputRetentionDays ?? null;
    const expiresAt =
      outputRetentionDays === null
        ? null
        : now + Math.max(1, Math.min(3_650, outputRetentionDays)) * 86_400_000;
    exportsRepository.create({
      id: exportId,
      ownerId: job.ownerId,
      jobId: job.id,
      storageKey: publishedKey,
      displayName: outputDisplayName(asset.originalName),
      bytes: publishedStat.size,
      sha256: outputSha256,
      media: {
        verified: true,
        analysis: outputAnalysis,
        expected: command.expected,
        encoder: command.encoder,
        disclosures: command.disclosures,
      },
      createdAt: now,
      expiresAt,
      deletedAt: null,
    });
    throwIfAborted(signal);
    persist("Completed", 100, {
      exportId,
      completedAt: now,
      published: true,
    });
    completeOwnedJob(job, workerId, now);
    committed = true;
    stopMonitor();
    monitorStopped = true;
  } catch (error) {
    const activeStatus = jobs.get(job.id, job.ownerId)?.status;
    const abort = error instanceof JobAbortError ? error : signal.aborted ? abortError(signal) : null;
    if (abort?.kind === "lease-lost") {
      // Another state transition owns this record; only local temporary data is cleaned below.
    } else if (abort?.kind === "cancelled" || activeStatus === "cancel_requested") {
      addLog("Processing cancelled by the owner.");
      jobs.updateTelemetry(job.id, job.ownerId, "Cancelled", progress, telemetry, logTail);
      jobs.setStatus(job.id, job.ownerId, "cancelled", {
        phase: "Cancelled",
        errorCode: "CANCELLED",
        safeErrorMessage: "Processing was cancelled and temporary output was removed.",
        completedAt: Date.now(),
      });
    } else {
      const failure = abort
        ? abort.kind === "timeout"
          ? {
              code: "PROCESS_TIMEOUT",
              message: "Processing exceeded the configured time limit and temporary output was removed.",
            }
          : {
              code: "WORKER_STOPPED",
              message: "The local processing worker stopped before this job finished.",
            }
        : safeFailure(error);
      addLog(`Job stopped: ${failure.code}.`);
      jobs.updateTelemetry(job.id, job.ownerId, "Failed", progress, telemetry, logTail);
      jobs.setStatus(job.id, job.ownerId, "failed", {
        phase: "Failed",
        errorCode: failure.code,
        safeErrorMessage: failure.message,
        completedAt: Date.now(),
      });
    }
  } finally {
    if (!monitorStopped) stopMonitor();
    if (!committed && publishedExportId) {
      getDatabase()
        .prepare("DELETE FROM exports WHERE id = ? AND owner_id = ?")
        .run(publishedExportId, job.ownerId);
    }
    if (!committed && publishedKey) {
      await deleteMediaKey(publishedKey).catch(() => undefined);
    }
    if (attemptDirectory) {
      await removeJobAttemptDirectory(attemptDirectory).catch(() => undefined);
    }
  }
}

function settleAbandonedCancellations(now = Date.now()): number {
  return getDatabase().prepare(
    `UPDATE jobs SET status = 'cancelled', phase = 'Cancelled', error_code = 'CANCELLED',
     safe_error_message = 'Processing was cancelled and temporary output was removed.',
     completed_at = ?, updated_at = ?, worker_id = NULL, lease_until = NULL
     WHERE status = 'cancel_requested'
       AND (worker_id IS NULL OR lease_until IS NULL OR lease_until < ?)`,
  ).run(now, now, now).changes;
}

async function cleanExpiredDatabaseFiles(now = Date.now()): Promise<void> {
  const db = getDatabase();
  const expiredExports = db.prepare(
    `SELECT id, owner_id, storage_key FROM exports
     WHERE expires_at IS NOT NULL AND expires_at <= ? LIMIT 100`,
  ).all(now) as Array<{ id: string; owner_id: number; storage_key: string }>;
  for (const record of expiredExports) {
    try {
      await deleteMediaKey(record.storage_key);
      db.prepare(
        "UPDATE exports SET deleted_at = COALESCE(deleted_at, ?), expires_at = NULL WHERE id = ? AND owner_id = ?",
      ).run(now, record.id, record.owner_id);
    } catch {
      // Leave the expiry marker intact so a later cleanup pass can retry safely.
    }
  }

  const expiredAssets = db.prepare(
    `SELECT asset.id, asset.owner_id, asset.storage_key FROM media_assets asset
     WHERE asset.expires_at IS NOT NULL AND asset.expires_at <= ?
       AND NOT EXISTS (
         SELECT 1 FROM jobs job WHERE job.source_asset_id = asset.id
           AND job.status IN ('queued', 'analyzing', 'processing', 'cancel_requested')
       )
     LIMIT 100`,
  ).all(now) as Array<{ id: string; owner_id: number; storage_key: string }>;
  for (const record of expiredAssets) {
    try {
      await deleteMediaKey(record.storage_key);
      db.prepare(
        `UPDATE media_assets SET status = 'deleted', deleted_at = COALESCE(deleted_at, ?),
         expires_at = NULL, updated_at = ? WHERE id = ? AND owner_id = ?`,
      ).run(now, now, record.id, record.owner_id);
    } catch {
      // Leave the expiry marker intact so a later cleanup pass can retry safely.
    }
  }
}

async function cleanStaleAttemptDirectories(now = Date.now()): Promise<void> {
  const config = getAppConfig();
  const root = getStoragePaths().tempRoot;
  const retentionMs = Math.max(
    60 * 60_000,
    (settingsRepository.get()?.tempRetentionHours ?? Math.round(config.retentionMs / 3_600_000)) * 3_600_000,
  );
  const unknownJobStaleBefore =
    now - Math.max(config.jobTimeoutMs + 60 * 60_000, retentionMs);
  const terminalJobStaleBefore = now - retentionMs;
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(entry.name)) continue;
    const candidate = resolveContainedPath(root, entry.name);
    const job = jobs.get(entry.name);
    if (job && ["queued", "analyzing", "processing", "cancel_requested"].includes(job.status)) {
      continue;
    }
    const information = await lstat(candidate).catch(() => null);
    if (!information || information.isSymbolicLink() || !information.isDirectory()) continue;
    const staleBefore = job ? terminalJobStaleBefore : unknownJobStaleBefore;
    if (information.mtimeMs > staleBefore) continue;
    await removeJobAttemptDirectory(candidate).catch(() => undefined);
  }
}

export async function cleanExpiredKnownFiles(now = Date.now()): Promise<void> {
  if (maintenanceState.get().locked) return;
  await cleanExpiredDatabaseFiles(now);
  await cleanStaleAttemptDirectories(now);
}

async function runSupervisor(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      if (!maintenanceState.get().locked) {
        jobs.recoverAbandoned();
        settleAbandonedCancellations();
      }
    } catch {
      // The next bounded supervisor pass retries database recovery.
    }
    try {
      await wait(RECOVERY_INTERVAL_MS, signal);
    } catch (error) {
      if (error instanceof JobAbortError) return;
      throw error;
    }
  }
}

async function runCleanupScheduler(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    await cleanExpiredKnownFiles().catch(() => undefined);
    try {
      await wait(CLEANUP_INTERVAL_MS, signal);
    } catch (error) {
      if (error instanceof JobAbortError) return;
      throw error;
    }
  }
}

async function runWorkerSlot(slot: number, instanceId: string, signal: AbortSignal): Promise<void> {
  const workerId = `${instanceId}-${slot}`.slice(0, 100);
  while (!signal.aborted) {
    try {
      if (maintenanceState.get().locked) {
        await wait(IDLE_POLL_MS, signal);
        continue;
      }
      const job = jobs.claimNext(workerId, LEASE_MS);
      if (!job) {
        await wait(IDLE_POLL_MS, signal);
        continue;
      }
      await processClaimedJob(job, workerId, signal);
    } catch (error) {
      if (error instanceof JobAbortError || signal.aborted) return;
      await wait(IDLE_POLL_MS, signal).catch(() => undefined);
    }
  }
}

export async function processNextQueuedJob(
  workerId = `manual-${randomUUID()}`,
  signal: AbortSignal = new AbortController().signal,
): Promise<boolean> {
  const job = jobs.claimNext(workerId.slice(0, 100), LEASE_MS);
  if (!job) return false;
  await processClaimedJob(job, workerId.slice(0, 100), signal);
  return true;
}

export async function runWorker(signal: AbortSignal): Promise<void> {
  const config = getAppConfig();
  jobs.recoverAbandoned();
  settleAbandonedCancellations();
  const instanceId = `${os.hostname().replace(/[^a-zA-Z0-9.-]/g, "_")}-${process.pid}-${randomUUID()}`;
  await Promise.all([
    ...Array.from({ length: config.processConcurrency }, (_, index) =>
      runWorkerSlot(index + 1, instanceId, signal),
    ),
    runSupervisor(signal),
    runCleanupScheduler(signal),
  ]);
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const stop = () => abortWith(controller, "shutdown");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await runWorker(controller.signal);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    closeDatabase();
  }
}

const executedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (executedPath === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "The processing worker stopped unexpectedly.";
    console.error(message.slice(0, 500));
    process.exitCode = 1;
  });
}
