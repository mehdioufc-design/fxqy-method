"use client";

import {
  CheckCircle2,
  CircleX,
  FileCheck2,
  Gauge,
  LoaderCircle,
  OctagonX,
  Play,
  ShieldAlert,
  Square,
  TerminalSquare,
} from "lucide-react";
import { formatBytes, formatDuration } from "@/lib/client-api";
import { SaveExportButton } from "@/components/save-export-button";
import type { ExportSettings, JobView, UploadedAsset } from "./types";

export function ProcessingPanel({
  asset,
  job,
  starting,
  error,
  settings,
  onStart,
  onCancel,
}: {
  asset: UploadedAsset;
  job: JobView | null;
  starting: boolean;
  error: string;
  settings: ExportSettings;
  onStart: () => void;
  onCancel: () => void;
}) {
  const active = job && ["queued", "preparing", "processing", "verifying", "cancel-requested"].includes(job.status);
  const progress = Math.min(100, Math.max(0, Math.round((job?.progress ?? 0) * 100)));
  const exportLabel = settings.preset === "lossless-remux"
    ? "lossless preserve export"
    : settings.preset === "master-120"
      ? `up to ${settings.outputResolution === "2k" ? "1440p (2K)" : "1080p"} 120 FPS master`
      : settings.preset === "maximum-quality"
        ? "maximum-quality file preserving up to 4K and the source frame rate"
      : `up to ${settings.outputResolution === "2k" ? "1440p (2K)" : "1080p"} 60 FPS upload file`;

  return (
    <section className="processing-panel panel animate-in" aria-labelledby="processing-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">05 · Process</p>
          <h2 id="processing-title">Local export worker</h2>
        </div>
        <span className={`worker-state ${active ? "active" : job?.status === "completed" ? "complete" : ""}`}>
          <i /> {statusLabel(job?.status)}
        </span>
      </div>

      {!job && (
        <div className="start-card">
          <span className="start-icon"><Gauge size={22} /></span>
          <div>
            <strong>Ready to create the {exportLabel}</strong>
            <p>{asset.originalName} will be processed from private local storage, then probed and decode-checked before release. Encoded exports use quality-first rate control.</p>
          </div>
          <button className="button-primary" type="button" onClick={onStart} disabled={starting}>
            {starting ? <><span className="spinner" /> Queuing…</> : <><Play size={16} fill="currentColor" /> Start export</>}
          </button>
        </div>
      )}

      {job && (
        <div className="job-card" aria-live="polite">
          <div className="job-phase-row">
            <span className={`job-phase-icon status-${job.status}`}>
              {job.status === "completed" ? <CheckCircle2 size={20} /> : job.status === "failed" ? <CircleX size={20} /> : job.status === "cancelled" ? <OctagonX size={20} /> : <LoaderCircle size={20} />}
            </span>
            <span>
              <strong>{job.phase || statusLabel(job.status)}</strong>
              <small>{job.status === "completed" ? "Output verified and ready" : job.status === "failed" ? (job.safeError || "Processing stopped safely.") : job.status === "cancelled" ? "Temporary files were removed." : realStatus(job)}</small>
            </span>
            {active && <button className="button-danger" type="button" onClick={onCancel} disabled={job.status === "cancel-requested"}><Square size={13} fill="currentColor" /> {job.status === "cancel-requested" ? "Cancelling…" : "Cancel"}</button>}
          </div>

          {active && (
            <>
              <div className="job-progress-head"><span>{progress}%</span><span>{job.outTimeSeconds !== undefined ? `${formatDuration(job.outTimeSeconds)} processed` : "Waiting for FFmpeg timing"}</span></div>
              <div className="progress-track job-progress"><i style={{ width: `${Math.max(1, progress)}%` }} /></div>
              <dl className="live-stats">
                <div><dt>Frame</dt><dd>{job.frame?.toLocaleString() ?? "—"}</dd></div>
                <div><dt>Encoding FPS</dt><dd>{job.fps ? job.fps.toFixed(1) : "—"}</dd></div>
                <div><dt>Speed</dt><dd>{job.speed ?? "—"}</dd></div>
                <div><dt>Written</dt><dd>{job.totalSize ? formatBytes(job.totalSize) : "—"}</dd></div>
                <div><dt>Duplicated</dt><dd>{job.dupFrames?.toLocaleString() ?? "—"}</dd></div>
                <div><dt>Dropped</dt><dd>{job.dropFrames?.toLocaleString() ?? "—"}</dd></div>
              </dl>
            </>
          )}

          {job.output && job.status === "completed" && (
            <div className="completed-output">
              <span className="completed-icon"><FileCheck2 size={21} /></span>
              <div>
                <strong>Export complete — save this video?</strong>
                <p className="mono">{job.output.fileName}</p>
                <p>{job.output.width} × {job.output.height} · {job.output.fps} FPS · {job.output.codec.toUpperCase()} · {formatBytes(job.output.sizeBytes)}</p>
                <span>{job.output.verified ? "Verified container, streams, timing and decode" : "Verification status unavailable"}{job.output.frameSynthesis && job.output.frameSynthesis !== "none" ? ` · ${job.output.frameSynthesis} frames` : ""}</span>
              </div>
              <SaveExportButton url={job.output.downloadUrl} fileName={job.output.fileName} label="Yes, save" />
            </div>
          )}

          {job.logTail && job.logTail.length > 0 && (
            <details className="live-log">
              <summary><TerminalSquare size={15} /> Live FFmpeg status <span>privacy-safe</span></summary>
              <pre>{job.logTail.slice(-20).join("\n")}</pre>
            </details>
          )}
        </div>
      )}

      {error && <div className="inline-error" role="alert">{error}</div>}

      <div className="safety-statement">
        <ShieldAlert size={18} />
        <p><strong>TikTok safety statement</strong>“This tool only prepares a local standards-compliant file. It never hides 120 FPS behind false 60 FPS metadata. TikTok documents a maximum of 60 FPS and controls transcoding, distribution, recommendations and moderation. No application can guarantee playback quality, prevent recompression, preserve engagement, increase reach or protect an account from restrictions.”</p>
      </div>
    </section>
  );
}

function statusLabel(status?: JobView["status"]) {
  if (!status) return "Ready";
  return ({
    queued: "Queued",
    preparing: "Preparing",
    processing: "Processing",
    verifying: "Verifying",
    completed: "Completed",
    failed: "Failed",
    "cancel-requested": "Cancel requested",
    cancelled: "Cancelled",
  } as Record<JobView["status"], string>)[status];
}

function realStatus(job: JobView) {
  if (job.status === "queued") return "Waiting for the local worker to claim this job.";
  if (job.status === "verifying") return "Re-probing dimensions, cadence, colour, timestamps and container layout.";
  if (job.status === "cancel-requested") return "The worker is asking FFmpeg to stop and will clean partial files.";
  if (job.etaSeconds && job.etaSeconds > 0) return `Estimated ${formatDuration(job.etaSeconds)} remaining from measured processing speed.`;
  return "Progress is parsed from FFmpeg output; no simulated timer is used.";
}
