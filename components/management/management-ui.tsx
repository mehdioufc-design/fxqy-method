import { AlertTriangle, Inbox, LoaderCircle, RotateCw } from "lucide-react";
import type { ReactNode } from "react";

export function ManagementIntro({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="management-intro animate-in">
      <div className="management-intro-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {actions ? <div className="management-actions">{actions}</div> : null}
    </header>
  );
}

export function LoadingPanel({ label }: { label: string }) {
  return (
    <section className="management-state panel" role="status" aria-live="polite" aria-busy="true">
      <LoaderCircle className="management-spin" size={22} aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        <p>Reading private local data…</p>
      </div>
    </section>
  );
}

export function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <section className="management-state management-state-error panel" role="alert">
      <AlertTriangle size={22} aria-hidden="true" />
      <div>
        <strong>Could not load this page</strong>
        <p>{message}</p>
      </div>
      <button className="button-secondary" type="button" onClick={onRetry}>
        <RotateCw size={16} aria-hidden="true" />
        Try again
      </button>
    </section>
  );
}

export function EmptyPanel({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <section className="management-empty panel-flat">
      <span className="management-empty-icon" aria-hidden="true"><Inbox size={22} /></span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </section>
  );
}

export function StatusPill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  children: ReactNode;
}) {
  return <span className={`management-status management-status-${tone}`}>{children}</span>;
}

export function formatDateTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "Not available";
  const numeric = typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(numeric);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function presetLabel(value: string): string {
  const labels: Record<string, string> = {
    "tiktok-safe": "TikTok Safe",
    "maximum-quality": "Maximum Quality",
    "master-120": "120 FPS Master",
    "lossless-remux": "Lossless Remux",
  };
  return labels[value] ?? humanize(value);
}

export function statusLabel(value: string): string {
  const labels: Record<string, string> = {
    queued: "Queued",
    preparing: "Preparing",
    analyzing: "Analysing",
    processing: "Processing",
    verifying: "Verifying",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
    "cancel-requested": "Cancelling",
  };
  return labels[value] ?? humanize(value);
}

export function statusTone(value: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (value === "completed") return "success";
  if (value === "failed") return "danger";
  if (value === "cancelled") return "neutral";
  if (["queued", "preparing", "analyzing", "processing", "verifying", "cancel-requested"].includes(value)) {
    return "warning";
  }
  return "info";
}

export function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function toFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
