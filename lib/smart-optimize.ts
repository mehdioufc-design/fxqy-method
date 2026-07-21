export type SmartOptimizeAnalysis = {
  hdr?: boolean;
  video: {
    codec: string;
    pixelFormat?: string;
    width: number;
    height: number;
    displayWidth?: number;
    displayHeight?: number;
    color?: { primaries?: string; transfer?: string; space?: string; range?: string };
    fps: { measured?: number; average?: number };
  };
  remux?: { eligible: boolean };
};

export type SmartOptimizeDecision = Readonly<{
  preset: "tiktok-safe" | "lossless-remux";
  reason: string;
}>;

/** Selects the least destructive TikTok-compatible processing path. */
export function chooseSmartOptimize(analysis: SmartOptimizeAnalysis): SmartOptimizeDecision {
  const width = analysis.video.displayWidth ?? analysis.video.width;
  const height = analysis.video.displayHeight ?? analysis.video.height;
  const color = analysis.video.color;
  const conservativeBt709 = color?.primaries === "bt709"
    && color.transfer === "bt709"
    && color.space === "bt709"
    && !["pc", "jpeg"].includes(color.range ?? "");
  const conservativeCodec = analysis.video.codec === "h264"
    && analysis.video.pixelFormat === "yuv420p";
  const canPreserveStreams = analysis.remux?.eligible === true
    && conservativeCodec
    && Math.max(width, height) <= 4096
    && analysis.hdr !== true
    && conservativeBt709;

  return canPreserveStreams
    ? { preset: "lossless-remux", reason: "Compatible H.264/BT.709 media can be preserved without re-encoding." }
    : { preset: "tiktok-safe", reason: "Compatibility conversion is required for a conservative upload file." };
}
