import { describe, it, expect } from "vitest";
import { buildSlope } from "./build-slope";
import { getSlices } from "./slices";
import { analyseSlope } from "./solvers";
import { waternetPorePressure, type Waternet } from "./waternet";
import { WATER_UNIT_WEIGHT } from "../types/constants";
import type { SlopeDefinition } from "../types/slope-definition";
import type { Slope } from "./slope";

// The unit weight of water γw as a model setting (the `waterUnitWeight`
// analysis option).

const BASE: SlopeDefinition = {
  coordinates: [
    [0, -20],
    [0, 0],
    [20, 0],
    [40, -10],
    [60, -10],
    [60, -20],
  ],
  materials: [{ name: "Soil", unitWeight: 18, frictionAngle: 28, cohesion: 5 }],
  waterTable: {
    mode: "custom",
    value: [
      [0, -2],
      [60, -2],
    ],
  },
};

function slicesOf(slope: Slope) {
  const [cx, cy, r] = [30, 12, 30];
  const pts = slope.getCircleExternalIntersection(cx, cy, r);
  return getSlices(slope, pts[0][0], pts[1][0], cx, cy, r);
}

describe("unit weight of water", () => {
  it("is 9.807 when the model does not set it", () => {
    expect(WATER_UNIT_WEIGHT).toBe(9.807);
    const slope = buildSlope(BASE);
    expect(slope.waterUnitWeight).toBe(9.807);
    // behind the crest the line is below the ground: U = γw·h on the base
    const behind = slicesOf(slope).filter((s) => s.xRight <= 20);
    expect(behind.length).toBeGreaterThan(0);
    for (const s of behind) expect(s.U).toBeCloseTo(Math.max(-2 - s.yBottom, 0) * 9.807, 9);
  });

  it("scales the pore pressure of each slice with the model's value", () => {
    const slope = buildSlope(BASE);
    slope.updateAnalysisOptions({ waterUnitWeight: 10 });
    expect(slope.waterUnitWeight).toBe(10);
    const wet = slicesOf(slope).filter((s) => s.xRight <= 20 && s.yBottom < -2);
    expect(wet.length).toBeGreaterThan(0);
    for (const s of wet) expect(s.U).toBeCloseTo((-2 - s.yBottom) * 10, 9);
  });

  it("gives the same F with 9.807 set as without it, and a lower F with more", () => {
    const fos = (o: { waterUnitWeight?: number }) => {
      const slope = buildSlope(BASE);
      slope.updateAnalysisOptions({ iterations: 500, refinedIterations: 0, ...o });
      return analyseSlope(slope)!;
    };
    const f = fos({});
    expect(fos({ waterUnitWeight: 9.807 })).toBe(f);
    expect(fos({ waterUnitWeight: 11 })).toBeLessThan(f);
  });

  it("scales the waternet's pore pressure", () => {
    const wn: Waternet = {
      headLines: [{ id: "h", points: [[0, 10], [30, 10]] }],
      referenceLines: [],
      phreaticLineId: "h",
    };
    expect(waternetPorePressure(wn, 10, 4)).toBeCloseTo(6 * 9.807, 12);
    expect(waternetPorePressure(wn, 10, 4, 10)).toBeCloseTo(60, 12);
  });

  it("rejects a value that is not a positive number", () => {
    for (const bad of [0, -9.807, Number.NaN, Number.POSITIVE_INFINITY]) {
      const slope = buildSlope(BASE);
      expect(() => slope.updateAnalysisOptions({ waterUnitWeight: bad })).toThrow(/waterUnitWeight/);
      expect(slope.waterUnitWeight).toBe(9.807);
    }
  });
});
