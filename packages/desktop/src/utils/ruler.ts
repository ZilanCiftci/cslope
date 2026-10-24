/** Smallest spacing of labelled ticks on the paper, in mm on an A4-wide sheet. */
export const MIN_TICK_SPACING_MM = 15;
/** Free space between two tick labels, in mm on an A4-wide sheet. */
const TICK_LABEL_GAP_MM = 5;
/**
 * Width of a tick-label character (about 10 px type on the paper on screen,
 * 9 pt in the PDF), in mm on an A4-wide sheet; a point or minus sign is
 * narrower.
 */
const TICK_DIGIT_MM = 2.2;
const TICK_PUNCT_MM = 1.2;
/** Smallest tick step: centimetres in a model in metres. */
const MIN_TICK_STEP = 0.01;

function labelWidthMm(label: string): number {
  let w = 0;
  for (const ch of label) w += /[0-9]/.test(ch) ? TICK_DIGIT_MM : TICK_PUNCT_MM;
  return w;
}

/**
 * Spacing of the labelled ticks along the paper frame: the smallest "nice"
 * step (1, 2, 2.5 or 5 times a power of ten) whose ticks lie at least
 * MIN_TICK_SPACING_MM apart on the paper and leave room for their labels.
 * The labels' width comes from the values at the ends of `labelRange`
 * (world x from left to right; 0 to the span when not given).
 *
 * Sizes are taken on an A4-wide sheet: the screen fits any paper size to
 * the window, so a larger sheet shows the same labels relatively smaller.
 */
export function computeRulerStep(
  worldSpan: number,
  innerFrameWidthMm: number,
  paperWidthMm: number,
  labelRange?: [number, number],
): number {
  const span = Math.max(Math.abs(worldSpan), 1e-9);
  const frameMm =
    (Math.abs(innerFrameWidthMm) * 297) / Math.max(Math.abs(paperWidthMm), 1e-9);
  const mmPerUnit = frameMm / span;
  const [lo, hi] = labelRange
    ? [Math.min(...labelRange), Math.max(...labelRange)]
    : [0, span];
  const spacingNeeded = (step: number) => {
    const first = Math.ceil(lo / step - 1e-9) * step;
    const last = Math.floor(hi / step + 1e-9) * step;
    const label = Math.max(
      labelWidthMm(formatRulerLabel(first, step)),
      labelWidthMm(formatRulerLabel(last, step)),
    );
    return Math.max(MIN_TICK_SPACING_MM, label + TICK_LABEL_GAP_MM);
  };
  if (!(mmPerUnit > 0) || !Number.isFinite(mmPerUnit)) return Math.max(MIN_TICK_STEP, span);
  const rough = Math.max(MIN_TICK_STEP, MIN_TICK_SPACING_MM / mmPerUnit);
  let mag = Math.pow(10, Math.floor(Math.log10(rough)));
  for (let decade = 0; decade < 6; decade++, mag *= 10) {
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * mag;
      if (step < MIN_TICK_STEP - 1e-12) continue;
      if (step * mmPerUnit >= spacingNeeded(step)) return step;
    }
  }
  return mag;
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

/** A user tick spacing may be at most this many times denser than auto. */
export const MAX_TICK_DENSITY = 20;

/**
 * The user's grid/tick spacing when it is usable, else the automatic one.
 * A tiny spacing (e.g. 0.001 on a 100 m model) would otherwise draw
 * millions of lines and freeze the canvas and the PDF export.
 */
export function resolveTickStep(
  userSpacing: number | undefined,
  autoStep: number,
): number {
  if (
    userSpacing === undefined ||
    !Number.isFinite(userSpacing) ||
    userSpacing <= 0 ||
    userSpacing < autoStep / MAX_TICK_DENSITY
  ) {
    return autoStep;
  }
  return userSpacing;
}

/** Minor ruler ticks between labels: a whole number from 0 to 20 (a huge count made the tick loops endless). */
export function clampMinorTicks(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(20, Math.round(n))) : 0;
}
