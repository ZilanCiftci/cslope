/**
 * Search plane generation: every generated plane respects the search
 * limits, the minimum failure distance and the model boundary (property
 * checks on random models), plus the degenerate inputs.
 */
import { describe, it, expect } from "vitest";
import { Material, Udl, LineLoad } from "../types/index";
import { Slope } from "./slope";
import { setEntryExitPlanes, addSingleEntryExitPlane, addSingleCircularPlane, generateRefinedPlanes, generateLocalPlanes } from "./search";
import { analyseSlope } from "./solvers";
import { rng, uniform, randomShape, shapeCoordinates } from "./property-helpers";

function model(coords: [number, number][]): Slope {
  const s = new Slope();
  s.addMaterial(new Material({ name: "S", unitWeight: 19, cohesion: 8, frictionAngle: 28 }));
  s.setExternalBoundary(coords);
  return s;
}

describe("generated planes", () => {
  it("property: within the limits, longer than the minimum distance, the arc inside the model", () => {
    const r = rng(2024);
    for (let i = 0; i < 8; i++) {
      const shape = randomShape(r);
      const coords = shapeCoordinates(shape);
      const s = model(coords);
      const xEnd = coords[4][0];
      const e0 = uniform(r, 0, shape.crest * 0.7);
      const x0 = uniform(r, shape.crest + shape.run * 0.6, xEnd * 0.9);
      s.setAnalysisLimits({ entryLeftX: e0, entryRightX: e0 + shape.crest * 0.3, exitLeftX: x0, exitRightX: Math.min(xEnd, x0 + 5) });
      s.updateAnalysisOptions({ iterations: 300, minFailureDist: uniform(r, 0, 10) });
      setEntryExitPlanes(s);
      expect(s.search.length, `case ${i}`).toBeGreaterThan(0);
      const [el, er, xl, xr] = s.limits;
      for (const p of s.search) {
        expect(p.lc[0]).toBeGreaterThanOrEqual(el - 1e-9);
        expect(p.lc[0]).toBeLessThanOrEqual(er + 1e-9);
        expect(p.rc[0]).toBeGreaterThanOrEqual(xl - 1e-9);
        expect(p.rc[0]).toBeLessThanOrEqual(xr + 1e-9);
        expect(p.rc[0] - p.lc[0]).toBeGreaterThan(s.minFailureDistance);
        // End points on the circle and on the ground.
        expect(Math.hypot(p.lc[0] - p.cx, p.lc[1] - p.cy)).toBeCloseTo(p.radius, 6);
        expect(p.lc[1]).toBeCloseTo(s.getExternalYIntersection(p.lc[0]), 6);
        // Arc inside the model (lowest point and samples along it).
        for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
          const x = p.lc[0] + t * (p.rc[0] - p.lc[0]);
          const y = p.cy - Math.sqrt(Math.max(0, p.radius ** 2 - (x - p.cx) ** 2));
          expect(s.isInsideExternalBoundary(x, y + 1e-6), `case ${i} arc at t = ${t}`).toBe(true);
        }
        if (p.cx > p.lc[0] && p.cx < p.rc[0]) {
          expect(s.isInsideExternalBoundary(p.cx, p.cy - p.radius + 1e-6), `case ${i} lowest point`).toBe(true);
        }
      }
    }
  });

  it("many loads still leave at least two entry points", () => {
    const s = model([[0, -10], [0, 10], [10, 10], [25, 0], [40, 0], [40, -10]]);
    s.setUdls(...Array.from({ length: 30 }, (_, k) => new Udl({ magnitude: 5, x1: k * 0.3, x2: k * 0.3 + 0.2 })));
    s.setLineLoads(...Array.from({ length: 10 }, (_, k) => new LineLoad({ magnitude: 5, x: 1 + k * 0.5 })));
    s.updateAnalysisOptions({ iterations: 100 });
    setEntryExitPlanes(s);
    expect(s.search.length).toBeGreaterThan(0);
  });
});

describe("individual planes", () => {
  const s = model([[0, -10], [0, 10], [10, 10], [25, 0], [40, 0], [40, -10]]);

  it("planes through an entry and an exit point", () => {
    const t = model([[0, -10], [0, 10], [10, 10], [25, 0], [40, 0], [40, -10]]);
    addSingleEntryExitPlane(t, 5, 30, 4);
    expect(t.individualPlanes.length).toBeGreaterThan(0);
    t.customPlanesOnly = true;
    expect(analyseSlope(t)).toBeGreaterThan(0);
  });

  it("a circle that misses the ground or leaves the model is not added", () => {
    const before = s.individualPlanes.length;
    addSingleCircularPlane(s, 20, 60, 5);
    // Through the base of the model.
    addSingleCircularPlane(s, 22, 12, 30);
    expect(s.individualPlanes.length).toBe(before);
  });

  it("refined and local planes: nothing without a budget or valid seeds", () => {
    expect(generateRefinedPlanes(s, [], 10)).toEqual([]);
    const p = { lc: [5, 10] as [number, number], rc: [30, 0] as [number, number], cx: 20, cy: 20, radius: 18, fos: null, slices: null };
    expect(generateRefinedPlanes(s, [p], 10)).toEqual([]);
    expect(generateRefinedPlanes(s, [{ ...p, fos: 1.2 }], 0)).toEqual([]);
    expect(generateLocalPlanes(s, [{ ...p, fos: 1.2 }], 0, 1)).toEqual([]);
    const refined = generateRefinedPlanes(s, [{ ...p, fos: 1.2 }], 15);
    expect(refined.length).toBeLessThanOrEqual(15);
  });
});
