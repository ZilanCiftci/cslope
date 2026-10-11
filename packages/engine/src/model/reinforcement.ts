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
import { resolveStrength, resolveUnitWeight } from "../types/index";
import { WATER_UNIT_WEIGHT } from "../types/constants";
import type { Pile, Reinforcement, ReinforcementForce } from "../types/reinforcement";
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

interface Crossing {
  slice: Slice;
  /** Crossing point. */
  px: number;
  py: number;
  /** Position along the line, 0 (start) – 1 (end). */
  t: number;
  /** Direction of movement along the base (towards +x). */
  tx: number;
  ty: number;
}

/**
 * Crossings of a line with the slice bases of a slip surface; a crossing
 * at a slice edge lies on both slices' bases and is reported once.
 */
function crossings(slices: Slice[], x1: number, y1: number, x2: number, y2: number): Crossing[] {
  const ex = x2 - x1;
  const ey = y2 - y1;
  const len = Math.hypot(ex, ey);
  const out: Crossing[] = [];
  if (!(len > 0)) return out;
  for (const s of slices) {
    const bx0 = s.xLeft;
    const by0 = s.y0Bottom;
    const bdx = s.xRight - s.xLeft;
    const bdy = s.y1Bottom - s.y0Bottom;
    const blen = Math.hypot(bdx, bdy);
    if (!(blen > 0)) continue;
    const denom = bdx * ey - bdy * ex;
    if (Math.abs(denom) < 1e-12 * blen * len) continue; // parallel
    const qx = x1 - bx0;
    const qy = y1 - by0;
    const u = (qx * ey - qy * ex) / denom;
    const t = (qx * bdy - qy * bdx) / denom;
    if (u < 0 || u > 1 || t < 0 || t > 1) continue;
    const px = bx0 + u * bdx;
    const py = by0 + u * bdy;
    if (out.some((c) => Math.abs(c.px - px) < 1e-9 && Math.abs(c.py - py) < 1e-9)) continue;
    out.push({ slice: s, px, py, t, tx: bdx / blen, ty: bdy / blen });
  }
  return out;
}

/**
 * Add a force (fx, fy per metre, +x sliding, +y up) acting at (px, py) to
 * a slice's reinforcement loads; (cx, cy) the centre / axis point.
 */
function addForce(
  s: Slice,
  force: ReinforcementForce,
  cx: number,
  cy: number,
): void {
  const fDown = -force.fy;
  // Moment beyond fDown·dx, which the solvers take with the slice load.
  const moment = fDown * (cx - force.x) + force.fx * (cy - force.y) - fDown * s.dx;
  const load = force.passive ? (s.reinforcementPassive ??= [0, 0, 0]) : (s.reinforcementActive ??= [0, 0, 0]);
  load[0] += fDown;
  load[1] += force.fx;
  load[2] += moment;
  (s.reinforcementForces ??= []).push(force);
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
  const forces: ReinforcementForce[] = [];
  if (slices.length === 0) return forces;
  const elements = slope.reinforcements;
  const envelopes = elements.length > 0 ? slope.reinforcementEnvelopes : [];
  elements.forEach((r, k) => {
    const env = envelopes[k];
    if (!(env.length > 0)) return;
    const ax = (r.x2 - r.x1) / env.length;
    const ay = (r.y2 - r.y1) / env.length;
    for (const { slice, px, py, t, tx, ty } of crossings(slices, r.x1, r.y1, r.x2, r.y2)) {
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
      const force: ReinforcementForce = {
        index: k,
        x: px,
        y: py,
        fx: fx * magnitude,
        fy: fy * magnitude,
        force: magnitude,
        passive: (r.application ?? "active") === "passive",
      };
      addForce(slice, force, cx, cy);
      forces.push(force);
    }
  });

  // Piles push back against the movement, tilted by their angle.
  slope.piles.forEach((p, k) => {
    for (const { slice, px, py } of crossings(slices, p.x1, p.y1, p.x2, p.y2)) {
      const magnitude = pileForce(slope, p, px, py).perMetre;
      if (!(magnitude > 0)) continue;
      const a = ((p.angle ?? 0) * Math.PI) / 180;
      const force: ReinforcementForce = {
        index: k,
        pile: true,
        x: px,
        y: py,
        fx: -magnitude * Math.cos(a),
        fy: magnitude * Math.sin(a),
        force: magnitude,
        passive: (p.application ?? "active") === "passive",
      };
      addForce(slice, force, cx, cy);
      forces.push(force);
    }
  });
  return forces;
}

/**
 * Ito & Matsui (1975) coefficients of the lateral pressure on a pile,
 * p(z) = c·A1 + γ·z·A2, for clear spacing D1, diameter D and friction
 * angle φ. The φ = 0 solution (their Eq. 23) is a lower bound for every φ:
 * the c-φ expressions dip below it at small φ, which is unphysical.
 */
export function itoMatsuiCoefficients(D1: number, D: number, phiDeg: number): [number, number] {
  const S = D1 + D;
  const A1phi0 = S * (3 * Math.log(S / D1) + (D / D1) * Math.tan(Math.PI / 8) - 2) + 2 * D1;
  const A2phi0 = D;
  if (phiDeg < 0.01) return [A1phi0, A2phi0];
  const phi = (phiDeg * Math.PI) / 180;
  const Nphi = Math.tan(Math.PI / 4 + phi / 2) ** 2;
  const sN = Math.sqrt(Nphi);
  const tp = Math.tan(phi);
  const R = (S / D1) ** (sN * tp + Nphi - 1);
  const E = Math.exp((D / D1) * Nphi * tp * Math.tan(Math.PI / 8 + phi / 4));
  const A2 = (S * R * E - D1) / Nphi;
  const F = (2 * tp + 2 * sN + 1 / sN) / (sN * tp + Nphi - 1);
  const A1 = (S * R * (E - 2 * sN * tp - 1)) / (Nphi * tp) + S * F * (R - 1) + (2 * D1) / sN;
  return [Math.max(A1, A1phi0), Math.max(A2, A2phi0)];
}

/**
 * Force of a pile where the slip surface crosses it at (x, y): per pile
 * and per metre of slope, and what governs it.
 */
export function pileForce(
  slope: Slope,
  p: Pile,
  x: number,
  y: number,
): { perPile: number; perMetre: number; governs: "given" | "soil" | "shear" | "bending" } {
  const spacing = p.spacing ?? 1;
  const surf = slope.surfaceLineXY;
  const yGround = surf ? getYAtX(surf.x, surf.y, x) : NaN;
  const depth = Number.isFinite(yGround) ? Math.max(0, yGround - y) : 0;
  let perPile: number;
  let governs: "given" | "soil" | "shear" | "bending";
  // Arm of the soil pressure above the slip surface, for the bending limit.
  let arm = depth / 3;
  if (p.force !== undefined) {
    perPile = p.force;
    governs = "given";
  } else {
    // Ito & Matsui: integrate p(z) from the ground to the slip surface,
    // with each layer's c, φ and γ (γ·z with the layer's γ, as the theory
    // and Slide2 do).
    const D = p.diameter!;
    const D1 = spacing - D;
    const n = Math.min(400, Math.max(20, Math.ceil(depth / 0.05)));
    const dz = depth / n;
    let force = 0;
    let moment = 0;
    for (let k = 0; k < n && depth > 0; k++) {
      const z = (k + 0.5) * dz;
      const yy = yGround - z;
      const m = slope.materialGeometries.find((g) => isPointInPolygon(x, yy, g.px, g.py))?.material;
      if (!m) continue;
      const st = resolveStrength(m.model, { yBottom: yy, x, yGround, alpha: 0 });
      if (!Number.isFinite(st.cohesion)) continue; // high strength: no soil to push
      const [A1, A2] = itoMatsuiCoefficients(D1, D, st.frictionAngle);
      const pz = st.cohesion * A1 + resolveUnitWeight(m.model, m.unitWeight, x, yy) * z * A2;
      force += pz * dz;
      moment += pz * dz * (depth - z);
    }
    perPile = force;
    governs = "soil";
    if (force > 0) arm = moment / force;
  }
  if (p.shearCapacity !== undefined && p.shearCapacity < perPile) {
    perPile = p.shearCapacity;
    governs = "shear";
  }
  if (p.momentCapacity !== undefined && arm > 0 && p.momentCapacity / arm < perPile) {
    perPile = p.momentCapacity / arm;
    governs = "bending";
  }
  return { perPile, perMetre: perPile / spacing, governs };
}
