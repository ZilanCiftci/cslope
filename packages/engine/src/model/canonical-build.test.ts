/**
 * Canonical mirroring and model building: the remaining branches
 * (orientation edge cases, results with polylines and reinforcement
 * forces, legacy boundary assignment, invalid custom surfaces).
 */
import { describe, it, expect } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import type { AnalysisResult } from "../types/analysis";
import {
  inferOrientationFromCoordinates,
  resolveOrientation,
  toCanonicalSlopeDefinition,
  oppositeDirectionDefinition,
  mapAnalysisResultToModelSpace,
  mirrorLimits,
} from "./canonical";
import { buildSlope } from "./build-slope";

const LTR: [number, number][] = [[0, -10], [0, 10], [10, 10], [25, 0], [40, 0], [40, -10]];
const RTL: [number, number][] = LTR.map(([x, y]) => [40 - x, y]);
const soil = { name: "S", unitWeight: 19, cohesion: 10, frictionAngle: 25 };

describe("orientation", () => {
  it("fewer than two points, a flat model and explicit orientations", () => {
    expect(inferOrientationFromCoordinates([[0, 0]])).toBe("ltr");
    expect(inferOrientationFromCoordinates([[0, 0], [10, 0], [10, -5], [0, -5]])).toBe("ltr");
    expect(inferOrientationFromCoordinates(RTL)).toBe("rtl");
    expect(resolveOrientation("rtl", LTR)).toBe("rtl");
    expect(resolveOrientation(undefined, RTL)).toBe("rtl");
  });

  it("mirrored limits keep left ≤ right", () => {
    expect(mirrorLimits({ entryLeftX: 30, entryRightX: 35, exitLeftX: 5, exitRightX: 12 }, 0, 40)).toEqual({
      entryLeftX: 5,
      entryRightX: 10,
      exitLeftX: 28,
      exitRightX: 35,
    });
  });

  it("a left-to-right definition is returned as is (with its orientation)", () => {
    const def: SlopeDefinition = { coordinates: LTR, materials: [soil] };
    const c = toCanonicalSlopeDefinition(def);
    expect(c.coordinates).toBe(LTR);
    expect(c.orientation).toBe("ltr");
  });

  it("the opposite direction of a right-to-left model is the left-to-right one, without limits and custom surfaces", () => {
    const def: SlopeDefinition = {
      orientation: "rtl",
      coordinates: RTL,
      materials: [soil],
      analysisLimits: { entryLeftX: 30, entryRightX: 35, exitLeftX: 5, exitRightX: 12 },
      customSearchPlanes: [{ cx: 18, cy: 18, radius: 18.5 }],
      customPlanesOnly: true,
    };
    const opp = oppositeDirectionDefinition(toCanonicalSlopeDefinition(def));
    expect(opp.orientation).toBe("ltr");
    expect(opp.analysisLimits).toBeUndefined();
    expect(opp.customSearchPlanes).toBeUndefined();
    expect(opp.customPlanesOnly).toBe(false);
    expect(opp.coordinates).toEqual(RTL);
  });
});

describe("mapAnalysisResultToModelSpace", () => {
  const result: AnalysisResult = {
    minFOS: 1.2,
    maxFOS: 2,
    criticalSurface: {
      cx: 10,
      cy: 20,
      radius: 0,
      fos: 1.2,
      entryPoint: [5, 10],
      exitPoint: [30, 0],
      points: [[5, 10], [15, 2], [30, 0]],
      reinforcementForces: [{ index: 0, x: 12, y: 4, fx: 30, fy: 5, force: 30.4, passive: false }],
    },
    allSurfaces: [{ cx: 10, cy: 20, radius: 0, fos: 1.2, entryPoint: [5, 10], exitPoint: [30, 0], points: [[5, 10], [30, 0]] }],
    criticalSlices: [],
    method: "Bishop",
    elapsedMs: 1,
  };

  it("mirrors polylines and reinforcement forces (x and the horizontal component)", () => {
    const m = mapAnalysisResultToModelSpace(result, { orientation: "rtl", coordinates: LTR, materials: [soil] });
    const cs = m.criticalSurface!;
    expect(cs.points).toEqual([[35, 10], [25, 2], [10, 0]]);
    expect(cs.reinforcementForces![0]).toMatchObject({ x: 28, fx: -30, fy: 5 });
    expect(m.allSurfaces[0].points).toEqual([[35, 10], [10, 0]]);
  });

  it("without a critical surface or polylines", () => {
    const bare = { ...result, criticalSurface: null, allSurfaces: [{ ...result.allSurfaces[0], points: undefined }] };
    const m = mapAnalysisResultToModelSpace(bare, { orientation: "rtl", coordinates: LTR, materials: [soil] });
    expect(m.criticalSurface).toBeNull();
    expect(m.allSurfaces[0].points).toBeUndefined();
    const withoutForces = { ...result, criticalSurface: { ...result.criticalSurface!, points: undefined, reinforcementForces: undefined } };
    const n = mapAnalysisResultToModelSpace(withoutForces, { orientation: "rtl", coordinates: LTR, materials: [soil] });
    expect(n.criticalSurface!.points).toBeUndefined();
    expect(n.criticalSurface!.reinforcementForces).toBeUndefined();
  });
});

describe("buildSlope", () => {
  it("needs at least one material and rejects an invalid one", () => {
    expect(() => buildSlope({ coordinates: LTR, materials: [] })).toThrow(/at least one material/);
    expect(() => buildSlope({ coordinates: LTR, materials: undefined as never })).toThrow(/at least one material/);
    expect(() => buildSlope({ coordinates: LTR, materials: [{ ...soil, cohesion: -1 }] })).toThrow(/Material "S" has invalid model/);
  });

  it("legacy boundary assignment: below each boundary its material, the top region the first or the named one", () => {
    const def: SlopeDefinition = {
      coordinates: LTR,
      materials: [soil, { ...soil, name: "Clay" }, { ...soil, name: "Top" }],
      materialBoundaries: [{ coordinates: [[0, 2], [20, -1], [40, -3]], materialName: "Clay" }],
      topRegionMaterialName: "Top",
    };
    const s = buildSlope(def);
    const names = s.materialGeometries.map((g) => g.material.name).sort();
    expect(names).toEqual(["Clay", "Top"]);
    // Boundaries with a single point are ignored.
    const t = buildSlope({ ...def, materialBoundaries: [...def.materialBoundaries!, { coordinates: [[5, 5]], materialName: "S" }], topRegionMaterialName: undefined });
    expect(t.materialGeometries.map((g) => g.material.name).sort()).toEqual(["Clay", "S"]);
  });

  it("water tables in every mode, loads, reinforcement, piles and limits", () => {
    const base: SlopeDefinition = { coordinates: LTR, materials: [{ ...soil, waterTableId: "p" }] };
    expect(buildSlope({ ...base, waterTable: { mode: "height", value: 2 } }).waterRLXY!.y[0]).toBe(2);
    expect(buildSlope({ ...base, waterTable: { mode: "depth", value: 3, followBoundary: false } }).waterRLXY!.y[0]).toBe(7);
    expect(buildSlope({ ...base, waterTable: { mode: "custom", value: [[0, 1], [40, -1]] } }).waterRLXY).not.toBeNull();
    // A mode that does not fit its value is ignored.
    expect(buildSlope({ ...base, waterTable: { mode: "height", value: [[0, 1]] as never } }).hasWaterTable).toBe(false);
    const s = buildSlope({
      ...base,
      waterTables: [{ id: "p", coordinates: [[0, -1], [40, -2]] }],
      udls: [{ magnitude: 10, x1: 1, x2: 5 }],
      lineLoads: [{ magnitude: 20, x: 3 }],
      reinforcements: [{ x1: 20, y1: 4, x2: 10, y2: 1, tensileCapacity: 100 }],
      piles: [{ x1: 20, y1: 4, x2: 20, y2: -8, force: 50 }],
      analysisLimits: { entryLeftX: 2, entryRightX: 8, exitLeftX: 28, exitRightX: 36 },
    });
    expect(s.hasMaterialWaterTables).toBe(true);
    expect(s.udls).toHaveLength(1);
    expect(s.lineLoads).toHaveLength(1);
    expect(s.reinforcements).toHaveLength(1);
    expect(s.piles).toHaveLength(1);
    expect(s.limits).toEqual([2, 8, 28, 36]);
  });

  it("rejects an invalid custom circle; drops custom polylines that give no surface", () => {
    for (const p of [{ cx: 1, cy: 2, radius: 0 }, { cx: NaN, cy: 2, radius: 5 }, { cx: 1, cy: Infinity, radius: 5 }]) {
      expect(() => buildSlope({ coordinates: LTR, materials: [soil], customSearchPlanes: [p] })).toThrow(/finite centre and a positive radius/);
    }
    const s = buildSlope({
      coordinates: LTR,
      materials: [soil],
      customSurfaces: [
        { points: [[0, 20], [40, 20]] }, // above the ground
        { points: [[5, 10], [15, 6], [20, -2], [33, 0]] }, // kinked upward: still admitted (any concavity)
        { points: [[5, 10], [18, -2], [33, 0]], axis: [20, 25] },
      ],
      customPlanesOnly: true,
    });
    expect(s.individualPlanes).toHaveLength(2);
    expect(s.individualPlanes[1]).toMatchObject({ cx: 20, cy: 25, radius: 0 });
    expect(s.customPlanesOnly).toBe(true);
  });
});
