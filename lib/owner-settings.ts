import { getAppConfig } from "./config";
import { owners, settingsRepository, SINGLE_OWNER_ID, type OwnerSettings } from "./db";

export const DEFAULT_ENHANCEMENTS = Object.freeze({
  lanczos: true,
  normalizeAudio: false,
  captionGuides: true,
  sharpen: 0.1,
  denoise: 0,
  deband: 0,
});

export function getOwnerSettings(ownerId: number = SINGLE_OWNER_ID): OwnerSettings {
  if (process.env.NODE_ENV === "test") owners.ensureLocal();
  const existing = settingsRepository.get(ownerId);
  if (existing) return existing;
  const config = getAppConfig();
  return settingsRepository.update({
    ownerId,
    defaultPreset: "tiktok-safe",
  performanceMode: "fast_hardware",
    maxUploadBytes: config.maxUploadBytes,
    tempRetentionHours: Math.round(config.retentionMs / 3_600_000),
    outputRetentionDays: null,
    enhancements: DEFAULT_ENHANCEMENTS,
  });
}

export function settingsView(settings: OwnerSettings) {
  return {
    defaultPreset: settings.defaultPreset.replaceAll("_", "-"),
    performance: settings.performanceMode.replaceAll("_", "-"),
    maxUploadBytes: settings.maxUploadBytes,
    retentionHours: settings.tempRetentionHours,
    outputRetentionDays: settings.outputRetentionDays,
    enhancements: settings.enhancements,
  };
}
