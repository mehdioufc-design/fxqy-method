import { describe, expect, it } from "vitest";
import { resolveOutputDimensions } from "../lib/media/output-dimensions";

describe("aspect-preserving output dimensions", () => {
  it("downscales 4K portrait media to the chosen ceiling", () => {
    const source = { width: 2160, height: 3840, dar: 9 / 16, sar: "1:1", rotation: 0 };
    expect(resolveOutputDimensions(source, "1080p")).toMatchObject({ width: 1080, height: 1920 });
    expect(resolveOutputDimensions(source, "2k")).toMatchObject({ width: 1440, height: 2560 });
  });

  it("does not enlarge a source that is already below the selected ceiling", () => {
    expect(resolveOutputDimensions(
      { width: 720, height: 1280, dar: 9 / 16, sar: "1:1", rotation: 0 },
      "2k",
    )).toEqual({ width: 720, height: 1280, upscaled: false, limitedBySource: true });
  });

  it("normalizes anamorphic sample pixels without cropping the display aspect", () => {
    expect(resolveOutputDimensions(
      { width: 720, height: 576, dar: 4 / 3, sar: "16:15", rotation: 0 },
      "1080p",
    )).toMatchObject({ width: 768, height: 576 });
    expect(resolveOutputDimensions(
      { width: 720, height: 576, dar: 3 / 4, sar: "16:15", rotation: 90 },
      "1080p",
    )).toMatchObject({ width: 576, height: 768 });
  });
});
