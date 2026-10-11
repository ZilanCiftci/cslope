import chroma from "chroma-js";

/** Shared FOS-to-color mapper used across canvas, plot, and PDF export. */
const FOS_SCALE = chroma.scale(["red", "yellow", "green", "blue"]);

export function fosColor(fos: number, minFos = 0.5, maxFos = 3.0): string {
  const t = (fos - minFos) / (maxFos - minFos || 1);
  return FOS_SCALE(Math.max(0, Math.min(1, t))).hex();
}

export interface FosScaleRange {
  min: number;
  max: number;
  /** True when surfaces above `max` exist (they get the top colour). */
  capped: boolean;
}

/**
 * FOS range of the colour scale. The search always finds some surfaces
 * with very high FOS (small or shallow ones in cohesive soil), so the
 * scale ends at max(minFOS + 1, 2·minFOS) to keep the colours spread
 * over the surfaces near the critical one.
 */
export function fosScaleRange(result: { minFOS: number; maxFOS: number }): FosScaleRange {
  const { minFOS, maxFOS } = result;
  const upper = Math.max(minFOS + 1, 2 * minFOS);
  return maxFOS > upper
    ? { min: minFOS, max: upper, capped: true }
    : { min: minFOS, max: maxFOS, capped: false };
}

/** FOS of colour-bar tick `t` of `ticks` (0 = top). */
export function fosTickValue(range: FosScaleRange, t: number, ticks: number): number {
  return range.max - (t / ticks) * (range.max - range.min);
}

/** Colour-bar tick label; the top one of a capped scale reads "≥ x". */
export function fosTickLabel(range: FosScaleRange, t: number, ticks: number, ge = "≥ "): string {
  const text = fosTickValue(range, t, ticks).toFixed(2);
  return t === 0 && range.capped ? ge + text : text;
}

/**
 * Number of analysed surfaces and how many of them have FOS below 1.0,
 * e.g. "1388 (12 below 1.0)". The largest FOS of the search says little
 * (small surfaces in cohesive soil reach any value), the share below 1.0
 * shows how widespread failure is.
 */
export function surfaceCountText(result: { allSurfaces: { fos: number }[] }): string {
  const n = result.allSurfaces.length;
  const below = result.allSurfaces.filter((s) => s.fos < 1).length;
  return below > 0 ? `${n} (${below} below 1.0)` : `${n}`;
}
