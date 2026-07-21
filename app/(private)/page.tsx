import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { getOwnerSettings } from "@/lib/owner-settings";
import type { ExportSettings } from "@/components/dashboard/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const settings = getOwnerSettings();
  const enhancements = settings.enhancements && typeof settings.enhancements === "object"
    ? settings.enhancements as Record<string, unknown>
    : {};
  const initialSettings: Partial<ExportSettings> = {
    performance: settings.performanceMode.replaceAll("_", "-") as ExportSettings["performance"],
    lanczos: enhancements.lanczos !== false,
    normalizeAudio: enhancements.normalizeAudio === true,
    captionGuides: enhancements.captionGuides !== false,
    sharpen: finiteSetting(enhancements.sharpen, 0.1),
    denoise: finiteSetting(enhancements.denoise, 0),
    deband: finiteSetting(enhancements.deband, 0),
  };
  return <DashboardClient maxUploadBytes={settings.maxUploadBytes} initialSettings={initialSettings} />;
}

function finiteSetting(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
