import { describe, it, expect } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import { DEFAULT_FEM_SETTINGS } from "../types/analysis";
import { runFemSummary } from "./summary";

const clay = [{ name: "Clay", model: { kind: "undrained", unitWeight: 18, undrainedShearStrength: 20 } }];
const settings = { ...DEFAULT_FEM_SETTINGS, enabled: true, elementSize: 2, refinementLevels: 0 };

describe("runFemSummary", () => {
  it("gives the same factor for a slope and its mirror image, with the mesh in model coordinates", () => {
    const ltr = { coordinates: [[0, 0], [0, 10], [10, 10], [15, 5], [30, 5], [30, 0]], materials: clay } as unknown as SlopeDefinition;
    const rtl = {
      coordinates: [[30, 0], [30, 10], [20, 10], [15, 5], [0, 5], [0, 0]].reverse(),
      materials: clay,
    } as unknown as SlopeDefinition;
    const a = runFemSummary(ltr, settings);
    const b = runFemSummary(rtl, settings);
    expect(b.factorOfSafety).toBeCloseTo(a.factorOfSafety, 2);
    // the mirrored mesh lies where the model is: high ground on the right
    const nodeHigh = b.y.findIndex((y) => y > 9.99);
    expect(b.x[nodeHigh]).toBeGreaterThanOrEqual(20 - 1e-6);
    // elements stay counter-clockwise
    for (let e = 0; e < b.triangles.length; e += 3) {
      const [i, j, k] = [b.triangles[e], b.triangles[e + 1], b.triangles[e + 2]];
      const area = (b.x[j] - b.x[i]) * (b.y[k] - b.y[i]) - (b.y[j] - b.y[i]) * (b.x[k] - b.x[i]);
      expect(area).toBeGreaterThan(0);
    }
    expect(b.plasticShear.length).toBe(b.triangles.length / 3);
    expect(JSON.parse(JSON.stringify(b))).toEqual(b);
    // the F–displacement curve: converged trials by increasing F, up to the factor of safety
    expect(b.curve!.length).toBeGreaterThan(1);
    for (let k = 1; k < b.curve!.length; k++) expect(b.curve![k].F).toBeGreaterThan(b.curve![k - 1].F);
    expect(b.curve![b.curve!.length - 1].F).toBeCloseTo(b.factorOfSafety, 6);
  }, 60000);
});
