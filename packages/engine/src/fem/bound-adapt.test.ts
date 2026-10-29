import { describe, it, expect } from "vitest";
import { buildSlope } from "../model/build-slope";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import type { SlopeDefinition } from "../types/slope-definition";
import { adaptiveBounds, boundGapIndicator } from "./bound-adapt";
import { loadHighs } from "./lower-bound";

const slopeDef = (water = false) => ({
  coordinates: [[0, 0], [0, 10], [10, 10], [20, 5], [30, 5], [30, 0]],
  materials: [{ name: "soil", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 15, frictionAngle: 10 } }],
  ...(water ? { waterTable: { mode: "custom", value: [[0, 8], [20, 4.5], [30, 4.5]], followBoundary: false } } : {}),
}) as unknown as SlopeDefinition;

describe("boundGapIndicator", () => {
  for (const water of [false, true]) {
    it(`splits the bound gap into element contributions that sum to it${water ? " (with a water table)" : ""}`, async () => {
      const slope = buildSlope(toCanonicalSlopeDefinition(slopeDef(water)));
      const solver = (await loadHighs()) as Parameters<typeof boundGapIndicator>[3];
      const g = boundGapIndicator(slope, { elementSize: 2.5 }, 1.2, solver)!;
      expect(g.withStress).toBe(true);
      const gap = g.lambdaUpper - g.lambdaLower;
      expect(gap).toBeGreaterThan(0);
      let sum = 0, min = Infinity;
      for (const v of g.eta) { sum += v; min = Math.min(min, v); }
      // virtual work: Σ [D − σ:ε̇] = λ_U − λ_L, each term ≥ 0 (round-off
      // aside); with water the two programs' terms for the saturated weight
      // and the pore pressure are not identical element by element (the
      // lower bound's sub-elements), 0.5 % of the gap here
      expect(Math.abs(sum - gap)).toBeLessThan((water ? 1e-2 : 1e-4) * gap);
      expect(min).toBeGreaterThan(-1e-5 * gap);
    }, 300000);
  }
});

describe("adaptiveBounds", () => {
  it("narrows the gap between the bounds by refining where it lies", async () => {
    const slope = buildSlope(toCanonicalSlopeDefinition(slopeDef()));
    const r = await adaptiveBounds(slope, { elementSize: 2.5, fTolerance: 0.005, levels: 2 });
    expect(r.levels.length).toBeGreaterThan(1);
    const first = r.levels[0];
    expect(r.lower).toBeLessThanOrEqual(r.upper);
    expect(r.upper - r.lower).toBeLessThan(0.75 * (first.upper - first.lower));
    expect(r.levels[r.levels.length - 1].elements).toBeGreaterThan(first.elements);
  }, 900000);
});
