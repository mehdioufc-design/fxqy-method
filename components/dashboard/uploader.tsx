"use client";

import { Check, FileVideo2, LockKeyhole, UploadCloud, X } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { formatBytes } from "@/lib/client-api";
import type { UploadedAsset } from "./types";

const acceptedExtensions = [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"];

export function Uploader({
  maxBytes,
  currentAsset,
  onUploaded,
}: {
  maxBytes: number;
  currentAsset?: UploadedAsset | null;
  onUploaded: (asset: UploadedAsset, localPreviewUrl: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");

  async function handleFile(file?: File) {
    if (!file) return;
    setError("");
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!acceptedExtensions.includes(extension) && !file.type.startsWith("video/")) {
      setError("Choose a video file. The server will verify its actual media streams before accepting it.");
      return;
    }
    if (file.size <= 0 || file.size > maxBytes) {
      setError(`This file exceeds the configured ${formatBytes(maxBytes)} upload limit.`);
      return;
    }

    setProgress(0);
    setStage("Copying into private storage");
    try {
      const asset = await uploadVideo(file, (value) => {
        setProgress(value);
        if (value >= 1) setStage("Analysing streams and timing with FFprobe");
      }, xhrRef);
      const localUrl = URL.createObjectURL(file);
      onUploaded(asset, localUrl);
      setStage("Analysis complete");
      setProgress(null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
      setStage("");
      setProgress(null);
    } finally {
      xhrRef.current = null;
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void handleFile(event.dataTransfer.files[0]);
  }

  function cancelUpload() {
    xhrRef.current?.abort();
  }

  return (
    <section className="upload-panel panel animate-in" aria-labelledby="upload-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Start here</p>
          <h2 id="upload-title">Choose your source video</h2>
          <p className="section-description">We inspect it first, then show only honest export options that fit the file.</p>
        </div>
        <span className="local-badge"><LockKeyhole size={14} /> Stays on this machine</span>
      </div>

      <div
        className={`drop-zone ${dragging ? "is-dragging" : ""} ${progress !== null ? "is-busy" : ""}`}
        role={progress === null ? "button" : undefined}
        tabIndex={progress === null ? 0 : -1}
        aria-label={progress === null ? (currentAsset ? "Replace the current source video" : "Choose a source video") : undefined}
        onClick={progress === null ? () => inputRef.current?.click() : undefined}
        onKeyDown={progress === null ? (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          inputRef.current?.click();
        } : undefined}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
      >
        {progress === null && currentAsset ? (
          <div className="source-ready">
            <span className="source-ready-icon"><FileVideo2 size={24} /></span>
            <span className="source-ready-copy">
              <small>Source analysed and ready</small>
              <strong title={currentAsset.originalName}>{currentAsset.originalName}</strong>
              <span>{currentAsset.analysis.video.displayWidth ?? currentAsset.analysis.video.width} × {currentAsset.analysis.video.displayHeight ?? currentAsset.analysis.video.height} · {formatBytes(currentAsset.sizeBytes)}</span>
            </span>
            <span className="button-secondary source-replace"><UploadCloud size={15} /> Replace video</span>
          </div>
        ) : progress === null ? (
          <>
            <span className="drop-icon"><UploadCloud size={27} strokeWidth={1.6} /></span>
            <div className="drop-copy">
              <strong>Drop your video here</strong>
              <p>or browse files on this computer</p>
            </div>
            <span className="button-secondary upload-picker-cta" aria-hidden="true">
              <FileVideo2 size={16} /> Select video
            </span>
            <p className="drop-meta">MP4, MOV, WebM, MKV or AVI · up to {formatBytes(maxBytes)} · content is probed, not trusted by extension</p>
            <div className="upload-assurances" aria-label="Upload assurances">
              <span><Check size={13} /> Private storage</span>
              <span><Check size={13} /> Real media check</span>
              <span><Check size={13} /> No TikTok connection</span>
            </div>
          </>
        ) : (
          <div
            className="upload-progress"
            role="progressbar"
            aria-live="polite"
            aria-label={stage || "Uploading and analysing video"}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <div className="upload-progress-head">
              <span className="spinner" />
              <span>
                <strong>{stage}</strong>
                <small>{progress < 1 ? `${Math.round(progress * 100)}% transferred` : "Running genuine media analysis"}</small>
              </span>
              {progress < 1 && (
                <button className="icon-button" type="button" onClick={cancelUpload} aria-label="Cancel upload"><X size={17} /></button>
              )}
            </div>
            <div className="progress-track"><i style={{ width: `${Math.max(2, progress * 100)}%` }} /></div>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi"
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
      {error && <div className="inline-error" role="alert">{error}</div>}
    </section>
  );
}

function uploadVideo(
  file: File,
  onProgress: (progress: number) => void,
  xhrRef: React.MutableRefObject<XMLHttpRequest | null>,
) {
  return new Promise<UploadedAsset>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", "/api/uploads");
    xhr.responseType = "json";
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener("load", () => {
      const payload = xhr.response as {
        asset?: UploadedAsset;
        message?: string;
        error?: { message?: string };
      } | null;
      if (xhr.status >= 200 && xhr.status < 300 && payload?.asset) {
        onProgress(1);
        resolve(payload.asset);
      } else {
        reject(new Error(payload?.message ?? payload?.error?.message ?? "The video could not be accepted."));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("The local upload connection failed.")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled.")));
    xhr.send(file);
  });
}
