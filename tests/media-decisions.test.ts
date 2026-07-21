import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  FfmpegProgressParser,
  analyzePacketRecords,
  buildFfmpegCommand,
  evaluateRemuxEligibility,
  parseFfprobeAnalysis,
  parseEncoderListing,
  parseFilterListing,
  parsePresetOptions,
  progressFraction,
  trustedPathWithin,
  verifyOutputAnalysis,
  verifyRemuxInvariants,
} from "../lib/media";
import type { MediaAnalysis, MediaCapabilities } from "../lib/media";

function bt601Analysis(): MediaAnalysis {
  const records = Array.from({ length: 30 }, (_, index) => ({
    pts: index / 30,
    dts: index / 30,
    duration: 1 / 30,
    size: 12_000,
    keyframe: index === 0,
  }));
  return parseFfprobeAnalysis(
    {
      streams: [
        {
          index: 0,
          codec_name: "h264",
          codec_type: "video",
          width: 720,
          height: 1280,
          pix_fmt: "yuv420p",
          field_order: "progressive",
          color_range: "tv",
          color_space: "smpte170m",
          color_transfer: "smpte170m",
          color_primaries: "smpte170m",
          r_frame_rate: "30/1",
          avg_frame_rate: "30/1",
          time_base: "1/90000",
          duration: "1",
          nb_frames: "30",
          nb_read_packets: "30",
          disposition: { default: 1, attached_pic: 0 },
        },
        { index: 1, codec_name: "aac", codec_type: "audio", sample_rate: "48000", duration: "1" },
      ],
      format: { format_name: "mov,mp4", duration: "1", size: "800000" },
    },
    {
      packetTiming: analyzePacketRecords(records, 1 / 90_000),
      mp4: {
        valid: true,
        isIsoBmff: true,
        webOptimized: true,
        fragmented: false,
        atoms: [],
        compatibleBrands: [],
        errors: [],
      },
    },
  );
}

const capabilities: MediaCapabilities = {
  encoders: ["libx264", "libx265"],
  filters: ["zscale", "tonemap", "minterpolate", "loudnorm", "hqdn3d", "deband", "bwdif"],
  diagnostics: [],
};

describe("colour, remux, progress, and verification decisions", () => {
  it("converts known non-BT.709 SDR rather than only relabelling it", () => {
    const root = path.resolve(process.cwd(), "work", "media-decision-tests");
    const spec = buildFfmpegCommand({
      input: trustedPathWithin(root, path.join(root, "input.upload")),
      output: trustedPathWithin(root, path.join(root, "output.part.mp4")),
      analysis: bt601Analysis(),
      options: parsePresetOptions({ preset: "tiktok-safe", fps: 30 }),
      capabilities,
    });
    const filter = spec.args[spec.args.indexOf("-vf") + 1];
    expect(filter).toContain("zscale=p=bt709:t=bt709:m=bt709:r=limited");
    expect(spec.expected.color).toEqual({
      primaries: "bt709",
      transfer: "bt709",
      space: "bt709",
      range: "tv",
    });
  });

  it("blocks lossless remux when timestamps are invalid", () => {
    const base = bt601Analysis();
    const decision = evaluateRemuxEligibility({
      ...base,
      timing: { ...base.timing, nonMonotonicDts: 1 },
    });
    expect(decision.eligible).toBe(false);
    expect(decision.blockers.join(" ")).toMatch(/timestamp/i);
  });

  it("blocks and rejects lossless remux of suspicious frame/sample metadata", () => {
    const base = bt601Analysis();
    const suspicious = {
      ...base,
      timing: { ...base.timing, suspiciousFrameMetadata: true },
    };
    expect(evaluateRemuxEligibility(suspicious).eligible).toBe(false);
    expect(verifyRemuxInvariants(suspicious, suspicious).issues.map((entry) => entry.code))
      .toContain("SUSPICIOUS_FRAME_METADATA");
  });

  it("rejects a supposed lossless remux when known colour metadata changes", () => {
    const source = bt601Analysis();
    const output = {
      ...source,
      video: {
        ...source.video,
        color: { ...source.video.color, primaries: "bt709" },
      },
    };
    const result = verifyRemuxInvariants(source, output);
    expect(result.ok).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toContain("COLOR_PRIMARIES_CHANGED");
  });

  it("parses actual FFmpeg progress records without simulated increments", () => {
    const parser = new FfmpegProgressParser();
    const updates = parser.push(
      "frame=120\nfps=59.9\nout_time_us=2000000\nspeed=1.25x\ntotal_size=1000000\nprogress=continue\n",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].outTimeSeconds).toBe(2);
    expect(progressFraction(updates[0], 10)).toBe(0.2);
  });

  it("parses only allowlisted encoder and filter capabilities", () => {
    expect(parseEncoderListing(" V....D h264_nvenc NVIDIA NVENC H.264\n V....D arbitrary_encoder nope")).toEqual([
      "h264_nvenc",
    ]);
    expect(parseFilterListing(" ... minterpolate V->V\n ... arbitrary_filter V->V")).toEqual([
      "minterpolate",
    ]);
  });

  it("fails verification on incorrect colour or cadence", () => {
    const actual = bt601Analysis();
    const result = verifyOutputAnalysis(
      {
        preset: "tiktok-safe",
        durationSeconds: 1,
        width: 720,
        height: 1280,
        codec: "h264",
        pixelFormat: "yuv420p",
        frameRateKind: "constant",
        frameRate: 60,
        color: { primaries: "bt709", transfer: "bt709", space: "bt709", range: "tv" },
        webOptimized: true,
        progressive: true,
        rotation: 0,
        frameSynthesis: "cadence-conform",
      },
      actual,
    );
    expect(result.ok).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["FRAME_RATE_MISMATCH", "COLOR_PRIMARIES_MISMATCH"]),
    );
  });
});
