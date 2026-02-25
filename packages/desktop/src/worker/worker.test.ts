/**
 * Phase 4 — Worker integration tests.
 *
 * Tests the buildSlope DTO → Slope model reconstruction path
 * and end-to-end analysis via the same pipeline the worker uses.
 */

import { describe, it, expect } from "vitest";
import type { SlopeDefinition } from "@cslope/engine";
import { buildSlope, analyseSlope } from "@cslope/engine";

// ── Fixtures ─────────────────────────────────────────────────────

const T_ACADS_DEF: SlopeDefinition = {
  coordinates: [
    [0, -15],
    [0, 0],
    [20, 0],
    [40, -10],
    [50, -10],
    [50, -15],
  ],
  materials: [
    {
      name: "M1",
      unitWeight: 20,
      frictionAngle: 19.6,
      cohesion: 3,
      depthRange: [-1, -14],
      color: "#6d5f2a",
    },
  ],
};

// ── Tests ────────────────────────────────────────────────────────

describe("Worker: buildSlope DTO reconstruction", () => {
  it("reconstructs a simple slope from DTO", () => {
    const slope = buildSlope(T_ACADS_DEF);
    expect(slope.surfaceLineXY).not.toBeNull();
    expect(slope.surfaceLineXY!.x).toEqual([0, 20, 40, 50]);
    expect(slope.materialGeometries.length).toBeGreaterThan(0);
  });

  it("reconstructs slope with water table (height mode)", () => {
    const def: SlopeDefinition = {
      ...T_ACADS_DEF,
      waterTable: { mode: "height", value: -5, followBoundary: true },
    };
    const slope = buildSlope(def);
    expect(slope.hasWaterTable).toBe(true);
    expect(slope.waterRLXY).not.toBeNull();
  });

  it("reconstructs slope with UDL and line load", () => {
    const def: SlopeDefinition = {
      ...T_ACADS_DEF,
      udls: [{ magnitude: 10, x1: 5, x2: 15 }],
      lineLoads: [{ magnitude: 50, x: 10 }],
    };
    const slope = buildSlope(def);
    expect(slope.udls.length).toBe(1);
    expect(slope.lineLoads.length).toBe(1);
    expect(slope.udls[0].magnitude).toBe(10);
    expect(slope.lineLoads[0].magnitude).toBe(50);
  });

  it("reconstructs slope with custom water table coordinates", () => {
    const def: SlopeDefinition = {
      ...T_ACADS_DEF,
      waterTable: {
        mode: "custom",
        value: [
          [0, -3],
          [25, -5],
          [50, -8],
        ],
        followBoundary: false,
      },
    };
    const slope = buildSlope(def);
    expect(slope.hasWaterTable).toBe(true);
  });
});

describe("Worker: end-to-end analysis via DTO pipeline", () => {
  it("runs complete analysis from DTO and gets FOS", () => {
    const slope = buildSlope(T_ACADS_DEF);
    slope.setAnalysisLimits({
      entryLeftX: 17,
      entryRightX: 22,
      exitLeftX: 37,
      exitRightX: 43,
    });
    slope.updateAnalysisOptions({
      slices: 30,
      iterations: 200,
      method: "Bishop",
    });

    const fos = analyseSlope(slope);

    expect(fos).not.toBeNull();
    expect(fos!).toBeGreaterThan(0.5);
    expect(fos!).toBeLessThan(2.0);

    // Verify result structure
    expect(slope.search.length).toBeGreaterThan(0);
    const circle = slope.getMinFOSCircle();
    expect(circle.radius).toBeGreaterThan(0);
  });
});
