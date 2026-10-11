import { describe, it, expect } from "vitest";
import { buildSlope } from "./build-slope";
import { getSlices } from "./slices";
import { analyseSlope, analyseBishop } from "./solvers";
import { getCircleLineIntersections } from "../math/circle";
import type { SlopeDefinition } from "../types/slope-definition";

describe("slip surface entry and exit", () => {
  it("does not hang slices from the lower arc behind a vertical face", () => {
    // 10 m vertical cut; entering on the upper half of the circle used to
    // give a free 8 m crack and a 24 % too low FOS (0.585 vs 0.770).
    const slope = buildSlope({
      coordinates: [[0, -10], [0, 10], [10, 10], [10, 0], [40, 0], [40, -10]],
      materials: [{ name: "A", unitWeight: 20, frictionAngle: 30, cohesion: 20 }],
    });
    slope.updateAnalysisOptions({ iterations: 1500, refinedIterations: 500 });
    const minFos = analyseSlope(slope)!;
    expect(minFos).toBeGreaterThan(0.75);
    for (const p of slope.search.filter((q) => q.fos != null)) {
      expect(p.lc[1]).toBeLessThanOrEqual(p.cy + 1e-6);
      expect(p.rc[1]).toBeLessThanOrEqual(p.cy + 1e-6);
    }
  });

  it("does not stop at a toe vertex the arc only touches", () => {
    const slope = buildSlope({
      coordinates: [[0, -15], [0, 0], [20, 0], [40, -10], [60, -10], [60, -15]],
      materials: [{ name: "A", unitWeight: 20, frictionAngle: 30, cohesion: 5 }],
    });
    slope.updateAnalysisOptions({ iterations: 1500, refinedIterations: 500 });
    analyseSlope(slope);
    for (const p of slope.search.filter((q) => q.fos != null)) {
      // Just beyond the exit the arc must be out of the ground.
      const x = p.rc[0] + 1e-3;
      const term = p.radius ** 2 - (x - p.cx) ** 2;
      if (term < 0) continue;
      const yArc = p.cy - Math.sqrt(term);
      expect(slope.isInsideExternalBoundary(x, yArc)).toBe(false);
    }
  });

  it("finds a crossing exactly at a surface vertex", () => {
    const xs = [0, 10.3, 20.7, 40];
    const ys = [10, 10, 0.1, 0.1];
    // Circle through the toe vertex (20.7, 0.1).
    const [cx, cy] = [30, 25];
    const r = Math.hypot(20.7 - cx, 0.1 - cy);
    const hits = getCircleLineIntersections(cx, cy, r, xs, ys);
    expect(hits.some(([x, y]) => Math.abs(x - 20.7) < 1e-9 && Math.abs(y - 0.1) < 1e-9)).toBe(true);
  });
});

describe("slices at real-world coordinates", () => {
  const def = (xo: number): SlopeDefinition => ({
    coordinates: [[0, 0], [0, 10], [10, 10], [20, 0], [30, 0], [30, -10], [0, -10]].map(
      ([x, y]) => [x + xo, y] as [number, number],
    ),
    materials: [
      { name: "top", unitWeight: 18, frictionAngle: 30, cohesion: 5 },
      { name: "bot", unitWeight: 20, frictionAngle: 20, cohesion: 50 },
    ],
    materialBoundaries: [{ coordinates: [[xo, 3], [30 + xo, 3]], materialName: "" }],
    regionAssignments: [
      { point: [5 + xo, 8], materialName: "top" },
      { point: [5 + xo, -5], materialName: "bot" },
    ],
  });

  it("detects the base material at large eastings", () => {
    const fos: number[] = [];
    for (const xo of [0, 500000, 6500000]) {
      const slope = buildSlope(def(xo));
      const slices = getSlices(slope, 2 + xo, 25 + xo, 18 + xo, 16, 17);
      for (const s of slices) {
        expect(s.baseMaterial?.name).toBe(s.yBottom < 3 ? "bot" : "top");
      }
      fos.push(analyseBishop(slope, slices)[0]!);
    }
    expect(fos[1]).toBeCloseTo(fos[0], 4);
    expect(fos[2]).toBeCloseTo(fos[0], 3);
  });
});
