"use client";

import { ArrowRight, Check, Film, HardDrive, ShieldCheck, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "@/lib/client-api";
import { chooseSmartOptimize, recommendedSafeFps } from "@/lib/smart-optimize";
import { AnalysisPanel } from "./analysis-panel";
import { ComparisonPreview } from "./comparison-preview";
import { PresetSelector } from "./preset-selector";
import { ProcessingPanel } from "./processing-panel";
import type { ExportSettings, JobView, UploadedAsset } from "./types";
import { Uploader } from "./uploader";

const defaultSettings: ExportSettings = {
  preset: "tiktok-safe",
  performance: "fast-hardware",
  safeFps: 30,
  outputResolution: "1080p",
  codec: "h264",
  fitMode: "crop",
  masterCadence: "duplicate",
  lanczos: true,
  sharpen: 0,
  denoise: 0,
  deband: 0,
  brightness: 0,
  contrast: 1,
  saturation: 1,
  toneMapHdr: false,
  normalizeAudio: false,
  captionGuides: true,
};

export function DashboardClient({
  maxUploadBytes,
  initialSettings,
}: {
  maxUploadBytes: number;
  initialSettings?: Partial<ExportSettings>;
}) {
  const ownerDefaults = useMemo(
    () => ({ ...defaultSettings, ...initialSettings }),
    [initialSettings],
  );
  const [asset, setAsset] = useState<UploadedAsset | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [settings, setSettings] = useState(ownerDefaults);
  const [job, setJob] = useState<JobView | null>(null);
  const [starting, setStarting] = useState(false);
  const [jobError, setJobError] = useState("");
  const [opticalFlowAvailable, setOpticalFlowAvailable] = useState<boolean | null>(null);
  const lastObjectUrl = useRef("");
  const activeJobId = job?.id;
  const activeJobStatus = job?.status;

  useEffect(() => () => {
    if (lastObjectUrl.current) URL.revokeObjectURL(lastObjectUrl.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiRequest<{ diagnostics: { filters: { opticalFlow: boolean } } }>("/api/diagnostics")
      .then((payload) => {
        if (cancelled) return;
        setOpticalFlowAvailable(payload.diagnostics.filters.opticalFlow);
        if (!payload.diagnostics.filters.opticalFlow) {
          setSettings((current) => current.masterCadence === "optical-flow"
            ? { ...current, masterCadence: "duplicate" }
            : current);
        }
      })
      .catch(() => {
        if (!cancelled) setOpticalFlowAvailable(false);
      });
    return () => { cancelled = true; };
  }, []);

  const receiveAsset = useCallback((nextAsset: UploadedAsset, localUrl: string) => {
    if (lastObjectUrl.current) URL.revokeObjectURL(lastObjectUrl.current);
    lastObjectUrl.current = localUrl;
    setAsset(nextAsset);
    setSourceUrl(localUrl || nextAsset.previewUrl || `/api/media/${nextAsset.id}/preview`);
    setJob(null);
    setJobError("");
    const isHdr = ["smpte2084", "arib-std-b67"].includes(nextAsset.analysis.video.color?.transfer ?? "");
    const measuredFps = nextAsset.analysis.video.fps.measured;
    const sourceAtLeast120 = measuredFps !== undefined && measuredFps >= 119.98;
    const smart = chooseSmartOptimize(nextAsset.analysis);
    const safeFps = recommendedSafeFps(nextAsset.analysis);
    setSettings({
      ...ownerDefaults,
      preset: smart.preset,
      performance: ownerDefaults.performance,
      safeFps,
      outputResolution: "1080p",
      codec: isHdr ? "hevc" : "h264",
      fitMode: "crop",
      sharpen: 0,
      denoise: 0,
      deband: 0,
      brightness: 0,
      contrast: 1,
      saturation: 1,
      normalizeAudio: false,
      lanczos: true,
      toneMapHdr: isHdr,
      masterCadence: sourceAtLeast120 ? "native" : "duplicate",
    });
  }, [ownerDefaults]);

  const controlsLocked = Boolean(
    job && ["queued", "preparing", "processing", "verifying", "cancel-requested"].includes(job.status),
  );

  const changeSettings = useCallback((next: ExportSettings) => {
    if (controlsLocked) return;
    setSettings(next);
    setJob(null);
    setJobError("");
  }, [controlsLocked]);

  useEffect(() => {
    if (!activeJobId || !activeJobStatus || ["completed", "failed", "cancelled"].includes(activeJobStatus)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const payload = await apiRequest<{ job: JobView }>(`/api/jobs/${activeJobId}`);
        if (!cancelled) setJob(payload.job);
        if (!cancelled && !["completed", "failed", "cancelled"].includes(payload.job.status)) {
          timer = setTimeout(poll, 1000);
        }
      } catch (error) {
        if (!cancelled) {
          setJobError(error instanceof Error ? error.message : "Could not refresh processing status.");
          timer = setTimeout(poll, 2500);
        }
      }
    };
    timer = setTimeout(poll, 600);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeJobId, activeJobStatus]);

  async function startJob() {
    if (!asset || starting) return;
    setStarting(true);
    setJobError("");
    try {
      const payload = await apiRequest<{ job: JobView }>("/api/jobs", {
        method: "POST",
        body: JSON.stringify({ assetId: asset.id, preset: settings.preset, options: settings }),
      });
      setJob(payload.job);
    } catch (error) {
      setJobError(error instanceof Error ? error.message : "The export could not be queued.");
    } finally {
      setStarting(false);
    }
  }

  async function cancelJob() {
    if (!job) return;
    try {
      const payload = await apiRequest<{ job: JobView }>(`/api/jobs/${job.id}/cancel`, { method: "POST" });
      setJob(payload.job);
    } catch (error) {
      setJobError(error instanceof Error ? error.message : "The cancellation request failed.");
    }
  }

  return (
    <div className="dashboard-stack">
      <section className="workspace-intro animate-in" aria-labelledby="workspace-heading">
        <div className="workspace-intro-copy">
          <span className="hero-status"><i /> Your video optimization studio</span>
          <p className="eyebrow">Faithful, standards-compliant exports</p>
          <h2 id="workspace-heading">Keep the look.<br /><span>Improve the delivery.</span></h2>
          <p>Analyse, optimize and verify a cleaner upload-ready file while preserving the source framing, colour and character.</p>
          <div className="workflow-path" aria-label="Workflow: add, inspect, optimize, save">
            <span><b>1</b> Add</span><ArrowRight size={14} /><span><b>2</b> Inspect</span><ArrowRight size={14} /><span><b>3</b> Optimize</span><ArrowRight size={14} /><span><b>4</b> Save</span>
          </div>
        </div>
        <div className="workspace-confidence" aria-label="Workspace benefits">
          <div className="confidence-orbit" aria-hidden="true"><span><Film size={24} /></span><i /><i /><i /></div>
          <div className="workspace-points">
            <span><ShieldCheck size={16} /><b>Private on this PC</b><small>No third-party upload</small></span>
            <span><Film size={16} /><b>Faithful picture</b><small>Shape and colour preserved</small></span>
            <span><HardDrive size={16} /><b>Verified output</b><small>Checked before download</small></span>
          </div>
        </div>
      </section>

      <Uploader maxBytes={maxUploadBytes} currentAsset={asset} onUploaded={receiveAsset} />

      {asset ? (
        <>
          <AnalysisPanel asset={asset} />
          <div className="dashboard-split">
            <PresetSelector
              asset={asset}
              settings={settings}
              locked={controlsLocked}
              opticalFlowAvailable={opticalFlowAvailable}
              onChange={changeSettings}
            />
            <ComparisonPreview
              asset={asset}
              sourceUrl={sourceUrl}
              outputUrl={job?.output?.previewUrl}
              settings={settings}
              onGuidesChange={(captionGuides) => setSettings((current) => ({ ...current, captionGuides }))}
            />
          </div>
          <ProcessingPanel
            asset={asset}
            job={job}
            starting={starting}
            error={jobError}
            settings={settings}
            onStart={startJob}
            onCancel={cancelJob}
          />
        </>
      ) : (
        <section className="waiting-grid animate-in" aria-label="Workflow overview">
          <div className="panel-flat workflow-card workflow-card-analysis"><span><Film size={19} /></span><small>01 / Understand</small><strong>Know what is really in the file</strong><p>Resolution, cadence, codecs, colour, audio, rotation, timestamps and MP4 layout.</p><em><Check size={13} /> Real FFprobe analysis</em></div>
          <div className="panel-flat workflow-card workflow-card-optimize"><span><Sparkles size={19} /></span><small>02 / Optimize</small><strong>Choose the right kind of output</strong><p>Create a source-matched 30/60 FPS upload copy, a labelled 120 FPS master, or preserve compatible streams losslessly.</p><em><Check size={13} /> No deceptive metadata</em></div>
          <div className="panel-flat workflow-card workflow-card-verify"><span><ShieldCheck size={19} /></span><small>03 / Deliver</small><strong>Save with confidence</strong><p>Follow real FFmpeg progress, cancel safely, and download only after the result passes verification.</p><em><Check size={13} /> Private local download</em></div>
        </section>
      )}

      <aside className="global-safety-note">
        <ShieldCheck size={18} />
        <div><strong>Transparent by design</strong><p>This tool prepares standards-compliant video files. TikTok controls its own transcoding, distribution and moderation systems. No application can guarantee 4K/120 FPS playback, prevent recompression, prevent reduced distribution or guarantee protection from account restrictions. Follow TikTok&apos;s current rules and upload normal, original content.</p></div>
      </aside>
    </div>
  );
}
