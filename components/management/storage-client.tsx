"use client";

import {
  Database,
  FileVideo2,
  HardDrive,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest, formatBytes } from "@/lib/client-api";
import {
  ErrorPanel,
  formatDateTime,
  LoadingPanel,
  ManagementIntro,
  StatusPill,
  toFiniteNumber,
} from "./management-ui";
import type { StoragePayload, StorageSummary, StoredFileView } from "./types";

const DELETE_CONFIRMATION = "DELETE ALL FILES";

export function StorageClient() {
  const [data, setData] = useState<StoragePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retentionHours, setRetentionHours] = useState("168");
  const [savingRetention, setSavingRetention] = useState(false);
  const [retentionError, setRetentionError] = useState("");
  const [retentionMessage, setRetentionMessage] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");

  const loadStorage = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiRequest<Partial<StoragePayload>>("/api/storage");
      const normalized = normalizeStoragePayload(payload);
      setData(normalized);
      setRetentionHours(String(normalized.summary.retentionHours));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Local storage information could not be read.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadStorage(), 0);
    return () => window.clearTimeout(timer);
  }, [loadStorage]);

  async function saveRetention(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(retentionHours);
    if (!Number.isInteger(value) || value < 1 || value > 8760) {
      setRetentionError("Temporary-file retention must be a whole number from 1 to 8760 hours.");
      return;
    }

    setSavingRetention(true);
    setRetentionError("");
    setRetentionMessage("");
    try {
      const payload = await apiRequest<{ summary?: Partial<StorageSummary> }>("/api/storage", {
        method: "PUT",
        body: JSON.stringify({ retentionHours: value }),
      });
      setData((current) => current ? {
        ...current,
        summary: normalizeSummary(payload.summary, { ...current.summary, retentionHours: value }),
      } : current);
      setRetentionMessage("Temporary-file retention updated.");
    } catch (saveError) {
      setRetentionError(saveError instanceof Error ? saveError.message : "Retention could not be updated.");
    } finally {
      setSavingRetention(false);
    }
  }

  async function deleteEverything(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmation !== DELETE_CONFIRMATION) {
      setDeleteError(`Type ${DELETE_CONFIRMATION} exactly to continue.`);
      return;
    }

    setDeleting(true);
    setDeleteError("");
    setDeleteMessage("");
    try {
      const payload = await apiRequest<{
        ok: true;
        deleted?: { assets?: number; exports?: number; jobs?: number };
      }>("/api/storage/delete-all", {
        method: "POST",
        body: JSON.stringify({ confirmation }),
      });
      const deleted = payload.deleted ?? {};
      setConfirmation("");
      setDeleteMessage(
        `Deleted ${toFiniteNumber(deleted.assets)} source record(s), ${toFiniteNumber(deleted.exports)} export record(s), and ${toFiniteNumber(deleted.jobs)} history record(s). Saved settings were retained.`,
      );
      await loadStorage();
    } catch (deleteFailure) {
      setDeleteError(deleteFailure instanceof Error ? deleteFailure.message : "Local files and history could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="dashboard-stack management-page">
      <ManagementIntro
        eyebrow="Private disk usage"
        title="Local storage management"
        description="Review source, export, and temporary-file usage. Files stay on this machine unless you download or move them yourself."
        actions={
          <button className="button-secondary" type="button" onClick={() => void loadStorage()} disabled={loading || deleting}>
            <RefreshCw size={16} aria-hidden="true" />
            Refresh
          </button>
        }
      />

      {loading ? <LoadingPanel label="Inspecting private storage" /> : null}
      {!loading && error ? <ErrorPanel message={error} onRetry={() => void loadStorage()} /> : null}

      {!loading && !error && data ? (
        <>
          <section className="storage-overview panel animate-in" aria-labelledby="storage-overview-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Disk summary</p>
                <h2 id="storage-overview-title">Application-managed files</h2>
              </div>
              <StatusPill tone="info"><HardDrive size={13} aria-hidden="true" />{formatBytes(data.summary.freeBytes)} free</StatusPill>
            </div>

            <div className="storage-usage-heading">
              <strong>{formatBytes(data.summary.usedBytes)} used</strong>
              <span>{storageCapacityLabel(data.summary)}</span>
            </div>
            <div
              className="storage-capacity-track"
              role="meter"
              aria-label="Application storage used"
              aria-valuemin={0}
              aria-valuemax={Math.max(1, data.summary.usedBytes + data.summary.freeBytes)}
              aria-valuenow={data.summary.usedBytes}
            >
              <span style={{ width: `${capacityPercent(data.summary)}%` }} />
            </div>

            <dl className="storage-metrics">
              <div><dt>Sources</dt><dd>{formatBytes(data.summary.sourceBytes)}</dd><small>{data.assets.length} file(s)</small></div>
              <div><dt>Exports</dt><dd>{formatBytes(data.summary.exportBytes)}</dd><small>{data.exports.length} file(s)</small></div>
              <div><dt>Temporary</dt><dd>{formatBytes(data.summary.tempBytes)}</dd><small>Automatic cleanup</small></div>
              <div><dt>Maximum upload</dt><dd>{formatBytes(data.summary.maxUploadBytes)}</dd><small>Per source</small></div>
            </dl>
          </section>

          <section className="management-two-column">
            <StoredFilePanel
              title="Uploaded sources"
              description="Private originals currently managed by the application."
              files={data.assets}
              icon={<FileVideo2 size={18} />}
              empty="No uploaded source files are currently stored."
            />
            <StoredFilePanel
              title="Completed exports"
              description="Rendered files available from the export library."
              files={data.exports}
              icon={<Database size={18} />}
              empty="No completed export files are currently stored."
              footer={<Link className="button-ghost" href="/exports">Manage exports</Link>}
            />
          </section>

          <section className="management-two-column management-settings-grid">
            <form className="storage-retention panel" onSubmit={saveRetention}>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Cleanup policy</p>
                  <h2>Temporary-file retention</h2>
                </div>
              </div>
              <p className="management-section-copy">Temporary processing files are removed after this period. Completed output retention is configured in Settings.</p>
              <label className="field" htmlFor="retention-hours">
                <span>Retention in hours</span>
                <input
                  className="input"
                  id="retention-hours"
                  type="number"
                  min={1}
                  max={8760}
                  step={1}
                  inputMode="numeric"
                  value={retentionHours}
                  onChange={(event) => setRetentionHours(event.target.value)}
                  disabled={savingRetention}
                  required
                />
              </label>
              {retentionError ? <p className="inline-error" role="alert">{retentionError}</p> : null}
              {retentionMessage ? <p className="management-success" role="status"><ShieldCheck size={15} aria-hidden="true" />{retentionMessage}</p> : null}
              <div className="management-form-actions">
                <button className="button-primary" type="submit" disabled={savingRetention}>
                  {savingRetention ? <span className="spinner" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
                  {savingRetention ? "Saving…" : "Save retention"}
                </button>
              </div>
            </form>

            <form className="danger-zone panel" onSubmit={deleteEverything}>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Irreversible action</p>
                  <h2>Delete all files and history</h2>
                </div>
                <TriangleAlert size={21} aria-hidden="true" />
              </div>
              <div className="notice notice-error danger-zone-notice">
                <TriangleAlert size={16} aria-hidden="true" />
                <span>
                  <strong>This permanently removes all sources, exports, temporary processing files, and job history.</strong>
                  <small>Your saved settings are retained. Deleted files cannot be recovered by this application.</small>
                </span>
              </div>
              <label className="field" htmlFor="delete-confirmation">
                <span>Type <strong className="mono">{DELETE_CONFIRMATION}</strong></span>
                <input
                  className="input mono"
                  id="delete-confirmation"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={deleting}
                  required
                />
              </label>
              {deleteError ? <p className="inline-error" role="alert">{deleteError}</p> : null}
              {deleteMessage ? <p className="management-success" role="status"><ShieldCheck size={15} aria-hidden="true" />{deleteMessage}</p> : null}
              <div className="management-form-actions">
                <button
                  className="button-danger"
                  type="submit"
                  disabled={deleting || confirmation !== DELETE_CONFIRMATION}
                >
                  {deleting ? <span className="spinner" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
                  {deleting ? "Deleting private data…" : "Delete all files and history"}
                </button>
              </div>
            </form>
          </section>
        </>
      ) : null}
    </div>
  );
}

function StoredFilePanel({
  title,
  description,
  files,
  icon,
  empty,
  footer,
}: {
  title: string;
  description: string;
  files: StoredFileView[];
  icon: React.ReactNode;
  empty: string;
  footer?: React.ReactNode;
}) {
  return (
    <section className="storage-file-panel panel animate-in">
      <div className="storage-file-heading">
        <span aria-hidden="true">{icon}</span>
        <div><h2>{title}</h2><p>{description}</p></div>
      </div>
      {files.length === 0 ? <p className="storage-file-empty">{empty}</p> : (
        <ul className="storage-file-list">
          {files.map((file) => (
            <li key={file.id}>
              <div>
                <strong title={storedFileName(file)}>{storedFileName(file)}</strong>
                <small>{file.createdAt ? formatDateTime(file.createdAt) : file.status || "Stored locally"}</small>
              </div>
              <span>{formatBytes(toFiniteNumber(file.sizeBytes, toFiniteNumber(file.bytes)))}</span>
            </li>
          ))}
        </ul>
      )}
      {footer ? <div className="management-form-actions">{footer}</div> : null}
    </section>
  );
}

function storedFileName(file: StoredFileView): string {
  return file.fileName || file.originalName || file.displayName || `Local file ${file.id.slice(0, 8)}`;
}

function normalizeStoragePayload(payload: Partial<StoragePayload>): StoragePayload {
  return {
    summary: normalizeSummary(payload.summary),
    assets: Array.isArray(payload.assets) ? payload.assets : [],
    exports: Array.isArray(payload.exports) ? payload.exports : [],
  };
}

function normalizeSummary(value?: Partial<StorageSummary>, fallback?: StorageSummary): StorageSummary {
  return {
    usedBytes: toFiniteNumber(value?.usedBytes, fallback?.usedBytes),
    sourceBytes: toFiniteNumber(value?.sourceBytes, fallback?.sourceBytes),
    exportBytes: toFiniteNumber(value?.exportBytes, fallback?.exportBytes),
    tempBytes: toFiniteNumber(value?.tempBytes, fallback?.tempBytes),
    freeBytes: toFiniteNumber(value?.freeBytes, fallback?.freeBytes),
    maxUploadBytes: toFiniteNumber(value?.maxUploadBytes, fallback?.maxUploadBytes),
    retentionHours: Math.max(1, Math.round(toFiniteNumber(value?.retentionHours, fallback?.retentionHours ?? 168))),
  };
}

function capacityPercent(summary: StorageSummary): number {
  const total = summary.usedBytes + summary.freeBytes;
  return total > 0 ? Math.max(0, Math.min(100, (summary.usedBytes / total) * 100)) : 0;
}

function storageCapacityLabel(summary: StorageSummary): string {
  const total = summary.usedBytes + summary.freeBytes;
  return total > 0 ? `${formatBytes(total)} visible capacity` : "Capacity unavailable";
}
