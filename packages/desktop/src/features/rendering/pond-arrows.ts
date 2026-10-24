/**
 * Load arrows in ponded water, shared by the canvas and the PDF: small
 * arrows inside the free water pointing at the ground, normal to it, as
 * drawings show that the water loads the ground.
 *
 * Arrows are spaced evenly along the ground under each pond; each is
 * as long as a fraction of the local water depth (measured along the
 * normal), capped, with its tip on the ground. None where the water is
 * shallow, and none close to a water-table symbol.
 *
 * Everything works in drawing units (canvas px or PDF mm) with y down;
 * `unit` converts the canvas pixel sizes of the style spec to them.
 */
import type { Box } from "../canvas/label-layout";
import type { Pond } from "../../utils/piezo";
import {
  POND_ARROW_CLEARANCE_PX,
  POND_ARROW_DEPTH_FRACTION,
  POND_ARROW_HEAD_HALF_PX,
  POND_ARROW_HEAD_PX,
  POND_ARROW_MAX_PX,
  POND_ARROW_MIN_DEPTH_PX,
  POND_ARROW_SPACING_PX,
} from "./style-spec";

type Pt = [number, number];

/** A load arrow: shaft from `tail` to `base`, head `tip`, `b1`, `b2` (tip on the ground). */
export interface PondArrow {
  tail: Pt;
  base: Pt;
  tip: Pt;
  b1: Pt;
  b2: Pt;
}

function inside(p: Pt, poly: readonly Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Distance from `o` along unit `d` to the polygon's boundary (beyond `from`). */
function rayDepth(o: Pt, d: Pt, poly: readonly Pt[], from: number): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const ex = bx - ax;
    const ey = by - ay;
    const den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const qx = ax - o[0];
    const qy = ay - o[1];
    const t = (qx * ey - qy * ex) / den;
    const s = (qx * d[1] - qy * d[0]) / den;
    if (t > from && s >= -1e-9 && s <= 1 + 1e-9 && t < best) best = t;
  }
  return best;
}

function segmentBox(a: Pt, b: Pt, pad: number): Box {
  return {
    left: Math.min(a[0], b[0]) - pad,
    right: Math.max(a[0], b[0]) + pad,
    top: Math.min(a[1], b[1]) - pad,
    bottom: Math.max(a[1], b[1]) + pad,
  };
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * The load arrows of the ponds, in drawing units. `avoid`: boxes (the
 * water-table symbols) no arrow may come near.
 */
export function pondArrowLayout(
  ponds: readonly Pond[],
  toD: (x: number, y: number) => Pt,
  unit: number,
  avoid: readonly Box[] = [],
): PondArrow[] {
  const spacing = POND_ARROW_SPACING_PX * unit;
  const minDepth = POND_ARROW_MIN_DEPTH_PX * unit;
  const maxLen = POND_ARROW_MAX_PX * unit;
  const headLen = POND_ARROW_HEAD_PX * unit;
  const headHalf = POND_ARROW_HEAD_HALF_PX * unit;
  const clear = POND_ARROW_CLEARANCE_PX * unit;
  const tiny = 1e-3 * unit;
  const out: PondArrow[] = [];
  for (const pond of ponds) {
    const ground = pond.ground.map(([x, y]) => toD(x, y));
    const poly = [...pond.water.map(([x, y]) => toD(x, y)), ...[...ground].reverse()];
    const lens = ground.slice(1).map((p, i) => Math.hypot(p[0] - ground[i][0], p[1] - ground[i][1]));
    const total = lens.reduce((a, b) => a + b, 0);
    if (!(total > 0)) continue;
    const n = Math.max(1, Math.round(total / spacing));
    const step = total / n;
    let seg = 0;
    let start = 0;
    for (let k = 0; k < n; k++) {
      const s = (k + 0.5) * step;
      while (seg < lens.length - 1 && start + lens[seg] < s) start += lens[seg++];
      const len = lens[seg];
      if (!(len > tiny)) continue;
      const [ax, ay] = ground[seg];
      const [bx, by] = ground[seg + 1];
      const f = (s - start) / len;
      const tip: Pt = [ax + f * (bx - ax), ay + f * (by - ay)];
      const tx = (bx - ax) / len;
      const ty = (by - ay) / len;
      // The normal pointing into the water.
      let nrm: Pt = [ty, -tx];
      const probe = (d: Pt): Pt => [tip[0] + d[0] * 0.5 * unit, tip[1] + d[1] * 0.5 * unit];
      if (!inside(probe(nrm), poly)) {
        nrm = [-ty, tx];
        if (!inside(probe(nrm), poly)) continue;
      }
      const depth = rayDepth(tip, nrm, poly, tiny);
      if (!Number.isFinite(depth) || depth < minDepth) continue;
      const L = Math.min(POND_ARROW_DEPTH_FRACTION * depth, maxLen);
      const tail: Pt = [tip[0] + nrm[0] * L, tip[1] + nrm[1] * L];
      const box = segmentBox(tip, tail, headHalf + clear);
      if (avoid.some((b) => overlaps(box, b))) continue;
      const hl = Math.min(headLen, 0.5 * L);
      const base: Pt = [tip[0] + nrm[0] * hl, tip[1] + nrm[1] * hl];
      out.push({
        tail,
        base,
        tip,
        b1: [base[0] - nrm[1] * headHalf, base[1] + nrm[0] * headHalf],
        b2: [base[0] + nrm[1] * headHalf, base[1] - nrm[0] * headHalf],
      });
    }
  }
  return out;
}
