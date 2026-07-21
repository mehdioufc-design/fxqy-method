import type { ExportRecord, MediaAsset, ProcessingJob } from "./db";
import { exportsRepository, mediaAssets } from "./db";
import { MediaAnalysisSchema, type MediaAnalysis } from "./media";

type JsonObject = Record<string, unknown>;

function record(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function warningTitle(code: string): string {
  return code
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function parseStoredAnalysis(value: unknown): MediaAnalysis | null {
  const parsed = MediaAnalysisSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function analysisView(analysis: MediaAnalysis) {
  return {
    ...analysis,
    video: {
      ...analysis.video,
      fps: {
        ...analysis.video.fps,
        average: analysis.video.fps.measured,
      },
    },
    warnings: analysis.warnings.map((warning) => ({
      ...warning,
      title: warningTitle(warning.code),
    })),
  };
}

export function assetView(asset: MediaAsset) {
  const analysis = parseStoredAnalysis(asset.analysis);
  if (!analysis) throw new Error("The stored source analysis is unavailable.");
  return {
    id: asset.id,
    originalName: asset.originalName,
    sizeBytes: asset.bytes,
    createdAt: new Date(asset.createdAt).toISOString(),
    previewUrl: `/api/media/${asset.id}/preview`,
    analysis: analysisView(analysis),
  };
}

function publicJobStatus(job: ProcessingJob) {
  if (job.status === "cancel_requested") return "cancel-requested";
  if (job.status === "analyzing") return "preparing";
  if (job.status === "processing" && /verif/i.test(job.phase)) return "verifying";
  return job.status;
}

function exportMedia(exportRecord: ExportRecord): {
  analysis: MediaAnalysis | null;
  expected: JsonObject | null;
  verified: boolean;
} {
  const media = record(exportRecord.media);
  return {
    analysis: parseStoredAnalysis(media?.analysis),
    expected: record(media?.expected),
    verified: media?.verified === true,
  };
}

export function exportView(exportRecord: ExportRecord) {
  const parsed = exportMedia(exportRecord);
  return {
    id: exportRecord.id,
    jobId: exportRecord.jobId,
    fileName: exportRecord.displayName,
    sizeBytes: exportRecord.bytes,
    createdAt: new Date(exportRecord.createdAt).toISOString(),
    expiresAt: exportRecord.expiresAt ? new Date(exportRecord.expiresAt).toISOString() : null,
    downloadUrl: `/api/exports/${exportRecord.id}/download`,
    previewUrl: `/api/exports/${exportRecord.id}/preview`,
    media: parsed.analysis,
    verified: parsed.verified,
  };
}

export function jobView(job: ProcessingJob) {
  const telemetry = record(job.telemetry) ?? {};
  const ffmpeg = record(telemetry.ffmpeg) ?? {};
  const output = exportsRepository.list(job.ownerId, 500).find((entry) => entry.jobId === job.id);
  const parsedOutput = output ? exportMedia(output) : null;
  const video = parsedOutput?.analysis?.video;
  const expected = parsedOutput?.expected;
  const synthesis = expected?.frameSynthesis;
  const source = mediaAssets.get(job.sourceAssetId, job.ownerId);
  const sourceAnalysis = parseStoredAnalysis(source?.analysis);
  const speed = numberValue(ffmpeg.speed);
  const outTime = numberValue(ffmpeg.outTimeSeconds);
  const eta = speed && outTime !== undefined && sourceAnalysis
    ? Math.max(0, (sourceAnalysis.file.durationSeconds - outTime) / speed)
    : undefined;
  return {
    id: job.id,
    assetId: job.sourceAssetId,
    preset: job.preset,
    status: publicJobStatus(job),
    phase: job.phase,
    progress: Math.max(0, Math.min(1, job.progress / 100)),
    frame: numberValue(ffmpeg.frame),
    fps: numberValue(ffmpeg.fps),
    speed: speed === undefined ? undefined : `${speed.toFixed(2)}x`,
    totalSize: numberValue(ffmpeg.outputBytes),
    outTimeSeconds: outTime,
    dupFrames: numberValue(ffmpeg.duplicateFrames),
    dropFrames: numberValue(ffmpeg.droppedFrames),
    etaSeconds: eta ?? null,
    logTail: job.logTail,
    safeError: job.safeErrorMessage ?? undefined,
    createdAt: new Date(job.createdAt).toISOString(),
    startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : undefined,
    completedAt: job.completedAt ? new Date(job.completedAt).toISOString() : undefined,
    assetName: source?.originalName ?? "Local source",
    output: output && parsedOutput?.analysis
      ? {
          id: output.id,
          downloadUrl: `/api/exports/${output.id}/download`,
          previewUrl: `/api/exports/${output.id}/preview`,
          fileName: output.displayName,
          sizeBytes: output.bytes,
          verified: parsedOutput.verified,
          width: video!.width,
          height: video!.height,
          fps: video!.fps.measured ?? 0,
          codec: video!.codec,
          frameSynthesis:
            synthesis === "cadence-conform" ? "cadence-conformed" : synthesis,
        }
      : undefined,
  };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
