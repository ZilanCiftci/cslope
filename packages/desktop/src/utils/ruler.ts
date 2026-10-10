export function computeRulerStep(
  worldSpan: number,
  innerFrameWidthMm: number,
  paperWidthMm: number,
): number {
  const safeWorldSpan = Math.max(Math.abs(worldSpan), 1e-9);
  const safeInnerFrameWidthMm = Math.max(Math.abs(innerFrameWidthMm), 1e-9);
  const rulerRawStep =
    (10 * safeWorldSpan * (paperWidthMm / 297)) / safeInnerFrameWidthMm;
  const rawStep = Math.max(rulerRawStep, 0.5);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const stepOptions = [1, 2, 5, 10];
  return Math.max(0.5, stepOptions.find((s) => s * mag >= rawStep)! * mag);
}

/** Number of decimals needed to write `step` exactly (at most 6). */
function decimalsOf(step: number): number {
  for (let d = 0; d <= 6; d++) {
    const scaled = Math.abs(step) * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6) return d;
  }
  return 6;
}

/**
 * Tick label for `value`.  With the tick `step`, uses as many decimals as
 * the step needs (0.25 → "0.25", not "0.3"); without it, one decimal.
 */
export function formatRulerLabel(value: number, step?: number): string {
  const snapped = Math.abs(value) < 1e-9 ? 0 : value;
  const roundedInt = Math.round(snapped);
  if (Math.abs(snapped - roundedInt) < 1e-6) {
    return roundedInt.toString();
  }
  const decimals = step !== undefined ? Math.max(1, decimalsOf(step)) : 1;
  return snapped.toFixed(decimals);
}
