/**
 * Factor of Safety (FOS) solvers for slope stability analysis.
 *
 * Mirrors Python: src/pyslope/solvers.py + src/pyslope/math_utils.py
 *   (solve_fos_generic_moment, solve_fos_generic_force_circular)
 *
 * All Numba JIT functions are ported to plain TypeScript loops.
 */

import type { Slice } from "../types/index";
import { halfsine, extrapolateLambda } from "../math/index";
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
    funcs[i] = halfsine(s.xRight, x0, x1);
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
  fos: number,
  pushing: number,
  resisting: number,
  N: Float64Array,
];

/**
 * Generic moment equilibrium FOS solver.
 * Direct port of Python `math_utils.solve_fos_generic_moment`.
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
          W + xLeft - cohesionTerm / prevFOS - baseConstant * shearFactor;
        let denom = malpha + nMultiplier * shearFactor;
        if (Math.abs(denom) < 1e-12) denom = denom >= 0 ? 1e-12 : -1e-12;

        const N = num / denom;
        const eRight = baseConstant + N * nMultiplier;
        const xRight = eRight * shearFactor;

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

      if (pushing <= 0) return [0, pushing, resisting, nCurrent];

      fos = resisting / pushing;
      if (iter > 3 && Math.abs(prevFOS - fos) < tolerance) break;
      prevFOS = prevFOS + 0.5 * (fos - prevFOS);
    }

    // Outer convergence check on N values
    let maxNDiff = 0;
    for (let i = 0; i < n; i++) {
      const diff = Math.abs(nPrev[i] - nCurrent[i]);
      if (diff > maxNDiff) maxNDiff = diff;
    }
    if (maxNDiff < tolerance) return [fos, pushing, resisting, nCurrent];

    prevFOS = fos;
    for (let i = 0; i < n; i++) nPrev[i] = nCurrent[i];
  }

  return [fos, pushing, resisting, nCurrent];
}

/**
 * Generic force equilibrium FOS solver for circular surfaces.
 * Direct port of Python `math_utils.solve_fos_generic_force_circular`.
 */
function solveFOSGenericForceCircular(
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
          W + xLeft - CPrimeSin / prevFOS - baseConstant * shearFactor;
        let denom = malpha + nMultiplier * shearFactor;
        if (Math.abs(denom) < 1e-12) denom = denom >= 0 ? 1e-12 : -1e-12;

        const N = num / denom;
        const eRight = baseConstant + N * nMultiplier;
        const xRight = eRight * shearFactor;

        // Circular force equilibrium resistance
        if (matCode === 1) {
          const rd = c * bl * R + (N - U * bl) * R * tanPhi;
          const ru = cu * bl * R;
          resisting += Math.min(rd, ru);
        } else {
          resisting += c * bl * cosA + (N - U * bl) * cosA * tanPhi;
        }

        pushing += N * sinA;
        nCurrent[i] = N;
        eLeft = eRight;
        xLeft = xRight;
      }

      if (pushing <= 0) return [0, pushing, resisting, nCurrent];

      fos = resisting / pushing;
      if (iter > 3 && Math.abs(prevFOS - fos) < tolerance) break;
      prevFOS = prevFOS + 0.5 * (fos - prevFOS);
    }

    // Outer convergence check on N values
    let maxNDiff = 0;
    for (let i = 0; i < n; i++) {
      const diff = Math.abs(nPrev[i] - nCurrent[i]);
      if (diff > maxNDiff) maxNDiff = diff;
    }
    if (maxNDiff < tolerance) return [fos, pushing, resisting, nCurrent];

    prevFOS = fos;
    for (let i = 0; i < n; i++) nPrev[i] = nCurrent[i];
  }

  return [fos, pushing, resisting, nCurrent];
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
): [fos: number | null, pushing: number | null, resisting: number | null] {
  if (FS == null) FS = analyseOrdinary(slope, slices);
  if (FS == null || FS > slope.limitToRunBishops) return [FS, null, null];

  const x0 = slices[0].xLeft;
  const x1 = slices[slices.length - 1].xRight;
  const props = getSlicePropertyArrays(slices, x0, x1);
  const initialNs = new Float64Array(slices.length);

  const [fos, pushing, resisting] = solveFOSGenericMoment(
    props,
    slices[0].R,
    0, // lambda = 0
    FS,
    initialNs,
    slope.maxIterations,
    slope.tolerance,
    1, // numOuterIters = 1 when lambda = 0
  );

  if (fos === 0) return [null, null, null];
  return [fos, pushing, resisting];
}

/**
 * Janbu's Simplified Method.
 */
export function analyseJanbu(
  slope: Slope,
  slices: Slice[],
  FS?: number | null,
): [fos: number | null, pushing: number | null, resisting: number | null] {
  if (FS == null) FS = analyseOrdinary(slope, slices);
  if (FS == null || FS > slope.limitToRunJanbu) return [FS, null, null];

  const x0 = slices[0].xLeft;
  const x1 = slices[slices.length - 1].xRight;
  const props = getSlicePropertyArrays(slices, x0, x1);
  const initialNs = new Float64Array(slices.length);

  const [fos, pushing, resisting] = solveFOSGenericForceCircular(
    props,
    slices[0].R,
    0, // lambda = 0
    FS,
    initialNs,
    slope.maxIterations,
    slope.tolerance,
    1, // numOuterIters = 1 when lambda = 0
  );

  if (fos === 0) return [null, null, null];
  return [fos, pushing, resisting];
}

/**
 * Morgenstern-Price Method.
 */
export function analyseMorgensternPrice(
  slope: Slope,
  slices: Slice[],
): [
  fos: number | null,
  lffArray: [number, number, number][] | null,
  pushing: number | null,
  resisting: number | null,
] {
  const FSord = analyseOrdinary(slope, slices);
  if (FSord == null || FSord > slope.limitToRunBishops)
    return [FSord, null, null, null];

  const x0 = slices[0].xLeft;
  const x1 = slices[slices.length - 1].xRight;
  const props = getSlicePropertyArrays(slices, x0, x1);
  const R = slices[0].R;
  const n = slices.length;
  const maxIters = slope.maxIterations;
  const tol = slope.tolerance;

  // Step 1: Initial Bishop solution (lambda = 0)
  let Nm: Float64Array = new Float64Array(n);
  let [FSm, pushing0, resisting0, NmOut] = solveFOSGenericMoment(
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

  if (FSm === 0) return [null, null, null, null];
  if (FSm > slope.limitToRunMorgenstern)
    return [FSm, null, pushing0, resisting0];

  // Step 1b: Initial force solution (lambda = 0)
  let Nf: Float64Array = new Float64Array(n);
  let [FSf, pushingF, resistingF, NfOut] = solveFOSGenericForceCircular(
    props,
    R,
    0,
    FSord,
    Nf,
    maxIters,
    tol,
    1,
  );
  Nf = new Float64Array(NfOut);

  if (FSf === 0) {
    // Retry with different initial FS values
    for (const fact of [2, 0.5, 1.5, 0.75, 1.1, 0.9]) {
      [FSf, pushingF, resistingF, NfOut] = solveFOSGenericForceCircular(
        props,
        R,
        0,
        FSord * fact,
        new Float64Array(n),
        maxIters,
        tol,
        1,
      );
      Nf = new Float64Array(NfOut);
      if (FSf !== 0) break;
    }
    if (FSf === 0) return [FSm, null, pushingF, resistingF];
  }

  const lffArray: [number, number, number][] = [[0, FSm, FSf]];
  if (Math.abs(FSm - FSf) < tol) return [FSm, lffArray, pushingF, resistingF];

  // Step 2: Second point (lambda = 0.1)
  const lambda2 = 0.1;
  [FSm, pushing0, resisting0, NmOut] = solveFOSGenericMoment(
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

  [FSf, pushingF, resistingF, NfOut] = solveFOSGenericForceCircular(
    props,
    R,
    lambda2,
    FSf,
    Nf,
    maxIters,
    tol,
    maxIters,
  );
  Nf = new Float64Array(NfOut);

  if (FSf === 0) return [FSm, lffArray, pushingF, resistingF];

  lffArray.push([lambda2, FSm, FSf]);
  lffArray.sort((a, b) => a[0] - b[0]);
  if (Math.abs(FSm - FSf) < tol) return [FSm, lffArray, pushingF, resistingF];

  // Step 3: Iterative extrapolation
  for (let ii = 0; ii <= 6; ii++) {
    const prevLambda = lffArray[lffArray.length - 1][0];
    let [lambdaNew] = extrapolateLambda(lffArray);
    const [, fsExtrap] = extrapolateLambda(lffArray);

    // Limit step size
    if (Math.abs(lambdaNew - prevLambda) > 0.3) {
      lambdaNew = lambdaNew > prevLambda ? prevLambda + 0.3 : prevLambda - 0.3;
    }

    // Ensure unique lambda
    while (lffArray.some((x) => x[0] === lambdaNew)) {
      lambdaNew *= 0.9;
    }

    [FSm, pushing0, resisting0, NmOut] = solveFOSGenericMoment(
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

    [FSf, pushingF, resistingF, NfOut] = solveFOSGenericForceCircular(
      props,
      R,
      lambdaNew,
      FSf,
      Nf,
      maxIters,
      tol,
      maxIters,
    );
    Nf = new Float64Array(NfOut);

    if (FSf === 0) return [FSm, lffArray, pushingF, resistingF];

    lffArray.push([lambdaNew, FSm, FSf]);
    lffArray.sort((a, b) => a[0] - b[0]);

    if (Math.abs(FSm - FSf) < tol) return [FSm, lffArray, pushingF, resistingF];

    if (ii > 5) {
      // Fallback: pick closest match
      const sorted = [...lffArray].sort(
        (a, b) => Math.abs(a[1] - a[2]) - Math.abs(b[1] - b[2]),
      );
      const [bestLambda, bestFS] = sorted[0];
      [FSm, pushing0, resisting0, NmOut] = solveFOSGenericMoment(
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
      return [FSm, lffArray, pushing0, resisting0];
    }
  }

  return [FSm, lffArray, pushing0!, resisting0!];
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
  // Generate search planes if needed
  if (slope.search.length === 0 && slope.individualPlanes.length === 0) {
    setEntryExitPlanes(slope);
  }

  // Combine search + individual planes
  const allPlanes: SearchPlane[] = [
    ...slope.search.map((p) => ({ ...p, fos: 100, slices: null })),
    ...slope.individualPlanes.map((p) => ({ ...p, fos: 100, slices: null })),
  ];

  evaluatePlanes(slope, allPlanes);

  if (slope.refinedIterations > 0) {
    allPlanes.sort((a, b) => a.fos - b.fos);
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
  allPlanes.sort((a, b) => a.fos - b.fos);
  slope.setSearchResults(allPlanes);

  return allPlanes.length > 0 && allPlanes[0].fos < 100
    ? allPlanes[0].fos
    : null;
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

    switch (slope.method) {
      case "Bishop": {
        const [f] = analyseBishop(slope, slices);
        fos = f;
        break;
      }
      case "Janbu": {
        const [f] = analyseJanbu(slope, slices);
        fos = f;
        break;
      }
      case "Morgenstern-Price": {
        const [f, lff] = analyseMorgensternPrice(slope, slices);
        fos = f;
        plane.lffArray = lff ?? undefined;
        break;
      }
      default:
        throw new Error(`Unknown method: ${slope.method}`);
    }

    plane.fos = fos ?? 100;
    plane.slices = slices;
  }
}
