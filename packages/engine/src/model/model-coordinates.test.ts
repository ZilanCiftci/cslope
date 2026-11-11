import { describe, it, expect } from "vitest";
import { buildSlope } from "./build-slope";
import { getDomainX, mirrorX, toCanonicalSlopeDefinition } from "./canonical";
import { analyseSlope } from "./solvers";
import { DEFAULT_ANALYSIS_OPTIONS } from "../types/analysis";
import type { SlopeDefinition } from "../types/slope-definition";

// A 1:2 clay slope with a strip load on its crest, facing right (ltr) or,
// mirrored about x = 10, left (rtl): the same slope in both model spaces.
const slope = (rtl: boolean): SlopeDefinition => {
  const m = (x: number) => (rtl ? 20 - x : x);
  const pts: [number, number][] = [[0, -6], [0, 0], [6, 0], [14, -4], [20, -4], [20, -6]].map(([x, y]) => [m(x), y]);
  return {
    orientation: rtl ? "rtl" : "ltr",
    coordinates: rtl ? pts.reverse() : pts,
    materials: [{ name: "clay", model: { kind: "undrained", unitWeight: 18, undrainedShearStrength: 20 } }],
    regionAssignments: [{ point: [10, -5], materialName: "clay" }],
    udls: [{ magnitude: 15, x1: Math.min(m(1), m(5)), x2: Math.max(m(1), m(5)) }],
  } as unknown as SlopeDefinition;
};
const run = (def: SlopeDefinition) => {
  const s = buildSlope(toCanonicalSlopeDefinition(def));
  s.updateAnalysisOptions({ ...DEFAULT_ANALYSIS_OPTIONS, method: "Morgenstern-Price", slices: 30, iterations: 400, refinedIterations: 200 });
  const F = analyseSlope(s) as number;
  return { s, F };
};

describe("model-space surfaces", () => {
  for (const rtl of [false, true]) {
    it(`gives a searched surface back as a custom one in model space (${rtl ? "right to left" : "left to right"})`, () => {
      const def = slope(rtl);
      const { s, F } = run(def);
      const crit = s.search.filter((p) => p.fos != null).sort((a, b) => a.fos! - b.fos!)[0];
      const circle = s.toModelCircle(crit);
      // in model space the circle's centre lies over the slope as drawn: left of x = 10 facing right, right of it facing left
      expect(rtl ? circle.cx > 10 : circle.cx < 10).toBe(true);
      const again = run({ ...def, customSearchPlanes: [circle], customPlanesOnly: true });
      expect(again.F).toBeCloseTo(F, 6);
      // about the middle of the model's extent, as the canonical definition was mirrored
      const [lo, hi] = getDomainX(def.coordinates);
      expect(s.toModelX(crit.cx)).toBeCloseTo(rtl ? mirrorX(crit.cx, lo, hi) : crit.cx, 12);
      // a non-circular surface is not passed off as a circle
      expect(() => s.toModelCircle({ ...crit, points: [[0, 0], [1, -1]] })).toThrow(/non-circular/);
    }, 120000);
  }
});
