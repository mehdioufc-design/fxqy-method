import type { PacketTimingSummary } from "./contracts";

const MAX_STORED_TIMING_SAMPLES = 2_000_000;

export interface ParsedPacketRecord {
  readonly pts?: number;
  readonly dts?: number;
  readonly duration?: number;
  readonly size?: number;
  readonly keyframe: boolean;
}

function finiteValue(value: string | undefined): number | undefined {
  if (!value || value === "N/A") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function parseCompactPacketLine(line: string): ParsedPacketRecord | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  const fields = new Map<string, string>();
  for (const component of trimmed.split("|")) {
    const separator = component.indexOf("=");
    if (separator <= 0) continue;
    fields.set(component.slice(0, separator), component.slice(separator + 1));
  }

  if (fields.size === 0) return undefined;
  return {
    pts: finiteValue(fields.get("pts_time")),
    dts: finiteValue(fields.get("dts_time")),
    duration: finiteValue(fields.get("duration_time")),
    size: finiteValue(fields.get("size")),
    keyframe: fields.get("flags")?.includes("K") ?? false,
  };
}

function percentile(sorted: readonly number[], fraction: number): number | undefined {
  if (sorted.length === 0) return undefined;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)));
  return sorted[index];
}

export class PacketTimingAccumulator {
  readonly #timeBaseSeconds?: number;
  readonly #durations: number[] = [];
  readonly #pts: number[] = [];
  readonly #keyframePts: number[] = [];
  #sampleCount = 0;
  #missingPts = 0;
  #missingDts = 0;
  #nonMonotonicDts = 0;
  #nonPositiveDurations = 0;
  #negativeStart = false;
  #tinyPacketCount = 0;
  #lastDts?: number;

  constructor(timeBaseSeconds?: number) {
    this.#timeBaseSeconds =
      timeBaseSeconds !== undefined && Number.isFinite(timeBaseSeconds) && timeBaseSeconds > 0
        ? timeBaseSeconds
        : undefined;
  }

  push(record: ParsedPacketRecord): void {
    this.#sampleCount += 1;
    if (record.pts === undefined) {
      this.#missingPts += 1;
    } else {
      if (record.pts < 0) this.#negativeStart = true;
      if (this.#pts.length < MAX_STORED_TIMING_SAMPLES) this.#pts.push(record.pts);
      if (record.keyframe && this.#keyframePts.length < MAX_STORED_TIMING_SAMPLES) {
        this.#keyframePts.push(record.pts);
      }
    }

    if (record.dts === undefined) {
      this.#missingDts += 1;
    } else {
      if (record.dts < 0) this.#negativeStart = true;
      if (this.#lastDts !== undefined && record.dts <= this.#lastDts) {
        this.#nonMonotonicDts += 1;
      }
      this.#lastDts = record.dts;
    }

    if (record.duration !== undefined) {
      if (record.duration <= 0) {
        this.#nonPositiveDurations += 1;
      } else if (this.#durations.length < MAX_STORED_TIMING_SAMPLES) {
        this.#durations.push(record.duration);
      }
    }

    if (record.size !== undefined && record.size <= 16) this.#tinyPacketCount += 1;
  }

  pushCompactLine(line: string): void {
    const parsed = parseCompactPacketLine(line);
    if (parsed) this.push(parsed);
  }

  finish(): PacketTimingSummary {
    let cadenceSamples = [...this.#durations];
    if (cadenceSamples.length < 2 && this.#pts.length >= 2) {
      const sortedPts = [...this.#pts].sort((left, right) => left - right);
      cadenceSamples = [];
      for (let index = 1; index < sortedPts.length; index += 1) {
        const delta = sortedPts[index] - sortedPts[index - 1];
        if (delta > 0) cadenceSamples.push(delta);
      }
    }

    const sortedCadence = cadenceSamples.filter((value) => value > 0).sort((left, right) => left - right);
    const medianDuration = percentile(sortedCadence, 0.5);
    let kind: PacketTimingSummary["kind"] = "indeterminate";
    let measuredFps: number | undefined;
    if (medianDuration !== undefined && sortedCadence.length >= 10) {
      measuredFps = 1 / medianDuration;
      const tolerance = Math.max((this.#timeBaseSeconds ?? 0) * 2, medianDuration * 0.002, 1e-7);
      const differing = sortedCadence.filter(
        (duration) => Math.abs(duration - medianDuration) > tolerance,
      ).length;
      const p05 = percentile(sortedCadence, 0.05) ?? medianDuration;
      const p95 = percentile(sortedCadence, 0.95) ?? medianDuration;
      const variableThreshold = Math.max(2, Math.floor(sortedCadence.length * 0.005));
      kind = differing > variableThreshold && p95 - p05 > tolerance * 2 ? "variable" : "constant";
    }

    const sortedPts = [...this.#pts].sort((left, right) => left - right);
    let maximumGapSeconds: number | undefined;
    for (let index = 1; index < sortedPts.length; index += 1) {
      const gap = sortedPts[index] - sortedPts[index - 1];
      if (gap > (maximumGapSeconds ?? 0)) maximumGapSeconds = gap;
    }

    const sortedKeyframes = [...this.#keyframePts].sort((left, right) => left - right);
    let maximumKeyframeGapSeconds: number | undefined;
    for (let index = 1; index < sortedKeyframes.length; index += 1) {
      const gap = sortedKeyframes[index] - sortedKeyframes[index - 1];
      if (gap > (maximumKeyframeGapSeconds ?? 0)) maximumKeyframeGapSeconds = gap;
    }

    return {
      sampleCount: this.#sampleCount,
      sampledCount: Math.max(this.#durations.length, this.#pts.length),
      truncated: this.#sampleCount > MAX_STORED_TIMING_SAMPLES,
      missingPts: this.#missingPts,
      missingDts: this.#missingDts,
      nonMonotonicDts: this.#nonMonotonicDts,
      nonPositiveDurations: this.#nonPositiveDurations,
      negativeStart: this.#negativeStart,
      medianDurationSeconds: medianDuration,
      measuredFps,
      kind,
      maximumGapSeconds,
      maximumKeyframeGapSeconds,
      tinyPacketCount: this.#tinyPacketCount,
    };
  }
}

export function analyzePacketRecords(
  records: readonly ParsedPacketRecord[],
  timeBaseSeconds?: number,
): PacketTimingSummary {
  const accumulator = new PacketTimingAccumulator(timeBaseSeconds);
  for (const record of records) accumulator.push(record);
  return accumulator.finish();
}
