import { describe, expect, it } from "vitest";

import {
  MediaAnalysisSchema,
  analyzePacketRecords,
  parseFfprobeAnalysis,
  parseRational,
} from "../lib/media";

function rawProbe(overrides: Record<string, unknown> = {}) {
  return {
    streams: [
      {
        index: 0,
        codec_name: "h264",
        codec_type: "video",
        profile: "High",
        level: 42,
        width: 1080,
        height: 1920,
        sample_aspect_ratio: "1:1",
        display_aspect_ratio: "9:16",
        pix_fmt: "yuv420p",
        field_order: "progressive",
        color_range: "tv",
        color_space: "bt709",
        color_transfer: "bt709",
        color_primaries: "bt709",
        r_frame_rate: "60/1",
        avg_frame_rate: "60/1",
        time_base: "1/60000",
        duration: "1.0",
        bit_rate: "12000000",
        nb_frames: "60",
        nb_read_packets: "60",
        disposition: { default: 1, attached_pic: 0 },
        ...overrides,
      },
      {
        index: 1,
        codec_name: "aac",
        codec_type: "audio",
        sample_rate: "48000",
        channels: 2,
        channel_layout: "stereo",
        duration: "1.0",
        bit_rate: "192000",
        disposition: { default: 1 },
      },
    ],
    format: {
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      duration: "1.0",
      size: "1500000",
      bit_rate: "12192000",
      probe_score: 100,
    },
  };
}

function constantPackets(rate = 60, count = 60) {
  return Array.from({ length: count }, (_, index) => ({
    pts: index / rate,
    dts: index / rate,
    duration: 1 / rate,
    size: 20_000,
    keyframe: index % (rate * 2) === 0,
  }));
}

describe("rational and FFprobe analysis", () => {
  it("parses safe rational rates and rejects invalid values", () => {
    expect(parseRational("30000/1001")?.value).toBeCloseTo(29.97003, 5);
    expect(parseRational("0/0")).toBeUndefined();
    expect(parseRational("not-a-rate")).toBeUndefined();
  });

  it("uses measured packet cadence and produces a strict compatible analysis", () => {
    const timing = analyzePacketRecords(constantPackets(), 1 / 60_000);
    const analysis = parseFfprobeAnalysis(rawProbe(), {
      packetTiming: timing,
      fileBytes: 1_500_000,
      sha256: "a".repeat(64),
      mp4: {
        valid: true,
        isIsoBmff: true,
        webOptimized: true,
        fragmented: false,
        atoms: [],
        compatibleBrands: ["isom"],
        errors: [],
      },
    });

    expect(analysis.video.fps.kind).toBe("constant");
    expect(analysis.video.fps.measured).toBeCloseTo(60, 5);
    expect(analysis.video.level).toBe("4.2");
    expect(analysis.remux.eligible).toBe(true);
    expect(MediaAnalysisSchema.safeParse({ ...analysis, unexpected: true }).success).toBe(false);
  });

  it("does not treat legitimate tiny predicted packets as fake frame metadata", () => {
    const packets = constantPackets().map((packet, index) => ({
      ...packet,
      size: index < 3 ? 8 : packet.size,
    }));
    const analysis = parseFfprobeAnalysis(rawProbe(), {
      packetTiming: analyzePacketRecords(packets, 1 / 60_000),
    });

    expect(analysis.timing.tinyVideoPacketCount).toBe(3);
    expect(analysis.timing.suspiciousFrameMetadata).toBe(false);
  });

  it("flags declared cadence and frame-count mismatches", () => {
    const cadenceMismatch = parseFfprobeAnalysis(rawProbe(), {
      packetTiming: analyzePacketRecords(constantPackets(30), 1 / 60_000),
    });
    const countMismatch = parseFfprobeAnalysis(rawProbe(), {
      packetTiming: analyzePacketRecords(constantPackets(60, 50), 1 / 60_000),
    });

    expect(cadenceMismatch.timing.suspiciousFrameMetadata).toBe(true);
    expect(countMismatch.timing.suspiciousFrameMetadata).toBe(true);
  });

  it("detects real VFR rather than trusting avg_frame_rate", () => {
    let pts = 0;
    const records = Array.from({ length: 90 }, (_, index) => {
      const duration = index % 2 === 0 ? 1 / 24 : 1 / 30;
      const record = { pts, dts: pts, duration, size: 10_000, keyframe: index === 0 };
      pts += duration;
      return record;
    });
    const timing = analyzePacketRecords(records, 1 / 90_000);
    const analysis = parseFfprobeAnalysis(
      rawProbe({ avg_frame_rate: "2700/100", r_frame_rate: "30/1", nb_frames: "90", nb_read_packets: "90" }),
      { packetTiming: timing },
    );

    expect(timing.kind).toBe("variable");
    expect(analysis.warnings.map((warning) => warning.code)).toContain("VARIABLE_FRAME_RATE");
    expect(analysis.remux.eligible).toBe(false);
  });

  it("normalises display rotation and swaps display dimensions", () => {
    const analysis = parseFfprobeAnalysis(
      rawProbe({ side_data_list: [{ side_data_type: "Display Matrix", rotation: -90 }] }),
      { packetTiming: analyzePacketRecords(constantPackets()) },
    );
    expect(analysis.video.rotation).toBe(270);
    expect(analysis.video.displayWidth).toBe(1920);
    expect(analysis.video.displayHeight).toBe(1080);
    expect(analysis.remux.blockers.join(" ")).toMatch(/Rotation metadata/);
  });
});
