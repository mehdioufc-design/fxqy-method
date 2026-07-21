"use client";

import { BadgeCheck, Film, Info, Layers3, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { formatBytes } from "@/lib/client-api";
import { qualityResolutionTier, resolveOutputDimensions } from "@/lib/media/output-dimensions";
import { recommendedSafeFps } from "@/lib/smart-optimize";
import type { ExportSettings, OutputResolution, UploadedAsset } from "./types";

export function PresetSelector({
  asset,
  settings,
  locked,
  opticalFlowAvailable,
  onChange,
}: {
  asset: UploadedAsset;
  settings: ExportSettings;
  locked: boolean;
  opticalFlowAvailable: boolean | null;
  onChange: (settings: ExportSettings) => void;
}) {
  const sourceFps = asset.analysis.video.fps.measured ?? asset.analysis.video.fps.average;
  const native120 = asset.analysis.video.fps.kind === "constant"
    && sourceFps !== undefined
    && Math.abs(sourceFps - 120) <= 0.02;
  const sourceAtLeast120 = sourceFps !== undefined && sourceFps >= 119.98;
  const masterAvailable = sourceFps !== undefined && sourceFps > 0;
  const canRemux = asset.analysis.remux?.eligible === true;
  const suggestedFps = recommendedSafeFps(asset.analysis);
  const sourceWidth = asset.analysis.video.displayWidth ?? asset.analysis.video.width;
  const sourceHeight = asset.analysis.video.displayHeight ?? asset.analysis.video.height;
  const deliveryFriendlyRemux = canRemux
    && Math.max(sourceWidth, sourceHeight) <= 1920
    && Math.min(sourceWidth, sourceHeight) <= 1080;
  const safe = settings.preset === "tiktok-safe";
  const maximum = settings.preset === "maximum-quality";
  const master = settings.preset === "master-120";
  const lossless = settings.preset === "lossless-remux";
  const dimensions = resolveOutputDimensions(asset.analysis.video, maximum ? "4k" : settings.outputResolution);
  const safeCadence = describeSafeCadence(asset);
  const estimate = lossless
    ? Math.ceil(asset.analysis.file.bytes * 1.01)
    : estimateEncodedBytes(
      asset.analysis.file.durationSeconds,
      master,
      maximum,
      settings.codec,
      dimensions.width,
      dimensions.height,
      settings.safeFps,
    );

  const update = (changes: Partial<ExportSettings>) => onChange({ ...settings, ...changes });

  return (
    <section className="preset-panel panel animate-in" aria-labelledby="preset-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">03 · Output</p>
          <h2 id="preset-title">Choose an honest export</h2>
        </div>
        <span className="estimate-chip">Est. {formatBytes(estimate)}</span>
      </div>

      <div className="preset-grid" role="group" aria-label="Export mode">
        <button
          className={`preset-card preset-card-safe ${safe ? "selected" : ""}`}
          type="button"
          disabled={locked}
          aria-pressed={safe}
          onClick={() => update({ preset: "tiktok-safe", safeFps: suggestedFps, codec: "h264" })}
        >
          <span className="preset-card-top">
            <i><BadgeCheck size={17} /></i>
            <small>Recommended for TikTok</small>
            <b aria-hidden="true" />
          </span>
          <strong>TikTok delivery file</strong>
          <p>High-quality H.264 MP4 with a genuine {settings.safeFps} FPS timeline. {safeCadence}</p>
          <span className="preset-spec mono">H.264 High · yuv420p · AAC · fast-start</span>
        </button>

        <button
          className={`preset-card preset-card-quality ${maximum ? "selected" : ""}`}
          type="button"
          disabled={locked}
          aria-pressed={maximum}
          onClick={() => update({ preset: "maximum-quality", codec: asset.analysis.hdr ? "hevc" : "h264" })}
        >
          <span className="preset-card-top">
            <i><Film size={17} /></i>
            <small>Preserve up to 4K</small>
            <b aria-hidden="true" />
          </span>
          <strong>Maximum source quality</strong>
          <p>Keeps the source shape, frame rate and up to 4K resolution with a much higher quality bitrate. Use this when a 1080p or 2K export looks too soft.</p>
          <span className="preset-spec mono">Up to 4K · source FPS · high-quality VBR</span>
        </button>

        <button
          className={`preset-card preset-card-master ${master ? "selected" : ""} ${masterAvailable ? "" : "disabled"}`}
          type="button"
          disabled={locked || !masterAvailable}
          aria-pressed={master}
          onClick={() => update({
            preset: "master-120",
            codec: asset.analysis.hdr ? "hevc" : "h264",
            masterCadence: sourceAtLeast120 ? "native" : settings.masterCadence === "native" ? "duplicate" : settings.masterCadence,
          })}
        >
          <span className="preset-card-top">
            <i><Sparkles size={17} /></i>
            <small>Editing / experimental master</small>
            <b aria-hidden="true" />
          </span>
          <strong>Genuine 120 FPS file</strong>
          <p>{masterAvailable
            ? "Creates a real 120 FPS timeline. Lower-rate sources use clearly labelled duplication or optical-flow synthesis."
            : "A measured source frame rate is required before a 120 FPS master can be generated safely."}</p>
          <span className="preset-spec mono">120 FPS CFR · high bitrate · honest timing</span>
        </button>

        <button
          className={`preset-card preset-card-lossless ${lossless ? "selected" : ""} ${canRemux ? "" : "disabled"}`}
          type="button"
          disabled={locked || !canRemux}
          aria-pressed={lossless}
          onClick={() => update({ preset: "lossless-remux" })}
        >
          <span className="preset-card-top">
            <i><Zap size={17} /></i>
            <small className={deliveryFriendlyRemux ? "highly-recommended-badge" : undefined}>{deliveryFriendlyRemux ? "Highly recommended" : canRemux ? "Preserves the original" : "Unavailable for this source"}</small>
            <b aria-hidden="true" />
          </span>
          <strong>Lossless preserve</strong>
          <p>{canRemux
            ? "The best choice when preserving the source exactly matters most. It copies the original video and audio streams while optimizing the MP4 container; resolution and FPS stay unchanged."
            : asset.analysis.remux?.blockers?.[0] ?? "This source needs re-encoding for a reliable MP4 output."}</p>
          <span className="preset-spec mono">Stream copy · original quality · original FPS</span>
        </button>
      </div>

      {lossless ? (
        <div className="lossless-resize-choice">
          <div className="lossless-resize-copy">
            <span><Layers3 size={17} /></span>
            <div>
              <strong>Want a smaller 1080p or 2K file?</strong>
              <small>Lossless preserve must keep the original resolution. Choose a target below to switch to a high-quality TikTok-safe re-encode.</small>
            </div>
          </div>
          <div className="lossless-resize-actions" role="group" aria-label="Switch from lossless preserve to a resized export">
            <button
              className="button-secondary"
              type="button"
              disabled={locked}
              onClick={() => update({ preset: "tiktok-safe", safeFps: suggestedFps, codec: "h264", outputResolution: "1080p" })}
            >Create 1080p</button>
            <button
              className="button-secondary"
              type="button"
              disabled={locked}
              onClick={() => update({ preset: "tiktok-safe", safeFps: suggestedFps, codec: "h264", outputResolution: "2k" })}
            >Create 1440p (2K)</button>
          </div>
        </div>
      ) : (
        <div className="quick-options">
          <div className="output-choice-group">
            <span className="control-label"><Layers3 size={14} /> Output resolution</span>
            {maximum ? <div className="fixed-output-value"><strong>Preserve up to 4K</strong><span>{dimensions.width} × {dimensions.height}</span></div> : null}
            <div className="segmented-control" role="group" aria-label="Output resolution">
              <button
                type="button"
                className={settings.outputResolution === "1080p" ? "active" : ""}
                disabled={locked || maximum}
                aria-pressed={settings.outputResolution === "1080p"}
                onClick={() => update({ outputResolution: "1080p" })}
              >1080p</button>
              <button
                type="button"
                className={settings.outputResolution === "2k" ? "active" : ""}
                disabled={locked || maximum}
                aria-pressed={settings.outputResolution === "2k"}
                onClick={() => update({ outputResolution: "2k" })}
              >1440p (2K)</button>
            </div>
            <small>{dimensions.width} × {dimensions.height}; {dimensions.limitedBySource
              ? "the source is already smaller, so it will not be enlarged."
              : "the source is downscaled without cropping or stretching."}</small>
          </div>

          <div className="output-choice-group">
            <span className="control-label"><Film size={14} /> Frame-rate result</span>
            {safe ? (
              <>
                <div className="segmented-control" role="group" aria-label="TikTok delivery frame rate">
                  <button type="button" className={settings.safeFps === 30 ? "active" : ""} disabled={locked} aria-pressed={settings.safeFps === 30} onClick={() => update({ safeFps: 30 })}>30 FPS{suggestedFps === 30 ? " · recommended" : ""}</button>
                  <button type="button" className={settings.safeFps === 60 ? "active" : ""} disabled={locked} aria-pressed={settings.safeFps === 60} onClick={() => update({ safeFps: 60 })}>60 FPS{suggestedFps === 60 ? " · recommended" : ""}</button>
                </div>
                <small>Match the source where possible. Turning 24/30 FPS into 60 only repeats frames and gives TikTok more frames to compress.</small>
              </>
            ) : (
              <>
                <div className="fixed-output-value">
                  <strong>{master ? "120 FPS" : "Source FPS"}</strong>
                  <span>{master ? "actual 120 FPS timing" : "original frame timing"}</span>
                </div>
                <small>{master ? "The file reports exactly what it contains." : "Source timestamps are preserved."}</small>
              </>
            )}
          </div>
        </div>
      )}

      {master && (
        <div className="cadence-choice">
          <div className="cadence-intro">
            <Sparkles size={16} />
            <span>
              <strong>120 FPS frame method</strong>
              <small>{native120
                ? "The source is measured as native 120 FPS, so its real frames are preserved."
                : sourceAtLeast120
                  ? "The source is above or near 120 FPS, so it is honestly conformed to a constant 120 FPS timeline without invented motion."
                  : "Choose fast repeated frames or slower motion-estimated synthetic frames."}</small>
            </span>
          </div>
          {sourceAtLeast120 ? (
            <div className="fixed-output-value"><strong>{native120 ? "Native 120 FPS" : "Conform to 120 FPS"}</strong><span>{native120 ? "No generated frames" : "Excess frames may be dropped"}</span></div>
          ) : (
            <div className="segmented-control" role="group" aria-label="120 FPS frame method">
              <button
                type="button"
                className={settings.masterCadence === "duplicate" ? "active" : ""}
                disabled={locked}
                aria-pressed={settings.masterCadence === "duplicate"}
                onClick={() => update({ masterCadence: "duplicate" })}
              >Duplicate · faster</button>
              <button
                type="button"
                className={settings.masterCadence === "optical-flow" ? "active" : ""}
                disabled={locked || opticalFlowAvailable !== true}
                aria-pressed={settings.masterCadence === "optical-flow"}
                onClick={() => update({ masterCadence: "optical-flow" })}
              >{opticalFlowAvailable === null
                ? "Checking optical flow…"
                : opticalFlowAvailable
                  ? "Optical flow · CPU-heavy"
                  : "Optical flow unavailable"}</button>
            </div>
          )}
          {!sourceAtLeast120 && (
            <small className="cadence-warning">Duplication does not add smoother motion. Optical flow may look smoother but can create warping or ghosting around fast movement and cuts.</small>
          )}
        </div>
      )}

      <div className="outcome-card">
        <div>
          <p className="eyebrow">Resolved output</p>
          <strong>{lossless
            ? "Original streams preserved"
            : master
              ? `${dimensions.limitedBySource ? `${dimensions.width} × ${dimensions.height}` : resolutionLabel(settings.outputResolution)} 120 FPS master`
              : maximum
                ? `${dimensions.width} × ${dimensions.height} maximum-quality file`
              : `${dimensions.limitedBySource ? `${dimensions.width} × ${dimensions.height}` : resolutionLabel(settings.outputResolution)} ${settings.safeFps} FPS upload file`}</strong>
          <span>{lossless
            ? "No pixel or frame re-encoding"
            : `${dimensions.width} × ${dimensions.height} · quality-first encode · ${master || maximum ? settings.codec.toUpperCase() : "H.264"}`}</span>
        </div>
        <div className="outcome-tags">
          <span>{lossless ? "stream copy" : "high bitrate"}</span>
          <span>{lossless || maximum ? "original cadence" : master ? "120 FPS CFR" : `${settings.safeFps} FPS CFR`}</span>
          <span>fast-start</span>
          <span>no watermark</span>
        </div>
        <p><Info size={14} /> {master
          ? "TikTok documents a maximum of 60 FPS. It may reject, reduce or recompress this 120 FPS file; use the genuine 60 FPS mode for the reliable upload copy."
          : lossless
            ? `${asset.analysis.remux?.warnings?.[0] ? `${asset.analysis.remux.warnings[0]} ` : ""}Lossless preservation cannot resize the picture or change its frame rate. TikTok may still recompress the uploaded file.`
            : "This is a quality-first re-encode, not mathematically lossless. TikTok may still recompress any upload."}</p>
      </div>

      <div className="notice notice-info">
        <ShieldCheck size={16} />
        <span><strong>Standards-compliant timing</strong><small>The optimizer never stores 120 frames under false 60 FPS metadata, manipulates TikTok parsing, or claims control over reach and engagement.</small></span>
      </div>
      <div className="notice notice-warning">
        <Info size={16} />
        <span><strong>Private-first cannot be repaired after upload</strong><small>If quality changes when a private post is made public, that is a TikTok delivery decision. For the cleanest test, upload this final export with the intended visibility; wait for processing, disable Data Saver, and enable high-quality upload when TikTok offers that control.</small></span>
      </div>
    </section>
  );
}

function estimateEncodedBytes(
  duration: number,
  master: boolean,
  maximum: boolean,
  codec: "h264" | "hevc",
  width: number,
  height: number,
  safeFps: 30 | 60,
) {
  const tier = qualityResolutionTier(width, height);
  const videoMbps = master || maximum
    ? tier === "small" ? (codec === "hevc" ? 18 : 24) : tier === "1080p" ? (codec === "hevc" ? 36 : 48) : (codec === "hevc" ? 54 : 72)
    : safeFps === 60
      ? tier === "small" ? 12 : tier === "1080p" ? 20 : 30
      : tier === "small" ? 8 : tier === "1080p" ? 12 : 20;
  return Math.ceil(Math.max(1, duration) * ((videoMbps + 0.256) * 1_000_000 / 8) * 1.03);
}

function resolutionLabel(resolution: OutputResolution) {
  return resolution === "2k" ? "1440p (2K)" : "1080p";
}

function describeSafeCadence(asset: UploadedAsset): string {
  const fps = asset.analysis.video.fps.measured ?? asset.analysis.video.fps.average;
  if (!fps || asset.analysis.video.fps.kind === "indeterminate") {
    return "Source timing is conformed honestly; no native-motion claim is made.";
  }
  const target = recommendedSafeFps(asset.analysis);
  if (asset.analysis.video.fps.kind === "constant" && Math.abs(fps - target) <= 0.02) {
    return `The source already has native ${target} FPS motion.`;
  }
  if (fps < target - 0.02) {
    return `The closest delivery choice is ${target} FPS; no extra smoothness is claimed.`;
  }
  return `Source moments are sampled into ${target} FPS; excess frames may be dropped.`;
}
