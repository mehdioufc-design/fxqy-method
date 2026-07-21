export type ResolutionCeiling = "1080p" | "2k" | "4k";

export type SourceGeometry = Readonly<{
  width: number;
  height: number;
  displayWidth?: number;
  displayHeight?: number;
  dar?: number;
  sar?: string;
  rotation?: number;
}>;

export type ResolvedDimensions = Readonly<{
  width: number;
  height: number;
  upscaled: false;
  limitedBySource: boolean;
}>;

export type QualityResolutionTier = "small" | "1080p" | "2k";

export function qualityResolutionTier(width: number, height: number): QualityResolutionTier {
  const pixels = width * height;
  if (pixels <= 1280 * 720) return "small";
  if (pixels <= 1920 * 1080) return "1080p";
  return "2k";
}

/** Returns square-pixel dimensions no larger than either the source display size or selected ceiling. */
export function resolveOutputDimensions(
  source: SourceGeometry,
  resolution: ResolutionCeiling,
): ResolvedDimensions {
  const sourceSize = sourceDisplaySize(source);
  const ratio = validRatio(source.dar) ?? sourceSize.width / sourceSize.height;
  const shortEdge = resolution === "1080p" ? 1080 : resolution === "2k" ? 1440 : 2160;
  const landscape = ratio >= 1;
  const boxWidth = landscape ? Math.round((shortEdge * 16) / 9) : shortEdge;
  const boxHeight = landscape ? shortEdge : Math.round((shortEdge * 16) / 9);
  const scale = Math.min(1, boxWidth / sourceSize.width, boxHeight / sourceSize.height);
  const width = even(sourceSize.width * scale);
  const height = even(width / ratio);
  const correctedHeight = height > boxHeight ? even(sourceSize.height * scale) : height;
  const correctedWidth = height > boxHeight ? even(correctedHeight * ratio) : width;

  return {
    width: Math.min(boxWidth, correctedWidth),
    height: Math.min(boxHeight, correctedHeight),
    upscaled: false,
    limitedBySource: scale >= 0.999,
  };
}

function sourceDisplaySize(source: SourceGeometry): { width: number; height: number } {
  const sar = parseRatio(source.sar) ?? 1;
  const unrotatedWidth = source.width * sar;
  const rotated = source.rotation === 90 || source.rotation === 270;
  const calculatedWidth = rotated ? source.height : unrotatedWidth;
  const calculatedHeight = rotated ? unrotatedWidth : source.height;
  if (calculatedWidth > 0 && calculatedHeight > 0) {
    return { width: calculatedWidth, height: calculatedHeight };
  }
  return {
    width: source.displayWidth ?? source.width,
    height: source.displayHeight ?? source.height,
  };
}

function parseRatio(value: string | undefined): number | undefined {
  if (!value || value === "N/A") return undefined;
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value);
  if (!match) return undefined;
  return validRatio(Number(match[1]) / Number(match[2]));
}

function validRatio(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}
