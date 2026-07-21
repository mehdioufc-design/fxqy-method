import net from "node:net";
import { getAppConfig } from "./config";

export class RequestSecurityError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code = "request_rejected", status = 403) {
    super("The request could not be verified.");
    this.name = "RequestSecurityError";
    this.code = code;
    this.status = status;
  }
}

function requestHost(request: Request): string {
  const config = getAppConfig();
  if (config.trustProxy) {
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
    if (forwardedHost) return forwardedHost.toLowerCase();
  }
  const host = request.headers.get("host")?.trim();
  if (host) return host.toLowerCase();
  try {
    return new URL(request.url).host.toLowerCase();
  } catch {
    return "";
  }
}

export function assertAllowedHost(request: Request): void {
  const host = requestHost(request);
  if (!host || !getAppConfig().allowedHosts.has(host)) {
    throw new RequestSecurityError("invalid_host", 403);
  }
}

export function assertSameOrigin(request: Request): void {
  const originHeader = request.headers.get("origin");
  if (!originHeader) throw new RequestSecurityError("missing_origin", 403);
  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    throw new RequestSecurityError("invalid_origin", 403);
  }
  const configured = getAppConfig().appOrigin;
  const loopbackAlias =
    isLoopback(origin.hostname) &&
    isLoopback(configured.hostname) &&
    origin.protocol === configured.protocol &&
    effectivePort(origin) === effectivePort(configured);
  if (origin.origin !== configured.origin && !loopbackAlias) {
    throw new RequestSecurityError("cross_origin", 403);
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    throw new RequestSecurityError("cross_site", 403);
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function effectivePort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === "https:" ? "443" : "80";
}

export function assertSafeMutationRequest(request: Request): void {
  assertAllowedHost(request);
  assertSameOrigin(request);
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase())) {
    throw new RequestSecurityError("invalid_method", 405);
  }
}

export function getClientAddress(request: Request): string {
  if (!getAppConfig().trustProxy) return "direct-client";
  const raw = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ?? "";
  return net.isIP(raw) ? raw : "unknown-proxy-client";
}

export function getUserAgent(request: Request): string {
  return (request.headers.get("user-agent") || "unknown").slice(0, 512);
}

export async function readSmallJsonObject(
  request: Request,
  maximumBytes = 16 * 1024,
): Promise<Record<string, unknown>> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
    throw new RequestSecurityError("request_too_large", 413);
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maximumBytes) {
    throw new RequestSecurityError("request_too_large", 413);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new RequestSecurityError("invalid_json", 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestSecurityError("invalid_json", 400);
  }
  return value as Record<string, unknown>;
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  headers.set("X-Content-Type-Options", "nosniff");
  return Response.json(body, { ...init, headers });
}

export function privacySafeErrorResponse(error: unknown): Response {
  if (error instanceof RequestSecurityError) {
    return jsonResponse(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  return jsonResponse(
    {
      ok: false,
      error: { code: "internal_error", message: "The request could not be completed." },
    },
    { status: 500 },
  );
}
