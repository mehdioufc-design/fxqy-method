import path from "node:path";
import fs from "node:fs";

export type AppConfig = Readonly<{
  appOrigin: URL;
  allowedHosts: ReadonlySet<string>;
  dataRoot: string;
  databasePath: string;
  mediaRoot: string;
  tempRoot: string;
  trustProxy: boolean;
  maxUploadBytes: number;
  ffmpegPath: string;
  ffprobePath: string;
  minimumFreeBytes: number;
  jobTimeoutMs: number;
  processConcurrency: number;
  retentionMs: number;
}>;

let cachedConfig: AppConfig | undefined;

function integerEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function booleanEnv(name: string, fallback = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${name} must be true or false.`);
}

function absolutePathEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;
  return path.resolve(value);
}

function executableEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (value.length > 1024 || value.includes("\0") || /[\r\n]/.test(value)) {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

function bundledMediaExecutable(kind: "ffmpeg" | "ffprobe"): string {
  const executable = process.platform === "win32" ? `${kind}.exe` : kind;
  const candidates = kind === "ffmpeg"
    ? [path.join(process.cwd(), "node_modules", "ffmpeg-static", executable)]
    : [
        path.join(
          process.cwd(),
          "node_modules",
          "@ffprobe-installer",
          `${process.platform}-${process.arch}`,
          executable,
        ),
      ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? kind;
}

function parseAppOrigin(): URL {
  const raw = process.env.APP_ORIGIN?.trim() || "http://127.0.0.1:3000";
  let origin: URL;
  try {
    origin = new URL(raw);
  } catch {
    throw new Error("APP_ORIGIN must be an absolute HTTP or HTTPS URL.");
  }
  if (!['http:', 'https:'].includes(origin.protocol)) {
    throw new Error("APP_ORIGIN must use HTTP or HTTPS.");
  }
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("APP_ORIGIN must contain only scheme, host, and optional port.");
  }

  const isLoopback =
    origin.hostname === "localhost" ||
    origin.hostname === "127.0.0.1" ||
    origin.hostname === "[::1]";
  if (
    process.env.NODE_ENV === "production" &&
    origin.protocol !== "https:" &&
    !isLoopback &&
    !booleanEnv("ALLOW_INSECURE_HTTP")
  ) {
    throw new Error(
      "Production APP_ORIGIN must use HTTPS unless it is loopback. Set ALLOW_INSECURE_HTTP only for an isolated, trusted network.",
    );
  }
  return origin;
}

function parseAllowedHosts(origin: URL): ReadonlySet<string> {
  const hosts = new Set<string>([origin.host.toLowerCase()]);
  if (["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) {
    const port = origin.port ? `:${origin.port}` : "";
    hosts.add(`localhost${port}`);
    hosts.add(`127.0.0.1${port}`);
    hosts.add(`[::1]${port}`);
  }
  const configured = process.env.ALLOWED_HOSTS?.split(",") ?? [];
  for (const item of configured) {
    const host = item.trim().toLowerCase();
    if (!host || host.includes("/") || /\s/.test(host)) {
      if (host) throw new Error("ALLOWED_HOSTS entries must be host[:port] values.");
      continue;
    }
    hosts.add(host);
  }
  return hosts;
}

export function getAppConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const appOrigin = parseAppOrigin();

  const dataRoot = absolutePathEnv(
    "DATA_ROOT",
    process.env.DATA_DIR?.trim() || path.join(process.cwd(), ".data"),
  );
  const databasePath = absolutePathEnv(
    "DATABASE_PATH",
    path.join(dataRoot, "tiktok-optimizer.sqlite"),
  );
  const mediaRoot = absolutePathEnv("MEDIA_ROOT", path.join(dataRoot, "media"));
  const tempRoot = absolutePathEnv("TEMP_ROOT", path.join(dataRoot, "tmp"));

  cachedConfig = Object.freeze({
    appOrigin,
    allowedHosts: parseAllowedHosts(appOrigin),
    dataRoot,
    databasePath,
    mediaRoot,
    tempRoot,
    trustProxy: booleanEnv("TRUST_PROXY"),
    maxUploadBytes: integerEnv(
      "MAX_UPLOAD_BYTES",
      20 * 1024 * 1024 * 1024,
      1024 * 1024,
      1024 * 1024 * 1024 * 1024,
    ),
    ffmpegPath: executableEnv("FFMPEG_PATH", bundledMediaExecutable("ffmpeg")),
    ffprobePath: executableEnv("FFPROBE_PATH", bundledMediaExecutable("ffprobe")),
    minimumFreeBytes: integerEnv(
      "MIN_FREE_BYTES",
      5 * 1024 * 1024 * 1024,
      128 * 1024 * 1024,
      10 * 1024 * 1024 * 1024 * 1024,
    ),
    jobTimeoutMs: integerEnv("JOB_TIMEOUT_MINUTES", 360, 5, 2_880) * 60_000,
    processConcurrency: integerEnv("PROCESS_CONCURRENCY", 1, 1, 4),
    retentionMs: integerEnv("RETENTION_HOURS", 168, 1, 8_760) * 3_600_000,
  });
  return cachedConfig;
}

/** Tests may change process.env between cases; production code should not call this. */
export function resetAppConfigForTests(): void {
  cachedConfig = undefined;
}
