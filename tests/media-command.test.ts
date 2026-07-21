import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MediaConfigurationError,
  analyzePacketRecords,
  buildFfmpegCommand,
  parseFfprobeAnalysis,
  parsePresetOptions,
  trustedPathWithin,
} from "../lib/media";
import type { MediaAnalysis, MediaCapabilities } from "../lib/media";

const capabilities: MediaCapabilities = {
  encoders: ["libx264", "libx265", "h264_nvenc"],
  filters: ["zscale", "tonemap", "minterpolate", "loudnorm", "hqdn3d", "deband", "bwdif"],
  diagnostics: [],
};

function analysisAt(rate = 60, hdr = false, width = 1080, height = 1920): MediaAnalysis {
  const records = Array.from({ length: rate }, (_, index) => ({
    pts: index / rate,
    dts: index / rate,
    duration: 1 / rate,
    size: 18_000,
    keyframe: index === 0,
  }));
  return parseFfprobeAnalysis(
    {
      streams: [
        {
          index: 0,
          codec_name: hdr ? "hevc" : "h264",
          codec_type: "video",
          profile: hdr ? "Main 10" : "High",
          width,
          height,
          pix_fmt: hdr ? "yuv420p10le" : "yuv420p",
          field_order: "progressive",
          sample_aspect_ratio: "1:1",
          display_aspect_ratio: `${width}:${height}`,
          color_range: "tv",
          color_space: hdr ? "bt2020nc" : "bt709",
          color_transfer: hdr ? "smpte2084" : "bt709",
          color_primaries: hdr ? "bt2020" : "bt709",
          r_frame_rate: `${rate}/1`,
          avg_frame_rate: `${rate}/1`,
          time_base: "1/120000",
          duration: "1",
          nb_frames: String(rate),
          nb_read_packets: String(rate),
          side_data_list: hdr ? [{ side_data_type: "Mastering display metadata" }] : [],
          disposition: { default: 1, attached_pic: 0 },
        },
        {
          index: 1,
          codec_name: "aac",
          codec_type: "audio",
          sample_rate: "48000",
          channels: 2,
          duration: "1",
          disposition: { default: 1 },
        },
      ],
      format: { format_name: "mov,mp4", duration: "1", size: "1000000" },
    },
    {
      packetTiming: analyzePacketRecords(records, 1 / 120_000),
      mp4: {
        valid: true,
        isIsoBmff: true,
        webOptimized: false,
        fragmented: false,
        atoms: [],
        compatibleBrands: [],
        errors: [],
      },
    },
  );
}

function paths() {
  const root = path.resolve(process.cwd(), "work", "media-command-tests");
  return {
    input: trustedPathWithin(root, path.join(root, "5da1b14f.upload")),
    output: trustedPathWithin(root, path.join(root, "a094195c.part.mp4")),
  };
}

describe("validated FFmpeg command generation", () => {
  it("builds genuine TikTok Safe CFR argv without a shell command", () => {
    const spec = buildFfmpegCommand({
      ...paths(),
      analysis: analysisAt(60),
      options: parsePresetOptions({ preset: "tiktok-safe", fps: 60 }),
      capabilities,
    });
    const filter = spec.args[spec.args.indexOf("-vf") + 1];
    expect(spec.executable).toBe("ffmpeg");
    expect(spec.args).toContain("libx264");
    expect(spec.args).toContain("+faststart+write_colr");
    expect(spec.args).toContain("mp42");
    expect(spec.args).toContain("cfr");
    expect(filter).toContain("fps=fps=60:round=near");
    expect(spec.expected.width).toBe(1080);
    expect(spec.expected.height).toBe(1920);
    expect(spec.redactedArgs).toContain("<private-input>");
  });

  it("uses a tested hardware encoder only for Fast Hardware", () => {
    const spec = buildFfmpegCommand({
      ...paths(),
      analysis: analysisAt(60),
      options: parsePresetOptions({ preset: "tiktok-safe", performance: "fast-hardware" }),
      capabilities,
    });
    expect(spec.encoder).toBe("h264_nvenc");
    expect(spec.args).toContain("vbr");
  });

  it("preserves a square source shape in TikTok Safe", () => {
    const spec = buildFfmpegCommand({
      ...paths(),
      analysis: analysisAt(60, false, 1080, 1080),
      options: parsePresetOptions({ preset: "tiktok-safe", fps: 60 }),
      capabilities,
    });
    expect(spec.expected.width).toBe(1080);
    expect(spec.expected.height).toBe(1080);
    expect(spec.args[spec.args.indexOf("-vf") + 1]).toContain("scale=1080:1080");
  });

  it("offers quality-first 1080p and 2K 60 FPS output without changing aspect ratio", () => {
    const source4k = analysisAt(60, false, 2160, 3840);
    const fullHd = buildFfmpegCommand({
      ...paths(), analysis: source4k,
      options: parsePresetOptions({ preset: "tiktok-safe", fps: 60, resolution: "1080p" }), capabilities,
    });
    const twoK = buildFfmpegCommand({
      ...paths(), analysis: source4k,
      options: parsePresetOptions({ preset: "tiktok-safe", fps: 60, resolution: "2k" }), capabilities,
    });

    expect([fullHd.expected.width, fullHd.expected.height]).toEqual([1080, 1920]);
    expect([twoK.expected.width, twoK.expected.height]).toEqual([1440, 2560]);
    expect(twoK.expected.frameRate).toBe(60);
    expect(twoK.args).toContain("100M");
    expect(twoK.args[twoK.args.indexOf("-crf") + 1]).toBe("12");
    expect(twoK.args[twoK.args.indexOf("-level:v") + 1]).toBe("5.1");

    const twoK30 = buildFfmpegCommand({
      ...paths(), analysis: source4k,
      options: parsePresetOptions({ preset: "tiktok-safe", fps: 30, resolution: "2k" }), capabilities,
    });
    expect(twoK30.args[twoK30.args.indexOf("-level:v") + 1]).toBe("5.1");
  });

  it("keeps anamorphic display shape and does not upscale low-resolution sources", () => {
    const base = analysisAt(30, false, 720, 576);
    const anamorphic = {
      ...base,
      video: {
        ...base.video,
        displayWidth: 720,
        displayHeight: 576,
        dar: 4 / 3,
        sar: "16:15",
      },
    };
    const spec = buildFfmpegCommand({
      ...paths(), analysis: anamorphic,
      options: parsePresetOptions({ preset: "tiktok-safe", fps: 60, resolution: "2k" }), capabilities,
    });
    expect([spec.expected.width, spec.expected.height]).toEqual([768, 576]);
    expect(spec.args[spec.args.indexOf("-vf") + 1]).toContain("scale=768:576");
  });

  it("preserves a landscape source shape without needless upscaling", () => {
    const landscape = buildFfmpegCommand({
      ...paths(), analysis: analysisAt(60, false, 1920, 1080),
      options: parsePresetOptions({ preset: "maximum-quality" }), capabilities,
    });
    expect([landscape.expected.width, landscape.expected.height]).toEqual([1920, 1080]);
  });

  it("preserves supported HDR only in HEVC Main10 Maximum Quality", () => {
    const spec = buildFfmpegCommand({
      ...paths(),
      analysis: analysisAt(60, true),
      options: parsePresetOptions({ preset: "maximum-quality", codec: "hevc", preserveHdr: true }),
      capabilities,
    });
    expect(spec.expected.pixelFormat).toBe("yuv420p10le");
    expect(spec.expected.color.transfer).toBe("smpte2084");
    expect(spec.args).toContain("main10");
    expect(spec.disclosures.join(" ")).not.toMatch(/tone-mapped/);
  });

  it("preserves a 4K source and uses the high-quality 4K rate policy", () => {
    const source4k = analysisAt(60, false, 2160, 3840);
    const spec = buildFfmpegCommand({
      ...paths(), analysis: source4k,
      options: parsePresetOptions({ preset: "maximum-quality", codec: "h264" }), capabilities,
    });
    expect([spec.expected.width, spec.expected.height]).toEqual([2160, 3840]);
    expect(spec.args).toContain("110M");
    expect(spec.args[spec.args.indexOf("-crf") + 1]).toBe("14");
  });

  it("caps a long high-quality export below the documented four-gigabyte upload ceiling", () => {
    const source = analysisAt(60, false, 2160, 3840);
    const analysis = { ...source, file: { ...source.file, durationSeconds: 600 } };
    const spec = buildFfmpegCommand({
      ...paths(), analysis,
      options: parsePresetOptions({ preset: "maximum-quality", codec: "h264" }), capabilities,
    });
    expect(spec.estimatedSize.upperBoundBytes).toBeLessThan(4 * 1024 ** 3);
    expect(spec.disclosures.join(" ")).toContain("4 GB upload limit");
  });

  it("labels 120 FPS duplication and optical-flow interpolation honestly", () => {
    const duplicate = buildFfmpegCommand({
      ...paths(),
      analysis: analysisAt(60),
      options: parsePresetOptions({ preset: "master-120", cadence: "duplicate", resolution: "1080p" }),
      capabilities,
    });
    expect(duplicate.expected.frameSynthesis).toBe("duplication");
    expect([duplicate.expected.width, duplicate.expected.height]).toEqual([1080, 1920]);
    expect(duplicate.expected.frameRate).toBe(120);
    expect(duplicate.args[duplicate.args.indexOf("-vf") + 1]).toContain("fps=fps=120");
    expect(duplicate.args[duplicate.args.indexOf("-video_track_timescale") + 1]).toBe("120000");
    expect(duplicate.disclosures.join(" ")).toMatch(/not native 120 FPS/);

    const optical = buildFfmpegCommand({
      ...paths(),
      analysis: analysisAt(60, false, 2160, 3840),
      options: parsePresetOptions({ preset: "master-120", cadence: "optical-flow", resolution: "2k" }),
      capabilities,
    });
    expect(optical.expected.frameSynthesis).toBe("optical-flow");
    expect([optical.expected.width, optical.expected.height]).toEqual([1440, 2560]);
    const opticalFilter = optical.args[optical.args.indexOf("-vf") + 1];
    expect(opticalFilter).toContain("tpad=stop_mode=clone:stop_duration=1");
    expect(opticalFilter).toContain("minterpolate=fps=120");
    expect(opticalFilter).toContain("trim=duration=1");
    expect(opticalFilter.indexOf("scale=1440:2560")).toBeLessThan(opticalFilter.indexOf("minterpolate=fps=120"));
  });

  it("rejects native 120 claims for a measured 60 FPS source", () => {
    expect(() =>
      buildFfmpegCommand({
        ...paths(),
        analysis: analysisAt(60),
        options: parsePresetOptions({ preset: "master-120", cadence: "native" }),
        capabilities,
      }),
    ).toThrow(MediaConfigurationError);
  });

  it("honestly conforms a measured 240 FPS source down to CFR 120", () => {
    const spec = buildFfmpegCommand({
      ...paths(),
      analysis: analysisAt(240),
      options: parsePresetOptions({ preset: "master-120", cadence: "native", resolution: "1080p" }),
      capabilities,
    });
    expect(spec.expected.frameRate).toBe(120);
    expect(spec.expected.frameSynthesis).toBe("cadence-conform");
    expect(spec.args[spec.args.indexOf("-vf") + 1]).toContain("fps=fps=120");
    expect(spec.disclosures.join(" ")).toMatch(/without claiming native 120 FPS/);
  });

  it("rejects unknown/raw command options rather than forwarding them", () => {
    expect(() =>
      parsePresetOptions({
        preset: "tiktok-safe",
        fps: 60,
        codec: "copy; calc.exe",
        filter: "movie=https://example.invalid",
      }),
    ).toThrow();
  });

  it("rejects traversal before a path can reach command argv", () => {
    const root = path.resolve(process.cwd(), "work", "contained-root");
    expect(() => trustedPathWithin(root, path.resolve(root, "..", "escape.upload"))).toThrow();
  });

  it("builds remux argv without frame-rate flags or filters", () => {
    const spec = buildFfmpegCommand({
      ...paths(),
      analysis: analysisAt(60),
      options: parsePresetOptions({ preset: "lossless-remux" }),
      capabilities,
    });
    expect(spec.encoder).toBe("copy");
    expect(spec.args).toContain("+faststart+write_colr");
    expect(spec.args).toContain("mp42");
    expect(spec.args).not.toContain("-r");
    expect(spec.args).not.toContain("-vf");
    expect(spec.args).not.toContain("-filter_complex");
    expect(spec.estimatedSize.upperBoundBytes).toBeGreaterThan(0);
  });
});
