export type JsonMap = Record<string, unknown>;

export interface ExportView {
  id: string;
  jobId: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string | number;
  expiresAt?: string | number | null;
  downloadUrl: string;
  previewUrl?: string;
  media?: JsonMap | null;
  verified?: boolean;
}

export interface JobOutputView {
  id?: string;
  fileName?: string;
  sizeBytes?: number;
  downloadUrl?: string;
  previewUrl?: string;
  verified?: boolean;
}

export interface JobHistoryView {
  id: string;
  preset: string;
  status: string;
  phase?: string;
  progress: number;
  createdAt: string | number;
  startedAt?: string | number | null;
  completedAt?: string | number | null;
  safeError?: string;
  assetName?: string;
  output?: JobOutputView | null;
}

export interface StorageSummary {
  usedBytes: number;
  sourceBytes: number;
  exportBytes: number;
  tempBytes: number;
  freeBytes: number;
  maxUploadBytes: number;
  retentionHours: number;
}

export interface StoredFileView {
  id: string;
  fileName?: string;
  originalName?: string;
  displayName?: string;
  sizeBytes?: number;
  bytes?: number;
  createdAt?: string | number;
  status?: string;
}

export interface StoragePayload {
  summary: StorageSummary;
  assets: StoredFileView[];
  exports: StoredFileView[];
}

export interface OwnerSettingsView {
  defaultPreset: string;
  performance: string;
  maxUploadBytes: number;
  retentionHours: number;
  outputRetentionDays: number | null;
  enhancements: JsonMap;
}

export interface DiagnosticsView {
  ffmpeg?: unknown;
  ffprobe?: unknown;
  database?: unknown;
  storage?: unknown;
  hardware?: unknown;
  filters?: unknown;
  network?: unknown;
  warnings?: unknown;
  checkedAt?: string | number;
}

