/**
 * Data shared by the lower and upper bound limit analyses (lower-bound.ts,
 * upper-bound.ts): the strength, pore pressure and unit weight of the
 * strength reduction model (model.ts) at points of a limit analysis mesh,
 * and the line loads spread over the ground surface.
 */

import { WATER_UNIT_WEIGHT } from "../types/constants";
import type { Slope } from "../model/slope";
import type { Material } from "../types/material";
import { designStrength, needsLayerTop } from "../types/strength";
import { materialLayerTopAt } from "../model/geometry-ops";
import { gaussUnitWeight, polylineY, type FeModel } from "./model";

type Line = { x: number[]; y: number[] };

/** Centroids of the 16 sub-triangles of a 4 × 4 subdivision, in area coordinates (r, s). */
export const WEIGHT_POINTS: [number, number][] = [];
for (let i = 0; i < 4; i++) {
  for (let j = 0; i + j < 4; j++) {
    WEIGHT_POINTS.push([(i + 1 / 3) / 4, (j + 1 / 3) / 4]);
    if (i + j < 3) WEIGHT_POINTS.push([(i + 2 / 3) / 4, (j + 2 / 3) / 4]);
  }
}

/**
 * Design strength of material `m` at (px, py), as in the strength reduction
 * model (model.ts): depth from the layer top, partial factors applied.
 * `phi` in radians (0 when undrained); `cu` the undrained cap of a combined
 * material, Infinity where there is none.
 */
export function strengthAt(slope: Slope, m: Material, surface: Line, px: number, py: number): { c: number; phi: number; cu: number } {
  const yGround = polylineY(surface, px);
  const yLayerTop = needsLayerTop(m.model) ? (materialLayerTopAt(slope.materialGeometries, m, px, py) ?? yGround) : undefined;
  const s = m.getStrength({ yBottom: py, x: px, yGround, alpha: 0, ...(yLayerTop !== undefined ? { yLayerTop } : {}) });
  const d = designStrength(m.model.kind, s, slope.partialFactors);
  return {
    c: Math.max(0, d.cohesion),
    phi: d.undrained ? 0 : slope.partialFactors ? Math.atan(d.tanPhi) : (s.frictionAngle * Math.PI) / 180,
    cu: s.isCombined && !d.undrained ? Math.max(0, d.cohesionUndrained) : Infinity,
  };
}

/** Pore pressure at (x, y): from the seepage heads at node n when the model has them, else from the water line. */
export function porePressureAt(head: Float64Array | undefined, n: number, waterLine: Line | null | undefined, x: number, y: number): number {
  if (head) return Number.isFinite(head[n]) ? Math.max(0, WATER_UNIT_WEIGHT * (head[n] - y)) : 0;
  if (waterLine) {
    const yw = polylineY(waterLine, x);
    return Number.isFinite(yw) ? Math.max(0, WATER_UNIT_WEIGHT * (yw - y)) : 0;
  }
  return 0;
}

/**
 * Mean unit weight over the triangle (γsat below the water as in the
 * deformation analysis), by the midpoint rule on 16 equal sub-triangles, so
 * that an element cut by the water table carries close to its true weight
 * (the deformation analysis' three Gauss points weigh it in thirds).
 * `u` the pore pressures at the three corners.
 */
export function meanUnitWeight(
  m: Material,
  waterLine: Line | null | undefined,
  seepage: boolean,
  xs: readonly number[],
  ys: readonly number[],
  u: readonly number[],
): number {
  let gamma = 0;
  for (const [r, s2] of WEIGHT_POINTS) {
    const t = 1 - r - s2;
    const gx = t * xs[0] + r * xs[1] + s2 * xs[2], gy = t * ys[0] + r * ys[1] + s2 * ys[2];
    gamma += gaussUnitWeight(m, waterLine ?? null, seepage, t * u[0] + r * u[1] + s2 * u[2], gx, gy) / WEIGHT_POINTS.length;
  }
  return gamma;
}

/**
 * Line loads as strip loads on the ground surface: a concentrated load has
 * no bounded traction, so each is spread as uniform strip loads over the
 * two surface edges meeting at its point (a mesh vertex, model.ts), in
 * inverse proportion to their horizontal lengths, which keeps its resultant
 * and its point of action. Where only one edge with a horizontal extent
 * meets the point (at the end of the surface or the top of a vertical face)
 * the load is spread over it linearly from 2P/d at the point to 0, its
 * resultant d/3 from the point. Variable loads take the partial factor γQ,
 * as in the slices.
 * @returns the vertical load per horizontal metre at each end of the
 * surface edges it acts on, keyed `${edgeKey(a, b)}:${node}`.
 */
export function surfaceLineLoads(
  slope: Slope,
  model: FeModel,
  edgeKey: (a: number, b: number) => number,
  warnings: string[],
): Map<string, number> {
  const { x, y } = model;
  const lineQ = new Map<string, number>();
  const addQ = (edge: number, node: number, q: number) => lineQ.set(`${edge}:${node}`, (lineQ.get(`${edge}:${node}`) ?? 0) + q);
  const loadFactor = slope.partialFactors?.variableLoad ?? 1;
  for (const ll of slope.lineLoads) {
    let v = -1;
    for (let s = 0; s < model.surfaceEdges.length; s += 3) {
      for (const node of [model.surfaceEdges[s], model.surfaceEdges[s + 2]]) {
        if (Math.abs(x[node] - ll.x) <= 1e-9 * (1 + Math.abs(ll.x)) && (v < 0 || y[node] > y[v])) v = node;
      }
    }
    if (v < 0) { warnings.push(`A line load at x = ${ll.x} is not on the mesh's ground surface and is not included.`); continue; }
    const adj: [number, number, number][] = []; // edge key, horizontal length, the other node
    for (let s = 0; s < model.surfaceEdges.length; s += 3) {
      const a = model.surfaceEdges[s], b = model.surfaceEdges[s + 2];
      if ((a === v || b === v) && Math.abs(x[b] - x[a]) > 0) adj.push([edgeKey(a, b), Math.abs(x[b] - x[a]), a === v ? b : a]);
    }
    const P = ll.magnitude * loadFactor;
    if (adj.length === 1) {
      const [k1, d1, o1] = adj[0];
      addQ(k1, v, (2 * P) / d1);
      addQ(k1, o1, 0);
      warnings.push(`The line load at x = ${ll.x} is spread over one element edge; its point of action moves ${(d1 / 3).toFixed(2)} m into the slope.`);
    } else if (adj.length >= 2) {
      const [[k1, d1, o1], [k2, d2, o2]] = adj;
      // P1 = P d2/(d1 + d2) on edge 1 and P2 = P d1/(d1 + d2) on edge 2: P1 d1/2 = P2 d2/2.
      const q1 = (P * d2) / (d1 + d2) / d1, q2 = (P * d1) / (d1 + d2) / d2;
      addQ(k1, v, q1); addQ(k1, o1, q1);
      addQ(k2, v, q2); addQ(k2, o2, q2);
    }
  }
  return lineQ;
}
