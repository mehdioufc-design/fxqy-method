import { describe, expect, it } from "vitest";
import { chooseSmartOptimize, type SmartOptimizeAnalysis } from "../lib/smart-optimize";

function analysis(overrides: Partial<SmartOptimizeAnalysis> = {}): SmartOptimizeAnalysis {
  return {
    hdr: false,
    video: {
      codec: "h264", pixelFormat: "yuv420p", width: 1080, height: 1920,
      color: { primaries: "bt709", transfer: "bt709", space: "bt709", range: "tv" },
      fps: { measured: 29.97 },
    },
    remux: { eligible: true },
    ...overrides,
  };
}

describe("smart optimization selection", () => {
  it("preserves already compatible media without re-encoding", () => {
    expect(chooseSmartOptimize(analysis()).preset).toBe("lossless-remux");
  });

  it("preserves eligible 4K H.264 SDR sources without another lossy encode", () => {
    expect(chooseSmartOptimize(analysis({
      video: { ...analysis().video, width: 2160, height: 3840 },
    })).preset).toBe("lossless-remux");
  });

  it("converts ineligible, HEVC, HDR, oversized, and ambiguous-colour sources", () => {
    const cases = [
      analysis({ remux: { eligible: false } }),
      analysis({ video: { ...analysis().video, codec: "hevc" } }),
      analysis({ hdr: true }),
      analysis({ video: { ...analysis().video, width: 2160, height: 5000 } }),
      analysis({ video: { ...analysis().video, color: {} } }),
    ];
    for (const candidate of cases) expect(chooseSmartOptimize(candidate).preset).toBe("tiktok-safe");
  });

});
