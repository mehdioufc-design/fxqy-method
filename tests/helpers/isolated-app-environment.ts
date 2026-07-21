import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resetAppConfigForTests } from "../../lib/config";
import { closeDatabase, owners } from "../../lib/db";

const TEST_ENVIRONMENT_KEYS = [
  "APP_ORIGIN",
  "ALLOWED_HOSTS",
  "DATA_ROOT",
  "DATABASE_PATH",
  "MEDIA_ROOT",
  "TEMP_ROOT",
  "MAX_UPLOAD_BYTES",
  "MIN_FREE_BYTES",
  "JOB_TIMEOUT_MINUTES",
  "RETENTION_HOURS",
] as const;

export class IsolatedAppEnvironment {
  root = "";
  readonly #previous = new Map<string, string | undefined>();

  async start(): Promise<void> {
    for (const key of TEST_ENVIRONMENT_KEYS) this.#previous.set(key, process.env[key]);
    this.root = await mkdtemp(path.join(os.tmpdir(), "tto-tests-"));
    this.#applyEnvironment();
    await this.reset();
  }

  async reset(): Promise<void> {
    closeDatabase();
    resetAppConfigForTests();
    if (!this.root) throw new Error("Isolated environment has not started.");
    await rm(this.root, { recursive: true, force: true });
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    this.#applyEnvironment();
    owners.ensureLocal();
  }

  async dispose(): Promise<void> {
    closeDatabase();
    resetAppConfigForTests();
    if (this.root) await rm(this.root, { recursive: true, force: true });
    for (const [key, value] of this.#previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetAppConfigForTests();
  }

  #applyEnvironment(): void {
    process.env.APP_ORIGIN = "http://localhost:3000";
    process.env.ALLOWED_HOSTS = "localhost:3000";
    process.env.DATA_ROOT = this.root;
    process.env.DATABASE_PATH = path.join(this.root, "private.sqlite");
    process.env.MEDIA_ROOT = path.join(this.root, "media");
    process.env.TEMP_ROOT = path.join(this.root, "tmp");
    process.env.MAX_UPLOAD_BYTES = String(1024 * 1024);
    process.env.MIN_FREE_BYTES = String(128 * 1024 * 1024);
    process.env.JOB_TIMEOUT_MINUTES = "5";
    process.env.RETENTION_HOURS = "1";
  }
}

export function requestWithSecurityHeaders(
  pathname: string,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers);
  headers.set("host", "localhost:3000");
  headers.set("origin", "http://localhost:3000");
  headers.set("sec-fetch-site", "same-origin");
  headers.set("user-agent", "TikTok Optimizer automated tests");
  return new Request(`http://localhost:3000${pathname}`, { ...init, headers });
}
