"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, CircleAlert, Info, ListTree, ScanSearch } from "lucide-react";
import { formatBytes, formatDuration } from "@/lib/client-api";
import type { UploadedAsset, WarningSeverity } from "./types";

export function AnalysisPanel({ asset }: { asset: UploadedAsset }) {
  const { analysis } = asset;
  const video = analysis.video;
  const audio = analysis.audio;
  const fps = video.fps.measured ?? video.fps.average;
  const color = [video.color?.primaries, video.color?.transfer, video.color?.space]
    .filter(Boolean)
    .join(" · ") || "Not tagged";
  const remux = analysis.remux;

  const metrics = [
    ["Container", analysis.file.containerNames?.join(", ").toUpperCase() || "Not reported"],
    ["Resolution", `${video.displayWidth ?? video.width} × ${video.displayHeight ?? video.height}`],
    ["Display ratio", formatAspect(video.displayWidth ?? video.width, video.displayHeight ?? video.height, video.dar)],
    ["Frame rate", fps ? `${trimNumber(fps)} FPS` : "Indeterminate"],
    ["Reported FPS", [video.fps.avgText && `avg ${video.fps.avgText}`, video.fps.nominalText && `nominal ${video.fps.nominalText}`].filter(Boolean).join(" · ") || "Not reported"],
    ["Cadence", frameKind(video.fps.kind)],
    ["Sample ratio", video.sar ?? "Not reported"],
    ["Video", [video.codec.toUpperCase(), video.profile, video.level && `Level ${video.level}`].filter(Boolean).join(" · ")],
    ["Video bitrate", video.bitrate ? `${trimNumber(video.bitrate / 1_000_000)} Mb/s` : "Not reported"],
    ["Total bitrate", analysis.file.bitrate ? `${trimNumber(analysis.file.bitrate / 1_000_000)} Mb/s` : "Not reported"],
    ["Pixel format", video.pixelFormat ?? "Not reported"],
    ["Scan", video.fieldOrder && video.fieldOrder !== "unknown" ? video.fieldOrder : "Progressive / not flagged"],
    ["Colour", color],
    ["Colour range", video.color?.range ?? "Not tagged"],
    ["Audio", audio ? `${audio.codec.toUpperCase()}${audio.channels ? ` · ${audio.channels} ch` : ""}` : "No audio"],
    ["Audio rate", audio?.sampleRate ? `${(audio.sampleRate / 1000).toFixed(1)} kHz` : "—"],
    ["Audio bitrate", audio?.bitrate ? `${trimNumber(audio.bitrate / 1000)} kb/s` : "Not reported"],
    ["Duration", formatDuration(analysis.file.durationSeconds)],
    ["File size", formatBytes(analysis.file.bytes || asset.sizeBytes)],
    ["Rotation", `${video.rotation ?? 0}°`],
    ["HDR", analysis.hdr ? "Detected" : "Not detected"],
    ["Timestamps", timestampSummary(analysis.timing)],
    ["A/V duration delta", analysis.timing?.avDurationDeltaSeconds !== undefined ? `${analysis.timing.avDurationDeltaSeconds.toFixed(3)} s` : "Not reported"],
    ["Web optimized", analysis.file.webOptimized === true ? "Yes · moov before mdat" : analysis.file.webOptimized === false ? "No · metadata follows media" : "Not applicable / unknown"],
  ];
  const essentialLabels = new Set(["Resolution", "Frame rate", "Cadence", "Video", "Audio", "Duration", "File size", "Colour"]);
  const essentialMetrics = metrics.filter(([label]) => essentialLabels.has(label));
  const technicalMetrics = metrics.filter(([label]) => !essentialLabels.has(label));

  return (
    <section className="analysis-panel panel animate-in" aria-labelledby="analysis-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">02 · Analysis</p>
          <h2 id="analysis-title">Source inspection</h2>
        </div>
        <span className="analysis-complete"><CheckCircle2 size={14} /> FFprobe complete</span>
      </div>

      <div className="asset-title-row">
        <span className="asset-icon"><ScanSearch size={20} /></span>
        <span>
          <strong title={asset.originalName}>{asset.originalName}</strong>
          <small>Actual streams and timing inspected before processing</small>
        </span>
      </div>

      <dl className="metric-grid metric-grid-summary">
        {essentialMetrics.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd title={value}>{value}</dd>
          </div>
        ))}
      </dl>

      <div className="analysis-notices">
        {analysis.warnings.length === 0 ? (
          <div className="notice notice-success">
            <CheckCircle2 size={16} />
            <span><strong>No material compatibility warnings</strong><small>The selected preset can still require scaling or frame-rate conversion.</small></span>
          </div>
        ) : analysis.warnings.map((warning) => (
          <div className={`notice notice-${warning.severity}`} key={`${warning.code}-${warning.title}`}>
            <NoticeIcon severity={warning.severity} />
            <span><strong>{warning.title}</strong><small>{warning.message}</small></span>
          </div>
        ))}
      </div>

      {remux && (
        <div className={`remux-check ${remux.eligible ? "eligible" : "blocked"}`}>
          <span>
            {remux.eligible ? <CheckCircle2 size={17} /> : <CircleAlert size={17} />}
            <strong>{remux.eligible ? "Lossless remux is available" : "Lossless remux is not suitable"}</strong>
          </span>
          <p>
            {remux.eligible
              ? (remux.fixes?.join(" · ") || "Streams can be preserved while the MP4 container is rebuilt safely.")
              : (remux.blockers?.slice(0, 2).join(" · ") || "Re-encoding is required to meet the selected compatibility target.")}
          </p>
        </div>
      )}

      <details className="technical-details">
        <summary>
          <span><ListTree size={16} /><strong>Technical media details</strong><small>{technicalMetrics.length} additional probe values</small></span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <dl className="metric-grid technical-metric-grid">
          {technicalMetrics.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd title={value}>{value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}

function NoticeIcon({ severity }: { severity: WarningSeverity }) {
  if (severity === "error") return <CircleAlert size={16} />;
  if (severity === "warning") return <AlertTriangle size={16} />;
  return <Info size={16} />;
}

function frameKind(kind: "constant" | "variable" | "indeterminate") {
  if (kind === "constant") return "Constant frame rate";
  if (kind === "variable") return "Variable frame rate";
  return "Could not determine";
}

function formatAspect(width: number, height: number, dar?: number) {
  if (dar && Number.isFinite(dar)) return `${trimNumber(dar)}:1`;
  if (!width || !height) return "—";
  const divisor = gcd(Math.round(width), Math.round(height));
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function trimNumber(value: number) {
  return Number(value.toFixed(3)).toString();
}

function timestampSummary(timing: UploadedAsset["analysis"]["timing"]): string {
  if (!timing) return "Not reported";
  const errors =
    (timing.nonMonotonicDts ?? 0) +
    (timing.missingPts ?? 0) +
    (timing.missingDts ?? 0) +
    (timing.nonPositiveDurations ?? 0);
  if (errors > 0 || timing.negativeStart || timing.suspiciousFrameMetadata) {
    return `${errors} packet issue(s)${timing.negativeStart ? " · negative start" : ""}`;
  }
  return "Monotonic · no sampled errors";
}
