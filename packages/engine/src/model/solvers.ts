/**
 * Factor of Safety (FOS) solvers for slope stability analysis.
 *
 * All Numba JIT functions are ported to plain TypeScript loops.
 */

import type { Slice } from "../types/index";
import { getIntersliceFunctionValue, extrapolateLambda } from "../math/index";
import type { Slope, SearchPlane } from "./slope";
import { getSlices, WATER_LINE_GAP } from "./slices";
import { instantaneousAtNormalStress } from "../types/hoek-brown";
import { designStrength } from "../types/strength";
import {
  setEntryExitPlanes,
  generateRefinedPlanes,
  generateLocalPlanes,
  planeKey,
} from "./search";
import { optimiseNonCircular, optimisePolylines } from "./optimize";
import { BLOCK_SEEDS, bestDistinct, blockSearch } from "./block-search";
import { analyseMorgensternPriceMarch, LAMBDA_MAX, LAMBDA_MIN } from "./mp-march";

/**
 * Which Morgenstern-Price solver `analyseSlope` runs: the iterative one
 * (default) or the experimental march solver (`mp-march.ts`), for
 * comparison runs. Not an analysis option: set by scripts and tests.
 */
let morgensternPriceSolver: "iterative" | "march" = "iterative";
export function setMorgensternPriceSolver(solver: "iterative" | "march"): void {
  morgensternPriceSolver = solver;
}


// ────────────────────────────────────────────────────────────────
// Slice property arrays (replaces _get_slice_property_arrays)
// ────────────────────────────────────────────────────────────────

interface SliceArrays {
  weights: Float64Array;
  udls: Float64Array;
  lls: Float64Array;
  hForces: Float64Array;
  extraMoments: Float64Array;
  /** Reinforcement [down, horizontal, moment]: active as is, passive ÷ F. */
  activeV: Float64Array;
  activeH: Float64Array;
  activeM: Float64Array;
  passiveV: Float64Array;
  passiveH: Float64Array;
  passiveM: Float64Array;
  /** Moment arms of base shear and normal force about the centre. */
  shearArms: Float64Array;
  normalArms: Float64Array;
  alphas: Float64Array;
  baseLengths: Float64Array;
  phis: Float64Array;
  Us: Float64Array;
  cohesions: Float64Array;
  cohesionUndraineds: Float64Array;
  materialCodes: Int32Array;
  dxs: Float64Array;
  funcs: Float64Array;
  /** The slices themselves: the solvers note which strength governed. */
  slices: Slice[];
}

export function getSlicePropertyArrays(
  slices: Slice[],
  x0: number,
  x1: number,
  intersliceFunction: Slope["intersliceFunction"],
  intersliceDataPoints: Slope["intersliceDataPoints"],
): SliceArrays {
  const n = slices.length;
  const weights = new Float64Array(n);
  const udls = new Float64Array(n);
  const lls = new Float64Array(n);
  const hForces = new Float64Array(n);
  const extraMoments = new Float64Array(n);
  const activeV = new Float64Array(n);
  const activeH = new Float64Array(n);
  const activeM = new Float64Array(n);
  const passiveV = new Float64Array(n);
  const passiveH = new Float64Array(n);
  const passiveM = new Float64Array(n);
  const shearArms = new Float64Array(n);
  const normalArms = new Float64Array(n);
  const alphas = new Float64Array(n);
  const baseLengths = new Float64Array(n);
  const phis = new Float64Array(n);
  const Us = new Float64Array(n);
  const cohesions = new Float64Array(n);
  const cohesionUndraineds = new Float64Array(n);
  const materialCodes = new Int32Array(n);
  const dxs = new Float64Array(n);
  const funcs = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const s = slices[i];
    weights[i] = s.weight;
    // Free water on the slice acts like a surface load.
    udls[i] = s.udl + (s.waterLoad ?? 0);
    lls[i] = s.ll;
    hForces[i] = s.hForce ?? 0;
    extraMoments[i] = s.extraMoment ?? 0;
    if (s.reinforcementActive) {
      [activeV[i], activeH[i], activeM[i]] = s.reinforcementActive;
    }
    if (s.reinforcementPassive) {
      [passiveV[i], passiveH[i], passiveM[i]] = s.reinforcementPassive;
    }
    shearArms[i] = s.R;
    normalArms[i] = s.normalArm ?? 0;
    alphas[i] = s.alpha;
    baseLengths[i] = s.baseLength;
    phis[i] = s.phi;
    Us[i] = s.U;
    cohesions[i] = s.cohesion;
    cohesionUndraineds[i] = s.cohesionUndrained;
    materialCodes[i] = s.isCombined ? 1 : 0;
    dxs[i] = s.dx;
    funcs[i] = getIntersliceFunctionValue(
      intersliceFunction,
      s.xRight,
      x0,
      x1,
      intersliceDataPoints,
    );
  }

  return {
    weights,
    udls,
    lls,
    hForces,
    extraMoments,
    activeV,
    activeH,
    activeM,
    passiveV,
    passiveH,
    passiveM,
    shearArms,
    normalArms,
    alphas,
    baseLengths,
    phis,
    Us,
    cohesions,
    cohesionUndraineds,
    materialCodes,
    dxs,
    funcs,
    slices,
  };
}

// ────────────────────────────────────────────────────────────────
// Low-level iterative solvers
// ────────────────────────────────────────────────────────────────

type SolverResult = [
  fos: number | null,
  pushing: number,
  resisting: number,
  N: Float64Array,
  converged: boolean,
];

/** Trial-FOS increases allowed when the driving side vanishes (×2 each: 0.1 → 400). */
const MAX_NON_POSITIVE = 12;

/**
 * Base normal force and right-hand interslice forces of one slice from
 * vertical equilibrium with the shear mobilised at the trial FOS.
 *
 * @param effC  effective cohesion force C' = c·l − U·l·tanφ (kN/m)
 * @param tanPhi tan of the friction angle governing the slice
 * @returns [N, E_right, X_right]
 */
export function solveSliceNormal(
  W: number,
  xLeft: number,
  eLeft: number,
  effC: number,
  tanPhi: number,
  cosA: number,
  sinA: number,
  shearFactor: number,
  fos: number,
): [number, number, number] {
  let malpha = cosA + (sinA * tanPhi) / fos;
  if (Math.abs(malpha) < 1e-12) malpha = malpha >= 0 ? 1e-12 : -1e-12;
  const baseConstant = eLeft + (effC * cosA) / fos;
  const nMultiplier = (tanPhi * cosA) / fos - sinA;
  const num = W + xLeft - (effC * sinA) / fos + baseConstant * shearFactor;
  let denom = malpha - nMultiplier * shearFactor;
  if (Math.abs(denom) < 1e-12) denom = denom >= 0 ? 1e-12 : -1e-12;
  const N = num / denom;
  const eRight = baseConstant + N * nMultiplier;
  return [N, eRight, -eRight * shearFactor];
}

/**
 * Generic moment equilibrium FOS solver.
 */
function solveFOSGenericMoment(
  p: SliceArrays,
  lambdaVal: number,
  initialFOS: number,
  maxIters: number,
  tolerance: number,
): SolverResult {
  const n = p.weights.length;
  const nCurrent = new Float64Array(n);
  let prevFOS = initialFOS;
  let fos = initialFOS;
  let pushing = 0;
  let resisting = 0;
  let nonPositive = 0;
  let secF = 0;
  let secR = 0;

  let innerConverged = false;
  {
    for (let iter = 0; iter < maxIters; iter++) {
      pushing = 0;
      resisting = 0;
      let passiveMoment = 0;
      let eLeft = 0;
      let xLeft = 0;

      // Passive reinforcement mobilises with the soil: divided by F (an
      // initial guess of 0 from the Ordinary method would give NaN).
      const kP = prevFOS > 0 ? 1 / prevFOS : 1;
      for (let i = 0; i < n; i++) {
        const W =
          p.weights[i] + p.udls[i] + p.lls[i] + p.activeV[i] + p.passiveV[i] * kP;
        // Horizontal external force in the sliding direction; with the
        // solvers' sign of E it reduces the interslice force on the right.
        const H = p.hForces[i] + p.activeH[i] + p.passiveH[i] * kP;
        const c = p.cohesions[i];
        const bl = p.baseLengths[i];
        const a = p.alphas[i];
        const phi = p.phis[i];
        const U = p.Us[i];
        const dx = p.dxs[i];
        const f = p.funcs[i];
        const matCode = p.materialCodes[i];
        const cu = p.cohesionUndraineds[i];

        const tanPhi = Math.tan(phi);
        const cosA = Math.cos(a);
        const sinA = Math.sin(a);
        const shearFactor = lambdaVal * f;

        let [N, eRight, xRight] = solveSliceNormal(
          W,
          xLeft,
          eLeft - H,
          c * bl - U * bl * tanPhi,
          tanPhi,
          cosA,
          sinA,
          shearFactor,
          prevFOS,
        );
        const R = p.shearArms[i];
        const shear = c * bl + (N - U * bl) * tanPhi;
        let res = shear * R;
        // Combined method: where the undrained strength governs, the
        // slice must be in equilibrium with that (smaller) shear too; a
        // negative drained shear (N′ < 0, e.g. m_α < 0 on a steep slice)
        // is replaced the same way, which keeps the iteration stable.
        // (Compared as forces: on a non-circular surface the arm can be
        // negative.)
        let undrainedGoverns = false;
        if (matCode === 1 && !(shear >= 0 && shear <= cu * bl)) {
          undrainedGoverns = true;
          [N, eRight, xRight] = solveSliceNormal(
            W,
            xLeft,
            eLeft - H,
            cu * bl,
            0,
            cosA,
            sinA,
            shearFactor,
            prevFOS,
          );
          res = cu * bl * R;
        }
        resisting += res;
        if (matCode === 1) p.slices[i].undrainedGoverns = undrainedGoverns;

        // On a non-circular surface the normal force has a moment too.
        // Passive reinforcement is resistance: its moment is collected
        // unscaled and taken off the driving side below.
        pushing +=
          (W - p.passiveV[i] * kP) * dx +
          p.extraMoments[i] +
          p.activeM[i] +
          N * p.normalArms[i];
        passiveMoment += p.passiveV[i] * dx + p.passiveM[i];
        nCurrent[i] = N;
        eLeft = eRight;
        xLeft = xRight;
      }

      // F = R / (D + P/F)  ⇔  F = (R − P) / D, with P (< 0) the passive
      // moment: no division by a driving moment the passive force could
      // make vanish.
      resisting -= passiveMoment;
      // A trial FOS far too low can make the driving side vanish for one
      // iteration (large active loads, steep slices): raise the trial
      // value instead of giving up on the surface.
      if (pushing <= 0) {
        if (++nonPositive > MAX_NON_POSITIVE) return [null, pushing, resisting, nCurrent, false];
        prevFOS = Math.max(2 * prevFOS, 0.1);
        continue;
      }

      fos = resisting / pushing;
      if (Math.abs(prevFOS - fos) < tolerance) {
        innerConverged = true;
        break;
      }
      // Secant on r(F) = R(F)/D(F) − F, whose root is the fixed point: it
      // converges in a few iterations where the relaxed fixed-point step
      // F ← F + ½(R/D − F) needed 10–15. A step that leaves F ≤ 0.05 or
      // is not finite falls back to the plain fixed-point step.
      const r = fos - prevFOS;
      let next = fos;
      if (iter > 0 && r !== secR) next = prevFOS - (r * (prevFOS - secF)) / (r - secR);
      if (!(next > 0.05) || !Number.isFinite(next)) next = fos;
      secF = prevFOS;
      secR = r;
      prevFOS = next;
    }

  }
  return [fos, pushing, resisting, nCurrent, innerConverged];
}

/**
 * Generic force equilibrium FOS solver for circular surfaces.
 */
function solveFOSGenericForceCircular(
  p: SliceArrays,
  lambdaVal: number,
  initialFOS: number,
  maxIters: number,
  tolerance: number,
): SolverResult {
  const n = p.weights.length;
  const nCurrent = new Float64Array(n);
  let prevFOS = initialFOS;
  let fos = initialFOS;
  let pushing = 0;
  let resisting = 0;
  let nonPositive = 0;
  let secF = 0;
  let secR = 0;

  let innerConverged = false;
  {
    for (let iter = 0; iter < maxIters; iter++) {
      pushing = 0;
      resisting = 0;
      let passiveForce = 0;
      let eLeft = 0;
      let xLeft = 0;

      // Passive reinforcement mobilises with the soil: divided by F (an
      // initial guess of 0 from the Ordinary method would give NaN).
      const kP = prevFOS > 0 ? 1 / prevFOS : 1;
      for (let i = 0; i < n; i++) {
        const W =
          p.weights[i] + p.udls[i] + p.lls[i] + p.activeV[i] + p.passiveV[i] * kP;
        // Horizontal external force in the sliding direction; with the
        // solvers' sign of E it reduces the interslice force on the right.
        const H = p.hForces[i] + p.activeH[i] + p.passiveH[i] * kP;
        const c = p.cohesions[i];
        const bl = p.baseLengths[i];
        const a = p.alphas[i];
        const phi = p.phis[i];
        const U = p.Us[i];
        const f = p.funcs[i];
        const matCode = p.materialCodes[i];
        const cu = p.cohesionUndraineds[i];

        const tanPhi = Math.tan(phi);
        const cosA = Math.cos(a);
        const sinA = Math.sin(a);
        const shearFactor = lambdaVal * f;

        let [N, eRight, xRight] = solveSliceNormal(
          W,
          xLeft,
          eLeft - H,
          c * bl - U * bl * tanPhi,
          tanPhi,
          cosA,
          sinA,
          shearFactor,
          prevFOS,
        );
        // Circular force equilibrium resistance
        let res = c * bl * cosA + (N - U * bl) * cosA * tanPhi;
        // Combined method: where the undrained strength governs, N and the
        // interslice forces must follow from that shear as well.
        let undrainedGoverns = false;
        if (matCode === 1 && !(res >= 0 && res <= cu * bl * cosA)) {
          undrainedGoverns = true;
          [N, eRight, xRight] = solveSliceNormal(
            W,
            xLeft,
            eLeft - H,
            cu * bl,
            0,
            cosA,
            sinA,
            shearFactor,
            prevFOS,
          );
          res = cu * bl * cosA;
        }
        resisting += res;
        if (matCode === 1) p.slices[i].undrainedGoverns = undrainedGoverns;

        pushing += N * sinA + H - p.passiveH[i] * kP;
        passiveForce += p.passiveH[i];
        nCurrent[i] = N;
        eLeft = eRight;
        xLeft = xRight;
      }

      // Passive horizontal force (< 0) on the resisting side, as above.
      resisting -= passiveForce;
      // As in the moment solver: a too-low trial value is raised.
      if (pushing <= 0) {
        if (++nonPositive > MAX_NON_POSITIVE) return [null, pushing, resisting, nCurrent, false];
        prevFOS = Math.max(2 * prevFOS, 0.1);
        continue;
      }

      fos = resisting / pushing;
      if (Math.abs(prevFOS - fos) < tolerance) {
        innerConverged = true;
        break;
      }
      // Secant on r(F) = R(F)/D(F) − F, whose root is the fixed point: it
      // converges in a few iterations where the relaxed fixed-point step
      // F ← F + ½(R/D − F) needed 10–15. A step that leaves F ≤ 0.05 or
      // is not finite falls back to the plain fixed-point step.
      const r = fos - prevFOS;
      let next = fos;
      if (iter > 0 && r !== secR) next = prevFOS - (r * (prevFOS - secF)) / (r - secR);
      if (!(next > 0.05) || !Number.isFinite(next)) next = fos;
      secF = prevFOS;
      secR = r;
      prevFOS = next;
    }

  }
  return [fos, pushing, resisting, nCurrent, innerConverged];
}

// ────────────────────────────────────────────────────────────────
// High-level analysis methods
// ────────────────────────────────────────────────────────────────

/**
 * Ordinary (Swedish) method of slices.
 */
export function analyseOrdinary(_slope: Slope, slices: Slice[]): number | null {
  let pushing = 0;
  let resisting = 0;
  // External moments as forces along the base: divided by the mean shear
  // arm (the radius on a circle; per-slice arms on a polyline can be ~0).
  let armSum = 0;
  let lenSum = 0;
  for (const s of slices) {
    armSum += s.R * s.baseLength;
    lenSum += s.baseLength;
  }
  const meanArm = lenSum > 0 ? armSum / lenSum : 0;

  for (const s of slices) {
    // Reinforcement: active forces load the slice; passive ones (divided
    // by F in the solvers) are added to the resistance.
    const ra = s.reinforcementActive;
    const rp = s.reinforcementPassive;
    const W = sliceVerticalLoad(s) + (ra?.[0] ?? 0);
    const rMoment = ra?.[2] ?? 0;
    // A horizontal force (+x, sliding direction: reinforcement, water on
    // the ground or in a crack) lifts the slice off its base.
    const hNormal = ((ra?.[1] ?? 0) + (s.hForce ?? 0)) * Math.sin(s.alpha);
    if (rp && meanArm > 1e-9) {
      resisting -= (rp[0] * s.dx + rp[2]) / meanArm;
    }

    if (s.isCombined) {
      const fd =
        s.cohesion * s.baseLength +
        Math.max(0, W * Math.cos(s.alpha) - hNormal - s.U * s.baseLength) *
          Math.tan(s.phi);
      const fu = s.cohesionUndrained * s.baseLength;
      resisting += Math.min(fd, fu);
    } else {
      resisting +=
        s.cohesion * s.baseLength +
        Math.max(0, W * Math.cos(s.alpha) - hNormal - s.U * s.baseLength) *
          Math.tan(s.phi);
    }

    pushing +=
      W * Math.sin(s.alpha) +
      (meanArm > 1e-9 ? ((s.extraMoment ?? 0) + rMoment) / meanArm : 0);
  }

  if (pushing <= 0) return null;
  return resisting / pushing;
}

/**
 * Bishop's Simplified Method.
 */
export function analyseBishop(
  slope: Slope,
  slices: Slice[],
  FS?: number | null,
): [
  fos: number | null,
  pushing: number | null,
  resisting: number | null,
  converged: boolean,
] {
  if (FS == null) FS = analyseOrdinary(slope, slices);
  if (FS == null) return [FS, null, null, true];

  const x0 = slices[0].xLeft;
  const x1 = slices[slices.length - 1].xRight;
  const props = getSlicePropertyArrays(
    slices,
    x0,
    x1,
    slope.intersliceFunction,
    slope.intersliceDataPoints,
  );
  const [fos, pushing, resisting, , converged] = solveFOSGenericMoment(
    props,
    0, // lambda = 0
    FS,
    slope.maxIterations,
    slope.tolerance,
  );

  if (fos == null) return [null, null, null, false];
  return [fos, pushing, resisting, converged];
}

/**
 * Janbu correction factor f₀ (Janbu, 1973).
 *
 * The Simplified Method underestimates FOS because it neglects interslice
 * shear forces. The empirical correction compensates for this:
 *
 *   F_corrected = f₀ × F_simplified
 *   f₀ = 1 + b₁ × [d/L − 1.4 × (d/L)²]
 *
 * where L = length of the chord connecting the entry and exit points of
 * the failure surface and d = the greatest depth of the surface measured
 * perpendicular to that chord, and b₁ depends on soil type:
 *   c-only soil (φ=0): b₁ = 0.69
 *   φ-only soil (c=0): b₁ = 0.31
 *   c-φ soil:          b₁ = 0.50
 */
export function janbuCorrectionFactor(slices: Slice[]): number {
  if (slices.length === 0) return 1;

  // Entry and exit points on the failure surface
  const xEntry = slices[0].xLeft;
  const yEntry = slices[0].y0Bottom;
  const xExit = slices[slices.length - 1].xRight;
  const yExit = slices[slices.length - 1].y1Bottom;

  // L = chord length, d = largest depth perpendicular to the chord
  const L = Math.hypot(xExit - xEntry, yExit - yEntry);
  if (L <= 0) return 1;
  let d = 0;
  for (const s of slices) {
    // Signed distance of the base midpoint below the chord line
    const depth =
      ((xExit - xEntry) * (yEntry - s.yBottom) -
        (yExit - yEntry) * (xEntry - s.x)) /
      L;
    if (depth > d) d = depth;
  }

  const dOverL = d / L;

  // Determine b₁ from the soil type across all slices.
  // Pure cohesion (φ=0): b₁ = 0.69, pure friction (c=0): b₁ = 0.31, mixed: b₁ = 0.50
  let hasCohesion = false;
  let hasFriction = false;
  for (const s of slices) {
    if (s.cohesion > 0) hasCohesion = true;
    if (s.phi > 0) hasFriction = true;
    if (hasCohesion && hasFriction) break;
  }

  let b1: number;
  if (hasCohesion && hasFriction) {
    b1 = 0.5;
  } else if (hasCohesion) {
    b1 = 0.69;
  } else {
    b1 = 0.31;
  }

  // f₀ = 1 + b₁ × [d/L − 1.4 × (d/L)²]
  return 1 + b1 * (dOverL - 1.4 * dOverL * dOverL);
}

/**
 * Janbu's Simplified Method with correction factor f₀ (Janbu, 1973).
 *
 * Satisfies horizontal force equilibrium with λ = 0 (no interslice shear).
 * The empirical correction factor f₀ compensates for the systematic
 * underestimation inherent in the simplified assumption.
 */
export function analyseJanbu(
  slope: Slope,
  slices: Slice[],
  FS?: number | null,
): [
  fos: number | null,
  pushing: number | null,
  resisting: number | null,
  converged: boolean,
] {
  if (FS == null) FS = analyseOrdinary(slope, slices);
  if (FS == null) return [FS, null, null, true];

  const x0 = slices[0].xLeft;
  const x1 = slices[slices.length - 1].xRight;
  const props = getSlicePropertyArrays(
    slices,
    x0,
    x1,
    slope.intersliceFunction,
    slope.intersliceDataPoints,
  );
  const [fos, pushing, resisting, , converged] = solveFOSGenericForceCircular(
    props,
    0, // lambda = 0
    FS,
    slope.maxIterations,
    slope.tolerance,
  );

  if (fos == null) return [null, null, null, false];

  // Apply Janbu correction factor f₀ (only when enabled)
  const f0 = slope.janbuCorrection ? janbuCorrectionFactor(slices) : 1;
  const correctedFos = fos * f0;

  return [correctedFos, pushing, resisting, converged];
}

/**
 * Effective base normal force N′ = N − u·l (kN) of each slice of a solved
 * surface, as the method's own equilibrium gives it at its factor of
 * safety: Bishop at λ = 0 (moment equation), Janbu at λ = 0 (force
 * equation, with the uncorrected factor), Morgenstern–Price at the accepted
 * λ (the point of `lffArray` with the smallest gap). Null when the slices
 * cannot be solved at that factor. N′ can be negative (tension at the base
 * in cohesive soil without a tension crack).
 */
export function solvedEffectiveNormals(
  slope: Slope,
  slices: Slice[],
  fos: number,
  lffArray?: readonly (readonly [number, number, number, number])[] | null,
): number[] | null {
  if (slices.length === 0 || !Number.isFinite(fos)) return null;
  const props = getSlicePropertyArrays(
    slices,
    slices[0].xLeft,
    slices[slices.length - 1].xRight,
    slope.intersliceFunction,
    slope.intersliceDataPoints,
  );
  let normals: Float64Array;
  if (slope.method === "Janbu") {
    const f = slope.janbuCorrection ? fos / janbuCorrectionFactor(slices) : fos;
    const [solved, , , n] = solveFOSGenericForceCircular(props, 0, f, slope.maxIterations, slope.tolerance);
    if (solved == null) return null;
    normals = n;
  } else {
    let lambda = 0;
    if (slope.method === "Morgenstern-Price" && lffArray && lffArray.length > 0) {
      lambda = [...lffArray].sort((a, b) => a[3] - b[3])[0][0];
    }
    const [solved, , , n] = solveFOSGenericMoment(props, lambda, fos, slope.maxIterations, slope.tolerance);
    if (solved == null) return null;
    normals = n;
  }
  return Array.from(normals, (N, i) => N - props.Us[i] * props.baseLengths[i]);
}

/** λ extrapolation steps before falling back to the closest pair. */
const MP_MAX_STEPS = 30;

/**
 * Largest change of λ between two points. Fredlund (1984) moves λ by 0.1
 * per step; a larger jump can land the force iteration on another root of
 * the force equation (a near-pole root at λ = 0.4 on V017a, where the
 * step 0.3 was used).
 */
const MP_MAX_LAMBDA_STEP = 0.1;

/**
 * The factor where Fm(λ) and Ff(λ) meet, once the pair at `lambda` is
 * within the tolerance: the zero of Fm − Ff interpolated linearly in λ
 * between that pair and its nearest neighbour on the curves, and Fm
 * there. Fm at the accepted λ alone is off the crossing by up to about the
 * tolerance (0.7 % at the default 0.005 on fixed non-circular surfaces,
 * against a solution to 1e-9); near the root the curves are smooth, so the
 * secant through two points brings it to the precision of the pairs. With
 * no neighbour, or one that would extrapolate past it, the mean of the
 * pair.
 */
function crossingFOS(
  lffArray: readonly [number, number, number, number][],
  lambda: number,
  fm: number,
  ff: number,
): number {
  let near: [number, number, number, number] | null = null;
  for (const e of lffArray) {
    if (e[0] !== lambda && (!near || Math.abs(e[0] - lambda) < Math.abs(near[0] - lambda))) near = e;
  }
  const mean = (fm + ff) / 2;
  if (!near) return mean;
  const d = fm - ff;
  const dn = near[1] - near[2];
  if (dn === d) return mean;
  // Fraction of the way from `lambda` to the neighbour.
  const t = -d / (dn - d);
  if (!(Math.abs(t) <= 1)) return mean;
  const f = fm + t * (near[1] - fm);
  return f > 0 && Number.isFinite(f) ? f : mean;
}

/**
 * Morgenstern-Price Method.
 */
export function analyseMorgensternPrice(
  slope: Slope,
  slices: Slice[],
): [
  fos: number | null,
  lffArray: [number, number, number, number][] | null,
  pushing: number | null,
  resisting: number | null,
  /**
   * Complete equilibrium: Fm = Ff within the tolerance at some λ. False for
   * a closest-pair solution (see `closestPair`).
   */
  converged: boolean,
  /**
   * |Fm − Ff| of the closest pair when the two never met within the
   * tolerance; 0 or absent when they did.
   */
  equilibriumGap?: number,
  /**
   * The curves never met and the closest pair is accepted: both
   * iterations converged and the gap is at most `mpEquilibriumTolerance`.
   * The factor then satisfies moment equilibrium, force equilibrium only
   * within the gap, so it is no complete-equilibrium solution in the sense
   * of Morgenstern & Price (1965), Spencer (1967) and Fredlund & Krahn
   * (1977), which define it by Fm = Ff; `converged` is false.
   */
  closestPair?: boolean,
] {
  const FSord = analyseOrdinary(slope, slices);
  if (FSord == null) return [FSord, null, null, null, true];

  const x0 = slices[0].xLeft;
  const x1 = slices[slices.length - 1].xRight;
  const props = getSlicePropertyArrays(
    slices,
    x0,
    x1,
    slope.intersliceFunction,
    slope.intersliceDataPoints,
  );
  const maxIters = slope.maxIterations;
  const tol = slope.tolerance;
  const mpEquilibriumTolerance = Math.max(tol * 4, 0.02);
  // Fm(λ) and Ff(λ) are evaluated more precisely than the λ search
  // needs: near the root the gap Fm − Ff is of the order of `tol`, and
  // evaluation noise of that size sent the secant step the wrong way
  // (e.g. V081a, where Fm hardly depends on λ).
  const evalTol = tol * 0.1;

  // Step 1: Initial Bishop solution (lambda = 0)
  // The first pushing/resisting values are replaced before they are read.
  // eslint-disable-next-line no-useless-assignment
  let [FSm, pushing0, resisting0] = solveFOSGenericMoment(props, 0, FSord, maxIters, evalTol);

  if (FSm == null) return [null, null, null, null, false];

  // Step 1b: Initial force solution (lambda = 0)
  let [FSf, pushingF, resistingF] = solveFOSGenericForceCircular(props, 0, FSord, maxIters, evalTol);

  if (FSf == null) {
    // Retry with different initial FS values
    for (const fact of [2, 0.5, 1.5, 0.75, 1.1, 0.9]) {
      [FSf, pushingF, resistingF] = solveFOSGenericForceCircular(props, 0, FSord * fact, maxIters, evalTol);
      if (FSf != null) break;
    }
    if (FSf == null) return [FSm, null, pushingF, resistingF, false];
  }

  const lffArray: [number, number, number, number][] = [
    [0, FSm, FSf, Math.abs(FSm - FSf)],
  ];
  if (Math.abs(FSm - FSf) < tol)
    return [crossingFOS(lffArray, 0, FSm, FSf), lffArray, pushingF, resistingF, true];

  // Step 2: Second point (lambda = 0.1)
  const lambda2 = 0.1;
  [FSm, pushing0, resisting0] = solveFOSGenericMoment(props, lambda2, FSm, maxIters, evalTol);
  if (FSm == null) return [null, lffArray, pushing0, resisting0, false];

  [FSf, pushingF, resistingF] = solveFOSGenericForceCircular(props, lambda2, FSf, maxIters, evalTol);

  if (FSf == null) return [FSm, lffArray, pushingF, resistingF, false];

  lffArray.push([lambda2, FSm, FSf, Math.abs(FSm - FSf)]);
  lffArray.sort((a, b) => a[0] - b[0]);
  if (Math.abs(FSm - FSf) < tol)
    return [crossingFOS(lffArray, lambda2, FSm, FSf), lffArray, pushingF, resistingF, true];

  // Step 3: Iterative extrapolation
  const unconvergedLambdas: number[] = [];
  for (let ii = 0; ii <= MP_MAX_STEPS; ii++) {
    // Use the best-performing lambda (smallest gap) as pivot for step limiting,
    // NOT the largest lambda in the sorted array, which would prevent exploration
    // into the negative-lambda region where Fm and Ff may intersect.
    const bestEntry = [...lffArray].sort((a, b) => a[3] - b[3])[0];
    const prevLambda = bestEntry[0];
    const lffTriplets = lffArray.map(
      ([lambda, fsMoment, fsForce]) =>
        [lambda, fsMoment, fsForce] as [number, number, number],
    );
    let [lambdaNew, fsExtrap] = extrapolateLambda(lffTriplets);

    // Limit step size; the extrapolated FOS belongs to the unlimited λ,
    // so a limited step starts from the last moment FOS instead.
    if (Math.abs(lambdaNew - prevLambda) > MP_MAX_LAMBDA_STEP) {
      lambdaNew = lambdaNew > prevLambda ? prevLambda + MP_MAX_LAMBDA_STEP : prevLambda - MP_MAX_LAMBDA_STEP;
      fsExtrap = FSm;
    }
    if (!(fsExtrap > 0)) fsExtrap = FSm;
    // Do not step to or past a λ where the equilibrium did not converge:
    // halve the step towards the pivot instead.
    for (const bad of unconvergedLambdas) {
      if (
        (bad - prevLambda) * (lambdaNew - prevLambda) > 0 &&
        Math.abs(lambdaNew - prevLambda) >= Math.abs(bad - prevLambda)
      ) {
        lambdaNew = prevLambda + (bad - prevLambda) / 2;
        fsExtrap = FSm;
      }
    }

    // Ensure unique lambda
    let nudgeCount = 0;
    while (lffArray.some((x) => x[0] === lambdaNew)) {
      // Step a little further in the search direction (shrinking towards
      // 0 walked back over ground already covered).
      lambdaNew += lambdaNew >= prevLambda ? 0.05 : -0.05;
      if (++nudgeCount > 50) break;
    }
    // The interslice inclination stays between −10° and +80° (Edris & Wright 1987):
    // beyond that the force equation has roots that are no solution. A
    // walk that wants to leave the range has no crossing inside it.
    let exhausted = false;
    if (lambdaNew < LAMBDA_MIN || lambdaNew > LAMBDA_MAX) {
      const limit = lambdaNew < LAMBDA_MIN ? LAMBDA_MIN : LAMBDA_MAX;
      if (lffArray.some((x) => x[0] === limit)) {
        exhausted = true;
      } else {
        lambdaNew = limit;
        fsExtrap = FSm;
      }
    }

    if (!exhausted) {
      const [trialM, trialPushM, trialResM, , convergedM] =
        solveFOSGenericMoment(props, lambdaNew, fsExtrap, maxIters, evalTol);
      if (trialM == null) return [null, lffArray, trialPushM, trialResM, false];

      const [trialF, trialPushF, trialResF, , convergedF] =
        solveFOSGenericForceCircular(props, lambdaNew, FSf, maxIters, evalTol);

      if (trialF == null) return [trialM, lffArray, trialPushF, trialResF, false];

      if (convergedM && convergedF) {
        [FSm, pushing0, resisting0] = [trialM, trialPushM, trialResM];
        [FSf, pushingF, resistingF] = [trialF, trialPushF, trialResF];
        lffArray.push([lambdaNew, FSm, FSf, Math.abs(FSm - FSf)]);
        lffArray.sort((a, b) => a[0] - b[0]);

        if (Math.abs(FSm - FSf) < tol)
          return [crossingFOS(lffArray, lambdaNew, FSm, FSf), lffArray, pushingF, resistingF, true];
      } else {
        // An unconverged moment or force solution is no point of the
        // Fm(λ), Ff(λ) curves: far out in λ (e.g. λ ≈ −1 on V002's
        // non-circular surface) the force iteration drifts and its value
        // dropped onto Fm, a spurious "intersection" with a far too low FOS.
        unconvergedLambdas.push(lambdaNew);
      }
    }

    if (exhausted || ii >= MP_MAX_STEPS) {
      // Fallback: pick closest match
      const sorted = [...lffArray].sort((a, b) => a[3] - b[3]);
      const [bestLambda, bestFS] = sorted[0];
      let convergedBestM: boolean;
      [FSm, pushing0, resisting0, , convergedBestM] =
        solveFOSGenericMoment(props, bestLambda, bestFS, maxIters, evalTol);
      if (FSm == null) return [null, lffArray, pushing0, resisting0, false];

      let convergedBestF: boolean;
      [FSf, pushingF, resistingF, , convergedBestF] =
        solveFOSGenericForceCircular(props, bestLambda, bestFS, maxIters, evalTol);
      if (FSf == null) return [FSm, lffArray, pushingF, resistingF, false];

      const equilibriumGap = Math.abs(FSm - FSf);
      lffArray.push([bestLambda, FSm, FSf, equilibriumGap]);

      const iterationsConverged = convergedBestM && convergedBestF;
      // Re-solved at the best λ the pair may meet within the tolerance.
      const complete = iterationsConverged && equilibriumGap < tol;
      const closestPair = iterationsConverged && !complete && equilibriumGap <= mpEquilibriumTolerance;
      // The pushed pair is the last entry: the neighbour is another λ.
      const fos = complete ? crossingFOS(lffArray.slice(0, -1), bestLambda, FSm, FSf) : FSm;
      return [fos, lffArray, pushing0, resisting0, complete, equilibriumGap, closestPair];
    }
  }

  return [FSm, lffArray, pushing0!, resisting0!, false];
}

// ────────────────────────────────────────────────────────────────
// Top-level analysis orchestrator
// ────────────────────────────────────────────────────────────────

/**
 * Run the full slope stability analysis.
 *
 * 1. Generate search planes if none exist.
 * 2. For each plane: generate slices → compute FOS.
 * 3. Sort results by FOS and store on the Slope model.
 *
 * @returns Minimum FOS found, or null if no valid surfaces.
 */
export function analyseSlope(slope: Slope): number | null {
  const block = slope.searchMethod === "block" && !slope.customPlanesOnly;
  // Generate search planes unless only custom planes are requested
  if (slope.search.length === 0 && !slope.customPlanesOnly && !block) {
    setEntryExitPlanes(slope);
  }

  // Combine search + individual planes
  const combinedPlanes: SearchPlane[] = [
    ...(block ? [] : slope.search).map((p) => ({
      ...p,
      fos: null,
      slices: null,
      crack: undefined,
      converged: true,
    })),
    ...slope.individualPlanes.map((p) => ({
      ...p,
      fos: null,
      slices: null,
      crack: undefined,
      converged: true,
    })),
  ];
  const allPlanes: SearchPlane[] = [];
  const seenPlanes = new Set<string>();
  for (const plane of combinedPlanes) {
    const key = planeKey(plane);
    if (seenPlanes.has(key)) continue;
    seenPlanes.add(key);
    allPlanes.push(plane);
  }

  evaluatePlanes(slope, allPlanes);

  if (block) {
    // Block search: surfaces through the block search objects, refined
    // around the best; optimised as polylines on request.
    const evaluate = (planes: SearchPlane[]) => evaluatePlanes(slope, planes);
    const blockPlanes = blockSearch(slope, evaluate);
    allPlanes.push(...blockPlanes);
    if (slope.nonCircularOptimization) {
      const ground = slope.surfaceLineXY;
      const span = ground ? Math.max(...ground.x) - Math.min(...ground.x) : 1;
      const seeds = bestDistinct(blockPlanes, BLOCK_SEEDS, span);
      const known = new Set(allPlanes);
      allPlanes.push(...optimisePolylines(slope, seeds, evaluate).filter((p) => !known.has(p)));
    }
  } else if (slope.refinedIterations > 0 && !slope.customPlanesOnly) {
    allPlanes.sort((a, b) => {
      const af = a.fos ?? Number.POSITIVE_INFINITY;
      const bf = b.fos ?? Number.POSITIVE_INFINITY;
      return af - bf;
    });
    const refinedPlanes = generateRefinedPlanes(
      slope,
      allPlanes,
      slope.refinedIterations,
    );
    if (refinedPlanes.length > 0) {
      evaluatePlanes(slope, refinedPlanes);
      allPlanes.push(...refinedPlanes);
    }

    // Spend the rest of the budget on a local search with shrinking steps.
    let budget = slope.refinedIterations - refinedPlanes.length;
    const keys = new Set(allPlanes.map(planeKey));
    for (let level = 1; budget > 0 && level <= 12; level++) {
      const localPlanes = generateLocalPlanes(slope, allPlanes, budget, level, keys);
      if (localPlanes.length === 0) break;
      evaluatePlanes(slope, localPlanes);
      allPlanes.push(...localPlanes);
      budget -= localPlanes.length;
    }
  }

  // Non-circular optimisation of the best circles.
  if (slope.nonCircularOptimization && !slope.customPlanesOnly && !block) {
    const optimised = optimiseNonCircular(slope, allPlanes, (planes) =>
      evaluatePlanes(slope, planes),
    );
    allPlanes.push(...optimised);
  }

  // Sort by FOS ascending
  allPlanes.sort((a, b) => {
    const af = a.fos ?? Number.POSITIVE_INFINITY;
    const bf = b.fos ?? Number.POSITIVE_INFINITY;
    return af - bf;
  });
  slope.setSearchResults(allPlanes);

  const best = allPlanes.find((plane) => plane.fos != null);
  return best?.fos ?? null;
}

/** Surfaces shallower than this fraction of the model height are degenerate. */
const DEGENERATE_DEPTH = 1e-3;

/** The errors getSlices raises for a surface that has no valid slices. */
const SURFACE_GEOMETRY_ERRORS = new Set([WATER_LINE_GAP, "x0 must be less than x1", "Surface line not defined"]);

function isSurfaceGeometryError(error: unknown): boolean {
  return error instanceof Error && SURFACE_GEOMETRY_ERRORS.has(error.message);
}

/** Passes of the Hoek–Brown fixed point per surface, and its relative tolerance on F (implementation choices). */
const HB_PASSES = 30;
const HB_TOLERANCE = 1e-4;

/**
 * Each Hoek–Brown slice's instantaneous c and φ at its effective normal
 * stress N′/l (design values with the partial factors), halfway from the
 * present ones: the undamped update can cycle between two states
 * (implementation choice).
 */
function updateHoekBrown(slope: Slope, slices: Slice[], normals: readonly number[]): void {
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    if (!s.hoekBrown) continue;
    const inst = instantaneousAtNormalStress(s.hoekBrown, normals[i] / s.baseLength);
    const d = designStrength("hoek-brown", { cohesion: inst.cohesion, frictionAngle: inst.frictionAngle, cohesionUndrained: inst.cohesion }, slope.partialFactors);
    s.cohesion = (s.cohesion + d.cohesion) / 2;
    s.cohesionUndrained = s.cohesion;
    s.phi = Math.atan((Math.tan(s.phi) + d.tanPhi) / 2);
    s.frictionAngle = (s.phi * 180) / Math.PI;
  }
}

function evaluatePlanes(slope: Slope, allPlanes: SearchPlane[]): void {
  for (const plane of allPlanes) {
    delete plane.belowMinSize;
    let slices: Slice[];
    try {
      slices = getSlices(
        slope,
        plane.lc[0],
        plane.rc[0],
        plane.cx,
        plane.cy,
        plane.radius,
        plane.points,
      );
    } catch (error) {
      // A surface the slices cannot be built for is no candidate; any other
      // error is a fault that must not silently remove surfaces (and so
      // raise the minimum).
      if (!isSurfaceGeometryError(error)) throw error;
      plane.fos = null;
      continue;
    }
    // Refined and local planes arrive with a placeholder FOS; a surface
    // without slices (e.g. too shallow for the tension crack) is invalid.
    if (slices.length === 0) {
      plane.fos = null;
      continue;
    }
    if (slices[0].xLeft > plane.lc[0] + 1e-9) {
      plane.crack = [slices[0].xLeft, slices[0].y0Bottom];
    }

    // Minimum depth: shallower surfaces are not analysed. Surfaces that
    // only scratch the ground (thinner than 0.1 % of the model height) are
    // always skipped: their FOS grows without bound as c/(γ·depth) and
    // tells nothing about the slope.
    const degenerateDepth = DEGENERATE_DEPTH * slope.modelHeight;
    const minDepth = Math.max(slope.minSlipDepth, degenerateDepth);
    // Surfaces left out by the minimum depth or area are counted (reported
    // as AnalysisResult.discardedBySize), so that a local failure the
    // filters hide is not hidden silently. Not counted: the degenerate ones
    // and those that would be rejected anyway (high-strength or
    // impenetrable material).
    const countAsSmall = () =>
      !slices.some((s) => s.skipSurface || s.impenetrable) || undefined;
    if (minDepth > 0) {
      let maxDepth = 0;
      for (const s of slices) {
        maxDepth = Math.max(maxDepth, s.y0Top - s.y0Bottom, s.y1Top - s.y1Bottom);
      }
      if (maxDepth < minDepth) {
        plane.fos = null;
        plane.slices = slices;
        plane.converged = true;
        if (maxDepth >= degenerateDepth) plane.belowMinSize = countAsSmall();
        continue;
      }
    }

    // Minimum size of the sliding mass (micro-surfaces are of no interest
    // and their FOS is arbitrarily high in cohesive soil). The automatic
    // default has no basis in the literature; see Slope.minSlipArea.
    const minArea = slope.minSlipArea;
    if (minArea > 0) {
      let area = 0;
      for (const s of slices) area += s.area;
      if (area < minArea) {
        plane.fos = null;
        plane.slices = slices;
        plane.converged = true;
        plane.belowMinSize = countAsSmall();
        continue;
      }
    }

    // If any slice has skipSurface (e.g. high-strength material) or
    // impenetrable (bedrock), the surface is invalid — skip analysis.
    if (slices.some((s) => s.skipSurface || s.impenetrable)) {
      plane.fos = null;
      plane.slices = slices;
      plane.converged = true;
      continue;
    }

    // A surface with no net driving moment in the sliding direction (e.g.
    // a symmetric circle under level ground, or one that would slide the
    // other way) cannot fail here.  The iterative solvers oscillate on
    // such surfaces, which used to report them as "weak equilibrium".
    if (!hasDrivingMoment(slices)) {
      plane.fos = null;
      plane.slices = slices;
      plane.converged = true;
      continue;
    }

    let fos: number | null;
    let converged: boolean;
    /** The factor the slice normal forces were solved with, when not `fos`. */
    let solvedFos: number | null = null;
    /** Morgenstern-Price closest pair: not converged, but its factor is kept. */
    let acceptedClosestPair = false;

    // Hoek–Brown bases: the instantaneous strength at the normal stress
    // the solution finds, repeated until F settles (a fixed point; the
    // first pass uses the overburden estimate of the slice builder).
    const hoekBrown = slices.some((s) => s.hoekBrown);
    let lastHbFos = NaN;
    for (let pass = 0; ; pass++) {
      switch (slope.method) {
        case "Bishop": {
          const [f, , , cvg] = analyseBishop(slope, slices);
          fos = f;
          converged = cvg;
          break;
        }
        case "Janbu": {
          const [f, , , cvg] = analyseJanbu(slope, slices);
          fos = f;
          // The normal forces are those of the uncorrected factor: the f₀
          // correction scales the result, not the slice equilibrium.
          if (f != null && slope.janbuCorrection) solvedFos = f / janbuCorrectionFactor(slices);
          converged = cvg;
          break;
        }
        case "Morgenstern-Price": {
          const [f, lff, , , cvg, gap, closest] =
            morgensternPriceSolver === "march"
              ? analyseMorgensternPriceMarch(slope, slices)
              : analyseMorgensternPrice(slope, slices);
          fos = f;
          plane.lffArray = lff ?? undefined;
          // A solution accepted with the closest pair, not a crossing: the
          // factor of safety satisfies moment equilibrium, force equilibrium
          // only within the gap. It keeps its factor (on a φ = 0 circle, e.g.
          // V027, moment equilibrium alone fixes F) but is reported as not
          // converged, with the gap, so that it is not mistaken for a
          // complete-equilibrium solution (Fm = Ff; Morgenstern & Price 1965).
          plane.closestPair = closest === true || undefined;
          plane.equilibriumGap = closest && gap != null ? gap : undefined;
          acceptedClosestPair = closest === true;
          // A candidate of the non-circular optimisation is kept only with a
          // crossing: the optimisation is a minimum over thousands of
          // surfaces and finds every one where the closest pair reads low.
          // The surface is abandoned, as in Edris & Wright (1987, para. 101).
          if (plane.optimised && closest) fos = null;
          converged = cvg;
          break;
        }
        default:
          throw new Error(`Unknown method: ${slope.method}`);
      }
      if (!hoekBrown || fos == null) break;
      if (Math.abs(fos - lastHbFos) <= HB_TOLERANCE * Math.abs(fos)) break;
      if (pass >= HB_PASSES) {
        // F has not settled: the surface is reported as not converged
        converged = false;
        break;
      }
      lastHbFos = fos;
      // (solvedEffectiveNormals takes the factor as the method reports it, Janbu's corrected one included)
      const normals = solvedEffectiveNormals(slope, slices, fos, plane.lffArray);
      if (!normals) break;
      updateHoekBrown(slope, slices, normals);
    }

    // Discard non-converged or negative FoS — these arise from
    // degenerate surfaces (e.g. flat terrain with near-zero driving
    // moment) where the iterative solver produces meaningless values.
    if (fos != null && ((!converged && !acceptedClosestPair) || fos < 0)) {
      fos = null;
    }
    // m_α = cos α + sin α·tan φ / F ≤ 0 on a slice makes its normal force
    // meaningless (infinite or negative): raising strength could then
    // lower the FOS. Such surfaces are rejected, as is common practice.
    if (fos != null && slices.some((s) => mAlpha(s, solvedFos ?? fos!) <= 0)) {
      fos = null;
    }

    plane.fos = fos;
    plane.slices = slices;
    plane.converged = converged;
  }
}

/** Vertical load on a slice: soil weight, surface loads and free water. */
export function sliceVerticalLoad(s: Pick<Slice, "weight" | "udl" | "ll" | "waterLoad">): number {
  return s.weight + s.udl + s.ll + (s.waterLoad ?? 0);
}

/**
 * Driving moment of a slice about the circle centre (kN·m). On a
 * non-circular surface the base normal force has a moment too; it is
 * estimated here with N ≈ W·cos α (the solvers use the solved N).
 */
export function sliceDrivingMoment(
  s: Pick<
    Slice,
    "weight" | "udl" | "ll" | "waterLoad" | "dx" | "extraMoment" | "alpha" | "normalArm"
  >,
): number {
  const W = sliceVerticalLoad(s);
  return W * s.dx + (s.extraMoment ?? 0) + W * Math.cos(s.alpha) * (s.normalArm ?? 0);
}

/** True when the slices' net driving moment is clearly positive. */
function hasDrivingMoment(slices: Slice[]): boolean {
  let net = 0;
  let gross = 0;
  for (const s of slices) {
    const m = sliceDrivingMoment(s);
    net += m;
    gross += Math.abs(m);
  }
  // 0.1 % of the gross moment: below that FOS runs into the thousands
  // (meaningless "Max FOS" and colour scale) and the surface is never
  // critical.
  return gross > 0 && net > 1e-3 * gross;
}

function mAlpha(s: Slice, fos: number): number {
  // A combined-method slice in equilibrium with its undrained strength has
  // tan φ = 0 in the equation that was solved.
  const tanPhi = s.undrainedGoverns ? 0 : Math.tan(s.phi);
  return Math.cos(s.alpha) + (Math.sin(s.alpha) * tanPhi) / fos;
}
