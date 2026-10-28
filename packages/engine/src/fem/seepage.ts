/**
 * Steady seepage by finite elements on the slope's mesh, for pore pressures
 * from flow instead of a drawn water line.
 *
 * Head h on the six-node triangles, ∇·(k ∇h) = 0 (Galerkin finite
 * elements). Boundary conditions:
 *  - on the ground surface where the water table is at or above the ground
 *    (a reservoir, ponded water, the water level at a downstream toe): the
 *    head of the water there, h = y_w, imposed by a large number on the
 *    diagonal (penalty), as Bathe & Khoshgoftaar (1979) impose prescribed
 *    heads;
 *  - elsewhere on the ground surface: a seepage face, h = y, at the nodes
 *    where water leaves the soil, and no flow at the others. The face is
 *    found by switching nodes between the two conditions until neither
 *    inequality is violated (h ≤ y on the no-flow part, outflow on the
 *    face): Neuman & Witherspoon 1970, Water Resour. Res. 6(3), 889–897;
 *    Cooley 1983, Water Resour. Res. 19(5), 1271–1285;
 *  - vertical sides of the model: the head of the water table, h = y_w,
 *    below it (far-field hydrostatic water, so that a water table drawn
 *    below the ground is held at the model's edges), no flow above it;
 *  - base: no flow.
 *
 * Free surface on a fixed mesh: the permeability depends on the pressure
 * head ψ = h − y (Bathe & Khoshgoftaar 1979, Int. J. Numer. Anal. Meth.
 * Geomech. 3(1), 13–22), full where ψ ≥ 0 and, above the phreatic surface,
 * k·k_r(ψ) with the relative permeability of van Genuchten (1980, Soil Sci.
 * Soc. Am. J. 44(5), 892–898) and Mualem (1976, Water Resour. Res. 12(3),
 * 513–522): S_e = [1 + (α|ψ|)ⁿ]^(−m), m = 1 − 1/n,
 * k_r = S_e^½ [1 − (1 − S_e^(1/m))^m]². The default α = 3.6 m⁻¹ and
 * n = 1.56 are the class averages for loam of Carsel & Parrish (1988,
 * Water Resour. Res. 24(5), 755–769). The nonlinear problem is solved by
 * Picard iteration on the permeability with Aitken's dynamic
 * under-relaxation (see below). Pore pressure is u = γw (h − y) ≥ 0;
 * suction is not used for strength (χ = 0).
 *
 * Implementation choices (not from the literature): k_r is bounded below
 * by 10⁻⁶ to keep the system well conditioned; at most 80 iterations;
 * convergence when the unrelaxed change of the heads is below 0.1 % of
 * the range of heads and elevations; a corner node of the seepage face is
 * judged by its flow with half of each adjacent face edge's midside flow
 * (lumped), because the consistent flows of a six-node edge can show
 * inflow at a corner under outflow from the whole edge.
 */

import { WATER_UNIT_WEIGHT } from "../types/constants";
import type { Slope } from "../model/slope";
import { GP_STRIDE, GAUSS_T6, shapeT6 } from "./elements";
import { polylineY } from "./model";
import { nestedDissection, nodeGraph, SparseCholesky } from "./sparse";

export interface SeepageMesh {
  x: Float64Array;
  y: Float64Array;
  nodeCount: number;
  el: Int32Array;
  elementCount: number;
  gp: Float64Array;
  /** Surface edges, 3 nodes each (end, middle, end). */
  surfaceEdges: Int32Array;
  /** Nodes on the vertical sides of the model. */
  sideNodes: Int32Array;
  /** Permeability per element (m/s). */
  permeability: Float64Array;
  /** van Genuchten α (1/m) and n per element. */
  vgAlpha: Float64Array;
  vgN: Float64Array;
}

export interface SeepageResult {
  /** Total head per node (m). */
  head: Float64Array;
  iterations: number;
  converged: boolean;
  /** Nodes on a seepage face at the end. */
  seepageFaceNodes: number;
  /** False when no head is prescribed anywhere: no flow is computed and `head` is the water table. */
  flow: boolean;
}

/** Lower bound of the relative permeability (implementation choice). */
const MIN_RELATIVE_PERMEABILITY = 1e-6;

/** Relative permeability of van Genuchten (1980) and Mualem (1976) at pressure head ψ (m). */
export function vanGenuchtenMualem(psi: number, alpha: number, n: number): number {
  if (psi >= 0) return 1;
  const m = 1 - 1 / n;
  const se = (1 + (alpha * -psi) ** n) ** -m;
  const kr = Math.sqrt(se) * (1 - (1 - se ** (1 / m)) ** m) ** 2;
  return Math.max(MIN_RELATIVE_PERMEABILITY, kr);
}

/** Steady head field on a mesh, with the water table of `slope` as reservoir and tail water. */
export function solveSeepage(mesh: SeepageMesh, slope: Slope, maxIterations = 80): SeepageResult {
  const { x, y, nodeCount: nn, el, elementCount: ne, gp } = mesh;
  const water = slope.waterRLXY;
  // Surface nodes and their water level.
  const onSurface = new Uint8Array(nn);
  for (const n of mesh.surfaceEdges) onSurface[n] = 1;
  const fixedHead = new Float64Array(nn).fill(NaN);
  let yMin = Infinity, yMax = -Infinity;
  for (let n = 0; n < nn; n++) { yMin = Math.min(yMin, y[n]); yMax = Math.max(yMax, y[n]); }
  const tol = 1e-6 * (1 + yMax - yMin);
  for (let n = 0; n < nn; n++) {
    if (!onSurface[n] || !water) continue;
    const yw = polylineY(water, x[n]);
    if (Number.isFinite(yw) && yw >= y[n] - tol) fixedHead[n] = Math.max(yw, y[n]);
  }
  if (water) {
    for (const n of mesh.sideNodes) {
      const yw = polylineY(water, x[n]);
      if (Number.isFinite(yw) && yw >= y[n]) fixedHead[n] = yw;
    }
  }
  if (!fixedHead.some(Number.isFinite)) {
    // No water anywhere on the boundary: no flow.
    const head = new Float64Array(nn);
    for (let n = 0; n < nn; n++) head[n] = water ? polylineY(water, x[n]) : -Infinity;
    return { head, iterations: 0, converged: true, seepageFaceNodes: 0, flow: false };
  }
  // Corner nodes of surface edges, and the midside node of each, for the
  // lumped flows of the seepage face.
  const surfaceCorner = new Uint8Array(nn);
  const se = mesh.surfaceEdges;
  for (let k = 0; k < se.length; k += 3) { surfaceCorner[se[k]] = 1; surfaceCorner[se[k + 2]] = 1; }
  let hRange = -Infinity;
  for (let n = 0; n < nn; n++) if (Number.isFinite(fixedHead[n])) hRange = Math.max(hRange, fixedHead[n]);
  hRange = Math.max(hRange, yMax) - yMin;
  // One unknown per node, in nested dissection order.
  const order = nestedDissection(x, y, nodeGraph(el, ne, nn));
  const eqn = new Int32Array(nn);
  order.forEach((n, i) => (eqn[n] = i));
  const elEq = new Int32Array(6 * ne);
  for (let k = 0; k < 6 * ne; k++) elEq[k] = eqn[el[k]];
  const pattern = SparseCholesky.fromGroups(nn, elEq, 6);

  // Start from the highest prescribed head everywhere.
  let hMax = -Infinity;
  for (let n = 0; n < nn; n++) if (Number.isFinite(fixedHead[n])) hMax = Math.max(hMax, fixedHead[n]);
  let head = new Float64Array(nn);
  for (let n = 0; n < nn; n++) head[n] = Number.isFinite(fixedHead[n]) ? fixedHead[n] : hMax;
  const seepFace = new Uint8Array(nn);
  // Element conductivity matrices of the current iteration (6 × 6 each),
  // for the nodal flows of the seepage face.
  const elK = new Float64Array(36 * ne);
  const N = new Float64Array(6);
  let converged = false, it = 0;
  let omega = 1;
  let prevR: Float64Array | null = null;
  for (; it < maxIterations && !converged; it++) {
    const K = pattern.emptyCopy();
    elK.fill(0);
    for (let e = 0; e < ne; e++) {
      for (let g = 0; g < 3; g++) {
        const o = (3 * e + g) * GP_STRIDE, w = gp[o + 12];
        shapeT6(GAUSS_T6[g][0], GAUSS_T6[g][1], N);
        let h = 0, yy = 0;
        for (let k = 0; k < 6; k++) { h += N[k] * head[el[6 * e + k]]; yy += N[k] * y[el[6 * e + k]]; }
        const kr = vanGenuchtenMualem(h - yy, mesh.vgAlpha[e], mesh.vgN[e]);
        const kk = mesh.permeability[e] * kr * w;
        for (let a = 0; a < 6; a++) {
          for (let b = 0; b <= a; b++) {
            const v = kk * (gp[o + a] * gp[o + b] + gp[o + 6 + a] * gp[o + 6 + b]);
            K.add(eqn[el[6 * e + a]], eqn[el[6 * e + b]], v);
            elK[36 * e + 6 * a + b] += v;
            if (a !== b) elK[36 * e + 6 * b + a] += v;
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
    // Nodal flows K·h: the water a prescribed node supplies (> 0 enters the
    // ground); zero at a free node.
    const flow = new Float64Array(nn);
    for (let e = 0; e < ne; e++) {
      for (let a = 0; a < 6; a++) {
        let q = 0;
        for (let c = 0; c < 6; c++) q += elK[36 * e + 6 * a + c] * rhs[el[6 * e + c]];
        flow[el[6 * e + a]] += q;
      }
    }
    let qMax = 0;
    for (let n = 0; n < nn; n++) if (Number.isFinite(fixedHead[n]) || seepFace[n]) qMax = Math.max(qMax, Math.abs(flow[n]));
    // Seepage face: a free surface node with h > y joins it; a face node that
    // draws water in leaves it (water only leaves the ground there). A
    // corner node is judged by its lumped flow (file header).
    const lumped = flow.slice();
    for (let k = 0; k < se.length; k += 3) {
      const m = se[k + 1];
      lumped[se[k]] += 0.5 * flow[m];
      lumped[se[k + 2]] += 0.5 * flow[m];
    }
    let changed = 0;
    for (let n = 0; n < nn; n++) {
      if (!onSurface[n] || Number.isFinite(fixedHead[n])) continue;
      const q = surfaceCorner[n] ? lumped[n] : flow[n];
      if (!seepFace[n] && rhs[n] > y[n] + tol) { seepFace[n] = 1; changed++; }
      else if (seepFace[n] && q > 1e-6 * qMax) { seepFace[n] = 0; changed++; }
    }
    // Under-relaxed Picard update with Aitken's dynamic relaxation factor
    // (Irons & Tuck 1969, IJNME 1(3), 275–277; Küttler & Wall 2008, Comput.
    // Mech. 43(1), 61–72): with the residual r_k = h̃_k − h_k of the fixed
    // point, ω_k = −ω_(k−1) r_(k−1)ᵀ(r_k − r_(k−1)) / |r_k − r_(k−1)|².
    // Bounding ω to [0.05, 1] is an implementation choice.
    const r = new Float64Array(nn);
    let maxDh = 0;
    for (let n = 0; n < nn; n++) {
      r[n] = rhs[n] - head[n];
      maxDh = Math.max(maxDh, Math.abs(r[n]));
    }
    if (prevR) {
      let num = 0, den = 0;
      for (let n = 0; n < nn; n++) {
        const d = r[n] - prevR[n];
        num += prevR[n] * d;
        den += d * d;
      }
      if (den > 0) omega = Math.min(1, Math.max(0.05, (-omega * num) / den));
    }
    prevR = r;
    for (let n = 0; n < nn; n++) rhs[n] = head[n] + omega * r[n];
    head = rhs;
    // Converged when the unrelaxed change (the fixed point residual) is
    // below 0.1 % of the range of heads and the seepage face no longer
    // changes; a small relaxation factor does not make the step pass.
    converged = changed === 0 && maxDh < 1e-3 * (1 + hRange);
  }
  let faces = 0;
  for (const v of seepFace) faces += v;
  return { head, iterations: it, converged, seepageFaceNodes: faces, flow: true };
}

/** Pore pressure (kPa) at a point from nodal heads interpolated in an element. */
export function porePressureFromHead(h: number, yy: number): number {
  return Math.max(0, WATER_UNIT_WEIGHT * (h - yy));
}
