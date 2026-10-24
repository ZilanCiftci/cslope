/**
 * Non-circular optimisation, driven with an instrumented evaluator: every
 * candidate respects the search limits, the minimum failure distance and
 * slip depth and the budget, and the result is never worse than its seed.
 */
import { describe, it, expect } from "vitest";
import { Material } from "../types/index";
import { Slope, type SearchPlane } from "./slope";
import { optimiseNonCircular } from "./optimize";
import { getSlices } from "./slices";
import { analyseBishop } from "./solvers";
import { addSingleCircularPlane } from "./search";
import { isAdmissiblePolyline } from "./surface";

function model(): Slope {
  const s = new Slope();
  s.addMaterial(new Material({ name: "S", unitWeight: 19, cohesion: 8, frictionAngle: 28 }));
  s.setExternalBoundary([[0, -10], [0, 10], [10, 10], [25, 0], [40, 0], [40, -10]]);
  s.updateAnalysisOptions({ slices: 25, tolerance: 1e-6, maxIterations: 50 });
  return s;
}

function seeds(s: Slope): SearchPlane[] {
  for (const [cx, cy, r] of [[22, 18, 18.5], [20, 22, 21], [24, 15, 16]]) addSingleCircularPlane(s, cx, cy, r);
  const planes = s.individualPlanes.map((p) => ({ ...p }));
  for (const p of planes) {
    const sl = getSlices(s, p.lc[0], p.rc[0], p.cx, p.cy, p.radius);
    p.fos = analyseBishop(s, sl)[0];
  }
  return planes;
}

function instrumented(s: Slope) {
  const seen: SearchPlane[] = [];
  const evaluate = (planes: SearchPlane[]) => {
    for (const p of planes) {
      seen.push(p);
      const sl = getSlices(s, p.lc[0], p.rc[0], p.cx, p.cy, p.radius, p.points);
      p.fos = sl.length > 0 ? analyseBishop(s, sl)[0] : null;
    }
  };
  return { seen, evaluate };
}

describe("optimiseNonCircular", () => {
  it("candidates respect limits, distance, depth and budget; results beat their seeds", () => {
    const s = model();
    s.setAnalysisLimits({ entryLeftX: 2, entryRightX: 9, exitLeftX: 22, exitRightX: 36 });
    s.updateAnalysisOptions({ minFailureDist: 15, minSlipDepth: 1.5 });
    const start = seeds(s);
    const { seen, evaluate } = instrumented(s);
    const out = optimiseNonCircular(s, start, evaluate, { budgetPerSeed: 120 });
    expect(out.length).toBeGreaterThan(0);
    // The budget of each seed, and twice that for the best surface's
    // further optimisation.
    expect(seen.length).toBeLessThanOrEqual(120 * (start.length + 2));
    const [el, er, xl, xr] = s.limits;
    for (const p of seen.slice(3)) {
      const pts = p.points!;
      expect(pts[pts.length - 1][0] - pts[0][0]).toBeGreaterThan(15);
      expect(isAdmissiblePolyline(s, pts)).toBe(true);
      let depth = 0;
      for (const [x, y] of pts) depth = Math.max(depth, s.getExternalYIntersection(x) - y);
      expect(depth).toBeGreaterThanOrEqual(1.5);
    }
    const bestSeed = Math.min(...start.map((p) => p.fos!));
    for (const p of out) {
      expect(p.points![0][0]).toBeGreaterThanOrEqual(el - 1e-9);
      expect(p.points![0][0]).toBeLessThanOrEqual(er + 1e-9);
      expect(p.rc[0]).toBeGreaterThanOrEqual(xl - 1e-9);
      expect(p.rc[0]).toBeLessThanOrEqual(xr + 1e-9);
    }
    // The best optimised surface is at most the polyline of the best seed
    // circle (which is within 1 % of the circle itself).
    expect(Math.min(...out.map((p) => p.fos!))).toBeLessThan(bestSeed * 1.01);
  });

  it("no seeds: polylines and invalid surfaces are skipped; a seed whose polylines all fail gives nothing", () => {
    const s = model();
    const start = seeds(s);
    const { evaluate } = instrumented(s);
    expect(optimiseNonCircular(s, start.map((p) => ({ ...p, points: [p.lc, p.rc] })), evaluate)).toEqual([]);
    expect(optimiseNonCircular(s, start.map((p) => ({ ...p, fos: null })), evaluate)).toEqual([]);
    const failing = (planes: SearchPlane[]) => planes.forEach((p) => (p.fos = null));
    expect(optimiseNonCircular(s, start, failing)).toEqual([]);
  });

  it("a budget of one evaluation returns the seed's polyline", () => {
    const s = model();
    const start = seeds(s);
    const { seen, evaluate } = instrumented(s);
    const out = optimiseNonCircular(s, start.slice(0, 1), evaluate, { budgetPerSeed: 1 });
    expect(out).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(out[0].fos).toBe(seen[0].fos);
  });
});
