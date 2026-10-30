/**
 * Transfer of a converged state to a refined mesh of the same slope, as the
 * starting state of the strength reduction there (analysis.ts).
 *
 * The displacements are interpolated at the new nodes with the old
 * element's quadratic shape functions; the plastic strains and stresses of
 * a new Gauss point are those of the nearest Gauss point of the old element
 * that contains it (Peric, Hochard, Dutko & Owen 1996, Comput. Methods Appl.
 * Mech. Eng. 137, 331–344, transfer of the internal variables by the
 * Gauss points). The state is not in equilibrium on the new mesh: it only
 * starts the iteration, and each trial is decided there as before.
 */

import { shapeT6 } from "./elements";
import type { FeModel } from "./model";
import type { SrmState } from "./srm";

/** The old element containing (px, py) and its local coordinates (ξ, η), by a bucket grid of the old elements' boxes. */
function locator(m: FeModel): (px: number, py: number) => [number, number, number] | null {
  const { x, y, el, elementCount: ne } = m;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < m.cornerCount; i++) { x0 = Math.min(x0, x[i]); x1 = Math.max(x1, x[i]); y0 = Math.min(y0, y[i]); y1 = Math.max(y1, y[i]); }
  const nb = Math.max(1, Math.ceil(Math.sqrt(ne))), dx = (x1 - x0) / nb || 1, dy = (y1 - y0) / nb || 1;
  const cells: number[][] = Array.from({ length: nb * nb }, () => []);
  const cell = (v: number, v0: number, d: number) => Math.min(nb - 1, Math.max(0, Math.floor((v - v0) / d)));
  for (let e = 0; e < ne; e++) {
    const a = el[6 * e], b = el[6 * e + 1], c = el[6 * e + 2];
    const i0 = cell(Math.min(x[a], x[b], x[c]), x0, dx), i1 = cell(Math.max(x[a], x[b], x[c]), x0, dx);
    const j0 = cell(Math.min(y[a], y[b], y[c]), y0, dy), j1 = cell(Math.max(y[a], y[b], y[c]), y0, dy);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) cells[j * nb + i].push(e);
  }
  const local = (e: number, px: number, py: number): [number, number] => {
    const a = el[6 * e], b = el[6 * e + 1], c = el[6 * e + 2];
    const ax = x[b] - x[a], ay = y[b] - y[a], bx = x[c] - x[a], by = y[c] - y[a];
    const det = ax * by - ay * bx, qx = px - x[a], qy = py - y[a];
    return [(qx * by - qy * bx) / det, (ax * qy - ay * qx) / det];
  };
  return (px, py) => {
    // the element whose local coordinates are least outside it (a point on
    // an edge, or just off the outline by rounding, still finds one)
    let best = -1, bestOut = Infinity, bxi = 0, beta = 0;
    for (const e of cells[cell(py, y0, dy) * nb + cell(px, x0, dx)]) {
      const [xi, eta] = local(e, px, py);
      const out = Math.max(0, -xi, -eta, xi + eta - 1);
      if (out < bestOut) { bestOut = out; best = e; bxi = xi; beta = eta; if (out === 0) break; }
    }
    return best >= 0 && bestOut < 1e-6 ? [best, bxi, beta] : null;
  };
}

/** The converged `state` of `from` as a starting state on the mesh of `to`; null where a point of `to` lies outside `from`. */
export function transferState(from: FeModel, state: SrmState, to: FeModel): SrmState | null {
  const find = locator(from);
  const N = new Float64Array(6);
  const u = new Float64Array(to.eqCount);
  for (let n = 0; n < to.nodeCount; n++) {
    const ix = to.eq[2 * n], iy = to.eq[2 * n + 1];
    if (ix < 0 && iy < 0) continue;
    const hit = find(to.x[n], to.y[n]);
    if (!hit) return null;
    const [e, xi, eta] = hit;
    shapeT6(xi, eta, N);
    let ux = 0, uy = 0;
    for (let k = 0; k < 6; k++) {
      const node = from.el[6 * e + k];
      const qx = from.eq[2 * node], qy = from.eq[2 * node + 1];
      if (qx >= 0) ux += N[k] * state.u[qx];
      if (qy >= 0) uy += N[k] * state.u[qy];
    }
    if (ix >= 0) u[ix] = ux;
    if (iy >= 0) u[iy] = uy;
  }
  const ngp = 3 * to.elementCount;
  const evp = new Float64Array(4 * ngp), stress = new Float64Array(4 * ngp);
  for (let g = 0; g < ngp; g++) {
    const px = to.gpX[g], py = to.gpY[g];
    const hit = find(px, py);
    if (!hit) return null;
    const e = hit[0];
    let src = 3 * e, d = Infinity;
    for (let k = 0; k < 3; k++) {
      const s = 3 * e + k, dd = (from.gpX[s] - px) ** 2 + (from.gpY[s] - py) ** 2;
      if (dd < d) { d = dd; src = s; }
    }
    for (let c = 0; c < 4; c++) { evp[4 * g + c] = state.evp[4 * src + c]; stress[4 * g + c] = state.stress[4 * src + c]; }
  }
  return { u, evp, bodyLoads: new Float64Array(to.eqCount), stress, barEp: new Float64Array(0) };
}
