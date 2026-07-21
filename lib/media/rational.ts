export interface ParsedRational {
  readonly text: string;
  readonly numerator: number;
  readonly denominator: number;
  readonly value: number;
}

const RATIONAL_PATTERN = /^([+-]?\d+)\s*\/\s*([+-]?\d+)$/;

export function parseRational(value: unknown): ParsedRational | undefined {
  if (typeof value !== "string") return undefined;
  const match = RATIONAL_PATTERN.exec(value.trim());
  if (!match) return undefined;

  const numeratorBig = BigInt(match[1]);
  const denominatorBig = BigInt(match[2]);
  if (denominatorBig === 0n) return undefined;
  if (
    numeratorBig > BigInt(Number.MAX_SAFE_INTEGER) ||
    numeratorBig < BigInt(Number.MIN_SAFE_INTEGER) ||
    denominatorBig > BigInt(Number.MAX_SAFE_INTEGER) ||
    denominatorBig < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    return undefined;
  }

  const numerator = Number(numeratorBig);
  const denominator = Number(denominatorBig);
  const numeric = numerator / denominator;
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;

  return {
    text: `${numerator}/${denominator}`,
    numerator,
    denominator,
    value: numeric,
  };
}

export function parseFiniteNumber(value: unknown, minimum = 0): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= minimum ? numeric : undefined;
}

export function parseSafeInteger(value: unknown, minimum = 0): number | undefined {
  const numeric = parseFiniteNumber(value, minimum);
  return numeric !== undefined && Number.isSafeInteger(numeric) ? numeric : undefined;
}

export function formatCodecLevel(codec: string, rawLevel: unknown): string | undefined {
  const level = parseSafeInteger(rawLevel);
  if (level === undefined) return undefined;

  if (codec === "h264") {
    return `${Math.floor(level / 10)}.${level % 10}`;
  }

  if (codec === "hevc") {
    const hevcLevels: Record<number, string> = {
      30: "1",
      60: "2",
      63: "2.1",
      90: "3",
      93: "3.1",
      120: "4",
      123: "4.1",
      150: "5",
      153: "5.1",
      156: "5.2",
      180: "6",
      183: "6.1",
      186: "6.2",
    };
    return hevcLevels[level] ?? `unknown (${level})`;
  }

  return String(level);
}

