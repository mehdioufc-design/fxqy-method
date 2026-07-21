import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { getAppConfig } from "./config";
import { getDatabase } from "./db";
import { detectMediaCapabilities, type MediaCapabilities } from "./media";
import { getStoragePaths } from "./paths";
import { availableDiskBytes } from "./storage";

export type DiagnosticsSnapshot = Awaited<ReturnType<typeof runDiagnostics>>;

declare global {
  var __ttoDiagnostics: DiagnosticsSnapshot | undefined;
}

function captureVersion(executable: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["-hide_banner", "-version"], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle(() => reject(new Error("Version check timed out.")));
    }, timeoutMs);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      if (output.length < 8_192) output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (output.length < 8_192) output += chunk.toString("utf8");
    });
    child.once("error", () => settle(() => reject(new Error("Executable could not be started."))));
    child.once("close", (code) => settle(() => {
      if (code !== 0) reject(new Error("Executable returned an error."));
      else resolve(output.split(/\r?\n/)[0]?.slice(0, 500) || "Version reported");
    }));
  });
}

export async function runDiagnostics() {
  const config = getAppConfig();
  const paths = getStoragePaths();
  const warnings: string[] = [];

  const [ffmpegVersion, ffprobeVersion, writable] = await Promise.all([
    captureVersion(config.ffmpegPath).catch(() => null),
    captureVersion(config.ffprobePath).catch(() => null),
    access(paths.dataRoot, constants.R_OK | constants.W_OK).then(() => true).catch(() => false),
  ]);

  let capabilities: MediaCapabilities | null = null;
  if (ffmpegVersion) {
    capabilities = await detectMediaCapabilities({
      ffmpegPath: config.ffmpegPath,
      timeoutMs: 15_000,
    }).catch(() => null);
  }
  if (!ffmpegVersion) warnings.push("FFmpeg is unavailable. Install it or correct FFMPEG_PATH before processing.");
  if (!ffprobeVersion) warnings.push("FFprobe is unavailable. Install it or correct FFPROBE_PATH before uploading.");
  if (!capabilities && ffmpegVersion) warnings.push("FFmpeg started, but encoder/filter capability discovery failed.");
  if (!writable) warnings.push("The private data directory is not writable by this process.");

  const cpuEncoders = capabilities?.encoders.filter((encoder) => encoder === "libx264" || encoder === "libx265") ?? [];
  const hardwareEncoders = capabilities?.encoders.filter((encoder) => encoder !== "libx264" && encoder !== "libx265") ?? [];
  if (capabilities && !cpuEncoders.includes("libx264")) warnings.push("The required libx264 CPU encoder is unavailable.");
  if (capabilities && hardwareEncoders.length === 0) warnings.push("No runtime-usable hardware encoder was detected; CPU processing remains available.");

  const quickCheck = getDatabase().pragma("quick_check", { simple: true });
  const originHost = config.appOrigin.hostname;
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(originHost);
  if (!loopback && config.appOrigin.protocol !== "https:") {
    warnings.push("The configured non-loopback origin is not protected by HTTPS.");
  }

  const snapshot = {
    ffmpeg: {
      available: Boolean(ffmpegVersion),
      version: ffmpegVersion ?? "Unavailable",
      configuredExecutable: config.ffmpegPath,
    },
    ffprobe: {
      available: Boolean(ffprobeVersion),
      version: ffprobeVersion ?? "Unavailable",
      configuredExecutable: config.ffprobePath,
    },
    database: {
      healthy: String(quickCheck).toLowerCase() === "ok",
      journalMode: String(getDatabase().pragma("journal_mode", { simple: true })),
      foreignKeys: Boolean(getDatabase().pragma("foreign_keys", { simple: true })),
    },
    storage: {
      writable,
      freeBytes: availableDiskBytes(),
      minimumFreeBytes: config.minimumFreeBytes,
      maximumUploadBytes: config.maxUploadBytes,
    },
    hardware: {
      available: hardwareEncoders.length > 0,
      usableEncoders: hardwareEncoders,
      diagnostics: capabilities?.diagnostics.filter((item) => !["libx264", "libx265"].includes(item.encoder)) ?? [],
      cpuFallbacks: cpuEncoders,
    },
    filters: {
      available: Boolean(capabilities),
      detected: capabilities?.filters ?? [],
      opticalFlow: capabilities?.filters.includes("minterpolate") ?? false,
      hdrToneMapping:
        (capabilities?.filters.includes("zscale") && capabilities?.filters.includes("tonemap")) ?? false,
    },
    network: {
      privateByDefault: loopback,
      origin: config.appOrigin.origin,
      accessMode: "localhost-no-login",
      trustProxy: config.trustProxy,
      analytics: false,
      thirdPartyUploads: false,
    },
    warnings,
    checkedAt: new Date().toISOString(),
  };
  globalThis.__ttoDiagnostics = snapshot;
  return snapshot;
}

export async function getDiagnosticsSnapshot(force = false): Promise<DiagnosticsSnapshot> {
  if (!force && globalThis.__ttoDiagnostics) return globalThis.__ttoDiagnostics;
  return runDiagnostics();
}
