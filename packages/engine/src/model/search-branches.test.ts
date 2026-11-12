/**
 * Search plane generation: every generated plane respects the search
 * limits, the minimum failure distance and the model boundary (property
 * checks on random models), plus the degenerate inputs. (The refined and
 * local plane generators, internal functions, are tested in Rust:
 * packages/engine-rs/crates/cslope-engine/tests/model_core_search.rs.)
 */
import { describe, it, expect } from "vitest";
import { Material, Udl, LineLoad } from "../types/index";
import { Slope } from "./slope";
import { setEntryExitPlanes, addSingleEntryExitPlane, addSingleCircularPlane, isPlaneWithinExternalBoundary } from "./search";
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
      // the limits the search uses (an end on a ground corner moved out by 1e-5 of the width)
      const [el, er, xl, xr] = s.searchLimits;
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

describe("the first pass", () => {
  const distinct = (xs: number[]) =>
    [...xs].sort((a, b) => a - b).filter((x, i, a) => i === 0 || x - a[i - 1] > 1e-7);

  it("has 9 entry and 11 exit points at 1 000 iterations, scaled with the square root (#160)", () => {
    const s = model([[0, -10], [0, 10], [10, 10], [25, 0], [40, 0], [40, -10]]);
    s.setAnalysisLimits({ entryLeftX: 1, entryRightX: 8, exitLeftX: 27, exitRightX: 38 });
    s.updateAnalysisOptions({ iterations: 1000 });
    setEntryExitPlanes(s);
    expect(distinct(s.search.map((p) => p.lc[0]))).toHaveLength(9);
    expect(distinct(s.search.map((p) => p.rc[0]))).toHaveLength(11);
    s.updateAnalysisOptions({ iterations: 4000 });
    setEntryExitPlanes(s);
    expect(distinct(s.search.map((p) => p.lc[0]))).toHaveLength(18);
    expect(distinct(s.search.map((p) => p.rc[0]))).toHaveLength(22);
  });

  it("spaces the 11 sagittas of a pair evenly from 5 % to 95 % of the reference depth (#160)", () => {
    const s = model([[-40, -40], [-40, 10], [10, 10], [25, 0], [80, 0], [80, -40]]);
    // One pair (each side a point), both ends on the face.
    s.setAnalysisLimits({ entryLeftX: 11.5, entryRightX: 11.5, exitLeftX: 23.5, exitRightX: 23.5 });
    s.updateAnalysisOptions({ iterations: 1000 });
    setEntryExitPlanes(s);
    expect(s.search).toHaveLength(11);
    const [lc, rc] = [[11.5, 9], [23.5, 1]];
    // D: the sagitta of the circle through both ends centred at the
    // elevation of the higher end (radius half-chord / cos β).
    const half = Math.hypot(rc[0] - lc[0], rc[1] - lc[1]) / 2;
    const rRef = half / ((rc[0] - lc[0]) / (2 * half));
    const d = rRef - Math.sqrt(rRef ** 2 - half ** 2);
    const sagittas = s.search
      .map((p) => {
        const dist = Math.abs((rc[0] - lc[0]) * (p.cy - lc[1]) - (rc[1] - lc[1]) * (p.cx - lc[0])) / (2 * half);
        return p.radius - dist;
      })
      .sort((a, b) => a - b);
    sagittas.forEach((v, k) => expect(v / d).toBeCloseTo(0.05 + 0.09 * k, 9));
  });

  it("gives a side given as a point its point only (#157)", () => {
    const s = model([[0, -10], [0, 10], [10, 10], [25, 0], [40, 0], [40, -10]]);
    s.setAnalysisLimits({ entryLeftX: 1, entryRightX: 8, exitLeftX: 32, exitRightX: 32 });
    s.updateAnalysisOptions({ iterations: 1000 });
    setEntryExitPlanes(s);
    expect(distinct(s.search.map((p) => p.rc[0]))).toHaveLength(1);
    expect(distinct(s.search.map((p) => p.lc[0]))).toHaveLength(9);
    expect(s.search.length).toBeLessThanOrEqual(9 * 11);
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

  it("a circle dipping a hair below the model base between the samples leaves the model", () => {
    const t = model([[0, -10], [0, 10], [10, 10], [25, 0], [40, 0], [40, -10]]);
    // Lowest point 5 mm below the base, at x = 21.6 between arc samples.
    // (Added all the same: with compositeBase it follows the base; without,
    // the analysis rejects it.)
    const cx = 21.6;
    const radius = 21;
    addSingleCircularPlane(t, cx, -10.005 + radius, radius);
    addSingleCircularPlane(t, cx, -9.9 + radius, radius);
    expect(t.individualPlanes).toHaveLength(2);
    expect(isPlaneWithinExternalBoundary(t, t.individualPlanes[0])).toBe(false);
    expect(isPlaneWithinExternalBoundary(t, t.individualPlanes[1])).toBe(true);
    t.updateAnalysisOptions({ compositeBase: true });
    expect(isPlaneWithinExternalBoundary(t, t.individualPlanes[0])).toBe(true);
  });
});
