"use client";

import {
  ExternalLink,
  FileVideo2,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest, formatBytes } from "@/lib/client-api";
import { SaveExportButton } from "@/components/save-export-button";
import {
  asRecord,
  EmptyPanel,
  ErrorPanel,
  formatDateTime,
  LoadingPanel,
  ManagementIntro,
  StatusPill,
  toFiniteNumber,
} from "./management-ui";
import type { ExportView } from "./types";

export function ExportsClient() {
  const [exportsList, setExportsList] = useState<ExportView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [deletingId, setDeletingId] = useState("");

  const loadExports = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiRequest<{ exports?: ExportView[] }>("/api/exports");
      setExportsList(Array.isArray(payload.exports) ? payload.exports : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The export library could not be read.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadExports(), 0);
    return () => window.clearTimeout(timer);
  }, [loadExports]);

  async function removeExport(item: ExportView) {
    const accepted = window.confirm(
      `Permanently delete “${item.fileName}” from local storage? This cannot be undone.`,
    );
    if (!accepted) return;

    setDeletingId(item.id);
    setMutationError("");
    try {
      await apiRequest<{ ok: true }>(`/api/exports/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      });
      setExportsList((current) => current.filter((entry) => entry.id !== item.id));
    } catch (deleteError) {
      setMutationError(deleteError instanceof Error ? deleteError.message : "The export could not be deleted.");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <div className="dashboard-stack management-page">
      <ManagementIntro
        eyebrow="Verified local output"
        title="Your completed exports"
        description="Download files produced by the local worker or remove exports you no longer need. Nothing on this page uploads to TikTok."
        actions={
          <button className="button-secondary" type="button" onClick={() => void loadExports()} disabled={loading}>
            <RefreshCw size={16} aria-hidden="true" />
            Refresh
          </button>
        }
      />

      {mutationError ? <p className="inline-error" role="alert">{mutationError}</p> : null}

      {loading ? <LoadingPanel label="Loading completed exports" /> : null}
      {!loading && error ? <ErrorPanel message={error} onRetry={() => void loadExports()} /> : null}

      {!loading && !error && exportsList.length === 0 ? (
        <EmptyPanel
          title="No completed exports yet"
          description="Analyse a source on the dashboard and complete a real local export. Finished files will appear here."
          action={<Link className="button-primary" href="/">Open video workspace</Link>}
        />
      ) : null}

      {!loading && !error && exportsList.length > 0 ? (
        <section className="management-list" aria-label="Completed exports">
          {exportsList.map((item) => {
            const details = mediaDetails(item);
            const deleting = deletingId === item.id;
            return (
              <article className="management-row panel animate-in" key={item.id}>
                <span className="management-row-icon" aria-hidden="true"><FileVideo2 size={21} /></span>
                <div className="management-row-main">
                  <div className="management-row-title">
                    <h3 title={item.fileName}>{item.fileName}</h3>
                    <StatusPill tone={item.verified ? "success" : "warning"}>
                      {item.verified ? <ShieldCheck size={13} aria-hidden="true" /> : null}
                      {item.verified ? "Verified" : "Verification unavailable"}
                    </StatusPill>
                  </div>
                  <dl className="management-inline-metrics">
                    <div><dt>Size</dt><dd>{formatBytes(toFiniteNumber(item.sizeBytes))}</dd></div>
                    <div><dt>Created</dt><dd>{formatDateTime(item.createdAt)}</dd></div>
                    <div><dt>Video</dt><dd>{details}</dd></div>
                    <div><dt>Retention</dt><dd>{item.expiresAt ? formatDateTime(item.expiresAt) : "Manual deletion"}</dd></div>
                  </dl>
                </div>
                <div className="management-row-actions">
                  {item.previewUrl ? (
                    <a className="button-ghost" href={item.previewUrl} target="_blank" rel="noreferrer">
                      <ExternalLink size={15} aria-hidden="true" />
                      Preview
                    </a>
                  ) : null}
                  <SaveExportButton url={item.downloadUrl} fileName={item.fileName} />
                  <button
                    className="button-danger"
                    type="button"
                    onClick={() => void removeExport(item)}
                    disabled={Boolean(deletingId)}
                    aria-label={`Delete ${item.fileName}`}
                  >
                    {deleting ? <span className="spinner" aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />}
                    {deleting ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}

function mediaDetails(item: ExportView): string {
  const media = asRecord(item.media);
  const video = asRecord(media?.video) ?? media;
  if (!video) return "Details unavailable";
  const width = toFiniteNumber(video.width);
  const height = toFiniteNumber(video.height);
  const fpsObject = asRecord(video.fps);
  const fps = toFiniteNumber(video.frameRate, toFiniteNumber(video.fps, toFiniteNumber(fpsObject?.measured, toFiniteNumber(fpsObject?.average))));
  const codec = typeof video.codec === "string" ? video.codec.toUpperCase() : "";
  const resolution = width > 0 && height > 0 ? `${width}×${height}` : "";
  const frameRate = fps > 0 ? `${fps.toFixed(fps % 1 === 0 ? 0 : 2)} FPS` : "";
  return [resolution, frameRate, codec].filter(Boolean).join(" · ") || "Details unavailable";
}
