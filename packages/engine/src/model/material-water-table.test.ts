import { describe, it, expect } from "vitest";
import { buildSlope } from "./build-slope";
import { getSlices } from "./slices";
import { analyseSlope } from "./solvers";
import { toCanonicalSlopeDefinition } from "./canonical";
import { WATER_UNIT_WEIGHT } from "../types/constants";
import type { SlopeDefinition } from "../types/slope-definition";

const BASE: SlopeDefinition = {
  coordinates: [
    [0, -20],
    [0, 0],
    [20, 0],
    [40, -10],
    [60, -10],
    [60, -20],
  ],
  materials: [
    { name: "Upper", unitWeight: 18, frictionAngle: 28, cohesion: 5 },
    { name: "Lower", unitWeight: 20, frictionAngle: 32, cohesion: 2 },
  ],
  materialBoundaries: [
    {
      coordinates: [
        [0, -6],
        [60, -6],
      ],
      materialName: "",
    },
  ],
  regionAssignments: [
    { point: [5, -2], materialName: "Upper" },
    { point: [5, -15], materialName: "Lower" },
  ],
  waterTable: {
    mode: "custom",
    value: [
      [0, -2],
      [60, -2],
    ],
  },
};

const PER_MATERIAL: SlopeDefinition = {
  ...BASE,
  materials: [
    { ...BASE.materials[0], waterTableId: "high" },
    { ...BASE.materials[1], waterTableId: "low" },
  ],
  waterTables: [
    {
      id: "high",
      coordinates: [
        [0, -2],
        [60, -2],
      ],
    },
    {
      id: "low",
      coordinates: [
        [0, -14],
        [60, -14],
      ],
    },
  ],
};

function deepSlices(def: SlopeDefinition) {
  const slope = buildSlope(def);
  const [cx, cy, r] = [30, 12, 30];
  const pts = slope.getCircleExternalIntersection(cx, cy, r);
  return getSlices(slope, pts[0][0], pts[1][0], cx, cy, r);
}

describe("per-material water tables", () => {
  it("uses the base material's own water line for pore pressure", () => {
    const slices = deepSlices(PER_MATERIAL);
    const lower = slices.filter((s) => s.baseMaterial?.name === "Lower");
    const upper = slices.filter((s) => s.baseMaterial?.name === "Upper");
    expect(lower.length).toBeGreaterThan(0);
    expect(upper.length).toBeGreaterThan(0);
    for (const s of lower) {
      expect(s.U).toBeCloseTo(Math.max(-14 - s.yBottom, 0) * WATER_UNIT_WEIGHT, 9);
    }
    for (const s of upper) {
      expect(s.U).toBeCloseTo(Math.max(-2 - s.yBottom, 0) * WATER_UNIT_WEIGHT, 9);
    }
  });

  it("gives a different (higher) FOS when the lower material has a lower water line", () => {
    const single = buildSlope(BASE);
    const perMaterial = buildSlope(PER_MATERIAL);
    single.updateAnalysisOptions({ iterations: 1000 });
    perMaterial.updateAnalysisOptions({ iterations: 1000 });
    expect(analyseSlope(perMaterial)!).toBeGreaterThan(analyseSlope(single)!);
  });

  it("is unchanged when materials are not assigned to a line", () => {
    const unassigned: SlopeDefinition = {
      ...BASE,
      waterTables: PER_MATERIAL.waterTables,
    };
    const a = deepSlices(BASE).map((s) => s.U);
    const b = deepSlices(unassigned).map((s) => s.U);
    expect(b).toEqual(a);
  });

  it("mirrors additional water tables for right-to-left models", () => {
    const rtl = toCanonicalSlopeDefinition({
      ...PER_MATERIAL,
      orientation: "rtl",
    });
    expect(rtl.waterTables?.[1].coordinates).toEqual([
      [60, -14],
      [0, -14],
    ]);
  });
});
