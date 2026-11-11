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
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import type { Slice } from "../types/geometry";
import type { Pile, Reinforcement, ReinforcementForce } from "../types/reinforcement";
import type { Slope } from "./slope";
import { wasm } from "../facade/internal";
import { h, onSlices } from "../facade/wire";

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
 * Ito & Matsui pressure on a vertical pile, integrated down from its head
 * (or the ground, if lower): at depths z[k] below the ground, the force
 * F[k] = ∫p dz and the moment Q[k] = ∫p·z dz per pile. Strength as in the
 * analysis (design values with partial factors), γz as the effective
 * vertical stress (γ as the slices weigh it, less the pore pressure).
 */
export interface PileProfile {
  z: Float64Array;
  F: Float64Array;
  Q: Float64Array;
}

type EnvelopeWire = Omit<ReinforcementEnvelope, "s" | "fromEnd1"> & { s: number[]; fromEnd1: number[] };
type ProfileWire = { z: number[]; F: number[]; Q: number[] };

function envelopeIn(e: EnvelopeWire): ReinforcementEnvelope {
  return { ...e, s: Float64Array.from(e.s), fromEnd1: Float64Array.from(e.fromEnd1) };
}

function envelopeOut(e: ReinforcementEnvelope): EnvelopeWire {
  return { ...e, s: Array.from(e.s), fromEnd1: Array.from(e.fromEnd1) };
}

function profileIn(p: ProfileWire | null | undefined): PileProfile | null {
  return p ? { z: Float64Array.from(p.z), F: Float64Array.from(p.F), Q: Float64Array.from(p.Q) } : null;
}

/**
 * Effective vertical stress at (x, y): the weight of the soil column
 * between the ground and the point (γsat below a material's water line)
 * less the pore pressure there.
 */
export function effectiveVerticalStress(slope: Slope, x: number, y: number): number {
  return wasm().effective_vertical_stress(h(slope), x, y);
}

/**
 * Vertical stress at (x, y) from the soil column (and ponded water) above
 * it: effective (σv − u) or total (σv, for undrained strengths, which are
 * total-stress parameters).
 */
export function verticalStress(slope: Slope, x: number, y: number, effective: boolean): number {
  return wasm().vertical_stress(h(slope), x, y, effective);
}

/**
 * Effective vertical stress at (x, y) with the slope's distributed loads:
 * `effectiveVerticalStress` plus each load over x, for the yield stress a
 * SHANSEP material keeps from an earlier stage (its geometry, water and
 * loads). A load acts as a strip load straight down, without spreading
 * with depth (as the slices take it on their bases); a load normal to the
 * ground counts with its vertical part, which is its magnitude per
 * horizontal metre. The loads are characteristic (the earlier stage is a
 * stress history, not a design state). The part of a load carried by
 * excess pore pressure in the material at the point (`excessPorePressure`)
 * does not count where the point is below the water (as the slices take
 * it). Reinforcement pullout uses `effectiveVerticalStress`, without the
 * loads.
 */
export function effectiveVerticalStressWithLoads(slope: Slope, x: number, y: number): number {
  return wasm().effective_vertical_stress_with_loads(h(slope), x, y);
}

/** Capacity envelope of an element in the slope (per element). */
export function buildEnvelope(slope: Slope, r: Reinforcement): ReinforcementEnvelope {
  return envelopeIn(wasm().build_envelope(h(slope), r) as EnvelopeWire);
}

/**
 * Pullout resistance beyond distance s towards end 2 (per element): the
 * end-2 anchorage plus the pullout developed between s and end 2 — what a
 * pullout table gives for the resisting zone behind a failure surface.
 */
export function pulloutBeyond(env: ReinforcementEnvelope, s: number): number {
  return wasm().pullout_beyond(envelopeOut(env), s);
}

/** Capacity (per element) at distance s from end 1. */
export function envelopeAt(env: ReinforcementEnvelope, s: number): number {
  return wasm().envelope_at(envelopeOut(env), s);
}

/**
 * Apply the reinforcement forces to the slices of a slip surface: where
 * an element crosses a slice base, its force acts on that slice at the
 * crossing. The force pulls the sliding mass towards the part of the
 * element in stable ground. A passive element that the movement would
 * push (compress) more than 2° past the normal to the base carries
 * nothing; an active element always carries its force, along itself
 * where it is pushed. (cx, cy) is the centre / axis point for
 * moments, the solvers' convention: driving moment of a force
 * (Fx, Fdown) at (x, y) is Fdown·(cx − x) + Fx·(cy − y).
 *
 * Returns the applied forces.
 */
export function applyReinforcement(slope: Slope, slices: Slice[], cx: number, cy: number): ReinforcementForce[] {
  return onSlices(slope, slices, (w) => wasm().apply_reinforcement(h(slope), w, cx, cy));
}

/**
 * Unit direction of a pile's force on the sliding mass (+x sliding, +y up)
 * for the movement (tx, ty) along the slip surface at the crossing.
 */
export function pileForceDirection(p: Pile, tx: number, ty: number): [number, number] {
  const d = wasm().pile_force_direction(p, tx, ty);
  return [d[0], d[1]];
}

/**
 * Ito & Matsui (1975) coefficients of the lateral pressure on a pile,
 * p(z) = c·A1 + γ·z·A2, for clear spacing D1, diameter D and friction
 * angle φ. The φ = 0 solution (their Eq. 23) is a lower bound for every φ:
 * the c-φ expressions dip below it at small φ, which is unphysical.
 */
export function itoMatsuiCoefficients(D1: number, D: number, phiDeg: number): [number, number] {
  const c = wasm().ito_matsui_coefficients(D1, D, phiDeg);
  return [c[0], c[1]];
}

export function buildPileProfile(slope: Slope, p: Pile): PileProfile | null {
  return profileIn(wasm().build_pile_profile(h(slope), p) as ProfileWire | null);
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
  profile?: PileProfile | null,
): { perPile: number; perMetre: number; governs: "given" | "soil" | "shear" | "bending"; resultantAbove: number } {
  const wire = profile === undefined ? undefined : profile === null ? null : { z: Array.from(profile.z), F: Array.from(profile.F), Q: Array.from(profile.Q) };
  return wasm().pile_force(h(slope), p, x, y, wire) as ReturnType<typeof pileForce>;
}
