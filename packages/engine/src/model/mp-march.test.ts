import { describe, it, expect } from "vitest";
import { VERIFICATION_CASES, runVerification, verificationOptions } from "../verification";
import { buildSlope } from "./build-slope";
import { toCanonicalSlopeDefinition } from "./canonical";
import { Material } from "../types/index";
import { Slope } from "./slope";
import { getSlices } from "./slices";
import { addSingleCircularPlane } from "./search";
import { analyseMorgensternPrice, analyseOrdinary, analyseSlope, getSlicePropertyArrays, setMorgensternPriceSolver } from "./solvers";
import { analyseMorgensternPriceMarch, march, setMarchSearchOptions, solveMorgensternPriceFast, solveMorgensternPriceMarch } from "./mp-march";

/** The critical surface of the iterative search for a verification problem. */
function critical(id: string) {
  const c = VERIFICATION_CASES.find((x) => x.id === id)!;
  const k = c.checks.find((x) => x.method === "Morgenstern-Price")!;
  const { fos, slope } = runVerification(c.definition, "Morgenstern-Price", k.options);
  const plane = slope.search.find((p) => p.fos != null && p.slices)!;
  const s = plane.slices!;
  const props = getSlicePropertyArrays(s, s[0].xLeft, s[s.length - 1].xRight, slope.intersliceFunction, slope.intersliceDataPoints);
  return { fos: fos!, props, F0: analyseOrdinary(slope, s)!, published: k.published };
}

/**
 * V002's critical surface of the optimisation before its best surface was
 * optimised further (FOS 0.4119), on which the iterative solver reaches a
 * far root: canonical coordinates, moment axis.
 */
const V002_SURFACE = {
  points: [[32.9006, 35], [34.6453, 31.4463], [38.0925, 28.8535], [41.0822, 26.546], [44.0631, 24.2221], [46.7363, 22.1455], [49.4385, 20.1175], [52.0906, 18.432], [54.8722, 16.9687], [57.6663, 15.7865], [60.551, 14.8205], [63.4418, 13.9426], [66.4016, 13.3364], [69.4227, 13.0618], [72.454, 13.1832], [75.3358, 13.7796], [78.0588, 15]] as [number, number][],
  axis: [69.7991, 60.2313] as [number, number],
};

/** A fixed surface of a verification problem, analysed as its Morgenstern-Price check. */
function onSurface(id: string, surface: { points: [number, number][]; axis: [number, number] }) {
  const c = VERIFICATION_CASES.find((x) => x.id === id)!;
  const k = c.checks.find((x) => x.method === "Morgenstern-Price")!;
  const slope = buildSlope({ ...toCanonicalSlopeDefinition(c.definition), customSurfaces: [surface], customPlanesOnly: true });
  slope.updateAnalysisOptions({ ...verificationOptions("Morgenstern-Price", k.options), nonCircularOptimization: false });
  analyseSlope(slope);
  const s = slope.search.find((p) => p.fos != null && p.slices)!.slices!;
  const props = getSlicePropertyArrays(s, s[0].xLeft, s[s.length - 1].xRight, slope.intersliceFunction, slope.intersliceDataPoints);
  return { props, F0: analyseOrdinary(slope, s)!, published: k.published };
}

describe("Morgenstern-Price march solver", () => {
  it("closes force and moment equilibrium at its root and agrees with the iterative solver (V001)", () => {
    const { fos, props, F0 } = critical("V001");
    const r = solveMorgensternPriceMarch(props, F0);
    expect(r.chosen).not.toBeNull();
    const m = march(props, r.chosen!.lambda, r.chosen!.F);
    expect(Math.abs(m.gf)).toBeLessThan(1e-6 * m.fScale);
    expect(Math.abs(m.gm)).toBeLessThan(1e-6 * m.mScale);
    expect(m.outOfBand).toBe(0);
    expect(Math.abs(r.chosen!.F - fos)).toBeLessThan(0.002);
    // The 2-D Newton fast path reaches the same root as the λ scan.
    expect(r.newton).not.toBeNull();
    expect(Math.abs(r.newton!.F - r.chosen!.F)).toBeLessThan(1e-5);
    expect(Math.abs(r.newton!.lambda - r.chosen!.lambda)).toBeLessThan(1e-4);
  });

  it("keeps the far root of V002 outside the band and reports the published one", () => {
    // The iterative solver reaches 0.344 at λ ≈ −1.08 on this surface when
    // the tolerance is tight; there every slice's denominator has changed
    // sign. The march solver only roots inside the band.
    const { props, F0, published } = onSurface("V002", V002_SURFACE);
    const r = solveMorgensternPriceMarch(props, F0);
    expect(r.roots.length).toBe(1);
    expect(r.roots[0].lambda).toBeGreaterThan(0);
    expect(Math.abs(r.roots[0].F - published)).toBeLessThan(0.003);
    expect(march(props, -1.08, 0.347).outOfBand).toBeGreaterThan(0);
  });

  it("reports no root when force equilibrium cannot close at the moment F (V027, φ = 0)", () => {
    // Moment equilibrium of a φ = 0 circle fixes F; here no λ closes force
    // equilibrium at that F, so the surface has no complete-equilibrium
    // solution. The iterative solver accepts it with a 0.02 gap instead.
    const { props, F0 } = critical("V027");
    const r = solveMorgensternPriceMarch(props, F0);
    expect(r.roots.length).toBe(0);
    expect(r.chosen).toBeNull();
  });

  it("the fast solver, the scan alone and every rule give the same single root (V001)", () => {
    const { props, F0 } = critical("V001");
    const full = solveMorgensternPriceMarch(props, F0);
    const fast = solveMorgensternPriceFast(props, F0);
    expect(fast.newton).not.toBeNull();
    expect(Math.abs(fast.chosen!.F - full.chosen!.F)).toBeLessThan(1e-5);
    const scan = solveMorgensternPriceFast(props, F0, { scanOnly: true });
    expect(scan.newton).toBeNull();
    expect(Math.abs(scan.chosen!.F - full.chosen!.F)).toBeLessThan(1e-5);
    for (const rule of ["largest", "smallest"] as const) {
      const r = solveMorgensternPriceMarch(props, F0, { rule });
      expect(r.chosen!.F).toBe(full.chosen!.F);
    }
  });

  it("as the search solver it reproduces the iterative search (V001) and gives no answer without a root (V027)", () => {
    const run = (id: string) => {
      const c = VERIFICATION_CASES.find((x) => x.id === id)!;
      const k = c.checks.find((x) => x.method === "Morgenstern-Price")!;
      return runVerification(c.definition, "Morgenstern-Price", k.options);
    };
    const iterative = run("V001").fos!;
    // The iterative search's critical surface of V027 has no root (above).
    const v027 = run("V027");
    const p27 = v027.slope.search.find((p) => p.fos != null && p.slices)!;
    setMorgensternPriceSolver("march");
    setMarchSearchOptions({});
    try {
      const { fos, slope } = run("V001");
      expect(Math.abs(fos! / iterative - 1)).toBeLessThan(0.005);
      // The drop-in solver on the critical surface: one root, reported as the FOS.
      const plane = slope.search.find((p) => p.fos != null && p.slices)!;
      const [f, lff, , , converged] = analyseMorgensternPriceMarch(slope, plane.slices!);
      expect(converged).toBe(true);
      expect(Math.abs(f! - fos!)).toBeLessThan(1e-6);
      expect(lff!.length).toBe(1);
      expect(analyseMorgensternPriceMarch(v027.slope, p27.slices!)[0]).toBeNull();
    } finally {
      setMorgensternPriceSolver("iterative");
    }
  });

  it("a combined material: the undrained strength governs where it is lower, as in the iterative solver", () => {
    const s = new Slope();
    s.addMaterial(new Material({ name: "C", unitWeight: 19, cohesion: 5, frictionAngle: 30, cohesionUndrained: 25, cFactor: 1 }));
    s.setExternalBoundary([[0, -10], [0, 10], [10, 10], [25, 0], [40, 0], [40, -10]]);
    s.updateAnalysisOptions({ slices: 30, tolerance: 1e-4, maxIterations: 50 });
    addSingleCircularPlane(s, 22, 18, 18.5);
    const p = s.individualPlanes[0];
    const slices = getSlices(s, p.lc[0], p.rc[0], p.cx, p.cy, p.radius);
    const [iterative] = analyseMorgensternPrice(s, slices);
    const [f] = analyseMorgensternPriceMarch(s, slices);
    expect(f).not.toBeNull();
    expect(Math.abs(f! - iterative!)).toBeLessThan(0.002);
    expect(slices.some((x) => x.undrainedGoverns)).toBe(true);
    expect(slices.some((x) => !x.undrainedGoverns)).toBe(true);
  });
});
