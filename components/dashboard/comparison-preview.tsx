"use client";

import { Captions, Eye, EyeOff, ScanLine } from "lucide-react";
import { useState } from "react";
import type { ExportSettings, UploadedAsset } from "./types";

export function ComparisonPreview({
  asset,
  sourceUrl,
  outputUrl,
  settings,
  onGuidesChange,
}: {
  asset: UploadedAsset;
  sourceUrl: string;
  outputUrl?: string;
  settings: ExportSettings;
  onGuidesChange: (value: boolean) => void;
}) {
  const [active, setActive] = useState<"source" | "output">("source");
  const sourceRatio = `${asset.analysis.video.displayWidth ?? asset.analysis.video.width} / ${asset.analysis.video.displayHeight ?? asset.analysis.video.height}`;

  return (
    <section className="preview-panel panel animate-in" aria-labelledby="preview-title">
      <div className="section-heading preview-heading">
        <div>
          <p className="eyebrow">04 · Preview</p>
          <h2 id="preview-title">Before & after</h2>
        </div>
        <button
          type="button"
          className={`guide-toggle ${settings.captionGuides ? "active" : ""}`}
          onClick={() => onGuidesChange(!settings.captionGuides)}
        >
          {settings.captionGuides ? <Eye size={14} /> : <EyeOff size={14} />}
          Caption-safe guides
        </button>
      </div>

      <div className="preview-tabs" role="tablist" aria-label="Comparison preview">
        <button type="button" role="tab" aria-selected={active === "source"} className={active === "source" ? "active" : ""} onClick={() => setActive("source")}>Before · source</button>
        <button type="button" role="tab" aria-selected={active === "output"} className={active === "output" ? "active" : ""} onClick={() => setActive("output")}>After · verified export</button>
      </div>

      <div className="preview-stage">
        {active === "source" ? (
          <div className="video-canvas source-canvas" style={{ aspectRatio: sourceRatio }}>
            <video src={sourceUrl} controls preload="metadata" playsInline aria-label="Source video preview" />
            <span className="preview-label">Source</span>
          </div>
        ) : outputUrl ? (
          <div className={`video-canvas output-canvas fit-${settings.fitMode}`} style={{ aspectRatio: sourceRatio }}>
            <video src={outputUrl} controls preload="metadata" playsInline aria-label="Processed video preview" />
            <span className="preview-label verified"><ScanLine size={12} /> Verified output</span>
            {settings.captionGuides && <SafeGuides />}
          </div>
        ) : (
          <div className="video-canvas output-canvas empty-output" style={{ aspectRatio: sourceRatio }}>
            <span className="empty-output-icon"><ScanLine size={23} /></span>
            <strong>After preview waits for a real export</strong>
            <p>The processed file appears here only after FFmpeg finishes and the output passes verification.</p>
            {settings.captionGuides && <SafeGuides />}
          </div>
        )}
      </div>

      <div className="preview-foot">
        <span><Captions size={14} /> Guides approximate interface-safe areas and do not alter the exported video.</span>
        <span className="mono">Source aspect ratio preserved</span>
      </div>
    </section>
  );
}

function SafeGuides() {
  return (
    <div className="safe-guides" aria-hidden="true">
      <i className="safe-top" />
      <i className="safe-bottom" />
      <i className="safe-right" />
      <span>caption-safe</span>
    </div>
  );
}
