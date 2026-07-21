import { describe, expect, it } from "vitest";
import { parseDashboardJobRequest } from "../lib/job-options";

const assetId = "7b2c56f2-3d20-40f0-a1ac-7e78aac4a410";

function dashboardOptions(overrides: Record<string, unknown> = {}) {
  return {
    preset: "tiktok-safe",
    performance: "fast-hardware",
    safeFps: 60,
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
    ...overrides,
  };
}

describe("dashboard export option validation", () => {
  it("passes the selected 2K size into a genuine 60 FPS preset", () => {
    const result = parseDashboardJobRequest({
      assetId,
      preset: "tiktok-safe",
      options: dashboardOptions({ outputResolution: "2k" }),
    });
    expect(result.options).toMatchObject({ preset: "tiktok-safe", fps: 60, resolution: "2k" });
  });

  it("passes duplication or optical flow only into the honest 120 FPS preset", () => {
    const result = parseDashboardJobRequest({
      assetId,
      preset: "master-120",
      options: dashboardOptions({
        preset: "master-120",
        outputResolution: "1080p",
        masterCadence: "optical-flow",
      }),
    });
    expect(result.options).toMatchObject({
      preset: "master-120",
      resolution: "1080p",
      cadence: "optical-flow",
    });
  });

  it("rejects unknown resolution values and mismatched preset labels", () => {
    expect(() => parseDashboardJobRequest({
      assetId,
      preset: "tiktok-safe",
      options: dashboardOptions({ outputResolution: "4k" }),
    })).toThrow();
    expect(() => parseDashboardJobRequest({
      assetId,
      preset: "master-120",
      options: dashboardOptions(),
    })).toThrow();
  });
});
