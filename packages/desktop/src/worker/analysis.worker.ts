/**
 * Analysis Web Worker.
 *
 * Reconstructs a Slope model from the serialized SlopeDefinition,
 * runs the full analysis, and returns structured results.
 */

import type { AnalysisRequest, AnalysisResponse } from "./messages";
import type {
  AnalysisResult,
  SlipSurfaceResult,
  SliceData,
} from "@cslope/engine";
import {
  analyseSlope,
  mapAnalysisResultToModelSpace,
  buildSlope,
  oppositeDirectionDefinition,
  resolveOrientation,
  sliceDrivingMoment,
  sliceVerticalLoad,
  type SearchPlane,
  type Slice,
  type AnalysisOptions,
  type SlopeDefinition,
} from "@cslope/engine";

function computeCriticalPushingMoment(
  slices: ReadonlyArray<Slice> | null | undefined,
): number | null {
  if (!slices || slices.length === 0) return null;
  let pushing = 0;
  for (const s of slices) {
    pushing += sliceDrivingMoment(s);
    // Active reinforcement is on the driving side (passive is part of the
    // resistance, which is reported as pushing × FOS).
    const a = s.reinforcementActive;
    if (a) pushing += a[0] * s.dx + a[2];
  }
  return Number.isFinite(pushing) && pushing > 0 ? pushing : null;
}

function computeCriticalSlipVolume(
  slices: ReadonlyArray<{ area: number }> | null | undefined,
): number | null {
  if (!slices || slices.length === 0) return null;
  let volume = 0;
  for (const s of slices) {
    volume += s.area;
  }
  return Number.isFinite(volume) && volume > 0 ? volume : null;
}

// ── Worker handler ──────────────────────────────────────────────

/** Handle incoming analysis requests. */
self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const { type, id, slope: slopeDef, options } = event.data;

  if (type !== "run-analysis") {
    const errorResponse: AnalysisResponse = {
      type: "analysis-error",
      id: id ?? "unknown",
      error: `Unknown message type: ${type}`,
    };
    self.postMessage(errorResponse);
    return;
  }

  try {
    const start = performance.now();
    let result: AnalysisResult;
    if (options.bothDirections && !slopeDef.customPlanesOnly) {
      result = analyseBothDirections(slopeDef, options);
    } else {
      result = mapAnalysisResultToModelSpace(analyse(slopeDef, options), slopeDef);
    }
    result.elapsedMs = performance.now() - start;

    const completeResponse: AnalysisResponse = {
      type: "analysis-complete",
      id,
      result,
    };
    self.postMessage(completeResponse);
  } catch (err: unknown) {
    const errorResponse: AnalysisResponse = {
      type: "analysis-error",
      id,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(errorResponse);
  }
};

/**
 * Analyse the model's own direction and the opposite one and report the
 * lower FOS, with the direction it slides in.
 */
function analyseBothDirections(
  slopeDef: SlopeDefinition,
  options: AnalysisOptions,
): AnalysisResult {
  const own = resolveOrientation(slopeDef.orientation, slopeDef.coordinates);
  const oppositeDef = oppositeDirectionDefinition(slopeDef);
  const tryRun = (def: SlopeDefinition) => {
    try {
      return { result: mapAnalysisResultToModelSpace(analyse(def, options), def) };
    } catch (err) {
      return { error: err };
    }
  };
  // A failure in the model's own direction (its limits, its geometry) is
  // the user's error to see; only the opposite run may come up empty.
  const ownResult = mapAnalysisResultToModelSpace(analyse(slopeDef, options), slopeDef);
  const b = tryRun(oppositeDef);
  const ownGoverns = !b.result || ownResult.minFOS <= b.result.minFOS;
  const governing = ownGoverns ? ownResult : b.result!;
  const other = ownGoverns ? b.result : ownResult;
  return {
    ...governing,
    slidingDirection: ownGoverns ? own : own === "ltr" ? "rtl" : "ltr",
    otherDirectionMinFOS: other ? other.minFOS : null,
  };
}

/**
 * Points of a non-circular surface as drawn: from the crack bottom (when
 * cracked) to the exit.
 */
function displayPoints(p: SearchPlane): [number, number][] | undefined {
  if (!p.points) return undefined;
  const crack = p.crack;
  if (!crack) return p.points;
  return [crack, ...p.points.filter((q) => q[0] > crack[0] + 1e-9)];
}

/** Run one analysis on a canonical definition (result in canonical space). */
function analyse(
  slopeDef: SlopeDefinition,
  options: AnalysisOptions,
): AnalysisResult {
  const start = performance.now();
  // Build slope model from DTO
  const slope = buildSlope(slopeDef);

  // Apply analysis options
  slope.updateAnalysisOptions(options);

  // Run analysis
  const minFOS = analyseSlope(slope);

  // Build result DTO
  let criticalSurface: SlipSurfaceResult | null = null;
  const allSurfaces: SlipSurfaceResult[] = [];
  const criticalSlices: SliceData[] = [];

  const validSurfaces = slope.search.filter((s) => s.fos != null);
  if (validSurfaces.length === 0) {
    // Reporting FOS 0.000 here would read as a collapsed slope.
    throw new Error(
      "No valid slip surface was found. Check the search limits, the geometry and the material strengths.",
    );
  }

  if (validSurfaces.length > 0) {
    const crit = validSurfaces[0];
    criticalSurface = {
      cx: crit.cx,
      cy: crit.cy,
      radius: crit.radius,
      fos: crit.fos!,
      entryPoint: crit.crack ?? crit.lc,
      exitPoint: crit.rc,
      converged: crit.converged,
      lffArray: crit.lffArray,
      points: displayPoints(crit),
      reinforcementForces: crit.slices?.flatMap((s) => s.reinforcementForces ?? []),
    };

    // Convert slices for critical surface
    if (crit.slices) {
      for (const s of crit.slices) {
        const surfaceLoad = sliceVerticalLoad(s) - s.weight;
        criticalSlices.push({
          x: s.x,
          xLeft: s.xLeft,
          xRight: s.xRight,
          width: s.width,
          yTop: s.yTop,
          yBottom: s.yBottom,
          height: s.height,
          area: s.area,
          alpha: s.alpha,
          baseLength: s.baseLength,
          weight: s.weight,
          surfaceLoad,
          cohesion: s.cohesion,
          frictionAngle: s.frictionAngle,
          // Same effective normal force as the results plot dialog.
          normalForce:
            (s.weight + surfaceLoad) * Math.cos(s.alpha) -
            s.U * s.baseLength,
          porePressure: s.U,
          baseMaterial: s.baseMaterial!,
        });
      }
    }

    // All surfaces for visualization (sorted by FOS ascending)
    for (let i = 0; i < validSurfaces.length; i++) {
      const p = validSurfaces[i];
      allSurfaces.push({
        cx: p.cx,
        cy: p.cy,
        radius: p.radius,
        fos: p.fos!,
        entryPoint: p.crack ?? p.lc,
        exitPoint: p.rc,
        converged: p.converged,
        lffArray: p.lffArray,
        points: displayPoints(p),
      });
    }
  }

  // Moments about a circle's centre; on a non-circular surface they
  // depend on the axis point and the solved normal forces, so none are
  // reported.
  const criticalPushingMoment = validSurfaces[0]?.points
    ? null
    : computeCriticalPushingMoment(validSurfaces[0]?.slices);
  const criticalSlipVolume = computeCriticalSlipVolume(
    validSurfaces[0]?.slices,
  );
  const criticalResistingMoment =
    criticalPushingMoment != null && criticalSurface
      ? criticalPushingMoment * criticalSurface.fos
      : null;

  const nonConvergedSurfaces = slope.search.reduce(
    (count, plane) => count + (plane.converged === false ? 1 : 0),
    0,
  );

  const result: AnalysisResult = {
    minFOS: minFOS ?? 0,
    maxFOS: validSurfaces.length > 0 ? slope.getMaxFOS() : 0,
    criticalSurface,
    allSurfaces,
    criticalSlices,
    method: options.method,
    criticalLffArray:
      options.method === "Morgenstern-Price" && validSurfaces.length > 0
        ? validSurfaces[0].lffArray
        : undefined,
    criticalPushingMoment:
      criticalPushingMoment != null ? criticalPushingMoment : undefined,
    criticalResistingMoment:
      criticalResistingMoment != null ? criticalResistingMoment : undefined,
    criticalSlipVolume:
      criticalSlipVolume != null ? criticalSlipVolume : undefined,
    elapsedMs: performance.now() - start,
    nonConvergedSurfaces,
    splitFailureCount: slope.splitFailureCount,
  };

  return result;
}

export {}; // Ensure this is treated as a module
