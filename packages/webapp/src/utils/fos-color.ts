import chroma from "chroma-js";

/** Shared FOS-to-color mapper used across canvas, plot, and PDF export. */
const FOS_SCALE = chroma.scale(["red", "yellow", "green", "blue"]);

export function fosColor(fos: number, minFos = 0.5, maxFos = 3.0): string {
  const t = (fos - minFos) / (maxFos - minFos || 1);
  return FOS_SCALE(Math.max(0, Math.min(1, t))).hex();
}
