/**
 * Factor of Safety (FOS) solvers for slope stability analysis.
 *
 * All Numba JIT functions are ported to plain TypeScript loops.
 */

import type { Slice } from "../types/index";
import { getIntersliceFunctionValue, extrapolateLambda } from "../math/index";
import type { Slope, SearchPlane } from "./slope";
import { getSlices } from "./slices";
import { setEntryExitPlanes, generateRefinedPlanes } from "./search";

// ────────────────────────────────────────────────────────────────
// Slice property arrays (replaces _get_slice_property_arrays)
// ────────────────────────────────────────────────────────────────

interface SliceArrays {
  weights: Float64Array;
  udls: Float64Array;
  lls: Float64Array;
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
    udls[i] = s.udl;
    lls[i] = s.ll;
    alphas[i] = s.alpha;
    baseLengths[i] = s.baseLength;
    phis[i] = s.phi;
    Us[i] = s.U;
    cohesions[i] = s.cohesion;
    cohesionUndraineds[i] = s.cohesionUndrained;
    materialCodes[i] = s.materialType === "Combined" ? 1 : 0;
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
 * Generic moment equilibrium FOS solver.
 */
function solveFOSGenericMoment(
  p: SliceArrays,
  R: number,
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

        let malpha = cosA + (sinA * tanPhi) / prevFOS;
        if (Math.abs(malpha) < 1e-12) malpha = malpha >= 0 ? 1e-12 : -1e-12;

        const C = c * bl - U * bl * tanPhi;
        const cohesionComponent = (C * cosA) / prevFOS;
        const cohesionTerm = C * sinA;

        const baseConstant = eLeft + cohesionComponent;
        const nMultiplier = (tanPhi * cosA) / prevFOS - sinA;
        const shearFactor = lambdaVal * f;

        const num =
          W + xLeft - cohesionTerm / prevFOS + baseConstant * shearFactor;
        let denom = malpha - nMultiplier * shearFactor;
        if (Math.abs(denom) < 1e-12) denom = denom >= 0 ? 1e-12 : -1e-12;

        const N = num / denom;
        const eRight = baseConstant + N * nMultiplier;
        const xRight = -eRight * shearFactor;

        // Resistance
        if (matCode === 1) {
          const rd = (c * bl + (N - U * bl) * tanPhi) * R;
          const ru = cu * bl * R;
          resisting += Math.min(rd, ru);
        } else {
          resisting += (c * bl + (N - U * bl) * tanPhi) * R;
        }

        pushing += W * dx;
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

        // N calculation (moment-based normal force)
        let malpha = cosA + (sinA * tanPhi) / prevFOS;
        if (Math.abs(malpha) < 1e-12) malpha = malpha >= 0 ? 1e-12 : -1e-12;

        const CPrimeSin = (c * bl - U * bl * tanPhi) * sinA;
        const cohesionComponent = ((c * bl - U * bl * tanPhi) * cosA) / prevFOS;
        const baseConstant = eLeft + cohesionComponent;
        const nMultiplier = (tanPhi * cosA) / prevFOS - sinA;
        const shearFactor = lambdaVal * f;

        const num =
          W + xLeft - CPrimeSin / prevFOS + baseConstant * shearFactor;
        let denom = malpha - nMultiplier * shearFactor;
        if (Math.abs(denom) < 1e-12) denom = denom >= 0 ? 1e-12 : -1e-12;

        const N = num / denom;
        const eRight = baseConstant + N * nMultiplier;
        const xRight = -eRight * shearFactor;

        // Circular force equilibrium resistance
        if (matCode === 1) {
          const rd = c * bl * cosA + (N - U * bl) * cosA * tanPhi;
          const ru = cu * bl * cosA;
          resisting += Math.min(rd, ru);
        } else {
          resisting += c * bl * cosA + (N - U * bl) * cosA * tanPhi;
        }

        pushing += N * sinA;
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

  for (const s of slices) {
    const W = s.weight + s.udl + s.ll;

    if (s.materialType === "Combined") {
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

    pushing += W * Math.sin(s.alpha);
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
  if (FS == null || FS > slope.limitToRunBishops) return [FS, null, null, true];

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
    slices[0].R,
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
 * where d = max vertical distance from the chord connecting the entry and
 * exit points of the failure surface to the arc (the sagitta), L = horizontal
 * distance between entry and exit, and b₁ depends on soil type:
 *   c-only soil (φ=0): b₁ = 0.69
 *   φ-only soil (c=0): b₁ = 0.31
 *   c-φ soil:          b₁ = 0.50
 */
function janbuCorrectionFactor(slices: Slice[]): number {
  if (slices.length === 0) return 1;

  const L = slices[slices.length - 1].xRight - slices[0].xLeft;
  if (L <= 0) return 1;

  // Entry and exit points on the failure surface
  const xEntry = slices[0].xLeft;
  const yEntry = slices[0].y0Bottom;
  const xExit = slices[slices.length - 1].xRight;
  const yExit = slices[slices.length - 1].y1Bottom;

  // d = max vertical distance from the chord (entry→exit) to the arc
  let d = 0;
  for (const s of slices) {
    // Interpolate chord y at slice midpoint x
    const t = (s.x - xEntry) / (xExit - xEntry);
    const chordY = yEntry + t * (yExit - yEntry);
    // The arc is below the chord, so chord Y > arc Y
    const sag = chordY - s.yBottom;
    if (sag > d) d = sag;
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
  if (FS == null || FS > slope.limitToRunJanbu) return [FS, null, null, true];

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
  if (FSord == null || FSord > slope.limitToRunBishops)
    return [FSord, null, null, null, true];

  const x0 = slices[0].xLeft;
  const x1 = slices[slices.length - 1].xRight;
  const props = getSlicePropertyArrays(
    slices,
    x0,
    x1,
    slope.intersliceFunction,
    slope.intersliceDataPoints,
  );
  const R = slices[0].R;
  const n = slices.length;
  const maxIters = slope.maxIterations;
  const tol = slope.tolerance;
  const mpEquilibriumTolerance = Math.max(tol * 4, 0.02);

  // Step 1: Initial Bishop solution (lambda = 0)
  let Nm: Float64Array = new Float64Array(n);
  let [FSm, pushing0, resisting0, NmOut, convergedM] = solveFOSGenericMoment(
    props,
    R,
    0,
    FSord,
    Nm,
    maxIters,
    tol,
    1,
  );
  Nm = new Float64Array(NmOut);

  if (FSm == null) return [null, null, null, null, false];
  if (FSm > slope.limitToRunMorgenstern)
    return [FSm, null, pushing0, resisting0, convergedM];

  // Step 1b: Initial force solution (lambda = 0)
  let Nf: Float64Array = new Float64Array(n);
  let [FSf, pushingF, resistingF, NfOut] = solveFOSGenericForceCircular(
    props,
    0,
    FSord,
    Nf,
    maxIters,
    tol,
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
        tol,
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
  [FSm, pushing0, resisting0, NmOut, convergedM] = solveFOSGenericMoment(
    props,
    R,
    lambda2,
    FSm,
    Nm,
    maxIters,
    tol,
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
    tol,
    maxIters,
  );
  Nf = new Float64Array(NfOut);

  if (FSf == null) return [FSm, lffArray, pushingF, resistingF, false];

  lffArray.push([lambda2, FSm, FSf, Math.abs(FSm - FSf)]);
  lffArray.sort((a, b) => a[0] - b[0]);
  if (Math.abs(FSm - FSf) < tol)
    return [FSm, lffArray, pushingF, resistingF, true];

  // Step 3: Iterative extrapolation
  for (let ii = 0; ii <= 6; ii++) {
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
      if (lambdaNew === 0) {
        lambdaNew = 1e-6;
      } else {
        lambdaNew *= 0.9;
      }
      if (++nudgeCount > 50) break;
    }

    [FSm, pushing0, resisting0, NmOut, convergedM] = solveFOSGenericMoment(
      props,
      R,
      lambdaNew,
      fsExtrap,
      Nm,
      maxIters,
      tol,
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
      tol,
      maxIters,
    );
    Nf = new Float64Array(NfOut);

    if (FSf == null) return [FSm, lffArray, pushingF, resistingF, false];

    lffArray.push([lambdaNew, FSm, FSf, Math.abs(FSm - FSf)]);
    lffArray.sort((a, b) => a[0] - b[0]);

    if (Math.abs(FSm - FSf) < tol)
      return [FSm, lffArray, pushingF, resistingF, true];

    if (ii > 5) {
      // Fallback: pick closest match
      const sorted = [...lffArray].sort((a, b) => a[3] - b[3]);
      const [bestLambda, bestFS] = sorted[0];
      let convergedBestM: boolean;
      [FSm, pushing0, resisting0, NmOut, convergedBestM] =
        solveFOSGenericMoment(
          props,
          R,
          bestLambda,
          bestFS,
          Nm,
          maxIters,
          tol,
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
          tol,
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
    const key = `${plane.cx}|${plane.cy}|${plane.radius}`;
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
      );
    } catch {
      continue;
    }
    if (slices.length === 0) continue;

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

    plane.fos = fos;
    plane.slices = slices;
    plane.converged = converged;
  }
}
