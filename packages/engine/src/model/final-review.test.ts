/**
 * Final review of the day's engine changes: slicing with densely digitised
 * water lines, the base material on a layer boundary, and the ponded water
 * in the Ito & Matsui vertical stress.
 */
import { describe, expect, it } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import { buildSlope } from "./build-slope";
import { toCanonicalSlopeDefinition } from "./canonical";
import { analyseMorgensternPrice, analyseSlope } from "./solvers";
import { getSlices } from "./slices";
import { pileForce, verticalStress } from "./reinforcement";
import { VERIFICATION_CASES, layered, runVerification, su } from "../verification/cases";

describe("slicing with a densely digitised water line", () => {
  // One material, a curved main water line given by n + 1 vertices.
  const slopeWith = (n: number) => {
    const line = Array.from({ length: n + 1 }, (_, i) => {
      const x = (60 * i) / n;
      return [x, -2 - 6 * (x / 60) ** 2];
    });
    const def = {
      coordinates: [[0, -20], [0, 0], [20, 0], [40, -10], [60, -10], [60, -20]],
      materials: [{ name: "Upper", unitWeight: 18, frictionAngle: 28, cohesion: 5 }],
      waterTable: { mode: "custom", value: line },
    } as unknown as SlopeDefinition;
    return buildSlope(toCanonicalSlopeDefinition(def));
  };

  it("cuts long intervals to about the nominal width however many vertices the line has", () => {
    // The water vertices are slice edges; once they outnumber the slice
    // count a long interval without vertices stayed one wide slice.
    const fos = [20, 600].map((n) => {
      const slope = slopeWith(n);
      slope.updateAnalysisOptions({ method: "Morgenstern-Price", iterations: 500, refinedIterations: 0 });
      const f = analyseSlope(slope)!;
      const crit = slope.search.find((p) => p.fos === f)!;
      const b = (crit.rc[0] - crit.lc[0]) / slope.sliceCount;
      expect(Math.max(...crit.slices!.map((s) => s.width))).toBeLessThan(1.6 * b);
      return f;
    });
    expect(Math.abs(fos[1] / fos[0] - 1)).toBeLessThan(0.01);
  });
});

describe("base on a layer boundary", () => {
  // su 40 over a weak layer su 10 (y = -12 to -14) over su 40.
  const ltr: [number, number][] = [[0, 10], [15, 10], [30, 0], [40, 0]];
  const def = layered(ltr, -20, [
    { name: "Upper", topY: null, model: su(40, 19) },
    { name: "Weak", topY: -12, model: su(10, 19) },
    { name: "Lower", topY: -14, model: su(40, 19) },
  ]);
  const { slope } = runVerification(def, "Bishop", { iterations: 200 });
  const along = (y: number): [number, number][] => [[5, 10], [14, y], [28, y], [35, 0]];
  const run = (y: number) => {
    const slices = getSlices(slope, 5, 35, 20, 30, 0, along(y));
    const mats = new Set(slices.filter((s) => s.xLeft >= 14 && s.xRight <= 28).map((s) => s.baseMaterial!.name));
    return { mats: [...mats], fos: analyseMorgensternPrice(slope, slices)[0] };
  };

  it("takes the weaker layer on its top and on its bottom", () => {
    for (const [y, inside] of [[-12, -12.001], [-14, -13.999]]) {
      const on = run(y);
      expect(on.mats).toEqual(["Weak"]);
      expect(on.fos).toBeCloseTo(run(inside).fos!, 2);
    }
  });
});

describe("Ito & Matsui vertical stress", () => {
  // Upper's own line ponds 2 m on the face; Lower's line is below the ground.
  const def = {
    coordinates: [[0, -20], [0, 0], [20, 0], [40, -10], [60, -10], [60, -20]],
    materials: [
      { name: "Upper", unitWeight: 18, frictionAngle: 28, cohesion: 5, waterTableId: "high" },
      { name: "Lower", unitWeight: 20, frictionAngle: 32, cohesion: 2, waterTableId: "low" },
    ],
    materialBoundaries: [{ coordinates: [[0, -6], [60, -6]], materialName: "" }],
    regionAssignments: [
      { point: [5, -2], materialName: "Upper" },
      { point: [5, -15], materialName: "Lower" },
    ],
    waterTables: [
      { id: "high", coordinates: [[0, -2], [60, -2]], followBoundary: false },
      { id: "low", coordinates: [[0, -8], [60, -8]], followBoundary: false },
    ],
  } as unknown as SlopeDefinition;
  const slope = buildSlope(toCanonicalSlopeDefinition(def));

  it("carries the free water on the ground into the layer below", () => {
    // x = 28: ground at -4 in Upper, whose line stands 2 m above it.
    const above = verticalStress(slope, 28, -5.999, false);
    const below = verticalStress(slope, 28, -6.001, false);
    expect(below - above).toBeGreaterThan(0);
    expect(below - above).toBeLessThan(0.1);
  });
});

describe("Ito & Matsui pile force location", () => {
  // Cai & Ugai's slope with a pile row, D1/D = 3 (V013c).
  const c = VERIFICATION_CASES.find((x) => x.id === "V013c")!;
  const run = (location?: "centroid" | "slip-surface") => {
    const def = { ...c.definition, piles: c.definition.piles!.map((p) => ({ ...p, ...(location ? { location } : {}) })) };
    return runVerification(def, "Bishop", c.checks[0].options ?? {});
  };

  it("acts at the resultant of the soil pressure by default, at the slip surface as Cai & Ugai on request", () => {
    const centroid = run().fos!;
    const crossing = run("slip-surface").fos!;
    expect(run("centroid").fos).toBe(centroid);
    // The resultant lies above the crossing: a shorter arm, a lower factor.
    expect(centroid).toBeLessThan(crossing);
    expect(centroid).toBeCloseTo(1.4371, 3);
    expect(crossing).toBeCloseTo(1.4501, 3);
  });

  it("puts the resultant at the soil pressure's moment over its force above the crossing", () => {
    const { slope } = run();
    const p = slope.piles[0];
    const { perPile, resultantAbove } = pileForce(slope, p, p.x1, 2);
    expect(perPile).toBeGreaterThan(0);
    // Below the pile head (y = 5) and above the crossing (y = 2).
    expect(resultantAbove).toBeGreaterThan(0);
    expect(resultantAbove).toBeLessThan(3);
    expect(pileForce(slope, { ...p, force: 100 }, p.x1, 2).resultantAbove).toBe(0);
  });
});
