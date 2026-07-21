export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function apiRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && typeof init.body === "string" && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  headers.set("accept", "application/json");

  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const payload = await response.json().catch(() => null) as null | {
    message?: string;
    error?: string | { message?: string; code?: string };
    code?: string;
  };

  if (!response.ok) {
    throw new ApiError(
      payload?.message ??
        (typeof payload?.error === "string" ? payload.error : payload?.error?.message) ??
        "The request could not be completed.",
      response.status,
      payload?.code ?? (typeof payload?.error === "object" ? payload.error.code : undefined),
    );
  }

  return payload as T;
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const order = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** order;
  return `${value.toFixed(value >= 10 || order === 0 ? 0 : 1)} ${units[order]}`;
}

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}
