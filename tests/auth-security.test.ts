import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { requireApiSession, requireMutationSession } from "../lib/api";
import { owners } from "../lib/db";
import {
  assertAllowedHost,
  assertSafeMutationRequest,
  privacySafeErrorResponse,
  RequestSecurityError,
} from "../lib/http-security";
import {
  IsolatedAppEnvironment,
  requestWithSecurityHeaders,
} from "./helpers/isolated-app-environment";

const environment = new IsolatedAppEnvironment();

beforeAll(async () => environment.start());
beforeEach(async () => environment.reset());
afterAll(async () => environment.dispose());

describe("localhost-only access", () => {
  it("creates the local workspace automatically without credentials", () => {
    expect(owners.get()).toMatchObject({
      id: 1,
      username: "Local workspace",
      passwordHash: "authentication-disabled",
    });
    expect(requireApiSession(requestWithSecurityHeaders("/api/uploads")).owner.id).toBe(1);
  });

  it("allows same-origin mutations without a session or CSRF cookie", () => {
    const request = requestWithSecurityHeaders("/api/jobs", { method: "POST" });
    expect(requireMutationSession(request).owner.id).toBe(1);
  });

  it("treats localhost and 127.0.0.1 as the same loopback origin", () => {
    const request = new Request("http://127.0.0.1:3000/api/jobs", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "sec-fetch-site": "same-origin",
      },
    });
    expect(requireMutationSession(request).owner.id).toBe(1);
  });

  it("rejects host spoofing, cross-origin mutations, and wrong methods", () => {
    expect(() =>
      assertAllowedHost(new Request("http://evil.example/api/uploads", { headers: { host: "evil.example" } })),
    ).toThrow(RequestSecurityError);
    expect(() =>
      assertSafeMutationRequest(
        new Request("http://localhost:3000/api/jobs", {
          method: "POST",
          headers: { host: "localhost:3000", origin: "https://evil.example" },
        }),
      ),
    ).toThrow(RequestSecurityError);
    expect(() => assertSafeMutationRequest(requestWithSecurityHeaders("/api/jobs"))).toThrow(
      RequestSecurityError,
    );
  });

  it("does not expose private paths in unexpected error responses", async () => {
    const response = privacySafeErrorResponse(new Error("C:\\private\\owner-video.mp4 secret"));
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const payload = await response.json();
    expect(JSON.stringify(payload)).not.toContain("owner-video.mp4");
  });
});
