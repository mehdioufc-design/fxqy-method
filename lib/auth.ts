import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { getAppConfig } from "./config";
import { owners, sessions, type Owner } from "./db";
import { RequestSecurityError, getClientAddress, getUserAgent } from "./http-security";

export const SESSION_COOKIE = "tto_session";
const IDLE_MS = 7 * 24 * 60 * 60 * 1000;
const ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;

function digest(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function cookieToken(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const item of header.split(";")) {
    const [name, ...rest] = item.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionOwnerFromRequest(request: Request): Owner | null {
  const token = cookieToken(request);
  if (!token || token.length < 32 || token.length > 256) return null;
  const session = sessions.get(digest(token));
  const now = Date.now();
  if (!session || session.revokedAt || session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) return null;
  const owner = owners.get(session.ownerId);
  if (!owner || owner.passwordChangedAt > session.createdAt) return null;
  if (now - session.lastSeenAt > 5 * 60_000) sessions.touch(session.tokenHash, now, Math.min(now + IDLE_MS, session.absoluteExpiresAt));
  return owner;
}

export function requireSessionOwner(request: Request): Owner {
  const owner = sessionOwnerFromRequest(request);
  if (!owner) throw new RequestSecurityError("authentication_required", 401);
  return owner;
}

export async function currentOwner(): Promise<Owner | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = sessions.get(digest(token));
  const now = Date.now();
  if (!session || session.revokedAt || session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) return null;
  return owners.get(session.ownerId);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function createSession(owner: Owner, request: Request): { token: string; expires: Date } {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  const absoluteExpiresAt = now + ABSOLUTE_MS;
  sessions.create({
    tokenHash: digest(token), ownerId: owner.id, createdAt: now, lastSeenAt: now,
    idleExpiresAt: now + IDLE_MS, absoluteExpiresAt, revokedAt: null,
    ipHash: digest(getClientAddress(request)), userAgentHash: digest(getUserAgent(request)),
  });
  return { token, expires: new Date(absoluteExpiresAt) };
}

export function sessionCookie(value: string, expires: Date): string {
  const secure = getAppConfig().appOrigin.protocol === "https:";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function revokeRequestSession(request: Request): void {
  const token = cookieToken(request);
  if (token) sessions.revoke(digest(token));
}

export function normalizeAccountId(value: string): string {
  return value.trim().toLowerCase();
}
