"use client";

import {
  CheckCircle2,
  Cpu,
  Database,
  FileCode2,
  Filter,
  HardDrive,
  Network,
  RefreshCw,
  TerminalSquare,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiRequest, formatBytes } from "@/lib/client-api";
import {
  asRecord,
  ErrorPanel,
  formatDateTime,
  humanize,
  LoadingPanel,
  ManagementIntro,
  StatusPill,
} from "./management-ui";
import type { DiagnosticsView } from "./types";

export function DiagnosticsClient() {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadDiagnostics = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiRequest<{ diagnostics?: DiagnosticsView }>("/api/diagnostics");
      setDiagnostics(payload.diagnostics ?? {});
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "System diagnostics could not be read.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDiagnostics(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDiagnostics]);

  async function refreshDiagnostics() {
    setRefreshing(true);
    setError("");
    try {
      const payload = await apiRequest<{ diagnostics?: DiagnosticsView }>("/api/diagnostics/refresh", {
        method: "POST",
      });
      if (payload.diagnostics) {
        setDiagnostics(payload.diagnostics);
      } else {
        const current = await apiRequest<{ diagnostics?: DiagnosticsView }>("/api/diagnostics");
        setDiagnostics(current.diagnostics ?? {});
      }
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Diagnostics could not be refreshed.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="dashboard-stack management-page">
      <ManagementIntro
        eyebrow="Local capability check"
        title="System diagnostics"
        description="Inspect the real FFmpeg toolchain, storage, database, hardware encoders, filters, and private network posture detected by the backend."
        actions={
          <button className="button-primary" type="button" onClick={() => void refreshDiagnostics()} disabled={loading || refreshing}>
            {refreshing ? <span className="spinner" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
            {refreshing ? "Running checks…" : "Run diagnostics"}
          </button>
        }
      />

      {loading ? <LoadingPanel label="Running initial capability checks" /> : null}
      {!loading && error && !diagnostics ? <ErrorPanel message={error} onRetry={() => void loadDiagnostics()} /> : null}
      {error && diagnostics ? <p className="inline-error" role="alert">{error}</p> : null}

      {!loading && diagnostics ? (
        <>
          <section className="diagnostics-summary panel animate-in" aria-labelledby="diagnostics-summary-title">
            <div>
              <p className="eyebrow">Latest result</p>
              <h2 id="diagnostics-summary-title">Capability snapshot</h2>
              <p>{diagnostics.checkedAt ? `Checked ${formatDateTime(diagnostics.checkedAt)}` : "The backend did not report a check time."}</p>
            </div>
            <StatusPill tone={!Array.isArray(diagnostics.warnings) ? "neutral" : warningItems(diagnostics.warnings).length > 0 ? "warning" : "success"}>
              {warningItems(diagnostics.warnings).length > 0 ? <TriangleAlert size={13} aria-hidden="true" /> : Array.isArray(diagnostics.warnings) ? <CheckCircle2 size={13} aria-hidden="true" /> : null}
              {!Array.isArray(diagnostics.warnings)
                ? "Warnings not reported"
                : warningItems(diagnostics.warnings).length > 0
                  ? `${warningItems(diagnostics.warnings).length} warning(s)`
                  : "No warnings reported"}
            </StatusPill>
          </section>

          <section className="diagnostics-grid" aria-label="Diagnostic results">
            <DiagnosticCard title="FFmpeg" icon={<TerminalSquare size={19} />} value={diagnostics.ffmpeg} />
            <DiagnosticCard title="FFprobe" icon={<FileCode2 size={19} />} value={diagnostics.ffprobe} />
            <DiagnosticCard title="Database" icon={<Database size={19} />} value={diagnostics.database} />
            <DiagnosticCard title="Storage" icon={<HardDrive size={19} />} value={diagnostics.storage} />
            <DiagnosticCard title="Hardware acceleration" icon={<Cpu size={19} />} value={diagnostics.hardware} />
            <DiagnosticCard title="Media filters" icon={<Filter size={19} />} value={diagnostics.filters} />
            <DiagnosticCard title="Network and privacy" icon={<Network size={19} />} value={diagnostics.network} />
          </section>

          <section className="diagnostic-warnings panel animate-in" aria-labelledby="diagnostic-warnings-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Attention</p>
                <h2 id="diagnostic-warnings-title">Diagnostic warnings</h2>
              </div>
            </div>
            {!Array.isArray(diagnostics.warnings) ? (
              <p className="diagnostic-empty">The backend did not return a warnings list for this snapshot.</p>
            ) : warningItems(diagnostics.warnings).length > 0 ? (
              <ul>
                {warningItems(diagnostics.warnings).map((warning, index) => (
                  <li className="notice notice-warning" key={`${warning}-${index}`}>
                    <TriangleAlert size={16} aria-hidden="true" />
                    <span><strong>Check recommended</strong><small>{warning}</small></span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="management-success"><CheckCircle2 size={16} aria-hidden="true" />No diagnostic warnings were reported by the backend.</p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function DiagnosticCard({ title, icon, value }: { title: string; icon: ReactNode; value: unknown }) {
  const status = diagnosticStatus(value);
  const rows = flattenDiagnostic(value);
  const reported = value !== undefined && value !== null;
  return (
    <article className="diagnostic-card panel animate-in">
      <header>
        <span className="diagnostic-icon" aria-hidden="true">{icon}</span>
        <h3>{title}</h3>
        <StatusPill tone={status === true ? "success" : status === false ? "danger" : "neutral"}>
          {!reported ? "Not reported" : status === true ? "Ready" : status === false ? "Unavailable" : "Reported"}
        </StatusPill>
      </header>
      {rows.length > 0 ? (
        <dl className="diagnostic-details">
          {rows.map(([key, rowValue]) => (
            <div key={key}>
              <dt>{humanize(key.replaceAll(".", " · "))}</dt>
              <dd className={looksLikePath(key) ? "mono" : undefined}>{formatDiagnosticValue(key, rowValue)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="diagnostic-empty">No details were reported for this check.</p>
      )}
    </article>
  );
}

function diagnosticStatus(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const record = asRecord(value);
  if (!record) return null;
  for (const key of ["ok", "available", "healthy", "ready", "writable", "supported"] as const) {
    if (typeof record[key] === "boolean") return record[key] as boolean;
  }
  if (typeof record.error === "string" && record.error) return false;
  return null;
}

function flattenDiagnostic(value: unknown, prefix = "", depth = 0): Array<[string, unknown]> {
  const record = asRecord(value);
  if (!record) return value === undefined || value === null ? [] : [[prefix || "value", value]];
  const rows: Array<[string, unknown]> = [];
  for (const [key, child] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const nested = asRecord(child);
    if (nested && depth < 1) rows.push(...flattenDiagnostic(nested, path, depth + 1));
    else rows.push([path, child]);
  }
  return rows.slice(0, 24);
}

function formatDiagnosticValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not reported";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    return /bytes|space|size/i.test(key) ? formatBytes(value) : value.toLocaleString();
  }
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return "None reported";
    return value.map((entry) => typeof entry === "string" || typeof entry === "number" ? String(entry) : JSON.stringify(entry)).join(", ");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "Reported";
  }
}

function warningItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === "string") return entry;
    const record = asRecord(entry);
    if (!record) return "A diagnostic warning was reported.";
    for (const key of ["message", "description", "detail", "title"]) {
      if (typeof record[key] === "string" && record[key]) return record[key] as string;
    }
    return "A diagnostic warning was reported.";
  });
}

function looksLikePath(key: string): boolean {
  return /path|root|directory|executable|database/i.test(key);
}
