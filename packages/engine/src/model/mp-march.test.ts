import { describe, it, expect } from "vitest";
import { VERIFICATION_CASES, runVerification } from "../verification";
import { analyseOrdinary, getSlicePropertyArrays } from "./solvers";
import { march, solveMorgensternPriceMarch } from "./mp-march";

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
    const { props, F0, published } = critical("V002");
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
});
