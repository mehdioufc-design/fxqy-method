import { z } from "zod";
import { createSession, hashPassword, normalizeAccountId, sessionCookie } from "@/lib/auth";
import { owners } from "@/lib/db";
import { assertSafeMutationRequest, jsonResponse, readSmallJsonObject } from "@/lib/http-security";
import { apiErrorResponse } from "@/lib/api";

export const runtime = "nodejs";
const Input = z.object({ email: z.string().trim().email().max(254), password: z.string().min(10).max(128) }).strict();

export async function POST(request: Request) {
  try {
    assertSafeMutationRequest(request);
    const input = Input.parse(await readSmallJsonObject(request));
    const normalized = normalizeAccountId(input.email);
    if (owners.getByNormalizedUsername(normalized)) return jsonResponse({ error: { message: "An account with that email already exists." } }, { status: 409 });
    const passwordHash = await hashPassword(input.password);
    const owner = owners.create(input.email.trim(), normalized, passwordHash, owners.count() === 0 ? "admin" : "user");
    const session = createSession(owner, request);
    return jsonResponse({ ok: true, needsOnboarding: true }, { status: 201, headers: { "Set-Cookie": sessionCookie(session.token, session.expires) } });
  } catch (error) { return apiErrorResponse(error); }
}
