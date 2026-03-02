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

export function formatRulerLabel(value: number): string {
  const snapped = Math.abs(value) < 1e-9 ? 0 : value;
  const roundedInt = Math.round(snapped);
  if (Math.abs(snapped - roundedInt) < 1e-6) {
    return roundedInt.toString();
  }
  return (Math.round(snapped * 10) / 10).toFixed(1);
}
