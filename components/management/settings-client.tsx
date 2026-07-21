"use client";

import {
  Gauge,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest, formatBytes } from "@/lib/client-api";
import {
  ErrorPanel,
  LoadingPanel,
  ManagementIntro,
  toFiniteNumber,
} from "./management-ui";
import type { JsonMap, OwnerSettingsView } from "./types";

const MIB = 1024 * 1024;

export function SettingsClient() {
  const [settings, setSettings] = useState<OwnerSettingsView | null>(null);
  const [maxUploadMib, setMaxUploadMib] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiRequest<{ settings?: Partial<OwnerSettingsView> }>("/api/settings");
      const normalized = normalizeSettings(payload.settings);
      setSettings(normalized);
      setMaxUploadMib(String(Math.max(1, Math.round(normalized.maxUploadBytes / MIB))));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Owner settings could not be read.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSettings(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSettings]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    const uploadMib = Number(maxUploadMib);
    if (!Number.isInteger(uploadMib) || uploadMib < 1 || uploadMib > 1_048_576) {
      setSaveError("Maximum upload size must be a whole number from 1 to 1,048,576 MiB.");
      return;
    }
    if (!Number.isInteger(settings.retentionHours) || settings.retentionHours < 1 || settings.retentionHours > 8760) {
      setSaveError("Temporary-file retention must be from 1 to 8760 hours.");
      return;
    }
    if (settings.outputRetentionDays !== null && (!Number.isInteger(settings.outputRetentionDays) || settings.outputRetentionDays < 1 || settings.outputRetentionDays > 3650)) {
      setSaveError("Output retention must be blank or from 1 to 3650 days.");
      return;
    }

    const nextSettings: OwnerSettingsView = {
      ...settings,
      maxUploadBytes: uploadMib * MIB,
    };
    setSaving(true);
    setSaveError("");
    setSaveMessage("");
    try {
      const payload = await apiRequest<{ settings?: Partial<OwnerSettingsView> }>("/api/settings", {
        method: "PUT",
        body: JSON.stringify(nextSettings),
      });
      const saved = normalizeSettings(payload.settings ?? nextSettings);
      setSettings(saved);
      setMaxUploadMib(String(Math.max(1, Math.round(saved.maxUploadBytes / MIB))));
      setSaveMessage("Your preferences were saved.");
      window.setTimeout(() => window.dispatchEvent(new Event("tto:request-feedback")), 700);
    } catch (saveFailure) {
      setSaveError(saveFailure instanceof Error ? saveFailure.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dashboard-stack management-page">
      <ManagementIntro
        eyebrow="Your preferences"
        title="Application settings"
        description="Set local processing defaults and storage limits. Video shape, colour, and detail are preserved automatically."
        actions={
          <button className="button-secondary" type="button" onClick={() => void loadSettings()} disabled={loading || saving}>
            <RefreshCw size={16} aria-hidden="true" />
            Reload
          </button>
        }
      />

      {loading ? <LoadingPanel label="Loading owner settings" /> : null}
      {!loading && error ? <ErrorPanel message={error} onRetry={() => void loadSettings()} /> : null}

      {!loading && !error && settings ? (
        <div className="management-settings-layout">
          <form className="settings-form panel animate-in" onSubmit={saveSettings}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Processing defaults</p>
                <h2>Export and storage preferences</h2>
              </div>
              <Gauge size={21} aria-hidden="true" />
            </div>
            <p className="management-section-copy">These values initialise new work. Each source can still use different validated export options on the dashboard.</p>

            <div className="management-field-grid">
              <label className="field" htmlFor="performance-mode">
                <span>Performance mode</span>
                <select
                  className="select"
                  id="performance-mode"
                  value={settings.performance}
                  onChange={(event) => setSettings({ ...settings, performance: event.target.value })}
                  disabled={saving}
                >
                  <option value="fast-hardware">Fast Hardware</option>
                  <option value="balanced">Balanced</option>
                  <option value="maximum-cpu">Maximum CPU Quality</option>
                </select>
              </label>

              <label className="field" htmlFor="max-upload-mib">
                <span>Maximum upload size (MiB)</span>
                <input
                  className="input"
                  id="max-upload-mib"
                  type="number"
                  min={1}
                  max={1_048_576}
                  step={1}
                  inputMode="numeric"
                  value={maxUploadMib}
                  onChange={(event) => setMaxUploadMib(event.target.value)}
                  disabled={saving}
                  required
                />
                <small className="management-field-help">Current limit: {formatBytes(Math.max(0, Number(maxUploadMib) || 0) * MIB)}</small>
              </label>

              <label className="field" htmlFor="temp-retention-hours">
                <span>Temporary-file retention (hours)</span>
                <input
                  className="input"
                  id="temp-retention-hours"
                  type="number"
                  min={1}
                  max={8760}
                  step={1}
                  value={settings.retentionHours}
                  onChange={(event) => setSettings({ ...settings, retentionHours: Number(event.target.value) })}
                  disabled={saving}
                  required
                />
              </label>

              <label className="field" htmlFor="output-retention-days">
                <span>Completed-output retention (days)</span>
                <input
                  className="input"
                  id="output-retention-days"
                  type="number"
                  min={1}
                  max={3650}
                  step={1}
                  value={settings.outputRetentionDays ?? ""}
                  onChange={(event) => setSettings({
                    ...settings,
                    outputRetentionDays: event.target.value === "" ? null : Number(event.target.value),
                  })}
                  disabled={saving}
                />
                <small className="management-field-help">Leave blank to keep completed exports until manual deletion.</small>
              </label>
            </div>

            <div className="settings-enhancements panel-flat">
              <div className="storage-file-heading">
                <span aria-hidden="true"><SlidersHorizontal size={18} /></span>
                <div><h3>Processing defaults</h3><p>Shape, colour, and detail remain faithful to the source.</p></div>
              </div>
              <div className="settings-toggle-grid">
                <EnhancementToggle
                  label="Lanczos scaling"
                  description="Use the high-quality scaler when resizing."
                  checked={readEnhancementBoolean(settings.enhancements, "lanczos")}
                  onChange={(checked) => setSettings({ ...settings, enhancements: { ...settings.enhancements, lanczos: checked } })}
                  disabled={saving}
                />
                <EnhancementToggle
                  label="Caption-safe guides"
                  description="Show safe-area overlays in the comparison preview."
                  checked={readEnhancementBoolean(settings.enhancements, "captionGuides")}
                  onChange={(checked) => setSettings({ ...settings, enhancements: { ...settings.enhancements, captionGuides: checked } })}
                  disabled={saving}
                />
              </div>
            </div>

            {saveError ? <p className="inline-error" role="alert">{saveError}</p> : null}
            {saveMessage ? <p className="management-success" role="status"><ShieldCheck size={15} aria-hidden="true" />{saveMessage}</p> : null}
            <div className="management-form-actions">
              <button className="button-primary" type="submit" disabled={saving}>
                {saving ? <span className="spinner" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
                {saving ? "Saving preferences…" : "Save preferences"}
              </button>
            </div>
          </form>

          <section className="password-form panel animate-in">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Account access</p>
                <h2>Protected workspace</h2>
              </div>
              <ShieldCheck size={21} aria-hidden="true" />
            </div>
            <p className="management-section-copy">Your settings, uploads, jobs and downloads are scoped to your signed-in account.</p>
            <div className="notice notice-info">
              <ShieldCheck size={16} aria-hidden="true" />
              <span><strong>Secure session</strong><small>Your password is hashed and the session cookie is HTTP-only.</small></span>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function EnhancementToggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="settings-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
      <span><strong>{label}</strong><small>{description}</small></span>
    </label>
  );
}

function normalizeSettings(value?: Partial<OwnerSettingsView>): OwnerSettingsView {
  return {
    defaultPreset: normalizePresetId(value?.defaultPreset),
    performance: normalizePerformanceId(value?.performance),
    maxUploadBytes: Math.max(MIB, Math.round(toFiniteNumber(value?.maxUploadBytes, MIB))),
    retentionHours: Math.max(1, Math.round(toFiniteNumber(value?.retentionHours, 168))),
    outputRetentionDays: value?.outputRetentionDays === null
      ? null
      : Math.max(1, Math.round(toFiniteNumber(value?.outputRetentionDays, 30))),
    enhancements: value?.enhancements && typeof value.enhancements === "object" && !Array.isArray(value.enhancements)
      ? value.enhancements
      : {},
  };
}

function normalizePresetId(value: unknown): string {
  if (typeof value !== "string") return "tiktok-safe";
  const normalized = value.replaceAll("_", "-");
  return ["tiktok-safe", "maximum-quality", "master-120", "lossless-remux"].includes(normalized)
    ? normalized
    : "tiktok-safe";
}

function normalizePerformanceId(value: unknown): string {
  if (typeof value !== "string") return "balanced";
  const normalized = value.replaceAll("_", "-");
  return ["fast-hardware", "balanced", "maximum-cpu"].includes(normalized)
    ? normalized
    : "balanced";
}

function readEnhancementBoolean(enhancements: JsonMap, key: string): boolean {
  return enhancements[key] === true;
}
