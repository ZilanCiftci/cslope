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
} from "../engine/types/index";
import { analyseSlope } from "../engine/model/index";
import { mapAnalysisResultToModelSpace } from "../engine/model/canonical";
import { buildSlope } from "./build-slope";

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
    // Send progress: building model
    self.postMessage({
      type: "analysis-progress",
      id,
      progress: 0.1,
    } satisfies AnalysisResponse);

    // Build slope model from DTO
    const slope = buildSlope(slopeDef);

    // Apply analysis options
    slope.updateAnalysisOptions({
      slices: options.slices,
      iterations: options.iterations,
      refinedIterations: options.refinedIterations,
      method: options.method,
      tolerance: options.tolerance,
      maxIterations: options.maxIterations,
    });

    if (options.minFailureDist > 0) {
      slope.updateAnalysisOptions({ minFailureDist: options.minFailureDist });
    }

    // Send progress: running analysis
    self.postMessage({
      type: "analysis-progress",
      id,
      progress: 0.3,
    } satisfies AnalysisResponse);

    // Run analysis
    const minFOS = analyseSlope(slope);

    // Send progress: building result
    self.postMessage({
      type: "analysis-progress",
      id,
      progress: 0.9,
    } satisfies AnalysisResponse);

    // Build result DTO
    let criticalSurface: SlipSurfaceResult | null = null;
    const allSurfaces: SlipSurfaceResult[] = [];
    const criticalSlices: SliceData[] = [];

    if (slope.search.length > 0) {
      const crit = slope.search[0];
      criticalSurface = {
        cx: crit.cx,
        cy: crit.cy,
        radius: crit.radius,
        fos: crit.fos,
        entryPoint: crit.lc,
        exitPoint: crit.rc,
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
      for (let i = 0; i < slope.search.length; i++) {
        const p = slope.search[i];
        allSurfaces.push({
          cx: p.cx,
          cy: p.cy,
          radius: p.radius,
          fos: p.fos,
          entryPoint: p.lc,
          exitPoint: p.rc,
        });
      }
    }

    const result: AnalysisResult = {
      minFOS: minFOS ?? 0,
      maxFOS: slope.search.length > 0 ? slope.getMaxFOS() : 0,
      criticalSurface,
      allSurfaces,
      criticalSlices,
      method: options.method,
      elapsedMs: performance.now() - start,
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
