import fs from "node:fs";
import Database from "better-sqlite3";
import { getAppConfig } from "./config";
import { ensureStorageDirectories } from "./paths";

export const SINGLE_OWNER_ID = 1 as const;

export type Owner = {
  id: number;
  username: string;
  normalizedUsername: string;
  passwordHash: string;
  createdAt: number;
  updatedAt: number;
  passwordChangedAt: number;
  lastLoginAt: number | null;
  role: "admin" | "user";
  onboardedAt: number | null;
};

export type Session = {
  tokenHash: string;
  ownerId: number;
  createdAt: number;
  lastSeenAt: number;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
  revokedAt: number | null;
  ipHash: string | null;
  userAgentHash: string | null;
};

export type LoginAttemptScope = "pair" | "account";
export type LoginAttempt = {
  key: string;
  scope: LoginAttemptScope;
  failures: number;
  windowStartedAt: number;
  blockedUntil: number | null;
  updatedAt: number;
};

export type MediaAssetStatus = "staged" | "analyzing" | "ready" | "failed" | "deleted";
export type MediaAsset = {
  id: string;
  ownerId: number;
  originalName: string;
  storageKey: string;
  bytes: number;
  probedMime: string | null;
  sha256: string | null;
  analysis: unknown | null;
  status: MediaAssetStatus;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  deletedAt: number | null;
};

export type JobStatus =
  | "queued"
  | "analyzing"
  | "processing"
  | "completed"
  | "failed"
  | "cancel_requested"
  | "cancelled";

export type ProcessingJob = {
  id: string;
  ownerId: number;
  sourceAssetId: string;
  preset: string;
  settings: unknown;
  status: JobStatus;
  phase: string;
  progress: number;
  errorCode: string | null;
  safeErrorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  cancelRequestedAt: number | null;
  telemetry: unknown;
  logTail: string[];
  attempt: number;
  workerId: string | null;
  leaseUntil: number | null;
};

export type ExportRecord = {
  id: string;
  ownerId: number;
  jobId: string;
  storageKey: string;
  displayName: string;
  bytes: number;
  sha256: string | null;
  media: unknown | null;
  createdAt: number;
  expiresAt: number | null;
  deletedAt: number | null;
};

export type OwnerSettings = {
  ownerId: number;
  defaultPreset: string;
  performanceMode: "fast_hardware" | "balanced" | "maximum_cpu";
  maxUploadBytes: number;
  tempRetentionHours: number;
  outputRetentionDays: number | null;
  enhancements: unknown;
  updatedAt: number;
};

export type MaintenanceState = {
  locked: boolean;
  operation: string | null;
  startedAt: number | null;
  details: unknown | null;
};

type SqlOwner = {
  id: number;
  username: string;
  normalized_username: string;
  password_hash: string;
  created_at: number;
  updated_at: number;
  password_changed_at: number;
  last_login_at: number | null;
  role: "admin" | "user";
  onboarded_at: number | null;
};

type SqlSession = {
  token_hash: string;
  owner_id: number;
  created_at: number;
  last_seen_at: number;
  idle_expires_at: number;
  absolute_expires_at: number;
  revoked_at: number | null;
  ip_hash: string | null;
  user_agent_hash: string | null;
};

type SqlLoginAttempt = {
  key: string;
  scope: LoginAttemptScope;
  failures: number;
  window_started_at: number;
  blocked_until: number | null;
  updated_at: number;
};

type SqlMediaAsset = {
  id: string;
  owner_id: number;
  original_name: string;
  storage_key: string;
  bytes: number;
  probed_mime: string | null;
  sha256: string | null;
  analysis_json: string | null;
  status: MediaAssetStatus;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
  deleted_at: number | null;
};

type SqlJob = {
  id: string;
  owner_id: number;
  source_asset_id: string;
  preset: string;
  settings_json: string;
  status: JobStatus;
  phase: string;
  progress: number;
  error_code: string | null;
  safe_error_message: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
  cancel_requested_at: number | null;
  telemetry_json: string;
  log_tail_json: string;
  attempt: number;
  worker_id: string | null;
  lease_until: number | null;
};

type SqlExport = {
  id: string;
  owner_id: number;
  job_id: string;
  storage_key: string;
  display_name: string;
  bytes: number;
  sha256: string | null;
  media_json: string | null;
  created_at: number;
  expires_at: number | null;
  deleted_at: number | null;
};

type SqlSettings = {
  owner_id: number;
  default_preset: string;
  performance_mode: OwnerSettings["performanceMode"];
  max_upload_bytes: number;
  temp_retention_hours: number;
  output_retention_days: number | null;
  enhancements_json: string;
  updated_at: number;
};

type SqlMaintenance = {
  locked: number;
  operation: string | null;
  started_at: number | null;
  details_json: string | null;
};

const schemaSql = `
CREATE TABLE IF NOT EXISTS owners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  normalized_username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  password_changed_at INTEGER NOT NULL,
  last_login_at INTEGER,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  onboarded_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  ip_hash TEXT,
  user_agent_hash TEXT
);
CREATE INDEX IF NOT EXISTS sessions_owner_idx ON sessions(owner_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(absolute_expires_at, idle_expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('pair', 'account')),
  failures INTEGER NOT NULL CHECK (failures >= 0),
  window_started_at INTEGER NOT NULL,
  blocked_until INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_updated_idx ON login_attempts(updated_at);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  probed_mime TEXT,
  sha256 TEXT,
  analysis_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('staged', 'analyzing', 'ready', 'failed', 'deleted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS media_assets_owner_created_idx ON media_assets(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS media_assets_expiry_idx ON media_assets(expires_at);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  source_asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  preset TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'analyzing', 'processing', 'completed', 'failed', 'cancel_requested', 'cancelled')),
  phase TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  error_code TEXT,
  safe_error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  cancel_requested_at INTEGER,
  telemetry_json TEXT NOT NULL DEFAULT '{}',
  log_tail_json TEXT NOT NULL DEFAULT '[]',
  attempt INTEGER NOT NULL DEFAULT 0,
  worker_id TEXT,
  lease_until INTEGER
);
CREATE INDEX IF NOT EXISTS jobs_owner_created_idx ON jobs(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_status_created_idx ON jobs(status, created_at);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  sha256 TEXT,
  media_json TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS exports_owner_created_idx ON exports(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS exports_expiry_idx ON exports(expires_at);

CREATE TABLE IF NOT EXISTS settings (
  owner_id INTEGER PRIMARY KEY REFERENCES owners(id) ON DELETE CASCADE,
  default_preset TEXT NOT NULL DEFAULT 'tiktok_safe',
  performance_mode TEXT NOT NULL DEFAULT 'balanced' CHECK (performance_mode IN ('fast_hardware', 'balanced', 'maximum_cpu')),
  max_upload_bytes INTEGER NOT NULL,
  temp_retention_hours INTEGER NOT NULL DEFAULT 24,
  output_retention_days INTEGER,
  enhancements_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS maintenance_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  operation TEXT,
  started_at INTEGER,
  details_json TEXT
);
INSERT OR IGNORE INTO maintenance_state(id, locked) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('bug', 'feedback')),
  message TEXT NOT NULL,
  page TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'resolved')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_owner_created_idx ON feedback(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_status_created_idx ON feedback(status, created_at DESC);
`;

const SCHEMA_VERSION = 3;

declare global {
  var __ttoDatabase: Database.Database | undefined;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (value === null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function json(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function ownerFromSql(row: SqlOwner): Owner {
  return {
    id: row.id,
    username: row.username,
    normalizedUsername: row.normalized_username,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    passwordChangedAt: row.password_changed_at,
    lastLoginAt: row.last_login_at,
    role: row.role,
    onboardedAt: row.onboarded_at,
  };
}

function sessionFromSql(row: SqlSession): Session {
  return {
    tokenHash: row.token_hash,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
    revokedAt: row.revoked_at,
    ipHash: row.ip_hash,
    userAgentHash: row.user_agent_hash,
  };
}

function loginAttemptFromSql(row: SqlLoginAttempt): LoginAttempt {
  return {
    key: row.key,
    scope: row.scope,
    failures: row.failures,
    windowStartedAt: row.window_started_at,
    blockedUntil: row.blocked_until,
    updatedAt: row.updated_at,
  };
}

function mediaAssetFromSql(row: SqlMediaAsset): MediaAsset {
  return {
    id: row.id,
    ownerId: row.owner_id,
    originalName: row.original_name,
    storageKey: row.storage_key,
    bytes: row.bytes,
    probedMime: row.probed_mime,
    sha256: row.sha256,
    analysis: parseJson<unknown | null>(row.analysis_json, null),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    deletedAt: row.deleted_at,
  };
}

function jobFromSql(row: SqlJob): ProcessingJob {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sourceAssetId: row.source_asset_id,
    preset: row.preset,
    settings: parseJson(row.settings_json, {}),
    status: row.status,
    phase: row.phase,
    progress: row.progress,
    errorCode: row.error_code,
    safeErrorMessage: row.safe_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelRequestedAt: row.cancel_requested_at,
    telemetry: parseJson(row.telemetry_json, {}),
    logTail: parseJson<string[]>(row.log_tail_json, []),
    attempt: row.attempt,
    workerId: row.worker_id,
    leaseUntil: row.lease_until,
  };
}

function exportFromSql(row: SqlExport): ExportRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    jobId: row.job_id,
    storageKey: row.storage_key,
    displayName: row.display_name,
    bytes: row.bytes,
    sha256: row.sha256,
    media: parseJson<unknown | null>(row.media_json, null),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    deletedAt: row.deleted_at,
  };
}

function settingsFromSql(row: SqlSettings): OwnerSettings {
  return {
    ownerId: row.owner_id,
    defaultPreset: row.default_preset,
    performanceMode: row.performance_mode,
    maxUploadBytes: row.max_upload_bytes,
    tempRetentionHours: row.temp_retention_hours,
    outputRetentionDays: row.output_retention_days,
    enhancements: parseJson(row.enhancements_json, {}),
    updatedAt: row.updated_at,
  };
}

function maintenanceFromSql(row: SqlMaintenance): MaintenanceState {
  return {
    locked: row.locked === 1,
    operation: row.operation,
    startedAt: row.started_at,
    details: parseJson<unknown | null>(row.details_json, null),
  };
}

export function getDatabase(): Database.Database {
  if (globalThis.__ttoDatabase?.open) return globalThis.__ttoDatabase;

  const config = getAppConfig();
  ensureStorageDirectories();
  const db = new Database(config.databasePath, { timeout: 5_000 });
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("secure_delete = ON");
  const schemaVersion = Number(db.pragma("user_version", { simple: true }));
  if (schemaVersion > SCHEMA_VERSION) {
    db.close();
    throw new Error("The database was created by a newer TikTok Optimizer version.");
  }
  if (schemaVersion < 3 && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='owners'").get()) {
    const ownerSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='owners'").get() as { sql?: string } | undefined)?.sql ?? "";
    if (ownerSql.includes("CHECK (id = 1)")) {
      db.pragma("foreign_keys = OFF");
      db.exec(`CREATE TABLE owners_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, normalized_username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        password_changed_at INTEGER NOT NULL, last_login_at INTEGER,
        role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'user')), onboarded_at INTEGER
      );
      INSERT INTO owners_new(id, username, normalized_username, password_hash, created_at, updated_at, password_changed_at, last_login_at, role, onboarded_at)
      SELECT id, username, normalized_username, password_hash, created_at, updated_at, password_changed_at, last_login_at, 'admin', NULL FROM owners;
      DROP TABLE owners;
      ALTER TABLE owners_new RENAME TO owners;`);
      db.pragma("foreign_keys = ON");
    }
  }
  db.exec(schemaSql);
  const jobColumns = new Set(
    (db.pragma("table_info(jobs)") as Array<{ name: string }>).map((column) => column.name),
  );
  const jobMigrations = [
    ["telemetry_json", "ALTER TABLE jobs ADD COLUMN telemetry_json TEXT NOT NULL DEFAULT '{}'"],
    ["log_tail_json", "ALTER TABLE jobs ADD COLUMN log_tail_json TEXT NOT NULL DEFAULT '[]'"],
    ["attempt", "ALTER TABLE jobs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0"],
    ["worker_id", "ALTER TABLE jobs ADD COLUMN worker_id TEXT"],
    ["lease_until", "ALTER TABLE jobs ADD COLUMN lease_until INTEGER"],
  ] as const;
  for (const [column, statement] of jobMigrations) {
    if (!jobColumns.has(column)) db.exec(statement);
  }
  if (schemaVersion < SCHEMA_VERSION) db.pragma(`user_version = ${SCHEMA_VERSION}`);
  try {
    fs.chmodSync(config.databasePath, 0o600);
  } catch {
    // Windows may not implement POSIX modes; directory ACLs remain authoritative.
  }
  globalThis.__ttoDatabase = db;
  return db;
}

export function closeDatabase(): void {
  if (globalThis.__ttoDatabase?.open) globalThis.__ttoDatabase.close();
  globalThis.__ttoDatabase = undefined;
}

export const owners = {
  get(id: number = SINGLE_OWNER_ID): Owner | null {
    const row = getDatabase().prepare("SELECT * FROM owners WHERE id = ?").get(id) as SqlOwner | undefined;
    return row ? ownerFromSql(row) : null;
  },

  getByNormalizedUsername(normalizedUsername: string): Owner | null {
    const row = getDatabase()
      .prepare("SELECT * FROM owners WHERE normalized_username = ?")
      .get(normalizedUsername) as SqlOwner | undefined;
    return row ? ownerFromSql(row) : null;
  },

  create(username: string, normalizedUsername: string, passwordHash: string, role: "admin" | "user" = "user", now = Date.now()): Owner {
    const db = getDatabase();
    const id = db.transaction(() => {
      const legacy = db.prepare("SELECT id FROM owners WHERE password_hash = 'authentication-disabled' LIMIT 1").get() as { id: number } | undefined;
      if (legacy) {
        db.prepare(`UPDATE owners SET username=?, normalized_username=?, password_hash=?, role='admin', updated_at=?, password_changed_at=? WHERE id=?`)
          .run(username, normalizedUsername, passwordHash, now, now, legacy.id);
        return legacy.id;
      }
      const result = db.prepare(
        `INSERT INTO owners(username, normalized_username, password_hash, role, created_at, updated_at, password_changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(username, normalizedUsername, passwordHash, role, now, now, now);
      const createdId = Number(result.lastInsertRowid);
      db.prepare(
        `INSERT INTO settings(owner_id, max_upload_bytes, updated_at)
         VALUES (?, ?, ?)`,
      ).run(createdId, getAppConfig().maxUploadBytes, now);
      return createdId;
    })();
    const owner = this.get(id);
    if (!owner) throw new Error("Owner initialization did not persist.");
    return owner;
  },

  count(): number {
    return Number((getDatabase().prepare("SELECT COUNT(*) AS count FROM owners WHERE password_hash <> 'authentication-disabled'").get() as { count: number }).count);
  },

  completeOnboarding(id: number, now = Date.now()): void {
    getDatabase().prepare("UPDATE owners SET onboarded_at = COALESCE(onboarded_at, ?), updated_at = ? WHERE id = ?").run(now, now, id);
  },

  ensureLocal(now = Date.now()): Owner {
    const db = getDatabase();
    db.transaction(() => {
      db.prepare(
        `INSERT OR IGNORE INTO owners(id, username, normalized_username, password_hash, created_at, updated_at, password_changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(SINGLE_OWNER_ID, "Local workspace", "local-workspace", "authentication-disabled", now, now, now);
      db.prepare(
        `INSERT OR IGNORE INTO settings(owner_id, max_upload_bytes, updated_at)
         VALUES (?, ?, ?)`,
      ).run(SINGLE_OWNER_ID, getAppConfig().maxUploadBytes, now);
    })();
    const owner = this.get();
    if (!owner) throw new Error("The local workspace could not be initialized.");
    return owner;
  },

  updatePassword(passwordHash: string, now = Date.now()): void {
    getDatabase()
      .prepare("UPDATE owners SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?")
      .run(passwordHash, now, now, SINGLE_OWNER_ID);
  },

  markLogin(id: number, now = Date.now()): void {
    getDatabase().prepare("UPDATE owners SET last_login_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
  },
};

export type FeedbackRecord = { id: string; ownerId: number; username: string; kind: "bug" | "feedback"; message: string; page: string; status: "new" | "reviewing" | "resolved"; createdAt: number; updatedAt: number };

export const feedbackRepository = {
  create(value: Omit<FeedbackRecord, "username">): void {
    getDatabase().prepare(`INSERT INTO feedback(id, owner_id, kind, message, page, status, created_at, updated_at)
      VALUES (@id, @ownerId, @kind, @message, @page, @status, @createdAt, @updatedAt)`).run(value);
  },
  listAll(limit = 500): FeedbackRecord[] {
    return getDatabase().prepare(`SELECT f.id, f.owner_id ownerId, o.username, f.kind, f.message, f.page, f.status, f.created_at createdAt, f.updated_at updatedAt
      FROM feedback f JOIN owners o ON o.id=f.owner_id ORDER BY f.created_at DESC LIMIT ?`).all(Math.max(1, Math.min(500, limit))) as FeedbackRecord[];
  },
  updateStatus(id: string, status: FeedbackRecord["status"], now = Date.now()): boolean {
    return getDatabase().prepare("UPDATE feedback SET status=?, updated_at=? WHERE id=?").run(status, now, id).changes === 1;
  },
};

export const sessions = {
  create(value: Session): void {
    getDatabase().prepare(
      `INSERT INTO sessions(token_hash, owner_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at, ip_hash, user_agent_hash)
       VALUES (@tokenHash, @ownerId, @createdAt, @lastSeenAt, @idleExpiresAt, @absoluteExpiresAt, @revokedAt, @ipHash, @userAgentHash)`,
    ).run(value);
  },

  get(tokenHash: string): Session | null {
    const row = getDatabase().prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash) as SqlSession | undefined;
    return row ? sessionFromSql(row) : null;
  },

  touch(tokenHash: string, lastSeenAt: number, idleExpiresAt: number): void {
    getDatabase()
      .prepare("UPDATE sessions SET last_seen_at = ?, idle_expires_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
      .run(lastSeenAt, idleExpiresAt, tokenHash);
  },

  revoke(tokenHash: string, now = Date.now()): void {
    getDatabase().prepare("UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE token_hash = ?").run(now, tokenHash);
  },

  revokeAll(ownerId: number = SINGLE_OWNER_ID, now = Date.now()): void {
    getDatabase().prepare("UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE owner_id = ?").run(now, ownerId);
  },

  deleteExpired(now = Date.now()): number {
    return getDatabase()
      .prepare("DELETE FROM sessions WHERE revoked_at IS NOT NULL OR idle_expires_at <= ? OR absolute_expires_at <= ?")
      .run(now, now).changes;
  },
};

export const loginAttempts = {
  get(key: string): LoginAttempt | null {
    const row = getDatabase().prepare("SELECT * FROM login_attempts WHERE key = ?").get(key) as SqlLoginAttempt | undefined;
    return row ? loginAttemptFromSql(row) : null;
  },

  recordFailure(
    key: string,
    scope: LoginAttemptScope,
    limit: number,
    now: number,
    windowMs: number,
    blockMs: number,
  ): LoginAttempt {
    const db = getDatabase();
    return db.transaction(() => {
      const existing = this.get(key);
      const sameWindow = existing && now - existing.windowStartedAt < windowMs;
      const failures = sameWindow ? existing.failures + 1 : 1;
      const windowStartedAt = sameWindow ? existing.windowStartedAt : now;
      const blockedUntil = failures >= limit ? now + blockMs : null;
      db.prepare(
        `INSERT INTO login_attempts(key, scope, failures, window_started_at, blocked_until, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET scope = excluded.scope, failures = excluded.failures,
           window_started_at = excluded.window_started_at, blocked_until = excluded.blocked_until,
           updated_at = excluded.updated_at`,
      ).run(key, scope, failures, windowStartedAt, blockedUntil, now);
      return { key, scope, failures, windowStartedAt, blockedUntil, updatedAt: now };
    })();
  },

  clear(keys: readonly string[]): void {
    const statement = getDatabase().prepare("DELETE FROM login_attempts WHERE key = ?");
    getDatabase().transaction(() => {
      for (const key of keys) statement.run(key);
    })();
  },

  deleteStale(before: number): number {
    return getDatabase().prepare("DELETE FROM login_attempts WHERE updated_at < ?").run(before).changes;
  },
};

export const mediaAssets = {
  create(value: Omit<MediaAsset, "analysis" | "updatedAt" | "deletedAt"> & { analysis?: unknown | null; updatedAt?: number; deletedAt?: number | null }): MediaAsset {
    const row = {
      ...value,
      analysisJson: value.analysis === null || value.analysis === undefined ? null : json(value.analysis),
      updatedAt: value.updatedAt ?? value.createdAt,
      deletedAt: value.deletedAt ?? null,
    };
    getDatabase().prepare(
      `INSERT INTO media_assets(id, owner_id, original_name, storage_key, bytes, probed_mime, sha256, analysis_json, status, created_at, updated_at, expires_at, deleted_at)
       VALUES (@id, @ownerId, @originalName, @storageKey, @bytes, @probedMime, @sha256, @analysisJson, @status, @createdAt, @updatedAt, @expiresAt, @deletedAt)`,
    ).run(row);
    const created = this.get(value.id, value.ownerId);
    if (!created) throw new Error("Media asset did not persist.");
    return created;
  },

  get(id: string, ownerId: number = SINGLE_OWNER_ID): MediaAsset | null {
    const row = getDatabase()
      .prepare("SELECT * FROM media_assets WHERE id = ? AND owner_id = ?")
      .get(id, ownerId) as SqlMediaAsset | undefined;
    return row ? mediaAssetFromSql(row) : null;
  },

  list(ownerId: number = SINGLE_OWNER_ID, limit = 100): MediaAsset[] {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = getDatabase()
      .prepare("SELECT * FROM media_assets WHERE owner_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?")
      .all(ownerId, safeLimit) as SqlMediaAsset[];
    return rows.map(mediaAssetFromSql);
  },

  listAll(ownerId: number = SINGLE_OWNER_ID): MediaAsset[] {
    const rows = getDatabase()
      .prepare("SELECT * FROM media_assets WHERE owner_id = ? ORDER BY created_at DESC")
      .all(ownerId) as SqlMediaAsset[];
    return rows.map(mediaAssetFromSql);
  },

  setAnalysis(id: string, ownerId: number, analysis: unknown, status: MediaAssetStatus = "ready", now = Date.now()): boolean {
    return getDatabase()
      .prepare("UPDATE media_assets SET analysis_json = ?, status = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
      .run(json(analysis), status, now, id, ownerId).changes === 1;
  },

  setStatus(id: string, ownerId: number, status: MediaAssetStatus, now = Date.now()): boolean {
    return getDatabase()
      .prepare("UPDATE media_assets SET status = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
      .run(status, now, id, ownerId).changes === 1;
  },

  markDeleted(id: string, ownerId: number, now = Date.now()): boolean {
    return getDatabase()
      .prepare("UPDATE media_assets SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
      .run(now, now, id, ownerId).changes === 1;
  },
};

export const jobs = {
  create(value: Omit<ProcessingJob, "updatedAt" | "errorCode" | "safeErrorMessage" | "startedAt" | "completedAt" | "cancelRequestedAt" | "telemetry" | "logTail" | "attempt" | "workerId" | "leaseUntil"> & Partial<Pick<ProcessingJob, "updatedAt" | "errorCode" | "safeErrorMessage" | "startedAt" | "completedAt" | "cancelRequestedAt" | "telemetry" | "logTail" | "attempt" | "workerId" | "leaseUntil">>): ProcessingJob {
    const row = {
      ...value,
      settingsJson: json(value.settings),
      updatedAt: value.updatedAt ?? value.createdAt,
      errorCode: value.errorCode ?? null,
      safeErrorMessage: value.safeErrorMessage ?? null,
      startedAt: value.startedAt ?? null,
      completedAt: value.completedAt ?? null,
      cancelRequestedAt: value.cancelRequestedAt ?? null,
      telemetryJson: json(value.telemetry ?? {}),
      logTailJson: json(value.logTail ?? []),
      attempt: value.attempt ?? 0,
      workerId: value.workerId ?? null,
      leaseUntil: value.leaseUntil ?? null,
    };
    getDatabase().prepare(
      `INSERT INTO jobs(id, owner_id, source_asset_id, preset, settings_json, status, phase, progress, error_code, safe_error_message, created_at, updated_at, started_at, completed_at, cancel_requested_at, telemetry_json, log_tail_json, attempt, worker_id, lease_until)
       VALUES (@id, @ownerId, @sourceAssetId, @preset, @settingsJson, @status, @phase, @progress, @errorCode, @safeErrorMessage, @createdAt, @updatedAt, @startedAt, @completedAt, @cancelRequestedAt, @telemetryJson, @logTailJson, @attempt, @workerId, @leaseUntil)`,
    ).run(row);
    const created = this.get(value.id, value.ownerId);
    if (!created) throw new Error("Processing job did not persist.");
    return created;
  },

  get(id: string, ownerId: number = SINGLE_OWNER_ID): ProcessingJob | null {
    const row = getDatabase().prepare("SELECT * FROM jobs WHERE id = ? AND owner_id = ?").get(id, ownerId) as SqlJob | undefined;
    return row ? jobFromSql(row) : null;
  },

  list(ownerId: number = SINGLE_OWNER_ID, limit = 100): ProcessingJob[] {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    return (getDatabase()
      .prepare("SELECT * FROM jobs WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(ownerId, safeLimit) as SqlJob[]).map(jobFromSql);
  },

  listAll(ownerId: number = SINGLE_OWNER_ID): ProcessingJob[] {
    return (getDatabase()
      .prepare("SELECT * FROM jobs WHERE owner_id = ? ORDER BY created_at DESC")
      .all(ownerId) as SqlJob[]).map(jobFromSql);
  },

  updateProgress(id: string, ownerId: number, phase: string, progress: number, now = Date.now()): boolean {
    const safeProgress = Math.max(0, Math.min(100, progress));
    return getDatabase()
      .prepare("UPDATE jobs SET phase = ?, progress = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
      .run(phase.slice(0, 120), safeProgress, now, id, ownerId).changes === 1;
  },

  updateTelemetry(
    id: string,
    ownerId: number,
    phase: string,
    progress: number,
    telemetry: unknown,
    logTail: readonly string[],
    now = Date.now(),
  ): boolean {
    const safeProgress = Math.max(0, Math.min(100, progress));
    const safeLog = logTail.slice(-40).map((line) => line.replace(/[\r\n]/g, " ").slice(0, 500));
    return getDatabase().prepare(
      `UPDATE jobs SET phase = ?, progress = ?, telemetry_json = ?, log_tail_json = ?, updated_at = ?
       WHERE id = ? AND owner_id = ?`,
    ).run(phase.slice(0, 120), safeProgress, json(telemetry), json(safeLog), now, id, ownerId).changes === 1;
  },

  claimNext(workerId: string, leaseMs = 30_000, now = Date.now()): ProcessingJob | null {
    const db = getDatabase();
    return db.transaction(() => {
      const row = db.prepare(
        "SELECT id, owner_id FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1",
      ).get() as { id: string; owner_id: number } | undefined;
      if (!row) return null;
      const changed = db.prepare(
        `UPDATE jobs SET status = 'analyzing', phase = 'Preparing source', progress = 1,
         worker_id = ?, lease_until = ?, attempt = attempt + 1, started_at = COALESCE(started_at, ?), updated_at = ?
         WHERE id = ? AND owner_id = ? AND status = 'queued'`,
      ).run(workerId.slice(0, 100), now + leaseMs, now, now, row.id, row.owner_id).changes;
      return changed === 1 ? this.get(row.id, row.owner_id) : null;
    }).immediate();
  },

  refreshLease(id: string, ownerId: number, workerId: string, leaseUntil: number, now = Date.now()): boolean {
    return getDatabase().prepare(
      "UPDATE jobs SET lease_until = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND worker_id = ? AND status IN ('analyzing', 'processing', 'cancel_requested')",
    ).run(leaseUntil, now, id, ownerId, workerId).changes === 1;
  },

  recoverAbandoned(now = Date.now()): number {
    return getDatabase().prepare(
      `UPDATE jobs SET status = 'failed', phase = 'Worker stopped', error_code = 'WORKER_INTERRUPTED',
       safe_error_message = 'The processing worker stopped before this job finished. Temporary files will be cleaned automatically.',
       completed_at = ?, updated_at = ?, worker_id = NULL, lease_until = NULL
       WHERE status IN ('analyzing', 'processing') AND lease_until IS NOT NULL AND lease_until < ?`,
    ).run(now, now, now).changes;
  },

  setStatus(
    id: string,
    ownerId: number,
    status: JobStatus,
    options: { phase?: string; errorCode?: string | null; safeErrorMessage?: string | null; startedAt?: number | null; completedAt?: number | null } = {},
    now = Date.now(),
  ): boolean {
    return getDatabase().prepare(
      `UPDATE jobs SET status = ?, phase = COALESCE(?, phase), error_code = ?, safe_error_message = ?,
       started_at = COALESCE(?, started_at), completed_at = COALESCE(?, completed_at),
       worker_id = CASE WHEN ? IN ('completed', 'failed', 'cancelled') THEN NULL ELSE worker_id END,
       lease_until = CASE WHEN ? IN ('completed', 'failed', 'cancelled') THEN NULL ELSE lease_until END,
       updated_at = ?
       WHERE id = ? AND owner_id = ?`,
    ).run(
      status,
      options.phase?.slice(0, 120) ?? null,
      options.errorCode?.slice(0, 80) ?? null,
      options.safeErrorMessage?.slice(0, 500) ?? null,
      options.startedAt ?? null,
      options.completedAt ?? null,
      status,
      status,
      now,
      id,
      ownerId,
    ).changes === 1;
  },

  requestCancellation(id: string, ownerId: number, now = Date.now()): boolean {
    return getDatabase().prepare(
      `UPDATE jobs SET status = 'cancel_requested', cancel_requested_at = ?, updated_at = ?
       WHERE id = ? AND owner_id = ? AND status IN ('queued', 'analyzing', 'processing')`,
    ).run(now, now, id, ownerId).changes === 1;
  },
};

export const exportsRepository = {
  create(value: ExportRecord): ExportRecord {
    getDatabase().prepare(
      `INSERT INTO exports(id, owner_id, job_id, storage_key, display_name, bytes, sha256, media_json, created_at, expires_at, deleted_at)
       VALUES (@id, @ownerId, @jobId, @storageKey, @displayName, @bytes, @sha256, @mediaJson, @createdAt, @expiresAt, @deletedAt)`,
    ).run({ ...value, mediaJson: value.media === null ? null : json(value.media) });
    const created = this.get(value.id, value.ownerId);
    if (!created) throw new Error("Export did not persist.");
    return created;
  },

  get(id: string, ownerId: number = SINGLE_OWNER_ID): ExportRecord | null {
    const row = getDatabase().prepare("SELECT * FROM exports WHERE id = ? AND owner_id = ?").get(id, ownerId) as SqlExport | undefined;
    return row ? exportFromSql(row) : null;
  },

  list(ownerId: number = SINGLE_OWNER_ID, limit = 100): ExportRecord[] {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    return (getDatabase()
      .prepare("SELECT * FROM exports WHERE owner_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?")
      .all(ownerId, safeLimit) as SqlExport[]).map(exportFromSql);
  },

  listAll(ownerId: number = SINGLE_OWNER_ID): ExportRecord[] {
    return (getDatabase()
      .prepare("SELECT * FROM exports WHERE owner_id = ? ORDER BY created_at DESC")
      .all(ownerId) as SqlExport[]).map(exportFromSql);
  },

  markDeleted(id: string, ownerId: number, now = Date.now()): boolean {
    return getDatabase().prepare("UPDATE exports SET deleted_at = ? WHERE id = ? AND owner_id = ?").run(now, id, ownerId).changes === 1;
  },
};

export const settingsRepository = {
  get(ownerId: number = SINGLE_OWNER_ID): OwnerSettings | null {
    const row = getDatabase().prepare("SELECT * FROM settings WHERE owner_id = ?").get(ownerId) as SqlSettings | undefined;
    return row ? settingsFromSql(row) : null;
  },

  update(value: Omit<OwnerSettings, "updatedAt">, now = Date.now()): OwnerSettings {
    getDatabase().prepare(
      `INSERT INTO settings(owner_id, default_preset, performance_mode, max_upload_bytes, temp_retention_hours, output_retention_days, enhancements_json, updated_at)
       VALUES (@ownerId, @defaultPreset, @performanceMode, @maxUploadBytes, @tempRetentionHours, @outputRetentionDays, @enhancementsJson, @updatedAt)
       ON CONFLICT(owner_id) DO UPDATE SET default_preset = excluded.default_preset,
       performance_mode = excluded.performance_mode, max_upload_bytes = excluded.max_upload_bytes,
       temp_retention_hours = excluded.temp_retention_hours, output_retention_days = excluded.output_retention_days,
       enhancements_json = excluded.enhancements_json, updated_at = excluded.updated_at`,
    ).run({ ...value, enhancementsJson: json(value.enhancements), updatedAt: now });
    const updated = this.get(value.ownerId);
    if (!updated) throw new Error("Settings did not persist.");
    return updated;
  },
};

export const maintenanceState = {
  get(): MaintenanceState {
    const row = getDatabase().prepare("SELECT locked, operation, started_at, details_json FROM maintenance_state WHERE id = 1").get() as SqlMaintenance;
    return maintenanceFromSql(row);
  },

  tryAcquire(operation: string, details: unknown = null, now = Date.now()): boolean {
    return getDatabase().prepare(
      `UPDATE maintenance_state SET locked = 1, operation = ?, started_at = ?, details_json = ?
       WHERE id = 1 AND locked = 0`,
    ).run(operation.slice(0, 80), now, details === null ? null : json(details)).changes === 1;
  },

  release(): void {
    getDatabase().prepare(
      "UPDATE maintenance_state SET locked = 0, operation = NULL, started_at = NULL, details_json = NULL WHERE id = 1",
    ).run();
  },
};

export function deleteAllOwnerMediaHistory(ownerId: number = SINGLE_OWNER_ID): void {
  const db = getDatabase();
  db.transaction(() => {
    db.prepare("DELETE FROM exports WHERE owner_id = ?").run(ownerId);
    db.prepare("DELETE FROM jobs WHERE owner_id = ?").run(ownerId);
    db.prepare("DELETE FROM media_assets WHERE owner_id = ?").run(ownerId);
  })();
}

export function compactPrivateDatabase(): void {
  const db = getDatabase();
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.exec("VACUUM");
}
