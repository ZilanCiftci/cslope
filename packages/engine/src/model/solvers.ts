/**
 * Factor of Safety (FOS) solvers for slope stability analysis.
 *
 * All Numba JIT functions are ported to plain TypeScript loops.
 */

import type { Slice } from "../types/index";
import { getIntersliceFunctionValue, extrapolateLambda } from "../math/index";
import type { Slope, SearchPlane } from "./slope";
import { getSlices } from "./slices";
import {
  setEntryExitPlanes,
  generateRefinedPlanes,
  generateLocalPlanes,
  planeKey,
} from "./search";
import { optimiseNonCircular } from "./optimize";

// ────────────────────────────────────────────────────────────────
// Slice property arrays (replaces _get_slice_property_arrays)
// ────────────────────────────────────────────────────────────────

interface SliceArrays {
  weights: Float64Array;
  udls: Float64Array;
  lls: Float64Array;
  hForces: Float64Array;
  extraMoments: Float64Array;
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
}

function getSlicePropertyArrays(
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

/**
 * Base normal force and right-hand interslice forces of one slice from
 * vertical equilibrium with the shear mobilised at the trial FOS.
 *
 * @param effC  effective cohesion force C' = c·l − U·l·tanφ (kN/m)
 * @param tanPhi tan of the friction angle governing the slice
 * @returns [N, E_right, X_right]
 */
function solveSliceNormal(
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
  initialNs: Float64Array,
  maxIters: number,
  tolerance: number,
  numOuterIters: number,
): SolverResult {
  const n = p.weights.length;
  const nPrev = new Float64Array(initialNs);
  const nCurrent = new Float64Array(n);
  let prevFOS = initialFOS;
  let fos = initialFOS;
  let pushing = 0;
  let resisting = 0;

  for (let outer = 0; outer < numOuterIters; outer++) {
    let innerConverged = false;
    for (let iter = 0; iter < maxIters; iter++) {
      pushing = 0;
      resisting = 0;
      let eLeft = 0;
      let xLeft = 0;

      for (let i = 0; i < n; i++) {
        const W = p.weights[i] + p.udls[i] + p.lls[i];
        // Horizontal external force in the sliding direction; with the
        // solvers' sign of E it reduces the interslice force on the right.
        const H = p.hForces[i];
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
        // slice must be in equilibrium with that (smaller) shear too.
        // (Compared as forces: on a non-circular surface the arm can be
        // negative.)
        if (matCode === 1 && !(shear >= 0 && shear <= cu * bl)) {
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

        // On a non-circular surface the normal force has a moment too.
        pushing += W * dx + p.extraMoments[i] + N * p.normalArms[i];
        nCurrent[i] = N;
        eLeft = eRight;
        xLeft = xRight;
      }

      if (pushing <= 0) return [null, pushing, resisting, nCurrent, false];

      fos = resisting / pushing;
      if (iter > 3 && Math.abs(prevFOS - fos) < tolerance) {
        innerConverged = true;
        break;
      }
      prevFOS = prevFOS + 0.5 * (fos - prevFOS);
    }

    if (numOuterIters === 1) {
      return [fos, pushing, resisting, nCurrent, innerConverged];
    }

    // Outer convergence check on N values
    let maxNDiff = 0;
    for (let i = 0; i < n; i++) {
      const diff = Math.abs(nPrev[i] - nCurrent[i]);
      if (diff > maxNDiff) maxNDiff = diff;
    }
    if (maxNDiff < tolerance)
      return [fos, pushing, resisting, nCurrent, innerConverged];

    prevFOS = fos;
    for (let i = 0; i < n; i++) nPrev[i] = nCurrent[i];
  }

  return [fos, pushing, resisting, nCurrent, false];
}

/**
 * Generic force equilibrium FOS solver for circular surfaces.
 */
function solveFOSGenericForceCircular(
  p: SliceArrays,
  lambdaVal: number,
  initialFOS: number,
  initialNs: Float64Array,
  maxIters: number,
  tolerance: number,
  numOuterIters: number,
): SolverResult {
  const n = p.weights.length;
  const nPrev = new Float64Array(initialNs);
  const nCurrent = new Float64Array(n);
  let prevFOS = initialFOS;
  let fos = initialFOS;
  let pushing = 0;
  let resisting = 0;

  for (let outer = 0; outer < numOuterIters; outer++) {
    let innerConverged = false;
    for (let iter = 0; iter < maxIters; iter++) {
      pushing = 0;
      resisting = 0;
      let eLeft = 0;
      let xLeft = 0;

      for (let i = 0; i < n; i++) {
        const W = p.weights[i] + p.udls[i] + p.lls[i];
        // Horizontal external force in the sliding direction; with the
        // solvers' sign of E it reduces the interslice force on the right.
        const H = p.hForces[i];
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
        if (matCode === 1 && !(res >= 0 && res <= cu * bl * cosA)) {
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

        pushing += N * sinA + H;
        nCurrent[i] = N;
        eLeft = eRight;
        xLeft = xRight;
      }

      if (pushing <= 0) return [null, pushing, resisting, nCurrent, false];

      fos = resisting / pushing;
      if (iter > 3 && Math.abs(prevFOS - fos) < tolerance) {
        innerConverged = true;
        break;
      }
      prevFOS = prevFOS + 0.5 * (fos - prevFOS);
    }

    if (numOuterIters === 1) {
      return [fos, pushing, resisting, nCurrent, innerConverged];
    }

    // Outer convergence check on N values
    let maxNDiff = 0;
    for (let i = 0; i < n; i++) {
      const diff = Math.abs(nPrev[i] - nCurrent[i]);
      if (diff > maxNDiff) maxNDiff = diff;
    }
    if (maxNDiff < tolerance)
      return [fos, pushing, resisting, nCurrent, innerConverged];

    prevFOS = fos;
    for (let i = 0; i < n; i++) nPrev[i] = nCurrent[i];
  }

  return [fos, pushing, resisting, nCurrent, false];
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
    const W = sliceVerticalLoad(s);

    if (s.isCombined) {
      const fd =
        s.cohesion * s.baseLength +
        Math.max(0, W * Math.cos(s.alpha) - s.U * s.baseLength) *
          Math.tan(s.phi);
      const fu = s.cohesionUndrained * s.baseLength;
      resisting += Math.min(fd, fu);
    } else {
      resisting +=
        s.cohesion * s.baseLength +
        Math.max(0, W * Math.cos(s.alpha) - s.U * s.baseLength) *
          Math.tan(s.phi);
    }

    pushing +=
      W * Math.sin(s.alpha) +
      (meanArm > 1e-9 ? (s.extraMoment ?? 0) / meanArm : 0);
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
  const initialNs = new Float64Array(slices.length);

  const [fos, pushing, resisting, , converged] = solveFOSGenericMoment(
    props,
    0, // lambda = 0
    FS,
    initialNs,
    slope.maxIterations,
    slope.tolerance,
    1, // numOuterIters = 1 when lambda = 0
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
function janbuCorrectionFactor(slices: Slice[]): number {
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
  const initialNs = new Float64Array(slices.length);

  const [fos, pushing, resisting, , converged] = solveFOSGenericForceCircular(
    props,
    0, // lambda = 0
    FS,
    initialNs,
    slope.maxIterations,
    slope.tolerance,
    1, // numOuterIters = 1 when lambda = 0
  );

  if (fos == null) return [null, null, null, false];

  // Apply Janbu correction factor f₀ (only when enabled)
  const f0 = slope.janbuCorrection ? janbuCorrectionFactor(slices) : 1;
  const correctedFos = fos * f0;

  return [correctedFos, pushing, resisting, converged];
}

/** λ extrapolation steps before falling back to the closest pair. */
const MP_MAX_STEPS = 10;

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
  converged: boolean,
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
  const n = slices.length;
  const maxIters = slope.maxIterations;
  const tol = slope.tolerance;
  const mpEquilibriumTolerance = Math.max(tol * 4, 0.02);
  // Fm(λ) and Ff(λ) are evaluated more precisely than the λ search
  // needs: near the root the gap Fm − Ff is of the order of `tol`, and
  // evaluation noise of that size sent the secant step the wrong way
  // (e.g. Slide VP37, where Fm hardly depends on λ).
  const evalTol = tol * 0.1;

  // Step 1: Initial Bishop solution (lambda = 0)
  let Nm: Float64Array = new Float64Array(n);
  let [FSm, pushing0, resisting0, NmOut] = solveFOSGenericMoment(
    props,
    0,
    FSord,
    Nm,
    maxIters,
    evalTol,
    1,
  );
  Nm = new Float64Array(NmOut);

  if (FSm == null) return [null, null, null, null, false];

  // Step 1b: Initial force solution (lambda = 0)
  let Nf: Float64Array = new Float64Array(n);
  let [FSf, pushingF, resistingF, NfOut] = solveFOSGenericForceCircular(
    props,
    0,
    FSord,
    Nf,
    maxIters,
    evalTol,
    1,
  );
  Nf = new Float64Array(NfOut);

  if (FSf == null) {
    // Retry with different initial FS values
    for (const fact of [2, 0.5, 1.5, 0.75, 1.1, 0.9]) {
      [FSf, pushingF, resistingF, NfOut] = solveFOSGenericForceCircular(
        props,
        0,
        FSord * fact,
        new Float64Array(n),
        maxIters,
        evalTol,
        1,
      );
      Nf = new Float64Array(NfOut);
      if (FSf != null) break;
    }
    if (FSf == null) return [FSm, null, pushingF, resistingF, false];
  }

  const lffArray: [number, number, number, number][] = [
    [0, FSm, FSf, Math.abs(FSm - FSf)],
  ];
  if (Math.abs(FSm - FSf) < tol)
    return [FSm, lffArray, pushingF, resistingF, true];

  // Step 2: Second point (lambda = 0.1)
  const lambda2 = 0.1;
  [FSm, pushing0, resisting0, NmOut] = solveFOSGenericMoment(
    props,
    lambda2,
    FSm,
    Nm,
    maxIters,
    evalTol,
    maxIters,
  );
  Nm = new Float64Array(NmOut);
  if (FSm == null) return [null, lffArray, pushing0, resisting0, false];

  [FSf, pushingF, resistingF, NfOut] = solveFOSGenericForceCircular(
    props,
    lambda2,
    FSf,
    Nf,
    maxIters,
    evalTol,
    maxIters,
  );
  Nf = new Float64Array(NfOut);

  if (FSf == null) return [FSm, lffArray, pushingF, resistingF, false];

  lffArray.push([lambda2, FSm, FSf, Math.abs(FSm - FSf)]);
  lffArray.sort((a, b) => a[0] - b[0]);
  if (Math.abs(FSm - FSf) < tol)
    return [FSm, lffArray, pushingF, resistingF, true];

  // Step 3: Iterative extrapolation
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
    let [lambdaNew] = extrapolateLambda(lffTriplets);
    const [, fsExtrap] = extrapolateLambda(lffTriplets);

    // Limit step size
    if (Math.abs(lambdaNew - prevLambda) > 0.3) {
      lambdaNew = lambdaNew > prevLambda ? prevLambda + 0.3 : prevLambda - 0.3;
    }

    // Ensure unique lambda
    let nudgeCount = 0;
    while (lffArray.some((x) => x[0] === lambdaNew)) {
      // Step a little further in the search direction (shrinking towards
      // 0 walked back over ground already covered).
      lambdaNew += lambdaNew >= prevLambda ? 0.05 : -0.05;
      if (++nudgeCount > 50) break;
    }

    [FSm, pushing0, resisting0, NmOut] = solveFOSGenericMoment(
      props,
      lambdaNew,
      fsExtrap,
      Nm,
      maxIters,
      evalTol,
      maxIters,
    );
    Nm = new Float64Array(NmOut);
    if (FSm == null) return [null, lffArray, pushing0, resisting0, false];

    [FSf, pushingF, resistingF, NfOut] = solveFOSGenericForceCircular(
      props,
      lambdaNew,
      FSf,
      Nf,
      maxIters,
      evalTol,
      maxIters,
    );
    Nf = new Float64Array(NfOut);

    if (FSf == null) return [FSm, lffArray, pushingF, resistingF, false];

    lffArray.push([lambdaNew, FSm, FSf, Math.abs(FSm - FSf)]);
    lffArray.sort((a, b) => a[0] - b[0]);

    if (Math.abs(FSm - FSf) < tol)
      return [FSm, lffArray, pushingF, resistingF, true];

    if (ii >= MP_MAX_STEPS) {
      // Fallback: pick closest match
      const sorted = [...lffArray].sort((a, b) => a[3] - b[3]);
      const [bestLambda, bestFS] = sorted[0];
      let convergedBestM: boolean;
      [FSm, pushing0, resisting0, NmOut, convergedBestM] =
        solveFOSGenericMoment(
          props,
          bestLambda,
          bestFS,
          Nm,
          maxIters,
          evalTol,
          maxIters,
        );
      Nm = new Float64Array(NmOut);
      if (FSm == null) return [null, lffArray, pushing0, resisting0, false];

      let convergedBestF: boolean;
      [FSf, pushingF, resistingF, NfOut, convergedBestF] =
        solveFOSGenericForceCircular(
          props,
          bestLambda,
          bestFS,
          Nf,
          maxIters,
          evalTol,
          maxIters,
        );
      Nf = new Float64Array(NfOut);
      if (FSf == null) return [FSm, lffArray, pushingF, resistingF, false];

      const equilibriumGap = Math.abs(FSm - FSf);
      lffArray.push([bestLambda, FSm, FSf, equilibriumGap]);

      return [
        FSm,
        lffArray,
        pushing0,
        resisting0,
        convergedBestM &&
          convergedBestF &&
          equilibriumGap <= mpEquilibriumTolerance,
      ];
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
  // Generate search planes unless only custom planes are requested
  if (slope.search.length === 0 && !slope.customPlanesOnly) {
    setEntryExitPlanes(slope);
  }

  // Combine search + individual planes
  const combinedPlanes: SearchPlane[] = [
    ...slope.search.map((p) => ({
      ...p,
      fos: null,
      slices: null,
      converged: true,
    })),
    ...slope.individualPlanes.map((p) => ({
      ...p,
      fos: null,
      slices: null,
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

  if (slope.refinedIterations > 0 && !slope.customPlanesOnly) {
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
  if (slope.nonCircularOptimization && !slope.customPlanesOnly) {
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

function evaluatePlanes(slope: Slope, allPlanes: SearchPlane[]): void {
  for (const plane of allPlanes) {
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
    } catch {
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
    const minDepth = Math.max(slope.minSlipDepth, DEGENERATE_DEPTH * slope.modelHeight);
    if (minDepth > 0) {
      let maxDepth = 0;
      for (const s of slices) {
        maxDepth = Math.max(maxDepth, s.y0Top - s.y0Bottom, s.y1Top - s.y1Bottom);
      }
      if (maxDepth < minDepth) {
        plane.fos = null;
        plane.slices = slices;
        plane.converged = true;
        continue;
      }
    }

    // Minimum size of the sliding mass (micro-surfaces are of no interest
    // and their FOS is arbitrarily high in cohesive soil).
    const minArea = slope.minSlipArea;
    if (minArea > 0) {
      let area = 0;
      for (const s of slices) area += s.area;
      if (area < minArea) {
        plane.fos = null;
        plane.slices = slices;
        plane.converged = true;
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
    let converged = true;

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
        converged = cvg;
        break;
      }
      case "Morgenstern-Price": {
        const [f, lff, , , cvg] = analyseMorgensternPrice(slope, slices);
        fos = f;
        plane.lffArray = lff ?? undefined;
        converged = cvg;
        break;
      }
      default:
        throw new Error(`Unknown method: ${slope.method}`);
    }

    // Discard non-converged or negative FoS — these arise from
    // degenerate surfaces (e.g. flat terrain with near-zero driving
    // moment) where the iterative solver produces meaningless values.
    if (fos != null && (!converged || fos < 0)) {
      fos = null;
    }
    // m_α = cos α + sin α·tan φ / F ≤ 0 on a slice makes its normal force
    // meaningless (infinite or negative): raising strength could then
    // lower the FOS. Such surfaces are rejected, as is common practice.
    if (fos != null && slices.some((s) => mAlpha(s, fos!) <= 0)) {
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
  return Math.cos(s.alpha) + (Math.sin(s.alpha) * Math.tan(s.phi)) / fos;
}
