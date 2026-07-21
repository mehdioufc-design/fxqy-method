import { z } from "zod";

const NumericLikeSchema = z.union([z.string(), z.number()]);

const DispositionSchema = z
  .object({
    default: NumericLikeSchema.optional(),
    attached_pic: NumericLikeSchema.optional(),
  })
  .passthrough();

const StreamTagsSchema = z
  .object({
    rotate: NumericLikeSchema.optional(),
  })
  .passthrough();

const SideDataSchema = z
  .object({
    side_data_type: z.string().optional(),
    rotation: NumericLikeSchema.optional(),
  })
  .passthrough();

export const RawFfprobeStreamSchema = z
  .object({
    index: NumericLikeSchema,
    codec_name: z.string().optional(),
    codec_type: z.string().optional(),
    profile: z.union([z.string(), z.number()]).optional(),
    level: NumericLikeSchema.optional(),
    width: NumericLikeSchema.optional(),
    height: NumericLikeSchema.optional(),
    coded_width: NumericLikeSchema.optional(),
    coded_height: NumericLikeSchema.optional(),
    sample_aspect_ratio: z.string().optional(),
    display_aspect_ratio: z.string().optional(),
    pix_fmt: z.string().optional(),
    field_order: z.string().optional(),
    color_range: z.string().optional(),
    color_space: z.string().optional(),
    color_transfer: z.string().optional(),
    color_primaries: z.string().optional(),
    r_frame_rate: z.string().optional(),
    avg_frame_rate: z.string().optional(),
    time_base: z.string().optional(),
    start_time: NumericLikeSchema.optional(),
    duration: NumericLikeSchema.optional(),
    bit_rate: NumericLikeSchema.optional(),
    nb_frames: NumericLikeSchema.optional(),
    nb_read_packets: NumericLikeSchema.optional(),
    sample_rate: NumericLikeSchema.optional(),
    channels: NumericLikeSchema.optional(),
    channel_layout: z.string().optional(),
    tags: StreamTagsSchema.optional(),
    disposition: DispositionSchema.optional(),
    side_data_list: z.array(SideDataSchema).optional(),
  })
  .passthrough();

const RawFfprobeFormatSchema = z
  .object({
    format_name: z.string().optional(),
    format_long_name: z.string().optional(),
    start_time: NumericLikeSchema.optional(),
    duration: NumericLikeSchema.optional(),
    size: NumericLikeSchema.optional(),
    bit_rate: NumericLikeSchema.optional(),
    probe_score: NumericLikeSchema.optional(),
    tags: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const RawFfprobeSchema = z
  .object({
    streams: z.array(RawFfprobeStreamSchema).default([]),
    format: RawFfprobeFormatSchema.optional(),
    error: z
      .object({
        code: NumericLikeSchema.optional(),
        string: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type RawFfprobe = z.infer<typeof RawFfprobeSchema>;
export type RawFfprobeStream = z.infer<typeof RawFfprobeStreamSchema>;

function dispositionFlag(stream: RawFfprobeStream, key: "default" | "attached_pic"): boolean {
  const value = stream.disposition?.[key];
  return value === 1 || value === "1";
}

export function selectPrimaryVideoStream(raw: RawFfprobe): RawFfprobeStream | undefined {
  const candidates = raw.streams.filter(
    (stream) => stream.codec_type === "video" && !dispositionFlag(stream, "attached_pic"),
  );
  return candidates.find((stream) => dispositionFlag(stream, "default")) ?? candidates[0];
}

export function selectPrimaryAudioStream(raw: RawFfprobe): RawFfprobeStream | undefined {
  const candidates = raw.streams.filter((stream) => stream.codec_type === "audio");
  return candidates.find((stream) => dispositionFlag(stream, "default")) ?? candidates[0];
}

