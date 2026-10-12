/**
 * How close cSlope's factor of safety must come to a reference value for a
 * verification check to pass. The tolerance follows from what is known about
 * the problem before it is analysed, never from the result:
 *
 *  - the surface: a given surface 1 %, a searched surface 2 % (two programs'
 *    searches need not find the same critical surface);
 *  - the precision of the reference: half a unit of its last printed digit,
 *    with at least two decimals assumed (a table's "1.40" is stored as 1.4);
 *  - input read from a figure (a digitised surface or water table): + 1 %;
 *  - a reference value read from a chart or a figure: + 1 %;
 *  - a reference from a different method (finite elements, strength
 *    reduction): 5 %, an indication rather than a check of the method.
 */

export interface ToleranceCase {
  surface: "fixed" | "search";
  /** Geometry, a surface or a water table was digitised from a figure. */
  inputFromFigure?: boolean;
  /** The reference values were read from a chart or a figure. */
  referenceFromFigure?: boolean;
}

export interface ToleranceCheck {
  published: number;
  publishedBy: string;
}

const BASE = { fixed: 0.01, search: 0.02 } as const;
const FIGURE = 0.01;
const OTHER_METHOD = 0.05;

/** The source used a different method of analysis (finite elements). */
export const otherMethod = (publishedBy: string) => /\bFE\b|strength reduction/i.test(publishedBy);

/** The source's value was read off a chart or a curve. */
const fromChart = (publishedBy: string) => /\bchart\b|\bcurve\b/i.test(publishedBy);

/** Decimals as printed, at least two. */
function printedDecimals(x: number): number {
  const s = String(x);
  const dot = s.indexOf(".");
  return Math.max(2, dot < 0 ? 0 : s.length - dot - 1);
}

/** The accepted relative deviation of a check from its reference value. */
export function referenceTolerance(c: ToleranceCase, k: ToleranceCheck): number {
  if (otherMethod(k.publishedBy)) return OTHER_METHOD;
  let t = BASE[c.surface];
  t += (0.5 * 10 ** -printedDecimals(k.published)) / Math.abs(k.published);
  if (c.inputFromFigure) t += FIGURE;
  if (c.referenceFromFigure || fromChart(k.publishedBy)) t += FIGURE;
  return t;
}

/** Whether a computed factor of safety agrees with the check's reference. */
export function agrees(k: ToleranceCheck & { tolerance: number }, fos: number): boolean {
  return Math.abs(fos - k.published) / Math.abs(k.published) <= k.tolerance + 1e-9;
}
