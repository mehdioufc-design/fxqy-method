import { ZodError } from "zod";
import { owners, type Owner } from "./db";
import { requireSessionOwner } from "./auth";
import {
  assertAllowedHost,
  assertSafeMutationRequest,
  jsonResponse,
  privacySafeErrorResponse,
} from "./http-security";
import { StorageError } from "./storage";

export type LocalApplicationContext = Readonly<{ owner: Owner }>;

function localContext(): LocalApplicationContext {
  return Object.freeze({ owner: owners.ensureLocal() });
}

export function requireApiSession(request: Request): LocalApplicationContext {
  assertAllowedHost(request);
  if (process.env.NODE_ENV === "test") return localContext();
  return Object.freeze({ owner: requireSessionOwner(request) });
}

export function requireMutationSession(request: Request): LocalApplicationContext {
  assertSafeMutationRequest(request);
  if (process.env.NODE_ENV === "test") return localContext();
  return Object.freeze({ owner: requireSessionOwner(request) });
}

export function apiErrorResponse(error: unknown): Response {
  if (error instanceof StorageError) {
    return jsonResponse(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return jsonResponse(
      { ok: false, error: { code: "INVALID_OPTIONS", message: "One or more processing options were invalid." } },
      { status: 400 },
    );
  }
  return privacySafeErrorResponse(error);
}
