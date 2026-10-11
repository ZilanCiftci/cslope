import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "../types/analysis";
import type { SlopeDefinition } from "../types/slope-definition";
import { Material } from "../types/material";
import {
  inferOrientationFromCoordinates,
  mapAnalysisResultToModelSpace,
  mirrorX,
  oppositeDirectionDefinition,
  toCanonicalSlopeDefinition,
} from "./canonical";
import { buildSlope } from "./build-slope";
import { analyseSlope } from "./solvers";

describe("canonical helpers", () => {
  it("infers LTR and RTL from boundary crest side", () => {
    const ltrCoords: [number, number][] = [
      [0, 0],
      [0, 10],
      [10, 5],
      [10, 0],
    ];
    const rtlCoords: [number, number][] = [
      [0, 0],
      [0, 5],
      [10, 10],
      [10, 0],
    ];

    expect(inferOrientationFromCoordinates(ltrCoords)).toBe("ltr");
    expect(inferOrientationFromCoordinates(rtlCoords)).toBe("rtl");
  });

  it("mirrors an RTL slope definition into canonical LTR space", () => {
    const slope: SlopeDefinition = {
      orientation: "rtl",
      coordinates: [
        [0, 0],
        [0, 5],
        [10, 10],
        [10, 0],
      ],
      materials: [
        {
          name: "M1",
          unitWeight: 20,
          frictionAngle: 30,
          cohesion: 5,
        },
      ],
      analysisLimits: {
        entryLeftX: 7,
        entryRightX: 9,
        exitLeftX: 1,
        exitRightX: 3,
      },
      lineLoads: [{ magnitude: 50, x: 8 }],
      udls: [{ magnitude: 10, x1: 6, x2: 9 }],
    };

    const canonical = toCanonicalSlopeDefinition(slope);

    expect(canonical.orientation).toBe("rtl");
    expect(canonical.coordinates[2][0]).toBe(0);
    expect(canonical.analysisLimits?.entryLeftX).toBe(1);
    expect(canonical.analysisLimits?.entryRightX).toBe(3);
    expect(canonical.lineLoads?.[0].x).toBe(2);
    expect(canonical.udls?.[0]).toEqual({ magnitude: 10, x1: 1, x2: 4 });
  });

  it("maps canonical results back to RTL model space", () => {
    const canonicalSlope: SlopeDefinition = {
      orientation: "rtl",
      coordinates: [
        [0, 0],
        [0, 10],
        [10, 5],
        [10, 0],
      ],
      materials: [
        {
          name: "M1",
          unitWeight: 20,
          frictionAngle: 30,
          cohesion: 5,
        },
      ],
    };

    const result: AnalysisResult = {
      minFOS: 1.2,
      maxFOS: 1.8,
      method: "Bishop",
      elapsedMs: 100,
      criticalSurface: {
        cx: 3,
        cy: 2,
        radius: 6,
        fos: 1.2,
        entryPoint: [2, 9],
        exitPoint: [8, 4],
      },
      allSurfaces: [
        {
          cx: 3,
          cy: 2,
          radius: 6,
          fos: 1.2,
          entryPoint: [2, 9],
          exitPoint: [8, 4],
        },
      ],
      criticalSlices: [
        {
          x: 4,
          xLeft: 3,
          xRight: 5,
          width: 2,
          yTop: 10,
          yBottom: 5,
          height: 5,
          area: 10,
          alpha: 0.3,
          baseLength: 2.1,
          weight: 100,
          cohesion: 5,
          frictionAngle: 30,
          normalForce: 0,
          porePressure: 0,
          baseMaterial: new Material({ name: "M1", cohesion: 5 }),
        },
      ],
    };

    const mapped = mapAnalysisResultToModelSpace(result, canonicalSlope);

    expect(mapped.criticalSurface?.cx).toBe(mirrorX(3, 0, 10));
    expect(mapped.criticalSurface?.entryPoint).toEqual([8, 9]);
    expect(mapped.criticalSurface?.exitPoint).toEqual([2, 4]);
    expect(mapped.criticalSlices[0].xLeft).toBeLessThan(
      mapped.criticalSlices[0].xRight,
    );
  });
});

describe("oppositeDirectionDefinition", () => {
  // Ridge: steep 1:1 face on the left, gentle 2:1 face on the right.
  const ridge: SlopeDefinition = {
    orientation: "ltr",
    coordinates: [[0, -10], [0, 0], [20, 0], [30, 10], [40, 10], [60, 0], [80, 0], [80, -10]],
    materials: [{ name: "S", unitWeight: 19, frictionAngle: 25, cohesion: 8 }],
    analysisLimits: { entryLeftX: 30, entryRightX: 40, exitLeftX: 60, exitRightX: 80 },
  };
  const run = (def: SlopeDefinition) => {
    const slope = buildSlope(def);
    slope.updateAnalysisOptions({ iterations: 2000, refinedIterations: 500 });
    return { fos: analyseSlope(slope)!, slope };
  };

  it("analyses the other face without the model's search limits", () => {
    const canonical = toCanonicalSlopeDefinition(ridge);
    const opposite = oppositeDirectionDefinition(canonical);
    expect(opposite.orientation).toBe("rtl");
    expect(opposite.analysisLimits).toBeUndefined();
    const own = run(canonical);
    const other = run(opposite);
    const explicit = run(toCanonicalSlopeDefinition({ ...ridge, orientation: "rtl", analysisLimits: undefined }));
    expect(other.fos).toBeCloseTo(explicit.fos, 9);
    // The steep face governs.
    expect(other.fos).toBeLessThan(own.fos);
  });

  it("maps the opposite result back onto the steep (left) face", () => {
    const opposite = oppositeDirectionDefinition(toCanonicalSlopeDefinition(ridge));
    const { slope } = run(opposite);
    const plane = slope.search.find((p) => p.fos != null)!;
    const mapped = mapAnalysisResultToModelSpace(
      {
        minFOS: plane.fos!,
        maxFOS: plane.fos!,
        criticalSurface: { cx: plane.cx, cy: plane.cy, radius: plane.radius, fos: plane.fos!, entryPoint: plane.lc, exitPoint: plane.rc },
        allSurfaces: [],
        criticalSlices: [],
        method: "Bishop",
        elapsedMs: 0,
      },
      opposite,
    );
    const xs = [mapped.criticalSurface!.entryPoint[0], mapped.criticalSurface!.exitPoint[0]];
    expect(Math.max(...xs)).toBeLessThanOrEqual(40);
  });
});
