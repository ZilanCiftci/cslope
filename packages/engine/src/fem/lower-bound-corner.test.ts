import { describe, it, expect } from "vitest";
import { buildSlope } from "../model/build-slope";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import type { SlopeDefinition } from "../types/slope-definition";
import { lowerBound, lowerBoundProblem } from "./lower-bound";
import { upperBound } from "./upper-bound";

// A synthetic model: a 2 m deep trench (1:1.5 sides) next to a low fill
// embankment with 45° sides on clay, the strip load on the embankment's
// crest starting `gap` from the crest's corner on the trench side and ending
// at the far corner.
const H = 0.35;
const embankment = (gap: number) =>
  ({
    coordinates: [[-9, -7], [-9, 0], [-4, 0], [-1, -2], [1, -2], [4, 0], [5, 0], [5 + H, H], [10, H], [10 + H, 0], [15, 0], [15, -7]],
    materials: [
      { name: "fill", model: { kind: "mohr-coulomb", unitWeight: 18.5, cohesion: 2, frictionAngle: 33 } },
      { name: "crust", model: { kind: "undrained", unitWeight: 17, undrainedShearStrength: 22 } },
      { name: "clay", model: { kind: "undrained", unitWeight: 16, undrainedShearStrength: 11 } },
    ],
    materialBoundaries: [
      { coordinates: [[5, 0], [10 + H, 0]], materialName: "" },
      { coordinates: [[-9, -1.2], [15, -1.2]], materialName: "" },
    ],
    regionAssignments: [
      { point: [8, H / 2], materialName: "fill" },
      { point: [-6, -0.6], materialName: "crust" },
      { point: [8, -0.6], materialName: "crust" },
      { point: [0, -4], materialName: "clay" },
    ],
    udls: [{ magnitude: 18, x1: 5 + H + gap, x2: 10 }],
  }) as unknown as SlopeDefinition;

const options = { elementSize: 0.5, fTolerance: 0.005, startF: 1 };

describe("lowerBound: strip loads ending at or near a corner of the ground surface", () => {
  it("finds a lower bound below the upper bound, the same with the load at the corner, 2 mm and 5 cm from it", async () => {
    // Before the loads' ends were singular points with fans of elements,
    // the load 5 cm from the corner found no stress field at any F (λ
    // levelled off at 0.37 as F fell to 0.05), and the load at the corner
    // and 2 mm from it gave 0.91 and 0.87.
    const lower: number[] = [];
    for (const gap of [0, 0.002, 0.05]) {
      const r = await lowerBound(buildSlope(toCanonicalSlopeDefinition(embankment(gap))), options);
      expect(Number.isFinite(r.factorOfSafety)).toBe(true);
      // λ(F) ≥ 1 at the reported F: the loads are carried
      expect(r.trials.find((t) => t.F === r.factorOfSafety)!.lambda).toBeGreaterThanOrEqual(1);
      lower.push(r.factorOfSafety);
    }
    const upper = await upperBound(buildSlope(toCanonicalSlopeDefinition(embankment(0))), options);
    for (const f of lower) expect(f).toBeLessThanOrEqual(upper.factorOfSafety);
    // close to the inset load's bound, and to the upper bound (1.21)
    expect(Math.abs(lower[0] - lower[2])).toBeLessThan(0.05 * lower[2]);
    expect(Math.abs(lower[1] - lower[2])).toBeLessThan(0.05 * lower[2]);
    expect(lower[0]).toBeGreaterThan(0.9 * upper.factorOfSafety);
  }, 600000);

  it("gives a load's end on a straight surface a fan of elements", () => {
    // the load's end 2 mm from the corner: a fan of elements of at most 30° as seen from it, each in sectors
    const { mesh } = lowerBoundProblem(buildSlope(toCanonicalSlopeDefinition(embankment(0.002))), { elementSize: 0.5 });
    const { x, y, el } = mesh;
    let node = -1;
    for (let n = 0; n < x.length; n++) if (Math.abs(x[n] - (5 + H + 0.002)) < 1e-9 && Math.abs(y[n] - H) < 1e-9) node = n;
    expect(node).toBeGreaterThanOrEqual(0);
    let count = 0, widest = 0;
    for (let e = 0; e < el.length / 3; e++) {
      const k = [el[3 * e], el[3 * e + 1], el[3 * e + 2]].indexOf(node);
      if (k < 0) continue;
      const a = el[3 * e + ((k + 1) % 3)], b = el[3 * e + ((k + 2) % 3)];
      const ax = x[a] - x[node], ay = y[a] - y[node], bx = x[b] - x[node], by = y[b] - y[node];
      widest = Math.max(widest, Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)));
      count++;
    }
    // 180° below a straight surface: at least six elements of at most 30°, four sectors each
    expect(count).toBeGreaterThanOrEqual(24);
    expect(widest).toBeLessThanOrEqual((30 * Math.PI) / 180 + 1e-9);
  }, 120000);
});
