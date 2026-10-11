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

describe("combined (drained/undrained) materials", () => {
  // With Su below c the undrained strength the undrained branch governs on every
  // slice, so the combined material must give exactly the FOS of a pure
  // undrained material with Su = cohesionUndrained, for every method.
  const coords: [number, number][] = [[0, -15], [0, 0], [20, 0], [40, -10], [50, -10], [50, -15]];
  const combined: SlopeDefinition = {
    coordinates: coords,
    materials: [{
      name: "C", unitWeight: 20, frictionAngle: 25, cohesion: 20,
      model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 20, frictionAngle: 25, cFactor: 1, cohesionUndrained: 18 },
    }],
  };
  const undrained: SlopeDefinition = {
    coordinates: coords,
    materials: [{
      name: "U", unitWeight: 20, frictionAngle: 0, cohesion: 18,
      model: { kind: "undrained", unitWeight: 20, undrainedShearStrength: 18 },
    }],
  };
  const fosFor = (def: SlopeDefinition, method: "Bishop" | "Janbu" | "Morgenstern-Price") => {
    const slope = buildSlope(def);
    slope.updateAnalysisOptions({ method, slices: 30 });
    const [cx, cy, r] = [28, 25, 35];
    const pts = slope.getCircleExternalIntersection(cx, cy, r);
    const slices = getSlices(slope, pts[0][0], pts[pts.length - 1][0], cx, cy, r);
    if (def === combined) expect(slices.every((s) => s.isCombined)).toBe(true);
    return { slope, slices };
  };

  for (const method of ["Bishop", "Janbu", "Morgenstern-Price"] as const) {
    it(`${method}: undrained-governed slices are in equilibrium with Su`, async () => {
      const { analyseJanbu, analyseMorgensternPrice } = await import("./solvers");
      const run = (def: SlopeDefinition) => {
        const { slope, slices } = fosFor(def, method);
        if (method === "Bishop") return analyseBishop(slope, slices)[0]!;
        if (method === "Janbu") return analyseJanbu(slope, slices)[0]!;
        return analyseMorgensternPrice(slope, slices)[0]!;
      };
      expect(run(combined)).toBeCloseTo(run(undrained), 2);
    });
  }
});

describe("round 5 engine fixes", () => {
  const base = (extra: Partial<SlopeDefinition> = {}): SlopeDefinition => ({
    coordinates: [[0, 0], [0, 10], [10, 10], [20, 5], [30, 5], [30, 0]],
    materials: [{ name: "A", unitWeight: 20, frictionAngle: 30, cohesion: 5 }],
    customSearchPlanes: [{ cx: 18, cy: 20, radius: 17 }],
    customPlanesOnly: true,
    ...extra,
  });
  const fos = (def: SlopeDefinition) => {
    const slope = buildSlope(def);
    slope.updateAnalysisOptions({ method: "Bishop", slices: 50 });
    return analyseSlope(slope)!;
  };

  it("a short water line continues horizontally to the model edges", () => {
    const full = fos(base({ waterTable: { mode: "custom", value: [[0, 7], [30, 7]] } }));
    const short = fos(base({ waterTable: { mode: "custom", value: [[0, 7], [15, 7]] } }));
    expect(short).toBeCloseTo(full, 6);
  });

  it("a line load exactly at the exit point is applied", () => {
    const slope = buildSlope(base());
    const [cx, cy, r] = [18, 20, 17];
    const pts = slope.getCircleExternalIntersection(cx, cy, r);
    const exitX = pts[pts.length - 1][0];
    const at = fos(base({ lineLoads: [{ magnitude: 100, x: exitX }] }));
    const near = fos(base({ lineLoads: [{ magnitude: 100, x: exitX - 1e-9 }] }));
    expect(at).toBeCloseTo(near, 6);
  });

  it("rejects non-finite optional strength fields and uses the model unit weight", async () => {
    const { validateMaterialModel } = await import("../types/validation");
    expect(
      validateMaterialModel({ kind: "mohr-coulomb", unitWeight: 20, cohesion: 10, frictionAngle: 30, cohesionRateOfChange: Number.NaN }),
    ).not.toEqual([]);
    expect(
      validateMaterialModel({ kind: "mohr-coulomb", unitWeight: 20, cohesion: 0, frictionAngle: 0, cohesionRateOfChange: 2 }),
    ).toEqual([]);
    const flat25 = fos(base({
      materials: [{ name: "A", unitWeight: 25, frictionAngle: 30, cohesion: 5, model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 5, frictionAngle: 30 } }],
    }));
    const both18 = fos(base({
      materials: [{ name: "A", unitWeight: 18, frictionAngle: 30, cohesion: 5 }],
    }));
    expect(flat25).toBeCloseTo(both18, 6);
  });
});
