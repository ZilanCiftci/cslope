/**
 * A posteriori error estimation and mesh refinement.
 *
 * Method and sources:
 * - Error indicator of Zienkiewicz & Zhu (1987, IJNME 24(2), 337–357): the
 *   finite element stresses are compared with a recovered, continuous
 *   stress field σ*, here the area-weighted nodal average of the element
 *   stresses interpolated linearly over each element, and
 *   η_e² = ∫_e (σ* − σ_h)ᵀ C (σ* − σ_h) dA with C the elastic compliance.
 * - Dissipation indicator (the default in analysis.ts): the plastic
 *   dissipation per element, after the dissipation-based adaptivity of
 *   finite element limit analysis (Lyamin, Sloan, Krabbenhøft & Hjiaj
 *   2005, IJNME 63(14), 1961–1974; Ciria, Peraire & Bonet 2008, IJNME
 *   75(8), 899–944).
 * - Marking by Dörfler's bulk criterion (Dörfler 1996, SIAM J. Numer.
 *   Anal. 33(3), 1106–1124): the smallest set of elements whose indicators
 *   sum to a fraction θ of the total.
 *
 * Implementation choices (not from the literature): C approximated by
 * 1/E; the dissipation taken from the accumulated viscoplastic strain at
 * the factor of safety (the limit analysis papers use the dissipation of
 * the collapse mechanism); marked elements get half their size in the
 * next mesh, through a size field on the old mesh; θ = 0.3 in analysis.ts.
 */

import { GP_STRIDE } from "./elements";
import type { FeModel } from "./model";

/** Squared error indicator per element from Gauss point stresses (4 per point). */
export function zzIndicator(model: FeModel, stress: Float64Array): Float64Array {
  const { el, elementCount: ne, cornerCount: nc, gp } = model;
  const nodal = new Float64Array(4 * nc);
  const weight = new Float64Array(nc);
  const area = new Float64Array(ne);
  for (let e = 0; e < ne; e++) {
    let a = 0;
    const mean = [0, 0, 0, 0];
    for (let g = 0; g < 3; g++) {
      const w = gp[(3 * e + g) * GP_STRIDE + 12];
      a += w;
      for (let k = 0; k < 4; k++) mean[k] += stress[4 * (3 * e + g) + k] * w;
    }
    area[e] = a;
    for (let c = 0; c < 3; c++) {
      const n = el[6 * e + c];
      weight[n] += a;
      for (let k = 0; k < 4; k++) nodal[4 * n + k] += mean[k];
    }
  }
  for (let n = 0; n < nc; n++) if (weight[n] > 0) for (let k = 0; k < 4; k++) nodal[4 * n + k] /= weight[n];
  // Area coordinates of the three Gauss points (L1, L2, L3).
  const L = [[2 / 3, 1 / 6, 1 / 6], [1 / 6, 2 / 3, 1 / 6], [1 / 6, 1 / 6, 2 / 3]];
  const eta2 = new Float64Array(ne);
  for (let e = 0; e < ne; e++) {
    const inv = 1 / model.elE[e];
    let s = 0;
    for (let g = 0; g < 3; g++) {
      const w = gp[(3 * e + g) * GP_STRIDE + 12];
      for (let k = 0; k < 4; k++) {
        let rec = 0;
        for (let c = 0; c < 3; c++) rec += L[g][c] * nodal[4 * el[6 * e + c] + k];
        const d = rec - stress[4 * (3 * e + g) + k];
        s += (k === 2 ? 2 : 1) * d * d * inv * w;
      }
    }
    eta2[e] = s;
  }
  return eta2;
}

function edge(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

/** Dörfler marking: the elements with the largest indicators that carry a fraction θ of the total. */
export function dorflerMark(eta2: Float64Array, theta = 0.5): Uint8Array {
  const order = Array.from(eta2.keys()).sort((a, b) => eta2[b] - eta2[a]);
  let total = 0;
  for (const v of eta2) total += v;
  const marked = new Uint8Array(eta2.length);
  let acc = 0;
  for (const e of order) {
    if (acc >= theta * total) break;
    marked[e] = 1;
    acc += eta2[e];
  }
  return marked;
}

/**
 * Size field for the next mesh: the target size the element was made with
 * (the model's size field at its centroid), halved where marked, looked up
 * by point location in the old mesh on a bucket grid. A marked element is
 * also never coarser than half its longest edge.
 */
export function refinedSizeField(model: FeModel, marked: Uint8Array, minSize = 0): ((x: number, y: number) => number) & { min: number } {
  const { el, elementCount: ne, x, y } = model;
  const size = new Float64Array(ne);
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (let e = 0; e < ne; e++) {
    const a = el[6 * e], b = el[6 * e + 1], c = el[6 * e + 2];
    // Unmarked elements keep their target size: their real edges lie below
    // the mesher's split threshold of 1.4 × the target, so a size from the
    // edge lengths would refine them too.
    const target = model.sizeField((x[a] + x[b] + x[c]) / 3, (y[a] + y[b] + y[c]) / 3);
    if (marked[e]) {
      const h = Math.max(edge(x[a] - x[b], y[a] - y[b]), edge(x[b] - x[c], y[b] - y[c]), edge(x[c] - x[a], y[c] - y[a]));
      size[e] = Math.max(minSize, Math.min(target, h) / 2);
    } else size[e] = Math.max(minSize, target);
    for (const n of [a, b, c]) {
      xmin = Math.min(xmin, x[n]); xmax = Math.max(xmax, x[n]);
      ymin = Math.min(ymin, y[n]); ymax = Math.max(ymax, y[n]);
    }
  }
  const nb = Math.max(1, Math.ceil(Math.sqrt(ne / 4)));
  const dx = (xmax - xmin) / nb || 1, dy = (ymax - ymin) / nb || 1;
  const buckets: number[][] = Array.from({ length: nb * nb }, () => []);
  const cell = (px: number, py: number) => [
    Math.min(nb - 1, Math.max(0, Math.floor((px - xmin) / dx))),
    Math.min(nb - 1, Math.max(0, Math.floor((py - ymin) / dy))),
  ];
  for (let e = 0; e < ne; e++) {
    const ns = [el[6 * e], el[6 * e + 1], el[6 * e + 2]];
    const [i0, j0] = cell(Math.min(...ns.map((n) => x[n])), Math.min(...ns.map((n) => y[n])));
    const [i1, j1] = cell(Math.max(...ns.map((n) => x[n])), Math.max(...ns.map((n) => y[n])));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) buckets[j * nb + i].push(e);
  }
  let fallback = 0;
  for (const h of size) fallback = Math.max(fallback, h);
  let smallest = Infinity;
  for (const h of size) smallest = Math.min(smallest, h);
  const field = (px: number, py: number) => {
    const [i, j] = cell(px, py);
    let best = fallback, bestD = Infinity;
    for (const e of buckets[j * nb + i]) {
      const a = el[6 * e], b = el[6 * e + 1], c = el[6 * e + 2];
      const d = ((y[b] - y[c]) * (x[a] - x[c]) + (x[c] - x[b]) * (y[a] - y[c]));
      const l1 = ((y[b] - y[c]) * (px - x[c]) + (x[c] - x[b]) * (py - y[c])) / d;
      const l2 = ((y[c] - y[a]) * (px - x[c]) + (x[a] - x[c]) * (py - y[c])) / d;
      const l3 = 1 - l1 - l2;
      const out = -Math.min(l1, l2, l3);
      if (out <= 1e-9) return size[e];
      if (out < bestD) { bestD = out; best = size[e]; }
    }
    return best;
  };
  return Object.assign(field, { min: smallest });
}

/**
 * Plastic dissipation per element, ∫_e |σ : ε_vp| dA, from the stresses and
 * accumulated viscoplastic strains at the factor of safety. It concentrates
 * in the failure mechanism, which is where the factor of safety is decided
 * (see the sources in the file header).
 */
export function dissipationIndicator(model: FeModel, stress: Float64Array, evp: Float64Array): Float64Array {
  const out = new Float64Array(model.elementCount);
  for (let e = 0; e < model.elementCount; e++) {
    let s = 0;
    for (let g = 0; g < 3; g++) {
      const i = 3 * e + g, o = 4 * i;
      const w = model.gp[i * GP_STRIDE + 12];
      s += Math.abs(stress[o] * evp[o] + stress[o + 1] * evp[o + 1] + stress[o + 2] * evp[o + 2] + stress[o + 3] * evp[o + 3]) * w;
    }
    out[e] = s;
  }
  return out;
}
