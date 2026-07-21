"use client";

import {
  CheckCircle2,
  Clock3,
  FileClock,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest, formatBytes, formatDuration } from "@/lib/client-api";
import { SaveExportButton } from "@/components/save-export-button";
import {
  EmptyPanel,
  ErrorPanel,
  formatDateTime,
  LoadingPanel,
  ManagementIntro,
  presetLabel,
  statusLabel,
  StatusPill,
  statusTone,
  toFiniteNumber,
} from "./management-ui";
import type { JobHistoryView } from "./types";

export function HistoryClient() {
  const [jobs, setJobs] = useState<JobHistoryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiRequest<{ jobs?: JobHistoryView[] }>("/api/jobs?limit=100");
      setJobs(Array.isArray(payload.jobs) ? payload.jobs : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Processing history could not be read.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadJobs(), 0);
    return () => window.clearTimeout(timer);
  }, [loadJobs]);

  return (
    <div className="dashboard-stack management-page">
      <ManagementIntro
        eyebrow="Local worker activity"
        title="Processing history"
        description="Review up to 100 recent jobs, including real completion, cancellation, and failure states reported by the local worker."
        actions={
          <button className="button-secondary" type="button" onClick={() => void loadJobs()} disabled={loading}>
            <RefreshCw size={16} aria-hidden="true" />
            Refresh
          </button>
        }
      />

      {loading ? <LoadingPanel label="Loading processing history" /> : null}
      {!loading && error ? <ErrorPanel message={error} onRetry={() => void loadJobs()} /> : null}

      {!loading && !error && jobs.length === 0 ? (
        <EmptyPanel
          title="No processing history"
          description="Jobs appear here after an analysed source is submitted to the local export worker."
          action={<Link className="button-primary" href="/">Start with a source</Link>}
        />
      ) : null}

      {!loading && !error && jobs.length > 0 ? (
        <section className="management-list" aria-label="Processing jobs">
          {jobs.map((job) => {
            const progress = clampProgress(job.progress);
            const active = ["queued", "preparing", "analyzing", "processing", "verifying", "cancel-requested"].includes(job.status);
            const duration = jobDuration(job);
            return (
              <article className="management-row management-job-row panel animate-in" key={job.id}>
                <span className={`management-row-icon management-job-icon management-job-icon-${statusTone(job.status)}`} aria-hidden="true">
                  {job.status === "completed" ? <CheckCircle2 size={21} /> : job.status === "failed" ? <TriangleAlert size={21} /> : <FileClock size={21} />}
                </span>
                <div className="management-row-main">
                  <div className="management-row-title">
                    <div>
                      <h3>{job.assetName || "Local source"}</h3>
                      <p>{presetLabel(job.preset)}</p>
                    </div>
                    <StatusPill tone={statusTone(job.status)}>{statusLabel(job.status)}</StatusPill>
                  </div>

                  <dl className="management-inline-metrics">
                    <div><dt>Created</dt><dd>{formatDateTime(job.createdAt)}</dd></div>
                    <div><dt>Phase</dt><dd>{job.phase || statusLabel(job.status)}</dd></div>
                    <div><dt>Duration</dt><dd>{duration === null ? "Not available" : formatDuration(duration)}</dd></div>
                    <div><dt>Job ID</dt><dd className="mono" title={job.id}>{job.id}</dd></div>
                  </dl>

                  {active || progress > 0 ? (
                    <div className="management-progress-wrap">
                      <div className="management-progress-label">
                        <span>{active ? "Reported progress" : "Final reported progress"}</span>
                        <strong>{Math.round(progress * 100)}%</strong>
                      </div>
                      <div
                        className="progress-track management-progress"
                        role="progressbar"
                        aria-label={`${job.assetName || "Job"} progress`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(progress * 100)}
                      >
                        <span style={{ width: `${progress * 100}%` }} />
                      </div>
                    </div>
                  ) : null}

                  {job.safeError ? (
                    <p className="management-job-error" role="status"><TriangleAlert size={14} aria-hidden="true" />{job.safeError}</p>
                  ) : null}
                </div>

                <div className="management-row-actions management-job-actions">
                  {job.output?.sizeBytes ? <span className="management-file-size">{formatBytes(toFiniteNumber(job.output.sizeBytes))}</span> : null}
                  {job.output?.downloadUrl ? (
                    <SaveExportButton url={job.output.downloadUrl} fileName={job.output.fileName ?? "Video.FXQYMethod.mp4"} />
                  ) : active ? (
                    <span className="management-active-note"><Clock3 size={14} aria-hidden="true" />Worker active</span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(1, toFiniteNumber(value)));
}

function jobDuration(job: JobHistoryView): number | null {
  if (!job.startedAt || !job.completedAt) return null;
  const start = timestamp(job.startedAt);
  const end = timestamp(job.completedAt);
  if (start === null || end === null || end < start) return null;
  return (end - start) / 1000;
}

function timestamp(value: string | number): number | null {
  const normalized = typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value;
  const result = new Date(normalized).getTime();
  return Number.isFinite(result) ? result : null;
}
