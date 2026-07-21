import path from "node:path";

import { MediaAnalysisSchema } from "./contracts";
import type { MediaAnalysis } from "./contracts";
import type { EncoderName, MediaCapabilities, OptionalFilterName } from "./hardware";
import { qualityResolutionTier, resolveOutputDimensions } from "./output-dimensions";
import { parsePresetOptions } from "./presets";
import type {
  EnhancementOptions,
  FitMode,
  Master120Options,
  MaximumQualityOptions,
  PerformanceMode,
  PresetOptions,
  TikTokSafeOptions,
} from "./presets";
import { evaluateRemuxEligibility } from "./remux";
import type { TrustedMediaPath } from "./trusted-path";

export type ExportCodec = "h264" | "hevc";
export type FrameSynthesis = "none" | "duplication" | "optical-flow" | "cadence-conform";

export interface ExpectedOutput {
  readonly preset: PresetOptions["preset"];
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly codec: ExportCodec;
  readonly pixelFormat: "yuv420p" | "yuv420p10le";
  readonly frameRateKind: "constant" | "variable";
  readonly frameRate?: number;
  readonly color: {
    readonly primaries: string;
    readonly transfer: string;
    readonly space: string;
    readonly range: "tv" | "pc";
  };
  readonly webOptimized: true;
  readonly progressive: true;
  readonly rotation: 0;
  readonly frameSynthesis: FrameSynthesis;
}

export interface CommandSpec {
  readonly executable: string;
  readonly args: readonly string[];
  readonly redactedArgs: readonly string[];
  readonly expected: ExpectedOutput;
  readonly encoder: EncoderName | "copy";
  readonly disclosures: readonly string[];
  readonly estimatedSize: {
    readonly likelyBytes: number;
    readonly upperBoundBytes: number;
    readonly exceedsFourGiB: boolean;
  };
}

export class MediaConfigurationError extends Error {
  readonly code:
    | "INVALID_PATH"
    | "MISSING_ENCODER"
    | "MISSING_FILTER"
    | "INVALID_CADENCE_MODE"
    | "REMUX_INELIGIBLE";

  constructor(code: MediaConfigurationError["code"], message: string) {
    super(message);
    this.name = "MediaConfigurationError";
    this.code = code;
  }
}

export interface BuildCommandRequest {
  readonly input: TrustedMediaPath;
  readonly output: TrustedMediaPath;
  readonly analysis: MediaAnalysis;
  readonly options: PresetOptions;
  readonly capabilities: MediaCapabilities;
  readonly ffmpegPath?: string;
}

const HARDWARE_BY_CODEC: Record<ExportCodec, readonly EncoderName[]> = {
  h264: ["h264_nvenc", "h264_qsv", "h264_amf", "h264_videotoolbox"],
  hevc: ["hevc_nvenc", "hevc_qsv", "hevc_amf", "hevc_videotoolbox"],
};

const CPU_BY_CODEC: Record<ExportCodec, EncoderName> = {
  h264: "libx264",
  hevc: "libx265",
};

const COLOR_PRIMARIES = new Set([
  "bt709",
  "bt470m",
  "bt470bg",
  "smpte170m",
  "smpte240m",
  "film",
  "bt2020",
  "smpte428",
  "smpte431",
  "smpte432",
]);
const COLOR_TRANSFERS = new Set([
  "bt709",
  "gamma22",
  "gamma28",
  "smpte170m",
  "smpte240m",
  "linear",
  "iec61966-2-1",
  "bt2020-10",
  "bt2020-12",
  "smpte2084",
  "arib-std-b67",
]);
const COLOR_SPACES = new Set([
  "bt709",
  "fcc",
  "bt470bg",
  "smpte170m",
  "smpte240m",
  "ycgco",
  "bt2020nc",
  "bt2020c",
  "ictcp",
]);

function validateExecutable(executable: string): string {
  if (!executable || executable.length > 4_096 || /[\0\r\n]/.test(executable)) {
    throw new MediaConfigurationError("INVALID_PATH", "The configured FFmpeg executable path is invalid.");
  }
  return executable;
}

function validateBrandedPath(value: TrustedMediaPath): string {
  if (!path.isAbsolute(value) || /[\0\r\n]/.test(value)) {
    throw new MediaConfigurationError("INVALID_PATH", "A trusted media path was invalid.");
  }
  return value;
}

function requireFilter(
  filters: ReadonlySet<OptionalFilterName>,
  name: OptionalFilterName,
  reason: string,
): void {
  if (!filters.has(name)) {
    throw new MediaConfigurationError("MISSING_FILTER", `${reason} requires FFmpeg's ${name} filter.`);
  }
}

function resolveEncoder(
  codec: ExportCodec,
  performance: PerformanceMode,
  capabilities: MediaCapabilities,
  disclosures: string[],
): EncoderName {
  const available = new Set(capabilities.encoders);
  const cpu = CPU_BY_CODEC[codec];
  if (performance === "fast-hardware") {
    const hardware = HARDWARE_BY_CODEC[codec].find((encoder) => available.has(encoder));
    if (hardware) return hardware;
    if (available.has(cpu)) {
      disclosures.push("No usable hardware encoder was detected; this export falls back to the CPU encoder.");
      return cpu;
    }
  } else if (available.has(cpu)) {
    return cpu;
  }

  throw new MediaConfigurationError(
    "MISSING_ENCODER",
    `No validated ${codec === "h264" ? "H.264" : "HEVC"} encoder is available.`,
  );
}

interface ResolvedColor {
  primaries: string;
  transfer: string;
  space: string;
  range: "tv" | "pc";
}

function preserveOrAssumeColor(analysis: MediaAnalysis, disclosures: string[]): ResolvedColor {
  const primaries = COLOR_PRIMARIES.has(analysis.video.color.primaries ?? "")
    ? analysis.video.color.primaries!
    : undefined;
  const transfer = COLOR_TRANSFERS.has(analysis.video.color.transfer ?? "")
    ? analysis.video.color.transfer!
    : undefined;
  const space = COLOR_SPACES.has(analysis.video.color.space ?? "")
    ? analysis.video.color.space!
    : undefined;
  const range = ["pc", "jpeg"].includes(analysis.video.color.range ?? "") ? "pc" : "tv";
  if (!primaries || !transfer || !space) {
    disclosures.push("Incomplete source colour metadata was resolved with an explicit BT.709 SDR assumption.");
    return { primaries: "bt709", transfer: "bt709", space: "bt709", range };
  }
  return { primaries, transfer, space, range };
}

function sourceNeedsBt709Conversion(analysis: MediaAnalysis): boolean {
  const color = analysis.video.color;
  return (
    (color.primaries !== undefined && color.primaries !== "bt709") ||
    (color.transfer !== undefined && color.transfer !== "bt709") ||
    (color.space !== undefined && color.space !== "bt709") ||
    color.range === "pc" ||
    color.range === "jpeg"
  );
}

function fixed(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function enhancementFilters(
  enhancements: EnhancementOptions,
  filters: ReadonlySet<OptionalFilterName>,
): string[] {
  const result: string[] = [];
  if (enhancements.denoise > 0) {
    requireFilter(filters, "hqdn3d", "Denoising");
    const luma = 0.5 + enhancements.denoise * 2.5;
    result.push(`hqdn3d=${fixed(luma)}:${fixed(luma * 0.75)}:${fixed(luma * 1.5)}:${fixed(luma * 1.125)}`);
  }
  if (enhancements.deband > 0) {
    requireFilter(filters, "deband", "Debanding");
    const threshold = 0.004 + enhancements.deband * 0.008;
    const range = Math.round(8 + enhancements.deband * 12);
    result.push(
      `deband=1thr=${fixed(threshold)}:2thr=${fixed(threshold)}:3thr=${fixed(threshold)}:4thr=${fixed(threshold)}:range=${range}:blur=1`,
    );
  }
  if (
    enhancements.brightness !== 0 ||
    enhancements.contrast !== 1 ||
    enhancements.saturation !== 1 ||
    enhancements.gamma !== 1
  ) {
    result.push(
      `eq=brightness=${fixed(enhancements.brightness)}:contrast=${fixed(enhancements.contrast)}:saturation=${fixed(enhancements.saturation)}:gamma=${fixed(enhancements.gamma)}`,
    );
  }
  return result;
}

function sharpenFilter(amount: number): string | undefined {
  return amount > 0 ? `unsharp=5:5:${fixed(amount)}:5:5:0` : undefined;
}

function geometryFilters(
  width: number,
  height: number,
  fitMode: Exclude<FitMode, "blurred-background">,
  scaling: "lanczos" | "bicubic",
): string[] {
  if (fitMode === "crop") {
    return [
      `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=${scaling}`,
      `crop=${width}:${height}`,
    ];
  }
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=${scaling}`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
  ];
}

function buildFilterGraph(params: {
  analysis: MediaAnalysis;
  width: number;
  height: number;
  fitMode: FitMode;
  scaling: "lanczos" | "bicubic";
  enhancements: EnhancementOptions;
  toneMap: boolean;
  toneMapAlgorithm: "mobius" | "hable";
  convertSdrToBt709: boolean;
  frameFilter?: string;
  frameFilterBeforeGeometry?: boolean;
  pixelFormat: "yuv420p" | "yuv420p10le";
  filters: ReadonlySet<OptionalFilterName>;
}): { args: string[]; filteredLabel?: string } {
  const beforeGeometry: string[] = [];
  const afterGeometry: string[] = [];
  const fieldOrder = params.analysis.video.fieldOrder;
  if (fieldOrder && !["progressive", "unknown"].includes(fieldOrder)) {
    requireFilter(params.filters, "bwdif", "Progressive conversion");
    beforeGeometry.push("bwdif=mode=send_frame:parity=auto:deint=all");
  }
  if (params.analysis.video.sar && !["1:1", "N/A"].includes(params.analysis.video.sar)) {
    beforeGeometry.push(`scale=w='trunc(iw*sar/2)*2':h=ih:flags=${params.scaling}`, "setsar=1");
  }
  if (params.toneMap) {
    requireFilter(params.filters, "zscale", "HDR-to-SDR conversion");
    requireFilter(params.filters, "tonemap", "HDR-to-SDR conversion");
    beforeGeometry.push(
      "zscale=t=linear:npl=100",
      "format=gbrpf32le",
      "zscale=p=bt709",
      `tonemap=tonemap=${params.toneMapAlgorithm}:desat=0`,
      "zscale=t=bt709:m=bt709:r=limited",
    );
  } else if (params.convertSdrToBt709) {
    requireFilter(params.filters, "zscale", "Standards-correct BT.709 colour conversion");
    beforeGeometry.push("zscale=p=bt709:t=bt709:m=bt709:r=limited");
  }
  beforeGeometry.push(...enhancementFilters(params.enhancements, params.filters));
  if (params.frameFilter && params.frameFilterBeforeGeometry) beforeGeometry.push(params.frameFilter);
  if (params.frameFilter && !params.frameFilterBeforeGeometry) afterGeometry.push(params.frameFilter);
  const sharpen = sharpenFilter(params.enhancements.sharpening);
  if (sharpen) afterGeometry.push(sharpen);
  afterGeometry.push("setpts=PTS-STARTPTS", "setsar=1", `format=${params.pixelFormat}`);

  if (params.fitMode !== "blurred-background") {
    const chain = [
      ...beforeGeometry,
      ...geometryFilters(params.width, params.height, params.fitMode, params.scaling),
      ...afterGeometry,
    ].join(",");
    return { args: ["-vf", chain] };
  }

  const source = `[0:${params.analysis.video.streamIndex}]`;
  const prefix = beforeGeometry.length > 0 ? `${beforeGeometry.join(",")},` : "";
  const suffix = afterGeometry.length > 0 ? `,${afterGeometry.join(",")}` : "";
  const graph = [
    `${source}${prefix}split=2[background][foreground]`,
    `[background]scale=${params.width}:${params.height}:force_original_aspect_ratio=increase:flags=${params.scaling},crop=${params.width}:${params.height},boxblur=luma_radius=30:luma_power=1[blurred]`,
    `[foreground]scale=${params.width}:${params.height}:force_original_aspect_ratio=decrease:flags=${params.scaling}[front]`,
    `[blurred][front]overlay=(W-w)/2:(H-h)/2${suffix}[vout]`,
  ].join(";");
  return { args: ["-filter_complex", graph], filteredLabel: "[vout]" };
}

interface RateControl {
  target: string;
  maximum: string;
  buffer: string;
  cpuCrf: number;
}

function safeQualityRate(width: number, height: number, fps: 30 | 60): RateControl {
  const tier = qualityResolutionTier(width, height);
  if (tier === "small") {
    return fps === 60
      ? { target: "12M", maximum: "20M", buffer: "40M", cpuCrf: 12 }
      : { target: "8M", maximum: "14M", buffer: "28M", cpuCrf: 12 };
  }
  if (tier === "1080p") {
    return fps === 60
      ? { target: "20M", maximum: "28M", buffer: "56M", cpuCrf: 12 }
      : { target: "12M", maximum: "20M", buffer: "40M", cpuCrf: 12 };
  }
  return fps === 60
    ? { target: "30M", maximum: "45M", buffer: "90M", cpuCrf: 12 }
    : { target: "20M", maximum: "32M", buffer: "64M", cpuCrf: 12 };
}

function masterQualityRate(width: number, height: number, codec: ExportCodec): RateControl {
  const tier = qualityResolutionTier(width, height);
  if (tier === "small") {
    return codec === "h264"
      ? { target: "24M", maximum: "40M", buffer: "80M", cpuCrf: 14 }
      : { target: "18M", maximum: "30M", buffer: "60M", cpuCrf: 15 };
  }
  if (tier === "1080p") {
    return codec === "h264"
      ? { target: "48M", maximum: "75M", buffer: "150M", cpuCrf: 14 }
      : { target: "36M", maximum: "58M", buffer: "116M", cpuCrf: 15 };
  }
  return codec === "h264"
    ? { target: "72M", maximum: "110M", buffer: "220M", cpuCrf: 14 }
    : { target: "54M", maximum: "85M", buffer: "170M", cpuCrf: 15 };
}

function bitrateBitsPerSecond(value: string): number {
  const match = /^(\d+(?:\.\d+)?)([kM])$/.exec(value);
  if (!match) throw new Error("Internal bitrate constant is invalid.");
  return Number(match[1]) * (match[2] === "M" ? 1_000_000 : 1_000);
}

function estimatedEncodedSize(
  durationSeconds: number,
  rate: RateControl,
  audioBitrate: string,
): CommandSpec["estimatedSize"] {
  const audio = bitrateBitsPerSecond(audioBitrate);
  const likelyBytes = Math.ceil(((bitrateBitsPerSecond(rate.target) + audio) * durationSeconds * 1.03) / 8);
  const upperBoundBytes = Math.ceil(((bitrateBitsPerSecond(rate.maximum) + audio) * durationSeconds * 1.05) / 8);
  return {
    likelyBytes,
    upperBoundBytes,
    exceedsFourGiB: upperBoundBytes > 4 * 1024 ** 3,
  };
}

/** Keeps encoded delivery files below TikTok's documented 4 GB upload ceiling. */
function uploadSizedRate(
  rate: RateControl,
  durationSeconds: number,
  audioBitrate: string,
  disclosures: string[],
): RateControl {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return rate;
  const uploadBudgetBits = 3.8 * 1024 ** 3 * 8;
  const containerAllowance = 0.97;
  const availableVideoBps = Math.floor((uploadBudgetBits / durationSeconds) * containerAllowance - bitrateBitsPerSecond(audioBitrate));
  const currentMaximum = bitrateBitsPerSecond(rate.maximum);
  if (availableVideoBps >= currentMaximum) return rate;
  const cappedMaximumMbps = Math.max(2, Math.floor(availableVideoBps / 1_000_000));
  const currentTargetMbps = bitrateBitsPerSecond(rate.target) / 1_000_000;
  const cappedTargetMbps = Math.max(1, Math.min(currentTargetMbps, Math.floor(cappedMaximumMbps * 0.82)));
  disclosures.push("The video rate is capped so the projected MP4 remains below TikTok's documented 4 GB upload limit.");
  return {
    ...rate,
    target: `${cappedTargetMbps}M`,
    maximum: `${cappedMaximumMbps}M`,
    buffer: `${cappedMaximumMbps * 2}M`,
  };
}

function encoderArgs(
  encoder: EncoderName,
  codec: ExportCodec,
  performance: PerformanceMode,
  rate: RateControl,
): string[] {
  const common = ["-c:v", encoder];
  if (encoder === "libx264" || encoder === "libx265") {
    const cpuPreset = performance === "maximum-cpu"
      ? "slow"
      : performance === "balanced"
        ? "medium"
        : "fast";
    return [
      ...common,
      "-preset",
      cpuPreset,
      "-crf",
      String(rate.cpuCrf),
      "-maxrate",
      rate.maximum,
      "-bufsize",
      rate.buffer,
    ];
  }
  if (encoder.endsWith("_nvenc")) {
    return [
      ...common,
      "-preset",
      "p6",
      "-rc",
      "vbr",
      "-cq",
      String(rate.cpuCrf + 1),
      "-b:v",
      rate.target,
      "-maxrate",
      rate.maximum,
      "-bufsize",
      rate.buffer,
    ];
  }
  if (encoder.endsWith("_qsv")) {
    return [
      ...common,
      "-preset",
      "medium",
      "-b:v",
      rate.target,
      "-maxrate",
      rate.maximum,
      "-bufsize",
      rate.buffer,
    ];
  }
  if (encoder.endsWith("_amf")) {
    return [
      ...common,
      "-quality",
      "balanced",
      "-rc",
      "vbr_peak",
      "-b:v",
      rate.target,
      "-maxrate",
      rate.maximum,
      "-bufsize",
      rate.buffer,
    ];
  }
  return [...common, "-b:v", rate.target, "-maxrate", rate.maximum, "-bufsize", rate.buffer];
}

function outputColorArgs(color: ResolvedColor): string[] {
  return [
    "-color_primaries",
    color.primaries,
    "-color_trc",
    color.transfer,
    "-colorspace",
    color.space,
    "-color_range",
    color.range,
  ];
}

function audioArgs(
  analysis: MediaAnalysis,
  enhancements: EnhancementOptions,
  filters: ReadonlySet<OptionalFilterName>,
  bitrate: string,
): string[] {
  if (!analysis.audio) return [];
  const chain: string[] = [];
  if (enhancements.audioNormalize) {
    requireFilter(filters, "loudnorm", "Audio normalisation");
    chain.push("loudnorm=I=-16:LRA=11:TP=-1.5:linear=true");
  }
  const async =
    analysis.timing.avDurationDeltaSeconds !== undefined && analysis.timing.avDurationDeltaSeconds > 0.05
      ? ":async=1000"
      : "";
  chain.push(`aresample=48000${async}:first_pts=0`, "apad");
  return [
    "-map",
    `0:${analysis.audio.streamIndex}?`,
    "-af",
    chain.join(","),
    "-c:a",
    "aac",
    "-profile:a",
    "aac_low",
    "-b:a",
    bitrate,
    "-ar",
    "48000",
    "-ac",
    "2",
    "-shortest",
  ];
}

function commonInput(executable: string, input: string): { executable: string; args: string[] } {
  return {
    executable,
    args: [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-n",
      "-progress",
      "pipe:1",
      "-nostats",
      "-protocol_whitelist",
      "file",
      "-i",
      input,
    ],
  };
}

function finishMp4(args: string[], output: string): void {
  args.push(
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-sn",
    "-dn",
    "-avoid_negative_ts",
    "make_zero",
    "-movflags",
    "+faststart",
    "-brand",
    "mp42",
    "-metadata:s:v:0",
    "rotate=0",
    "-f",
    "mp4",
    output,
  );
}

function sourceAspectDimensions(analysis: MediaAnalysis, quality: "safe" | "2k" | "ultra") {
  return resolveOutputDimensions(
    analysis.video,
    quality === "safe" ? "1080p" : quality === "2k" ? "2k" : "4k",
  );
}

function h264Level(
  width: number,
  height: number,
  frameRate: number,
): "4.2" | "5.1" | "5.2" | "6.0" | "6.1" | "6.2" {
  const frameMacroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const macroblocksPerSecond = frameMacroblocks * frameRate;
  if (frameMacroblocks <= 8_704 && macroblocksPerSecond <= 522_240) return "4.2";
  if (frameMacroblocks <= 36_864 && macroblocksPerSecond <= 983_040) return "5.1";
  if (frameMacroblocks <= 36_864 && macroblocksPerSecond <= 2_073_600) return "5.2";
  if (frameMacroblocks <= 139_264 && macroblocksPerSecond <= 4_177_920) return "6.0";
  if (frameMacroblocks <= 139_264 && macroblocksPerSecond <= 8_355_840) return "6.1";
  return "6.2";
}

function buildEncoded(
  executable: string,
  input: string,
  output: string,
  analysis: MediaAnalysis,
  options: TikTokSafeOptions | MaximumQualityOptions | Master120Options,
  capabilities: MediaCapabilities,
  resolved: {
    width: number;
    height: number;
    codec: ExportCodec;
    frameRate?: number;
    frameRateKind: "constant" | "variable";
    frameFilter?: string;
    frameFilterBeforeGeometry?: boolean;
    synthesis: FrameSynthesis;
    rate: RateControl;
    audioBitrate: string;
    preserveHdr: boolean;
  },
  disclosures: string[],
): CommandSpec {
  const availableFilters = new Set(capabilities.filters);
  const encoder = resolveEncoder(resolved.codec, options.performance, capabilities, disclosures);
  const preserveHdr = analysis.hdr && resolved.preserveHdr && resolved.codec === "hevc";
  const toneMap = analysis.hdr && !preserveHdr;
  if (analysis.hdr && options.preset !== "tiktok-safe" && resolved.preserveHdr && resolved.codec === "h264") {
    disclosures.push("H.264 High/yuv420p cannot preserve this HDR source; the export is tone-mapped to SDR.");
  }
  if (toneMap) disclosures.push("HDR is tone-mapped to conservative BT.709 SDR; the output is not HDR.");
  const pixelFormat: "yuv420p" | "yuv420p10le" = preserveHdr ? "yuv420p10le" : "yuv420p";
  const preservedColor = preserveOrAssumeColor(analysis, disclosures);
  const outputColor: ResolvedColor = toneMap || options.preset === "tiktok-safe"
    ? { primaries: "bt709", transfer: "bt709", space: "bt709", range: "tv" }
    : preservedColor;
  const convertSdrToBt709 =
    !analysis.hdr && options.preset === "tiktok-safe" && sourceNeedsBt709Conversion(analysis);
  if (convertSdrToBt709) disclosures.push("Source SDR colour is converted to BT.709 rather than merely relabelled.");

  const toneAlgorithm = options.toneMap === "hable" ? "hable" : "mobius";
  const graph = buildFilterGraph({
    analysis,
    width: resolved.width,
    height: resolved.height,
    fitMode: options.fitMode,
    scaling: options.scaling,
    enhancements: options.enhancements,
    toneMap,
    toneMapAlgorithm: toneAlgorithm,
    convertSdrToBt709,
    frameFilter: resolved.frameFilter,
    frameFilterBeforeGeometry: resolved.frameFilterBeforeGeometry,
    pixelFormat,
    filters: availableFilters,
  });

  const command = commonInput(executable, input);
  const deliveryRate = uploadSizedRate(resolved.rate, analysis.file.durationSeconds, resolved.audioBitrate, disclosures);
  command.args.push(...graph.args);
  command.args.push("-map", graph.filteredLabel ?? `0:${analysis.video.streamIndex}`);
  command.args.push(...encoderArgs(encoder, resolved.codec, options.performance, deliveryRate));
  command.args.push("-pix_fmt", pixelFormat);
  if (resolved.codec === "h264") {
    command.args.push("-profile:v", "high");
    command.args.push(
      "-level:v",
      h264Level(resolved.width, resolved.height, resolved.frameRate ?? analysis.video.fps.measured ?? 60),
    );
  } else {
    command.args.push("-profile:v", pixelFormat === "yuv420p10le" ? "main10" : "main", "-tag:v", "hvc1");
  }

  const gopFps = resolved.frameRate ?? analysis.video.fps.measured ?? 60;
  const gop = Math.max(24, Math.min(600, Math.round(gopFps * 2)));
  command.args.push(
    "-g",
    String(gop),
    "-flags",
    "+cgop",
    "-force_key_frames",
    "expr:gte(t,n_forced*2)",
    "-field_order:v",
    "progressive",
  );
  if (encoder === "libx264") {
    command.args.push("-keyint_min", String(Math.max(1, Math.round(gop / 2))), "-sc_threshold", "40");
  }
  command.args.push(
    "-fps_mode:v:0",
    resolved.frameRateKind === "constant" ? "cfr" : "passthrough",
  );
  if (resolved.frameRate === 30 || resolved.frameRate === 60) {
    command.args.push("-video_track_timescale", "60000");
  } else if (resolved.frameRate === 120) {
    command.args.push("-video_track_timescale", "120000");
  }
  command.args.push(...outputColorArgs(outputColor));
  command.args.push(...audioArgs(analysis, options.enhancements, availableFilters, resolved.audioBitrate));
  finishMp4(command.args, output);
  const estimatedSize = estimatedEncodedSize(
    analysis.file.durationSeconds,
    deliveryRate,
    resolved.audioBitrate,
  );
  if (estimatedSize.exceedsFourGiB) {
    disclosures.push("The conservative upper size estimate exceeds 4 GiB; check free disk space before processing.");
  }

  return {
    executable: command.executable,
    args: command.args,
    redactedArgs: command.args.map((argument) =>
      argument === input ? "<private-input>" : argument === output ? "<private-output>" : argument,
    ),
    encoder,
    disclosures,
    estimatedSize,
    expected: {
      preset: options.preset,
      durationSeconds: analysis.file.durationSeconds,
      width: resolved.width,
      height: resolved.height,
      codec: resolved.codec,
      pixelFormat,
      frameRateKind: resolved.frameRateKind,
      frameRate: resolved.frameRate,
      color: outputColor,
      webOptimized: true,
      progressive: true,
      rotation: 0,
      frameSynthesis: resolved.synthesis,
    },
  };
}

function buildRemux(
  executable: string,
  input: string,
  output: string,
  analysis: MediaAnalysis,
): CommandSpec {
  const decision = evaluateRemuxEligibility(analysis);
  if (!decision.eligible) {
    throw new MediaConfigurationError("REMUX_INELIGIBLE", decision.blockers.join(" "));
  }
  const command = commonInput(executable, input);
  command.args.push(
    "-map",
    `0:${analysis.video.streamIndex}`,
  );
  if (analysis.audio) command.args.push("-map", `0:${analysis.audio.streamIndex}?`);
  command.args.push(
    "-c",
    "copy",
    "-copytb",
    "1",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
  );
  if (analysis.timing.negativeStart) {
    command.args.push("-avoid_negative_ts", "make_zero");
  }
  command.args.push("-movflags", "+faststart", "-brand", "mp42");
  if (analysis.video.codec === "hevc") command.args.push("-tag:v", "hvc1");
  command.args.push("-f", "mp4", output);
  const color = preserveOrAssumeColor(analysis, []);
  const likelyBytes = Math.ceil(analysis.file.bytes * 1.01);
  const upperBoundBytes = Math.ceil(analysis.file.bytes * 1.05);
  const remuxDisclosures = [...decision.warnings];
  if (upperBoundBytes > 4 * 1024 ** 3) {
    remuxDisclosures.push("The output is expected to exceed 4 GiB; check free disk space before processing.");
  }
  return {
    executable,
    args: command.args,
    redactedArgs: command.args.map((argument) =>
      argument === input ? "<private-input>" : argument === output ? "<private-output>" : argument,
    ),
    encoder: "copy",
    disclosures: remuxDisclosures,
    estimatedSize: {
      likelyBytes,
      upperBoundBytes,
      exceedsFourGiB: upperBoundBytes > 4 * 1024 ** 3,
    },
    expected: {
      preset: "lossless-remux",
      durationSeconds: analysis.file.durationSeconds,
      width: analysis.video.width,
      height: analysis.video.height,
      codec: analysis.video.codec as ExportCodec,
      pixelFormat: analysis.video.pixelFormat as "yuv420p" | "yuv420p10le",
      frameRateKind: "constant",
      frameRate: analysis.video.fps.measured,
      color,
      webOptimized: true,
      progressive: true,
      rotation: 0,
      frameSynthesis: "none",
    },
  };
}

/** Builds validated argv only. It never creates or executes a shell command. */
export function buildFfmpegCommand(request: BuildCommandRequest): CommandSpec {
  const input = validateBrandedPath(request.input);
  const output = validateBrandedPath(request.output);
  if (path.resolve(input) === path.resolve(output)) {
    throw new MediaConfigurationError("INVALID_PATH", "Input and output paths must be different.");
  }
  const executable = validateExecutable(request.ffmpegPath ?? "ffmpeg");
  const analysis = MediaAnalysisSchema.parse(request.analysis);
  const options = parsePresetOptions(request.options);
  const disclosures: string[] = [];

  if (options.preset === "lossless-remux") {
    return buildRemux(executable, input, output, analysis);
  }

  if (options.preset === "tiktok-safe") {
    const dimensions = sourceAspectDimensions(analysis, options.resolution === "2k" ? "2k" : "safe");
    disclosures.push(`${options.resolution === "2k" ? "2K" : "1080p"} quality-first output at a genuine ${options.fps} FPS.`);
    return buildEncoded(
      executable,
      input,
      output,
      analysis,
      options,
      request.capabilities,
      {
        width: dimensions.width,
        height: dimensions.height,
        codec: "h264",
        frameRate: options.fps,
        frameRateKind: "constant",
        frameFilter: `fps=fps=${options.fps}:round=near`,
        synthesis:
          analysis.video.fps.kind === "constant" &&
          analysis.video.fps.measured !== undefined &&
          Math.abs(analysis.video.fps.measured - options.fps) <= 0.02
            ? "none"
            : "cadence-conform",
        rate: safeQualityRate(dimensions.width, dimensions.height, options.fps),
        audioBitrate: "256k",
        preserveHdr: false,
      },
      disclosures,
    );
  }

  if (options.preset === "maximum-quality") {
    const dimensions = sourceAspectDimensions(analysis, "ultra");
    const frameRate = options.frameRate === "preserve" ? undefined : Number(options.frameRate);
    const frameRateKind = frameRate
      ? "constant"
      : analysis.video.fps.kind === "constant"
        ? "constant"
        : "variable";
    if (!frameRate && analysis.video.fps.kind === "variable") {
      disclosures.push("Maximum Quality preserves the source's variable frame timestamps.");
    } else if (!frameRate && analysis.video.fps.kind === "indeterminate") {
      disclosures.push("The short or unusual source cadence is indeterminate; Maximum Quality preserves its timestamps.");
    }
    return buildEncoded(
      executable,
      input,
      output,
      analysis,
      options,
      request.capabilities,
      {
        width: dimensions.width,
        height: dimensions.height,
        codec: options.codec,
        frameRate,
        frameRateKind,
        frameFilter: frameRate ? `fps=fps=${frameRate}:round=near` : undefined,
        synthesis:
          frameRate &&
          !(
            analysis.video.fps.kind === "constant" &&
            analysis.video.fps.measured !== undefined &&
            Math.abs(analysis.video.fps.measured - frameRate) <= 0.02
          )
            ? "cadence-conform"
            : "none",
        rate: masterQualityRate(dimensions.width, dimensions.height, options.codec),
        audioBitrate: "256k",
        preserveHdr: options.preserveHdr,
      },
      disclosures,
    );
  }

  const sourceFps = analysis.video.fps.measured;
  const exactNative120 = analysis.video.fps.kind === "constant"
    && sourceFps !== undefined
    && Math.abs(sourceFps - 120) <= 0.02;
  if (options.cadence === "native") {
    if (!sourceFps || sourceFps < 119.98) {
      throw new MediaConfigurationError(
        "INVALID_CADENCE_MODE",
        "Native or downsampled 120 requires a measured source cadence of at least 120 FPS.",
      );
    }
    if (exactNative120) {
      disclosures.push("The source cadence is measured as native 120 FPS; no source moments are synthesized.");
    } else {
      disclosures.push("The source is conformed to a genuine constant 120 FPS timeline without claiming native 120 FPS; excess frames may be dropped.");
    }
  } else if (options.cadence === "duplicate") {
    if (!sourceFps || sourceFps >= 119.98) {
      throw new MediaConfigurationError(
        "INVALID_CADENCE_MODE",
        "Duplication is only available for a measured source below 120 FPS.",
      );
    }
    disclosures.push("120 FPS is created with genuine encoded duplicate frames; it is not native 120 FPS.");
  } else {
    if (!sourceFps || sourceFps >= 119.98) {
      throw new MediaConfigurationError(
        "INVALID_CADENCE_MODE",
        "Optical-flow interpolation is only available for a measured source below 120 FPS.",
      );
    }
    requireFilter(new Set(request.capabilities.filters), "minterpolate", "Optical-flow interpolation");
    disclosures.push("120 FPS is synthesized with optical-flow interpolation and is not native 120 FPS.");
  }

  const dimensions = sourceAspectDimensions(analysis, options.resolution === "2k" ? "2k" : "safe");
  disclosures.push(`${options.resolution === "2k" ? "2K" : "1080p"} 120 FPS master selected; the stream is honestly signalled as 120 FPS.`);
  return buildEncoded(
    executable,
    input,
    output,
    analysis,
    options,
    request.capabilities,
    {
      width: dimensions.width,
      height: dimensions.height,
      codec: options.codec,
      frameRate: 120,
      frameRateKind: "constant",
      frameFilter:
        options.cadence === "optical-flow"
          ? `tpad=stop_mode=clone:stop_duration=1,minterpolate=fps=120:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,trim=duration=${fixed(analysis.file.durationSeconds)},setpts=PTS-STARTPTS`
          : "fps=fps=120:round=near",
      synthesis:
        options.cadence === "native"
          ? exactNative120 ? "none" : "cadence-conform"
          : options.cadence === "duplicate"
            ? "duplication"
            : "optical-flow",
      rate: masterQualityRate(dimensions.width, dimensions.height, options.codec),
      audioBitrate: "256k",
      preserveHdr: options.preserveHdr,
    },
    disclosures,
  );
}
