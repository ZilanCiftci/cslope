/**
 * Slice boundaries at water-line vertices and the base material on a layer
 * boundary (review B4 and C3).
 */
import { describe, it, expect } from "vitest";
import { Material } from "../types/index";
import { WATER_UNIT_WEIGHT } from "../types/constants";
import type { Slice } from "../types/geometry";
import { Slope } from "./slope";
import { getSlices, headFactor } from "./slices";
import { layered, mc, runVerification, su } from "../verification/cases";

const BOUNDARY: [number, number][] = [[0, -10], [0, 10], [10, 10], [25, 0], [40, 0], [40, -10]];
/** Base at y = −6 from x = 20 to 22.67 (the review's probe slice). */
const BASE: [number, number][] = [[8, 10], [20, -6], [22.67, -6], [35, 0]];

function steppedWater(head: "vertical" | "phreatic-correction"): Slope {
  const s = new Slope();
  s.addMaterial(new Material({ name: "M", model: mc(5, 30, 19) }));
  s.setExternalBoundary(BOUNDARY);
  // A wall at x = 21: water at −1 behind it, −4 in front.
  s.setWaterTable({ coordinates: [[0, -1], [21, -1], [21, -4], [40, -4]], followBoundary: false });
  s.updateAnalysisOptions({ slices: 25, porePressureHead: head });
  return s;
}

/** ∫u dx over the base between xa and xb. */
const poreForce = (slices: Slice[], xa: number, xb: number) =>
  slices
    .filter((s) => s.xLeft >= xa - 1e-9 && s.xRight <= xb + 1e-9)
    .reduce((sum, s) => sum + s.U * s.width, 0);

describe("A vertical step in a water line (review B4)", () => {
  for (const head of ["vertical", "phreatic-correction"] as const) {
    it(`is a slice edge, and the pore pressure on each side is exact (${head})`, () => {
      const slices = getSlices(steppedWater(head), 8, 35, 20, 20, 0, BASE);
      expect(slices.some((s) => s.xRight === 21)).toBe(true);
      for (const s of slices.filter((s) => s.xLeft >= 20 - 1e-9 && s.xRight <= 22.67 + 1e-9)) {
        expect(s.U).toBeCloseTo(WATER_UNIT_WEIGHT * (s.x < 21 ? 5 : 2), 9);
      }
      // Mean over the probe slice 20–22.67: 30.6 kPa (was 19.6 with vertical
      // head and 8.66 with the phreatic correction).
      const mean = poreForce(slices, 20, 22.67) / 2.67;
      expect(mean).toBeCloseTo((WATER_UNIT_WEIGHT * (5 * 1 + 2 * 1.67)) / 2.67, 9);
      expect(mean).toBeCloseTo(30.6, 1);
    });
  }

  it("gets no cos²θ correction where the step lies inside a slice", () => {
    const line = { x: [0, 21, 21, 40], y: [-1, -1, -4, -4] };
    expect(headFactor(line, -1, -4, 20, 22.67, false)).toBe(1);
    // A sloping line keeps it.
    const sloping = { x: [0, 20, 22.67, 40], y: [-1, -1, -4, -4] };
    expect(headFactor(sloping, -1, -4, 20, 22.67, false)).toBeCloseTo(Math.cos(Math.atan(3 / 2.67)) ** 2, 12);
    // The step on a slice edge is not inside the slice.
    expect(headFactor(line, -4, -5, 21, 23, false)).toBeCloseTo(Math.cos(Math.atan(1 / 2)) ** 2, 12);
  });

  it("vertices of the line above the slip surface are slice edges, those below it are not", () => {
    const s = new Slope();
    s.addMaterial(new Material({ name: "M", model: mc(5, 30, 19) }));
    s.setExternalBoundary(BOUNDARY);
    s.setWaterTable({ coordinates: [[0, -1], [17.3, -2], [29.1, -9], [40, -9]], followBoundary: false });
    s.updateAnalysisOptions({ slices: 25 });
    const edges = new Set(getSlices(s, 8, 35, 20, 20, 0, BASE).map((sl) => sl.xLeft));
    expect(edges.has(17.3)).toBe(true);
    expect(edges.has(29.1)).toBe(false);
  });
});

describe("Base exactly on a layer boundary (review C3)", () => {
  const ltr: [number, number][] = [[0, 10], [15, 10], [30, 0], [40, 0]];
  /** Polyline running along y = yRun between x = 14 and 28. */
  const along = (yRun: number): [number, number][] => [[5, 10], [14, yRun], [28, yRun], [35, 0]];
  const flat = (slices: Slice[]) => slices.filter((s) => s.xLeft >= 14 - 1e-9 && s.xRight <= 28 + 1e-9);

  it("takes the weak layer below, as a surface 1 mm lower does", () => {
    const def = layered(ltr, -20, [
      { name: "Upper", topY: null, model: su(40, 19) },
      { name: "Weak", topY: -12, model: su(10, 19) },
    ]);
    const { slope } = runVerification(def, "Bishop", { iterations: 200 });
    const on = flat(getSlices(slope, 5, 35, 20, 30, 0, along(-12)));
    const below = flat(getSlices(slope, 5, 35, 20, 30, 0, along(-12.001)));
    expect(on.length).toBeGreaterThan(0);
    expect(on.every((s) => s.baseMaterial?.name === "Weak")).toBe(true);
    expect(below.every((s) => s.baseMaterial?.name === "Weak")).toBe(true);
    expect(on.every((s) => s.cohesion === 10)).toBe(true);
  });

  for (const kind of ["impenetrable", "high-strength"] as const) {
    it(`keeps the soil above on ${kind} material, so the surface stays analysable`, () => {
      const def = layered(ltr, -20, [
        { name: "Upper", topY: null, model: su(40, 19) },
        { name: "Rock", topY: -12, model: { kind, unitWeight: 22 } as never },
      ]);
      const { slope } = runVerification(def, "Bishop", { iterations: 200 });
      const on = flat(getSlices(slope, 5, 35, 20, 30, 0, along(-12)));
      expect(on.length).toBeGreaterThan(0);
      expect(on.every((s) => s.baseMaterial?.name === "Upper" && !s.impenetrable && !s.skipSurface)).toBe(true);
    });
  }
});

describe("Fixed slices (review C3)", () => {
  it("are split at layer and water crossings like the regular slices", () => {
    const def = layered([[0, 10], [15, 10], [30, 0], [40, 0]], -20, [
      { name: "Upper", topY: null, model: mc(5, 30, 19) },
      { name: "Lower", topY: 0, model: mc(10, 25, 19) },
    ]);
    const { slope } = runVerification(def, "Bishop", { iterations: 200 });
    slope.setWaterTable({ coordinates: [[0, 4], [40, 4]], followBoundary: false });
    slope.addFixedSlices([10, 20, 30]);
    const [cx, cy, r] = [22, 22, 24];
    const [[x0], [x1]] = slope.getCircleExternalIntersection(cx, cy, r);
    const slices = getSlices(slope, x0, x1, cx, cy, r);
    const edges = slices.map((s) => s.xLeft).concat(slices[slices.length - 1].xRight);
    for (const fx of [10, 20, 30]) expect(edges.some((e) => Math.abs(e - fx) < 1e-9)).toBe(true);
    // The circle crosses the layer boundary y = 0 and the water line y = 4.
    const crossings = (y: number) => [cx - Math.sqrt(r * r - (cy - y) ** 2), cx + Math.sqrt(r * r - (cy - y) ** 2)];
    const inside = [...crossings(0), ...crossings(4)].filter((x) => x > x0 + 1e-3 && x < x1 - 1e-3);
    expect(inside.length).toBe(2);
    for (const xc of inside) expect(edges.some((e) => Math.abs(e - xc) < 1e-6)).toBe(true);
  });
});
