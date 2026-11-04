/**
 * Axis ticks of the slice plots: round steps (1, 2, 5 × 10ⁿ) over a range
 * widened to whole steps, so that the axes carry readable values between
 * the ends instead of only the data's minimum and maximum.
 */
export interface AxisTicks {
  /** The axis range, widened to the outer ticks. */
  min: number;
  max: number;
  step: number;
  values: number[];
  /** Decimals that show the step exactly. */
  decimals: number;
}

/** A round step (1, 2 or 5 × 10ⁿ) near `rough`, at least `minStep`. */
function roundStep(rough: number, minStep: number): number {
  const base = 10 ** Math.floor(Math.log10(rough));
  const candidates = [1, 2, 5, 10].map((m) => m * base);
  const step = candidates.find((c) => c >= rough) ?? candidates[candidates.length - 1];
  return Math.max(step, minStep);
}

/**
 * The ticks of an axis from `lo` to `hi`, about `target` of them (never
 * fewer than two). `integer` keeps the step at whole numbers (the slice
 * numbers). A flat range is widened by one unit around its value.
 */
export function axisTicks(lo: number, hi: number, target = 5, integer = false): AxisTicks {
  let min = Math.min(lo, hi);
  let max = Math.max(lo, hi);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  if (max - min < 1e-12) {
    min -= 1;
    max += 1;
  }
  const step = roundStep((max - min) / Math.max(1, target), integer ? 1 : 0);
  const start = Math.floor(min / step + 1e-9) * step;
  const end = Math.ceil(max / step - 1e-9) * step;
  const decimals = integer ? 0 : Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const values: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) values.push(Number(v.toFixed(decimals)));
  return { min: start, max: end, step, values, decimals };
}

/** A tick's label, with the step's decimals. */
export function tickLabel(value: number, ticks: AxisTicks): string {
  return value.toFixed(ticks.decimals);
}
