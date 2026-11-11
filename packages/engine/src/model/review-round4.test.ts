import { describe, expect, it } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import { buildSlope } from "./build-slope";
import { analyseSlope } from "./solvers";
import { isAdmissiblePolyline } from "./surface";
import { analysisWarnings } from "./result-warnings";

const fos = (def: SlopeDefinition, options: Record<string, unknown> = {}) => {
  const slope = buildSlope(def);
  slope.updateAnalysisOptions({ method: "Bishop", iterations: 300, refinedIterations: 100, ...options });
  return analyseSlope(slope);
};

const mc = (unitWeight: number, cohesion: number, frictionAngle: number) =>
  ({ kind: "mohr-coulomb", unitWeight, cohesion, frictionAngle }) as const;

describe("region split", () => {
  // A boundary vertex on the slope face (5/7 along it): plain noding threw
  // and the slope was analysed as the first material throughout.
  const onFace: SlopeDefinition = {
    coordinates: [[0, -10], [0, 10], [10, 10], [20, 2], [21, 0], [40, 0], [40, -10]],
    materials: [
      { name: "Strong", model: mc(18, 15, 30) },
      { name: "Weak", model: mc(18, 0, 7) },
    ],
    materialBoundaries: [{ coordinates: [[0, 5], [17.142857142857142, 4.285714285714286], [40, -3]], materialName: "Weak" }],
    regionAssignments: [
      { point: [1, 9], materialName: "Strong" },
      { point: [1, -5], materialName: "Weak" },
    ],
  };

  it("splits at a boundary vertex on the outline as just below it", () => {
    const nudged: SlopeDefinition = {
      ...onFace,
      materialBoundaries: [{ coordinates: [[0, 5], [17.142857142857142, 4.285714285714286 - 1e-6], [40, -3]], materialName: "Weak" }],
    };
    expect(fos(onFace)).toBeCloseTo(fos(nudged)!, 4);
  });

  const def = (gap: number): SlopeDefinition => ({
    coordinates: [[0, -10], [0, 10], [10, 10], [30, 0], [40, 0], [40, -10]],
    materials: [
      { name: "Strong", model: mc(18, 15, 30) },
      { name: "Weak", model: mc(18, 2, 8) },
    ],
    materialBoundaries: [{ coordinates: [[0, 3], [40 - gap, -1]], materialName: "Weak" }],
    regionAssignments: [
      { point: [1, 9], materialName: "Strong" },
      { point: [1, -5], materialName: "Weak" },
    ],
  });

  it("puts a boundary end a rounding error short of the edge on it", () => {
    expect(fos(def(1e-12))).toBeCloseTo(fos(def(0))!, 9);
  });

  it("puts a boundary end up to 1e-3 of the model size short of the edge on it", () => {
    // A 1 mm or 4 cm (1e-3 × 40 m, less a rounding margin) gap left one
    // region of the strong material: FOS 2.215 instead of 0.773 (0.772
    // with the cut steep ends of a circle, until 2026-11-11).
    const exact = fos(def(0))!;
    expect(exact).toBeCloseTo(0.773, 3);
    for (const gap of [1e-3, 0.999e-3 * 40]) {
      const slope = buildSlope(def(gap));
      expect(slope.danglingBoundaries).toEqual([]);
      expect(fos(def(gap))).toBeCloseTo(exact, 3);
    }
  });

  it("reports a boundary that still ends inside a region", () => {
    const slope = buildSlope(def(0.1));
    slope.updateAnalysisOptions({ method: "Bishop", iterations: 300, refinedIterations: 100 });
    analyseSlope(slope);
    expect(slope.danglingBoundaries).toEqual([0]);
    const w = analysisWarnings(slope).filter((x) => x.code === "dangling-boundary");
    expect(w).toEqual([
      {
        code: "dangling-boundary",
        message: "Material boundary 1 ends inside a region and does not split it; check its end points.",
        boundaryIndex: 0,
      },
    ]);
  });

  it("numbers a dangling boundary as in the definition", () => {
    const d = def(0.1);
    const slope = buildSlope({
      ...d,
      materialBoundaries: [{ coordinates: [[5, 5]], materialName: "Weak" }, ...d.materialBoundaries!],
    });
    expect(slope.danglingBoundaries).toEqual([1]);
  });
});

describe("admissible non-circular surfaces", () => {
  it("rejects a segment that passes through the air in front of a vertical face", () => {
    // A bench: vertical face at x = 13 from y = 10 down to y = 6.
    const slope = buildSlope({
      coordinates: [[0, -5], [0, 10], [13, 10], [13, 6], [30, 6], [30, -5]],
      materials: [{ name: "Soil", model: mc(18, 5, 25) }],
    });
    expect(isAdmissiblePolyline(slope, [[12.9, 10], [13.2, 5.5], [20, 4], [25, 6]])).toBe(false);
    expect(isAdmissiblePolyline(slope, [[12.9, 10], [12.95, 5.5], [20, 4], [25, 6]])).toBe(true);
  });
});

describe("input that gave a plausible number instead of an error", () => {
  const base: SlopeDefinition = {
    coordinates: [[0, 0], [0, 10], [10, 10], [20, 5], [30, 5], [30, 0]],
    materials: [{ name: "Clay", model: mc(18, 10, 30) }],
  };

  it("refuses a non-finite or non-positive analysis option", () => {
    const slope = buildSlope(base);
    expect(() => slope.updateAnalysisOptions({ slices: Number.NaN })).toThrow(/slices/);
    expect(() => slope.updateAnalysisOptions({ tolerance: 0 })).toThrow(/tolerance/);
    expect(() => slope.updateAnalysisOptions({ maxIterations: Number.NaN })).toThrow(/maxIterations/);
  });

  it("rounds a fractional slice count", () => {
    expect(fos(base, { slices: 25.4 })).toBe(fos(base, { slices: 25 }));
  });

  it("refuses a region assigned to an unknown material", () => {
    expect(() => buildSlope({ ...base, regionAssignments: [{ point: [5, 5], materialName: "clay" }] })).toThrow(/unknown material "clay"/);
  });

  it("refuses a combined Mohr-Coulomb material without its undrained strength", () => {
    expect(() => buildSlope({ ...base, materials: [{ name: "Clay", model: { ...mc(18, 10, 30), cFactor: 1 } }] })).toThrow(/Undrained cohesion/);
  });

  it("refuses an older material definition with a strength missing", () => {
    expect(() => buildSlope({ ...base, materials: [{ name: "Clay", unitWeight: 18, frictionAngle: 25 }] })).toThrow(/no model/);
  });
});

describe("Janbu with the f₀ correction", () => {
  it("rejects the same surfaces as without it (m_α at the solved factor)", () => {
    const def = (c: number): SlopeDefinition => ({
      coordinates: [[0, -5], [0, 5], [20, 5.4], [74.3, 0], [94, 0], [94, -5]],
      materials: [{ name: "L0", model: mc(22, c, 27) }],
      lineLoads: [{ magnitude: 39, x: 71.43035369427459 }],
      customSearchPlanes: [{ cx: 72.194, cy: 0.642, radius: 0.843 }],
      customPlanesOnly: true,
    });
    for (const k of [1, 1.25, 1.5]) {
      const plain = fos(def(3.8 * k), { method: "Janbu", slices: 30, janbuCorrection: false });
      const corrected = fos(def(3.8 * k), { method: "Janbu", slices: 30, janbuCorrection: true });
      expect(corrected === null).toBe(plain === null);
    }
  });
});
