/**
 * Pore pressure from head lines and reference lines (a "waternet"). At a
 * point between two reference lines the head varies linearly with the
 * elevation from the bottom head line of the upper reference line to the
 * top head line of the lower one; below the lowest reference line it is
 * that line's bottom head line. Above the uppermost reference line it
 * varies linearly from the top head line of that line to the phreatic
 * level (where the head is the phreatic line's), and above the phreatic
 * level it is the phreatic line's. A reference line without head lines is
 * left out. The pore pressure is γw × (head − z), not negative. This
 * describes, for example, a clay layer between a phreatic level and a
 * confined aquifer with another head.
 */

import { WATER_UNIT_WEIGHT } from "../types/constants";

type Pt = [number, number];

export interface Waternet {
  /** Head lines by id: the elevation of the head along x. */
  headLines: { id: string; points: Pt[] }[];
  /** Reference lines: where the head of their top and bottom head lines applies. */
  referenceLines: { points: Pt[]; topHeadLineId?: string; bottomHeadLineId?: string }[];
  /** The head line that is the phreatic line (above all reference lines). */
  phreaticLineId?: string;
}

/** y of a polyline at x, constant beyond its ends; NaN without points. */
function lineAt(pts: readonly Pt[], x: number): number {
  const n = pts.length;
  if (n === 0) return Number.NaN;
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[n - 1][0]) return pts[n - 1][1];
  let k = 1;
  while (k < n - 1 && pts[k][0] < x) k++;
  const [x0, y0] = pts[k - 1], [x1, y1] = pts[k];
  return x1 > x0 ? y0 + ((x - x0) / (x1 - x0)) * (y1 - y0) : y1;
}

interface CompiledRef {
  points: readonly Pt[];
  x0: number;
  x1: number;
  /** Head lines for the zone above and below the line (each falls back on the other). */
  top: readonly Pt[] | undefined;
  bottom: readonly Pt[] | undefined;
}
interface Compiled {
  phreatic: readonly Pt[] | undefined;
  refs: CompiledRef[];
}

/** The waternet with its head lines looked up once (the pore pressure runs per slice). */
const compiled = new WeakMap<Waternet, Compiled>();
function compile(wn: Waternet): Compiled {
  let c = compiled.get(wn);
  if (!c) {
    const head = (id: string | undefined) => (id === undefined ? undefined : wn.headLines.find((l) => l.id === id)?.points);
    c = {
      phreatic: head(wn.phreaticLineId),
      refs: wn.referenceLines
        .filter((r) => (r.topHeadLineId !== undefined || r.bottomHeadLineId !== undefined) && r.points.length >= 2)
        .map((r) => {
          const top = head(r.topHeadLineId ?? r.bottomHeadLineId), bottom = head(r.bottomHeadLineId ?? r.topHeadLineId);
          return { points: r.points, x0: r.points[0][0], x1: r.points[r.points.length - 1][0], top, bottom };
        }),
    };
    compiled.set(wn, c);
  }
  return c;
}

const at = (pts: readonly Pt[] | undefined, x: number) => (pts ? lineAt(pts, x) : Number.NaN);

/** The pore pressure (kPa, ≥ 0) at (x, z). */
export function waternetPorePressure(wn: Waternet, x: number, z: number): number {
  const { phreatic, refs } = compile(wn);
  // the reference lines at x nearest above and below z
  let upper: CompiledRef | undefined, lower: CompiledRef | undefined;
  let yu = Infinity, yl = -Infinity;
  for (const r of refs) {
    if (x < r.x0 || x > r.x1) continue;
    const y = lineAt(r.points, x);
    if (y >= z) {
      if (y < yu) {
        yu = y;
        upper = r;
      }
    } else if (y > yl) {
      yl = y;
      lower = r;
    }
  }
  let h: number;
  if (!upper) {
    // above the uppermost reference line: towards the phreatic level
    const hp = at(phreatic, x);
    const hl = lower ? at(lower.top, x) : Number.NaN;
    if (lower && Number.isFinite(hl) && Number.isFinite(hp) && z < hp && hp > yl) {
      h = hl + ((z - yl) / (hp - yl)) * (hp - hl);
    } else h = Number.isFinite(hp) ? hp : hl;
  } else {
    const hu = at(upper.bottom, x);
    if (!lower) h = hu;
    else {
      const hl = at(lower.top, x);
      const t = yu > yl ? (z - yl) / (yu - yl) : 0;
      h = Number.isFinite(hu) && Number.isFinite(hl) ? hl + t * (hu - hl) : Number.isFinite(hu) ? hu : hl;
    }
  }
  return Number.isFinite(h) ? Math.max(0, (h - z) * WATER_UNIT_WEIGHT) : 0;
}
