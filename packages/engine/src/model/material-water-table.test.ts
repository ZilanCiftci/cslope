import { describe, it, expect } from "vitest";
import { buildSlope } from "./build-slope";
import { getSlices } from "./slices";
import { analyseSlope } from "./solvers";
import { toCanonicalSlopeDefinition } from "./canonical";
import { WATER_UNIT_WEIGHT } from "../types/constants";
import type { SlopeDefinition } from "../types/slope-definition";
import { runVerification } from "../verification/cases";

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

// Free water above the ground comes from the line of the material at the
// ground, the same line that gives that material its pore pressure: weight
// on the ground and pore pressure at the base must come from one water
// level (Duncan & Wright 2014, ch. 6).
describe("free water from a material's own line", () => {
  // V041a (D&W fig. 6.27): submerged slope, pool 30 ft above the crest.
  const soil = { name: "Soil", model: { kind: "mohr-coulomb", unitWeight: 20.10719, cohesion: 4.78803, frictionAngle: 20 } } as const;
  const dry: SlopeDefinition = {
    materials: [soil],
    coordinates: [[0, 0], [0, 4.572], [9.144, 4.572], [32.004, 13.716], [42.672, 13.716], [42.672, 0]],
    materialBoundaries: [],
    regionAssignments: [{ point: [37.338, 13.216], materialName: "Soil" }],
  };
  const pool: [number, number][] = [[0, 22.86], [42.672, 22.86]];
  const low: [number, number][] = [[0, -1], [42.672, -1]];
  const own = { ...dry, materials: [{ ...soil, waterTableId: "p" }] };
  const fos = (def: SlopeDefinition) =>
    runVerification(def, "Bishop", { porePressureHead: "vertical", slices: 40 }).fos;

  it("gives the pool as the material's line the FOS of the pool as the main line", () => {
    const main = fos({ ...dry, waterTable: { mode: "custom", value: pool, followBoundary: false } })!;
    expect(main).toBeCloseTo(1.597, 3);
    expect(fos({ ...own, waterTables: [{ id: "p", coordinates: pool, followBoundary: false }] })).toBeCloseTo(main, 6);
    expect(
      fos({
        ...own,
        waterTable: { mode: "custom", value: low, followBoundary: false },
        waterTables: [{ id: "p", coordinates: pool, followBoundary: false }],
      }),
    ).toBeCloseTo(main, 6);
  });

  it("puts no pool weight on a material whose own line is below the ground", () => {
    // The main line ponds but the soil's own line is below the slip
    // surface: no pore pressure and no water load, as dry.
    const d = fos(dry)!;
    expect(d).toBeCloseTo(1.337, 3);
    expect(
      fos({
        ...own,
        waterTable: { mode: "custom", value: pool, followBoundary: false },
        waterTables: [{ id: "p", coordinates: low, followBoundary: false }],
      }),
    ).toBeCloseTo(d, 6);
  });

  it("loads only the slices whose surface material has the ponding line", () => {
    // Lower (the ground from x = 32 on) ponds 2 m at the toe from its own
    // line; Upper takes the main line, below the ground.
    const def: SlopeDefinition = {
      ...BASE,
      materials: [BASE.materials[0], { ...BASE.materials[1], waterTableId: "toe" }],
      waterTable: { mode: "custom", value: [[0, -12], [60, -12]], followBoundary: false },
      waterTables: [{ id: "toe", coordinates: [[0, -8], [60, -8]], followBoundary: false }],
    };
    const slices = deepSlices(def);
    const wet = slices.filter((s) => s.xLeft >= 36 - 1e-9);
    expect(wet.length).toBeGreaterThan(0);
    for (const s of wet) {
      const depth = (-8 - s.y0Top + (-8 - s.y1Top)) / 2;
      expect(s.waterLoad).toBeCloseTo(WATER_UNIT_WEIGHT * (s.xRight - s.xLeft) * depth, 9);
    }
    for (const s of slices.filter((s) => s.xRight <= 36 + 1e-9)) {
      expect(s.waterLoad ?? 0).toBe(0);
    }
  });
});
