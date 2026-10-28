/**
 * Steady seepage by finite elements on the slope's mesh, for pore pressures
 * from flow instead of a drawn water line.
 *
 * Head h on the six-node triangles, ∇·(k ∇h) = 0. Boundary conditions:
 *  - on the ground surface where the water table is at or above the ground
 *    (a reservoir, ponded water, the water level at a downstream toe): the
 *    head of the water there, h = y_w;
 *  - elsewhere on the ground surface: a seepage face, h = y, at the nodes
 *    where flow would leave the soil with positive pressure, found by
 *    iteration (Neuman & Witherspoon 1970); no flow at the other nodes;
 *  - base and sides: no flow.
 * The free surface comes from the variable-permeability method (Bathe &
 * Khoshgoftaar 1979, Comput. Struct. 10, 785–790; Desai 1976): above the
 * phreatic surface (p < 0) the permeability is k·k_r, falling linearly to
 * k_r = 10⁻³ over a pressure head of 2 % of the model height, so a single
 * fixed mesh carries saturated and residual flow; the Picard iteration is
 * under-relaxed and repeats until the heads and the seepage face settle. Pore pressure is
 * u = γw (h − y) ≥ 0; suction is not used for strength (χ = 0).
 */

import { WATER_UNIT_WEIGHT } from "../types/constants";
import type { Slope } from "../model/slope";
import { GP_STRIDE, GAUSS_T6, shapeT6 } from "./elements";
import { polylineY } from "./model";
import { reverseCuthillMcKee, SkylineMatrix } from "./skyline";

export interface SeepageMesh {
  x: Float64Array;
  y: Float64Array;
  nodeCount: number;
  el: Int32Array;
  elementCount: number;
  gp: Float64Array;
  /** Surface edges, 3 nodes each (end, middle, end). */
  surfaceEdges: Int32Array;
  /** Permeability per element (m/s). */
  permeability: Float64Array;
}

export interface SeepageResult {
  /** Total head per node (m). */
  head: Float64Array;
  iterations: number;
  converged: boolean;
  /** Nodes on a seepage face at the end. */
  seepageFaceNodes: number;
}

/** Relative permeability above the phreatic surface. */
const RESIDUAL_PERMEABILITY = 1e-3;

/** Steady head field on a mesh, with the water table of `slope` as reservoir and tail water. */
export function solveSeepage(mesh: SeepageMesh, slope: Slope, maxIterations = 80): SeepageResult {
  const { x, y, nodeCount: nn, el, elementCount: ne, gp } = mesh;
  const water = slope.waterRLXY;
  // Surface nodes and their water level.
  const onSurface = new Uint8Array(nn);
  for (const n of mesh.surfaceEdges) onSurface[n] = 1;
  const fixedHead = new Float64Array(nn).fill(NaN);
  const tol = 1e-6 * (1 + Math.max(...y) - Math.min(...y));
  for (let n = 0; n < nn; n++) {
    if (!onSurface[n] || !water) continue;
    const yw = polylineY(water, x[n]);
    if (Number.isFinite(yw) && yw >= y[n] - tol) fixedHead[n] = Math.max(yw, y[n]);
  }
  if (!fixedHead.some(Number.isFinite)) {
    // No water at the ground: no flow, hydrostatic below the water table if any.
    const head = new Float64Array(nn);
    for (let n = 0; n < nn; n++) head[n] = water ? polylineY(water, x[n]) : -Infinity;
    return { head, iterations: 0, converged: true, seepageFaceNodes: 0 };
  }
  // One unknown per node, in reverse Cuthill–McKee order.
  const nbr: Set<number>[] = Array.from({ length: nn }, () => new Set<number>());
  for (let e = 0; e < ne; e++) for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) if (a !== b) nbr[el[6 * e + a]].add(el[6 * e + b]);
  const order = reverseCuthillMcKee(nbr.map((q) => Int32Array.from(q)));
  const eqn = new Int32Array(nn);
  order.forEach((n, i) => (eqn[n] = i));
  const first = new Int32Array(nn);
  for (let n = 0; n < nn; n++) { let lo = eqn[n]; for (const m of nbr[n]) if (eqn[m] < lo) lo = eqn[m]; first[eqn[n]] = lo; }

  let head = new Float64Array(nn);
  for (let n = 0; n < nn; n++) head[n] = Number.isFinite(fixedHead[n]) ? fixedHead[n] : Math.max(...Array.from(fixedHead).filter(Number.isFinite));
  const seepFace = new Uint8Array(nn);
  const band = 0.02 * (Math.max(...y) - Math.min(...y));
  const N = new Float64Array(6);
  let converged = false, it = 0;
  for (; it < maxIterations && !converged; it++) {
    const K = new SkylineMatrix(first);
    for (let e = 0; e < ne; e++) {
      for (let g = 0; g < 3; g++) {
        const o = (3 * e + g) * GP_STRIDE, w = gp[o + 12];
        shapeT6(GAUSS_T6[g][0], GAUSS_T6[g][1], N);
        let h = 0, yy = 0;
        for (let k = 0; k < 6; k++) { h += N[k] * head[el[6 * e + k]]; yy += N[k] * y[el[6 * e + k]]; }
        // Linear between full and residual permeability over a pressure head
        // of `band` below zero: the step at p = 0 makes the iteration cycle.
        const kr = h >= yy ? 1 : Math.max(RESIDUAL_PERMEABILITY, 1 + (h - yy) / band);
        const kk = mesh.permeability[e] * kr * w;
        for (let a = 0; a < 6; a++) {
          for (let b = 0; b <= a; b++) {
            const v = kk * (gp[o + a] * gp[o + b] + gp[o + 6 + a] * gp[o + 6 + b]);
            K.add(eqn[el[6 * e + a]], eqn[el[6 * e + b]], v);
          }
        }
      }
    }
    // Dirichlet nodes by a penalty on the diagonal (heads are O(10–100) m).
    let big = 0;
    for (let i = 0; i < nn; i++) big = Math.max(big, K.values[K.diag[i]]);
    big *= 1e10;
    const b = new Float64Array(nn);
    for (let n = 0; n < nn; n++) {
      const hf = Number.isFinite(fixedHead[n]) ? fixedHead[n] : seepFace[n] ? y[n] : NaN;
      if (Number.isFinite(hf)) { K.values[K.diag[eqn[n]]] += big; b[eqn[n]] = big * hf; }
    }
    K.factor();
    K.solve(b);
    const rhs = new Float64Array(nn);
    for (let n = 0; n < nn; n++) rhs[n] = b[eqn[n]];
    // Seepage face: a free surface node with h > y joins it; a face node whose
    // reaction draws water in (outflow < 0) leaves it.
    let changed = 0;
    for (let n = 0; n < nn; n++) {
      if (!onSurface[n] || Number.isFinite(fixedHead[n])) continue;
      if (!seepFace[n] && rhs[n] > y[n] + tol) { seepFace[n] = 1; changed++; }
    }
    // Pressure signs (and so the permeability) settled and no face change.
    // Under-relaxed update (Picard iteration on the permeability).
    // The relaxation shrinks over the iterations, which damps the small
    // cycles the permeability switch causes near the phreatic surface.
    const omega = it < 3 ? 1 : Math.max(0.1, 0.6 * 0.93 ** (it - 3));
    let maxDh = 0;
    for (let n = 0; n < nn; n++) {
      maxDh = Math.max(maxDh, Math.abs(rhs[n] - head[n]));
      rhs[n] = omega * rhs[n] + (1 - omega) * head[n];
    }
    head = rhs;
    // Converged when the (relaxed) change is below 0.1 % of the heads; the
    // unrelaxed solution may keep a cycle of a few centimetres of head.
    converged = changed === 0 && omega * maxDh < 1e-3 * (1 + Math.max(...head.filter(Number.isFinite)));
  }
  let faces = 0;
  for (const v of seepFace) faces += v;
  return { head, iterations: it, converged, seepageFaceNodes: faces };
}

/** Pore pressure (kPa) at a point from nodal heads interpolated in an element. */
export function porePressureFromHead(h: number, yy: number): number {
  return Math.max(0, WATER_UNIT_WEIGHT * (h - yy));
}
