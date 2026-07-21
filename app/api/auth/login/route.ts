import crypto from "node:crypto";
import { z } from "zod";
import { createSession, normalizeAccountId, sessionCookie, verifyPassword } from "@/lib/auth";
import { loginAttempts, owners } from "@/lib/db";
import { assertSafeMutationRequest, getClientAddress, jsonResponse, readSmallJsonObject } from "@/lib/http-security";
import { apiErrorResponse } from "@/lib/api";

export const runtime = "nodejs";
const Input = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) }).strict();
const key = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

export async function POST(request: Request) {
  try {
    assertSafeMutationRequest(request);
    const input = Input.parse(await readSmallJsonObject(request));
    const email = normalizeAccountId(input.email);
    const pairKey = `pair:${key(`${email}|${getClientAddress(request)}`)}`;
    const attempt = loginAttempts.get(pairKey);
    if (attempt?.blockedUntil && attempt.blockedUntil > Date.now()) return jsonResponse({ error: { message: "Too many attempts. Try again in 15 minutes." } }, { status: 429 });
    const owner = owners.getByNormalizedUsername(email);
    const valid = owner && owner.passwordHash !== "authentication-disabled" && await verifyPassword(input.password, owner.passwordHash);
    if (!valid) {
      loginAttempts.recordFailure(pairKey, "pair", 5, Date.now(), 15 * 60_000, 15 * 60_000);
      return jsonResponse({ error: { message: "Email or password is incorrect." } }, { status: 401 });
    }
    loginAttempts.clear([pairKey]);
    owners.markLogin(owner.id);
    const session = createSession(owner, request);
    return jsonResponse({ ok: true, needsOnboarding: !owner.onboardedAt }, { headers: { "Set-Cookie": sessionCookie(session.token, session.expires) } });
  } catch (error) { return apiErrorResponse(error); }
}
