import type { AnalysisWarning, MediaAnalysis, PacketTimingSummary } from "./contracts";
import { MediaAnalysisSchema } from "./contracts";
import type { Mp4AtomScan } from "./mp4-atoms";
import { RawFfprobeSchema, selectPrimaryAudioStream, selectPrimaryVideoStream } from "./probe-schema";
import type { RawFfprobeStream } from "./probe-schema";
import { formatCodecLevel, parseFiniteNumber, parseRational, parseSafeInteger } from "./rational";
import { evaluateRemuxEligibility } from "./remux";

export interface AnalysisSupplementalData {
  readonly fileBytes?: number;
  readonly sha256?: string;
  readonly mp4?: Mp4AtomScan;
  readonly packetTiming?: PacketTimingSummary;
}

export class MediaProbeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaProbeParseError";
  }
}

function streamIndex(stream: RawFfprobeStream): number {
  const index = parseSafeInteger(stream.index);
  if (index === undefined) throw new MediaProbeParseError("FFprobe returned an invalid stream index.");
  return index;
}

function parseDisplayRatio(value: string | undefined): number | undefined {
  if (!value || value === "N/A" || value === "0:1") return undefined;
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match) return undefined;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  const ratio = numerator / denominator;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : undefined;
}

function normaliseRotation(value: unknown): 0 | 90 | 180 | 270 {
  const parsed = parseFiniteNumber(value, Number.NEGATIVE_INFINITY);
  if (parsed === undefined) return 0;
  const normalised = ((Math.round(parsed) % 360) + 360) % 360;
  if (normalised >= 45 && normalised < 135) return 90;
  if (normalised >= 135 && normalised < 225) return 180;
  if (normalised >= 225 && normalised < 315) return 270;
  return 0;
}

function rotationFor(stream: RawFfprobeStream): 0 | 90 | 180 | 270 {
  const displayMatrix = stream.side_data_list?.find(
    (sideData) => sideData.side_data_type === "Display Matrix" || sideData.rotation !== undefined,
  );
  return normaliseRotation(displayMatrix?.rotation ?? stream.tags?.rotate);
}

function isHdr(stream: RawFfprobeStream): boolean {
  return (
    stream.color_transfer === "smpte2084" ||
    stream.color_transfer === "arib-std-b67" ||
    stream.side_data_list?.some((sideData) =>
      ["Mastering display metadata", "Content light level metadata", "DOVI configuration record"].includes(
        sideData.side_data_type ?? "",
      ),
    ) === true
  );
}

function addWarning(
  warnings: AnalysisWarning[],
  warning: AnalysisWarning,
): void {
  if (!warnings.some((existing) => existing.code === warning.code)) warnings.push(warning);
}

export function primaryVideoStreamIndex(rawInput: unknown): number {
  const raw = RawFfprobeSchema.parse(rawInput);
  const video = selectPrimaryVideoStream(raw);
  if (!video) throw new MediaProbeParseError("No usable video stream was detected.");
  return streamIndex(video);
}

export function parseFfprobeAnalysis(
  rawInput: unknown,
  supplemental: AnalysisSupplementalData = {},
): MediaAnalysis {
  const raw = RawFfprobeSchema.parse(rawInput);
  if (raw.error?.string) throw new MediaProbeParseError(raw.error.string);

  const videoStream = selectPrimaryVideoStream(raw);
  if (!videoStream) throw new MediaProbeParseError("No usable video stream was detected.");
  const audioStream = selectPrimaryAudioStream(raw);

  const width = parseSafeInteger(videoStream.width, 1);
  const height = parseSafeInteger(videoStream.height, 1);
  if (!width || !height) throw new MediaProbeParseError("The primary video has invalid dimensions.");

  const codec = videoStream.codec_name?.toLocaleLowerCase("en-US") || "unknown";
  const rotation = rotationFor(videoStream);
  const displayWidth = rotation === 90 || rotation === 270 ? height : width;
  const displayHeight = rotation === 90 || rotation === 270 ? width : height;
  const encodedDar = parseDisplayRatio(videoStream.display_aspect_ratio)
    ?? (width * (parseDisplayRatio(videoStream.sample_aspect_ratio) ?? 1)) / height;
  const displayDar = rotation === 90 || rotation === 270 ? 1 / encodedDar : encodedDar;
  const avgRate = parseRational(videoStream.avg_frame_rate);
  const nominalRate = parseRational(videoStream.r_frame_rate);
  const packetTiming = supplemental.packetTiming;
  const measuredFps = packetTiming?.measuredFps ?? avgRate?.value;

  const streamDuration = parseFiniteNumber(videoStream.duration);
  const formatDuration = parseFiniteNumber(raw.format?.duration);
  const durationSeconds = streamDuration ?? formatDuration ?? 0;
  const videoBitrate = parseFiniteNumber(videoStream.bit_rate);
  const fileBitrate = parseFiniteNumber(raw.format?.bit_rate);
  const fileBytes = supplemental.fileBytes ?? parseSafeInteger(raw.format?.size) ?? 0;
  const audioDuration = audioStream ? parseFiniteNumber(audioStream.duration) : undefined;
  const avDurationDeltaSeconds =
    audioDuration !== undefined && durationSeconds > 0
      ? Math.abs(audioDuration - durationSeconds)
      : undefined;

  const packetCount = packetTiming?.sampleCount;
  const declaredFrames = parseSafeInteger(videoStream.nb_frames);
  const ffprobePacketCount = parseSafeInteger(videoStream.nb_read_packets);
  const cadenceMismatch =
    packetTiming?.measuredFps !== undefined && avgRate !== undefined
      ? Math.abs(packetTiming.measuredFps - avgRate.value) / avgRate.value > 0.02
      : false;
  const countMismatch =
    packetCount !== undefined && declaredFrames !== undefined
      ? Math.abs(packetCount - declaredFrames) > Math.max(3, declaredFrames * 0.005)
      : packetCount !== undefined && ffprobePacketCount !== undefined
        ? Math.abs(packetCount - ffprobePacketCount) > Math.max(3, ffprobePacketCount * 0.005)
        : false;
  const suspiciousFrameMetadata =
    cadenceMismatch || countMismatch ||
    (packetTiming !== undefined &&
      packetTiming.sampleCount > 20 &&
      packetTiming.tinyPacketCount / packetTiming.sampleCount > 0.02);

  const hdr = isHdr(videoStream);
  const timing = {
    missingPts: packetTiming?.missingPts ?? 0,
    missingDts: packetTiming?.missingDts ?? 0,
    nonMonotonicDts: packetTiming?.nonMonotonicDts ?? 0,
    nonPositiveDurations: packetTiming?.nonPositiveDurations ?? 0,
    negativeStart:
      packetTiming?.negativeStart ??
      ((parseFiniteNumber(videoStream.start_time, Number.NEGATIVE_INFINITY) ?? 0) < 0),
    maximumGapSeconds: packetTiming?.maximumGapSeconds,
    maximumKeyframeGapSeconds: packetTiming?.maximumKeyframeGapSeconds,
    avDurationDeltaSeconds,
    suspiciousFrameMetadata,
  };

  const warnings: AnalysisWarning[] = [];
  if (packetTiming?.kind === "variable") {
    addWarning(warnings, {
      code: "VARIABLE_FRAME_RATE",
      severity: "warning",
      message: "The source uses variable frame timing. The encoded 60 FPS export will create an honest constant cadence.",
    });
  }
  if (!new Set(["h264", "hevc"]).has(codec)) {
    addWarning(warnings, {
      code: "UPLOAD_CODEC_REENCODE_REQUIRED",
      severity: "warning",
      message: "The source codec should be re-encoded to H.264 or HEVC for a conservative MP4 upload.",
    });
  }
  if (
    videoStream.pix_fmt &&
    !new Set(["yuv420p", "yuvj420p", "yuv420p10le"]).has(videoStream.pix_fmt)
  ) {
    addWarning(warnings, {
      code: "UNUSUAL_PIXEL_FORMAT",
      severity: "warning",
      message: `Pixel format ${videoStream.pix_fmt} requires conversion for broad upload compatibility.`,
    });
  }
  if (
    timing.missingPts > 0 ||
    timing.missingDts > 0 ||
    timing.nonMonotonicDts > 0 ||
    timing.nonPositiveDurations > 0
  ) {
    addWarning(warnings, {
      code: "TIMESTAMP_ERRORS",
      severity: "error",
      message: "The packet timeline contains missing, nonmonotonic, or invalid timestamps.",
    });
  }
  if (!videoStream.color_primaries || !videoStream.color_transfer || !videoStream.color_space) {
    addWarning(warnings, {
      code: "MISSING_COLOR_METADATA",
      severity: "warning",
      message: "Colour metadata is incomplete. HD SDR processing will use an explicit BT.709 assumption.",
    });
  }
  if (hdr) {
    addWarning(warnings, {
      code: "HDR_TO_SDR_REQUIRED",
      severity: "warning",
      message: "The 60 FPS upload export requires HDR-to-SDR tone mapping; the HEVC 120 FPS master can preserve supported HDR.",
    });
  }
  if (Math.min(displayWidth, displayHeight) < 720 || Math.max(displayWidth, displayHeight) < 1280) {
    addWarning(warnings, {
      code: "LOW_RESOLUTION_SOURCE",
      severity: "warning",
      message: "The source is below 720×1280-equivalent detail and cannot gain native detail by upscaling.",
    });
  }
  const effectiveBitrate = videoBitrate ?? fileBitrate;
  if (effectiveBitrate && measuredFps && width * height > 0) {
    const bitsPerPixelFrame = effectiveBitrate / (width * height * measuredFps);
    const threshold = codec === "hevc" ? 0.012 : 0.025;
    if (bitsPerPixelFrame < threshold) {
      addWarning(warnings, {
        code: "EXTREMELY_LOW_BITRATE",
        severity: "warning",
        message: "The source bitrate is very low for its resolution and cadence; lost detail cannot be restored.",
      });
    }
  }
  if (suspiciousFrameMetadata) {
    addWarning(warnings, {
      code: "INCONSISTENT_FRAME_RATE_METADATA",
      severity: "error",
      message: "Declared frame/sample metadata is inconsistent with the measured packet cadence.",
    });
  }
  if (
    avDurationDeltaSeconds !== undefined &&
    avDurationDeltaSeconds > Math.max(0.25, durationSeconds * 0.01)
  ) {
    addWarning(warnings, {
      code: "AUDIO_VIDEO_DURATION_MISMATCH",
      severity: "warning",
      message: "Audio and video durations differ enough to risk sync or trailing-media problems.",
    });
  }
  if (videoStream.field_order && !["progressive", "unknown"].includes(videoStream.field_order)) {
    addWarning(warnings, {
      code: "INTERLACED_SOURCE",
      severity: "warning",
      message: "The source is interlaced and will be deinterlaced for progressive export.",
    });
  }
  if (rotation !== 0) {
    addWarning(warnings, {
      code: "ROTATION_METADATA",
      severity: "info",
      message: "Rotation metadata will be rendered into the pixels and cleared during re-encoding.",
    });
  }
  const realVideos = raw.streams.filter(
    (stream) => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1 && stream.disposition?.attached_pic !== "1",
  );
  const audios = raw.streams.filter((stream) => stream.codec_type === "audio");
  if (realVideos.length > 1) {
    addWarning(warnings, {
      code: "MULTIPLE_VIDEO_STREAMS",
      severity: "info",
      message: "Only the primary/default video stream will be exported.",
    });
  }
  if (audios.length > 1) {
    addWarning(warnings, {
      code: "MULTIPLE_AUDIO_STREAMS",
      severity: "info",
      message: "Only the primary/default audio stream will be exported.",
    });
  }
  if (supplemental.mp4?.webOptimized === false) {
    addWarning(warnings, {
      code: "NOT_WEB_OPTIMIZED",
      severity: "info",
      message: "The MP4 index is after media data; fast-start export will move it to the beginning.",
    });
  }
  if (supplemental.mp4?.fragmented === true) {
    addWarning(warnings, {
      code: "FRAGMENTED_MP4",
      severity: "warning",
      message: "The source is fragmented MP4; export will create a broadly compatible nonfragmented file.",
    });
  }
  if (measuredFps && (measuredFps < 23 || measuredFps > 60.01)) {
    addWarning(warnings, {
      code: "FRAME_RATE_OUTSIDE_UPLOAD_GUIDANCE",
      severity: "warning",
      message: "The measured cadence is outside TikTok's currently documented 23–60 FPS API range.",
    });
  }

  const provisional: Omit<MediaAnalysis, "remux"> = {
    schemaVersion: 1,
    file: {
      bytes: fileBytes,
      sha256: supplemental.sha256,
      containerNames: (raw.format?.format_name ?? "unknown")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
      durationSeconds,
      bitrate: fileBitrate,
      probeScore: parseFiniteNumber(raw.format?.probe_score),
      webOptimized: supplemental.mp4?.webOptimized ?? null,
      fragmentedMp4: supplemental.mp4?.fragmented ?? null,
    },
    video: {
      streamIndex: streamIndex(videoStream),
      codec,
      profile: videoStream.profile === undefined ? undefined : String(videoStream.profile),
      level: formatCodecLevel(codec, videoStream.level),
      width,
      height,
      displayWidth,
      displayHeight,
      dar: displayDar,
      sar: videoStream.sample_aspect_ratio,
      pixelFormat: videoStream.pix_fmt,
      fieldOrder: videoStream.field_order,
      bitrate: videoBitrate,
      color: {
        primaries: videoStream.color_primaries,
        transfer: videoStream.color_transfer,
        space: videoStream.color_space,
        range: videoStream.color_range,
      },
      rotation,
      fps: {
        avgText: avgRate?.text,
        nominalText: nominalRate?.text,
        measured: measuredFps,
        kind: packetTiming?.kind ?? "indeterminate",
        sampleCount: packetTiming?.sampleCount ?? 0,
      },
    },
    audio: audioStream
      ? {
          streamIndex: streamIndex(audioStream),
          codec: audioStream.codec_name?.toLocaleLowerCase("en-US") || "unknown",
          sampleRate: parseSafeInteger(audioStream.sample_rate, 1),
          channels: parseSafeInteger(audioStream.channels, 1),
          channelLayout: audioStream.channel_layout,
          durationSeconds: audioDuration,
          bitrate: parseFiniteNumber(audioStream.bit_rate),
        }
      : undefined,
    timing,
    hdr,
    warnings,
  };

  return MediaAnalysisSchema.parse({
    ...provisional,
    remux: evaluateRemuxEligibility(provisional),
  });
}
