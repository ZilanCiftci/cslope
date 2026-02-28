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
} from "@cslope/engine";

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

  const start = performance.now();

  try {
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

    if (validSurfaces.length > 0) {
      const crit = validSurfaces[0];
      criticalSurface = {
        cx: crit.cx,
        cy: crit.cy,
        radius: crit.radius,
        fos: crit.fos!,
        entryPoint: crit.lc,
        exitPoint: crit.rc,
        converged: crit.converged,
      };

      // Convert slices for critical surface
      if (crit.slices) {
        for (const s of crit.slices) {
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
            cohesion: s.cohesion,
            frictionAngle: s.frictionAngle,
            normalForce: 0, // N-force not stored on slice
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
          entryPoint: p.lc,
          exitPoint: p.rc,
          converged: p.converged,
        });
      }
    }

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
      elapsedMs: performance.now() - start,
      nonConvergedSurfaces,
      splitFailureCount: slope.splitFailureCount,
    };

    const mappedResult = mapAnalysisResultToModelSpace(result, slopeDef);

    const completeResponse: AnalysisResponse = {
      type: "analysis-complete",
      id,
      result: mappedResult,
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

export {}; // Ensure this is treated as a module
