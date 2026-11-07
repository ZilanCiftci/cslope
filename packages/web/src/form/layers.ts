/**
 * The layers as the form shows them: each with its thickness, stacked down
 * from the ground level. The templates take the layers' bottom levels
 * (elevations); these turn one into the other, and check the thicknesses
 * with the templates' rules, worded for a thickness. Pure TypeScript.
 */
import { boundsText, LAYER_PARAMETERS, MIN_LAYER_THICKNESS, p } from "../templates/common";
import type { ParameterDescription } from "../templates/types";

/** A layer's thickness: at least MIN_LAYER_THICKNESS. */
export const LAYER_THICKNESS: ParameterDescription = p(
  "thickness",
  "Thickness (m)",
  "m",
  MIN_LAYER_THICKNESS,
  Infinity,
  0.1,
  `The layer's thickness; the layers stack down from the ground level. A layer is at least ${MIN_LAYER_THICKNESS} m thick.`,
);

/** A level or thickness without the floating-point rest of a sum (1e-6 m). */
const round = (v: number) => Math.round(v * 1e6) / 1e6;
/** A number as the page writes it, without that rest. */
const num = (v: number) => String(round(v));

/** The bottom level of each layer: the ground less the thicknesses so far (NaN from the first that is not a number). */
export function bottomLevels(ground: number, thicknesses: number[]): number[] {
  let top = ground;
  return thicknesses.map((t) => (top = round(top - t)));
}

/** The thickness of each layer from the bottom levels: from the ground, then from the layer above. */
export function thicknesses(ground: number, levels: number[]): number[] {
  let top = ground;
  return levels.map((level) => {
    const t = round(top - level);
    top = level;
    return t;
  });
}

/** A level as the page writes it: "−15", "0", "102.5" (a minus sign, not a hyphen). */
export const levelText = (v: number) => num(v).replace("-", "−");

/** A layer's thickness and its level range: "13.5 m (−1.5 to −15 m)"; the thickness alone when the levels are not known. */
export function rangeText(thickness: number, top: number, bottom: number): string {
  const t = `${num(thickness)} m`;
  return Number.isFinite(top) && Number.isFinite(bottom) ? `${t} (${levelText(top)} to ${levelText(bottom)} m)` : t;
}

/** A thickness for a new layer: `preferred` m, less when the lowest level allowed (−100 m) is closer below `base`. */
export function newThickness(base: number, preferred: number): string {
  const room = Math.floor(round(base - LAYER_PARAMETERS.bottomLevel.min) * 10) / 10;
  return String(Number.isFinite(room) && room >= MIN_LAYER_THICKNESS ? Math.min(preferred, room) : preferred);
}

/** A problem of a layer's thickness, by the layer's index. */
export interface ThicknessProblem {
  index: number;
  message: string;
}

/**
 * The problems of the thicknesses, as the templates' rules on the bottom
 * levels give them: each layer at least 0.05 m thick, no bottom below the
 * lowest level (−100 m); with `avoid` (an excavation's bottom), no bottom
 * but the last within 0.05 m of it, and the last at least 0.05 m below it.
 * `values[i]` is null for an empty or non-numeric thickness (that layer and
 * those below it are not checked against the levels).
 */
export function thicknessProblems(ground: number, values: (number | null)[], avoid: { level: number; text: string } | null): ThicknessProblem[] {
  const out: ThicknessProblem[] = [];
  const thin = MIN_LAYER_THICKNESS;
  const lowest = LAYER_PARAMETERS.bottomLevel.min;
  let top = Number.isFinite(ground) ? ground : NaN;
  values.forEach((t, index) => {
    const add = (message: string) => out.push({ index, message });
    const last = index === values.length - 1;
    if (t === null || !Number.isFinite(t)) {
      top = NaN;
      return;
    }
    if (t < thin) {
      add(`Must be ${boundsText(LAYER_THICKNESS)}.`);
      top = round(top - t);
      return;
    }
    if (!Number.isFinite(top)) return;
    const bottom = round(top - t);
    if (bottom < lowest) add(`Must be at most ${num(top - lowest)} m: the layer would end at ${levelText(bottom)} m, below the lowest level (${levelText(lowest)} m).`);
    else if (avoid && Number.isFinite(avoid.level)) {
      const exit = round(top - avoid.level);
      if (!last && Math.abs(bottom - avoid.level) < thin - 1e-9) {
        const thinner = round(exit - thin);
        const options = thinner >= thin ? `at most ${num(thinner)} m or at least ${num(exit + thin)} m` : `at least ${num(exit + thin)} m`;
        add(`Ends at ${levelText(bottom)} m, within ${thin} m of ${avoid.text} (${levelText(avoid.level)} m): make it ${options} thick.`);
      }
      if (last && bottom > avoid.level - thin + 1e-9) {
        const total = round(ground - avoid.level + thin);
        add(`The layers must reach at least ${thin} m below ${avoid.text} (${levelText(avoid.level)} m), ${num(total)} m in all: make this one at least ${num(exit + thin)} m thick.`);
      }
    }
    top = bottom;
  });
  return out;
}
