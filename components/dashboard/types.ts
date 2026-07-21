export type WarningSeverity = "info" | "warning" | "error";

export interface AnalysisWarning {
  code: string;
  severity: WarningSeverity;
  title: string;
  message: string;
}

export interface MediaAnalysisView {
  schemaVersion?: number;
  hdr?: boolean;
  file: {
    bytes: number;
    durationSeconds: number;
    bitrate?: number;
    containerNames?: string[];
    webOptimized?: boolean | null;
    fragmentedMp4?: boolean | null;
  };
  video: {
    codec: string;
    profile?: string;
    level?: string;
    width: number;
    height: number;
    displayWidth?: number;
    displayHeight?: number;
    dar?: number;
    sar?: string;
    pixelFormat?: string;
    fieldOrder?: string;
    bitrate?: number;
    rotation?: number;
    color?: {
      primaries?: string;
      transfer?: string;
      space?: string;
      range?: string;
    };
    fps: {
      measured?: number;
      average?: number;
      avgText?: string;
      nominalText?: string;
      kind: "constant" | "variable" | "indeterminate";
      sampleCount?: number;
    };
  };
  audio?: {
    codec: string;
    sampleRate?: number;
    channels?: number;
    bitrate?: number;
    durationSeconds?: number;
  };
  timing?: {
    avDurationDeltaSeconds?: number;
    nonMonotonicDts?: number;
    missingPts?: number;
    missingDts?: number;
    nonPositiveDurations?: number;
    negativeStart?: boolean;
    suspiciousFrameMetadata?: boolean;
  };
  warnings: AnalysisWarning[];
  remux?: {
    eligible: boolean;
    fixes?: string[];
    warnings?: string[];
    blockers?: string[];
    recommendedPreset?: string;
  };
}

export interface UploadedAsset {
  id: string;
  originalName: string;
  sizeBytes: number;
  createdAt?: string;
  previewUrl?: string;
  analysis: MediaAnalysisView;
}

export type PresetId = "tiktok-safe" | "maximum-quality" | "master-120" | "lossless-remux";
export type PerformanceMode = "fast-hardware" | "balanced" | "maximum-cpu";
export type FitMode = "crop" | "fit" | "blurred-background";
export type MasterCadence = "native" | "duplicate" | "optical-flow";
export type OutputResolution = "1080p" | "2k";

export interface ExportSettings {
  preset: PresetId;
  performance: PerformanceMode;
  safeFps: 30 | 60;
  outputResolution: OutputResolution;
  codec: "h264" | "hevc";
  fitMode: FitMode;
  masterCadence: MasterCadence;
  lanczos: boolean;
  sharpen: number;
  denoise: number;
  deband: number;
  brightness: number;
  contrast: number;
  saturation: number;
  toneMapHdr: boolean;
  normalizeAudio: boolean;
  captionGuides: boolean;
}

export type JobStatus =
  | "queued"
  | "preparing"
  | "processing"
  | "verifying"
  | "completed"
  | "failed"
  | "cancel-requested"
  | "cancelled";

export interface JobView {
  id: string;
  assetId: string;
  status: JobStatus;
  phase?: string;
  progress: number;
  frame?: number;
  fps?: number;
  speed?: string;
  totalSize?: number;
  outTimeSeconds?: number;
  dupFrames?: number;
  dropFrames?: number;
  etaSeconds?: number | null;
  logTail?: string[];
  safeError?: string;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  output?: {
    id: string;
    downloadUrl: string;
    previewUrl?: string;
    fileName: string;
    sizeBytes: number;
    verified: boolean;
    width: number;
    height: number;
    fps: number;
    codec: string;
    frameSynthesis?: "none" | "duplication" | "optical-flow" | "cadence-conformed";
  };
}
