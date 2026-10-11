/**
 * Reinforcement forces on the sliding mass.
 *
 * The capacity available at a point s along an element (distance from
 * end 1, length L) is the smallest of its tensile capacity and the force
 * that pullout can develop from either end:
 *
 *   T(s) = min(Tmax, T1 + ∫₀ˢ r, T2 + ∫ₛᴸ r)
 *
 * with r the pullout resistance per metre and T1, T2 the end anchorage
 * capacities. Without pullout both ends are fully anchored (T = Tmax).
 * Forces are per metre of slope: capacities are divided by the spacing.
 */

import type { Slice } from "../types/index";
import { resolveUnitWeight } from "../types/index";
import { WATER_UNIT_WEIGHT } from "../types/constants";
import type { Reinforcement, ReinforcementForce } from "../types/reinforcement";
import { getYAtX, isPointInPolygon } from "../math/index";
import type { Slope } from "./slope";

/** Capacity envelope of one element, per element (not per metre). */
export interface ReinforcementEnvelope {
  length: number;
  /** Stations along the element (0..length, increasing). */
  s: Float64Array;
  /** Pullout developed from end 1 up to each station, ∫₀ˢ r. */
  fromEnd1: Float64Array;
  tensile: number;
  end1: number;
  end2: number;
  /** Fully anchored ends: Tmax everywhere. */
  anchored: boolean;
  /**
   * Development lengths from end 1 and end 2 (pullout kind
   * "development"); then `s`/`fromEnd1` are unused.
   */
  development?: [number, number];
}

/**
 * Effective vertical stress at (x, y): the weight of the soil column
 * between the ground and the point (γsat below a material's water line)
 * less the pore pressure there.
 */
export function effectiveVerticalStress(slope: Slope, x: number, y: number): number {
  const surf = slope.surfaceLineXY;
  if (!surf) return 0;
  const yGround = getYAtX(surf.x, surf.y, x);
  if (!Number.isFinite(yGround) || y >= yGround) return 0;
  const materialAt = (yy: number) =>
    slope.materialGeometries.find((g) => isPointInPolygon(x, yy, g.px, g.py))?.material ?? null;
  const waterAt = (m: ReturnType<typeof materialAt>) => {
    const line = m ? slope.getWaterLineForMaterial(m) : null;
    if (!line) return -Infinity;
    const wy = getYAtX(line.x, line.y, x);
    return Number.isFinite(wy) ? wy : -Infinity;
  };
  const depth = yGround - y;
  const n = Math.min(100, Math.max(4, Math.ceil(depth / 0.25)));
  const dz = depth / n;
  let sigma = 0;
  for (let k = 0; k < n; k++) {
    const yy = yGround - (k + 0.5) * dz;
    const m = materialAt(yy);
    if (!m) continue;
    let gamma = resolveUnitWeight(m.model, m.unitWeight, x, yy);
    const gammaSat = m.model.unitWeightSat;
    if (gammaSat !== undefined && yy < waterAt(m)) gamma = gammaSat;
    sigma += gamma * dz;
  }
  const u = Math.max(0, waterAt(materialAt(y)) - y) * WATER_UNIT_WEIGHT;
  return Math.max(0, sigma - u);
}

/** Capacity envelope of an element in the slope (per element). */
export function buildEnvelope(slope: Slope, r: Reinforcement): ReinforcementEnvelope {
  const length = Math.hypot(r.x2 - r.x1, r.y2 - r.y1);
  const base = {
    length,
    tensile: r.tensileCapacity,
    end1: r.end1Capacity ?? 0,
    end2: r.end2Capacity ?? 0,
  };
  const p = r.pullout;
  if (!p) {
    return { ...base, s: new Float64Array([0, length]), fromEnd1: new Float64Array(2), anchored: true };
  }
  if (p.kind === "development") {
    return {
      ...base,
      anchored: false,
      s: new Float64Array([0, length]),
      fromEnd1: new Float64Array(2),
      development: [p.length1, p.length2],
    };
  }
  if (p.kind === "bond") {
    // Constant bond over the bonded length at end 2 (default: all of it).
    const bonded = Math.min(length, p.bondedLength ?? length);
    const start = length - bonded;
    return {
      ...base,
      anchored: false,
      s: new Float64Array([0, start, length]),
      fromEnd1: new Float64Array([0, 0, p.strength * bonded]),
    };
  }
  // Interface friction: r = 2(a + σ′v tan δ), integrated along the element.
  const n = Math.min(200, Math.max(20, Math.ceil(length / 0.1)));
  const s = new Float64Array(n + 1);
  const fromEnd1 = new Float64Array(n + 1);
  const tanDelta = Math.tan((p.frictionAngle * Math.PI) / 180);
  // r is per metre of slope; the envelope is kept per element (× spacing).
  const perElement = (p.coverage ?? 1) * (r.spacing ?? 1);
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    const x = r.x1 + t * (r.x2 - r.x1);
    const y = r.y1 + t * (r.y2 - r.y1);
    const rate = 2 * (p.adhesion + effectiveVerticalStress(slope, x, y) * tanDelta) * perElement;
    s[k + 1] = ((k + 1) / n) * length;
    fromEnd1[k + 1] = fromEnd1[k] + rate * (length / n);
  }
  return { ...base, anchored: false, s, fromEnd1 };
}

/** Pullout developed from end 1 up to distance s, ∫₀ˢ r (per element). */
function developedFromEnd1(env: ReinforcementEnvelope, s: number): number {
  const { s: st, fromEnd1 } = env;
  const last = st.length - 1;
  if (s <= 0) return 0;
  if (s >= env.length) return fromEnd1[last];
  let k = 1;
  while (k < last && st[k] < s) k++;
  const span = st[k] - st[k - 1];
  const t = span > 0 ? (s - st[k - 1]) / span : 1;
  return fromEnd1[k - 1] + t * (fromEnd1[k] - fromEnd1[k - 1]);
}

/**
 * Pullout resistance beyond distance s towards end 2 (per element): the
 * end-2 anchorage plus the pullout developed between s and end 2 — what a
 * pullout table gives for the resisting zone behind a failure surface.
 */
export function pulloutBeyond(env: ReinforcementEnvelope, s: number): number {
  if (env.anchored) return Infinity;
  if (env.development) {
    const l2 = env.development[1];
    return l2 > 0 ? env.end2 + (env.tensile * Math.max(0, env.length - s)) / l2 : Infinity;
  }
  return env.end2 + env.fromEnd1[env.fromEnd1.length - 1] - developedFromEnd1(env, s);
}

/** Capacity (per element) at distance s from end 1. */
export function envelopeAt(env: ReinforcementEnvelope, s: number): number {
  if (env.anchored) return env.tensile;
  if (env.development) {
    // Linear development over each length; length 0: fully anchored end.
    const l1 = env.development[0];
    const from1 = l1 > 0 ? env.end1 + (env.tensile * Math.max(0, s)) / l1 : Infinity;
    return Math.max(0, Math.min(env.tensile, from1, pulloutBeyond(env, s)));
  }
  const developed = developedFromEnd1(env, s);
  return Math.max(0, Math.min(env.tensile, env.end1 + developed, pulloutBeyond(env, s)));
}

/**
 * Apply the reinforcement forces to the slices of a slip surface: where
 * an element crosses a slice base, its force acts on that slice at the
 * crossing. The force pulls the sliding mass towards the part of the
 * element in stable ground; an element that the movement would push
 * (compress) carries nothing. (cx, cy) is the centre / axis point for
 * moments, the solvers' convention: driving moment of a force
 * (Fx, Fdown) at (x, y) is Fdown·(cx − x) + Fx·(cy − y).
 *
 * Returns the applied forces.
 */
export function applyReinforcement(
  slope: Slope,
  slices: Slice[],
  cx: number,
  cy: number,
): ReinforcementForce[] {
  const elements = slope.reinforcements;
  if (elements.length === 0 || slices.length === 0) return [];
  const envelopes = slope.reinforcementEnvelopes;
  const forces: ReinforcementForce[] = [];
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    const bx0 = s.xLeft;
    const by0 = s.y0Bottom;
    const bdx = s.xRight - s.xLeft;
    const bdy = s.y1Bottom - s.y0Bottom;
    const blen = Math.hypot(bdx, bdy);
    if (!(blen > 0)) continue;
    // Direction of movement along the base (towards +x).
    const tx = bdx / blen;
    const ty = bdy / blen;
    const lastSlice = i === slices.length - 1;
    for (let k = 0; k < elements.length; k++) {
      const r = elements[k];
      const env = envelopes[k];
      if (!(env.length > 0)) continue;
      const ax = (r.x2 - r.x1) / env.length;
      const ay = (r.y2 - r.y1) / env.length;
      // Intersection of the base segment (u ∈ [0, 1)) with the element (t ∈ [0, 1]).
      const ex = r.x2 - r.x1;
      const ey = r.y2 - r.y1;
      const denom = bdx * ey - bdy * ex;
      if (Math.abs(denom) < 1e-12 * blen * env.length) continue; // parallel
      const qx = r.x1 - bx0;
      const qy = r.y1 - by0;
      const u = (qx * ey - qy * ex) / denom;
      const t = (qx * bdy - qy * bdx) / denom;
      if (u < 0 || u > 1 || (u === 1 && !lastSlice) || t < 0 || t > 1) continue;
      const px = bx0 + u * bdx;
      const py = by0 + u * bdy;
      // Stable side: +a points into the sliding mass when it lies above
      // (to the left of) the base direction.
      const into = tx * ay - ty * ax > 0;
      const dx = into ? -ax : ax;
      const dy = into ? -ay : ay;
      // Tension only: the movement must pull away from the stable part.
      if (dx * tx + dy * ty >= 0) continue;
      const magnitude = envelopeAt(env, t * env.length) / (r.spacing ?? 1);
      if (!(magnitude > 0)) continue;
      let fx: number;
      let fy: number;
      const direction = r.direction ?? "axial";
      if (direction === "tangent") {
        fx = -tx;
        fy = -ty;
      } else if (direction === "bisector") {
        const bxv = dx - tx;
        const byv = dy - ty;
        const bl = Math.hypot(bxv, byv);
        fx = bxv / bl;
        fy = byv / bl;
      } else {
        fx = dx;
        fy = dy;
      }
      fx *= magnitude;
      fy *= magnitude;
      const passive = (r.application ?? "active") === "passive";
      const fDown = -fy;
      // Moment beyond fDown·dx, which the solvers take with the slice load.
      const moment = fDown * (cx - px) + fx * (cy - py) - fDown * s.dx;
      const load = passive ? (s.reinforcementPassive ??= [0, 0, 0]) : (s.reinforcementActive ??= [0, 0, 0]);
      load[0] += fDown;
      load[1] += fx;
      load[2] += moment;
      const force = { index: k, x: px, y: py, fx, fy, force: magnitude, passive };
      (s.reinforcementForces ??= []).push(force);
      forces.push(force);
    }
  }
  return forces;
}
