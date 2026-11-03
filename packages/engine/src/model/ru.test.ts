import { describe, expect, it } from "vitest";
import type { MaterialModel } from "../types";
import { validateMaterialModel } from "../types/validation";
import { layered, mc, runVerification } from "../verification/cases";

describe("pore pressure ratio ru", () => {
  const ground: [number, number][] = [[0, 10], [10, 10], [25, 0], [45, 0]];
  const circle = { customSearchPlanes: [{ cx: 20, cy: 20, radius: 21 }], customPlanesOnly: true };
  const run = (model: MaterialModel, extra = {}) =>
    runVerification({ ...layered(ground, -10, [{ name: "S", topY: null, model }], extra), ...circle }, "Bishop", { slices: 30 });

  it("adds ru × the soil weight per width to the pore pressure at each base", () => {
    const dry = run(mc(5, 30, 19)).slope.search[0].slices!;
    const wet = run({ ...mc(5, 30, 19), ru: 0.3 });
    wet.slope.search[0].slices!.forEach((s, i) => {
      expect(s.U - dry[i].U).toBeCloseTo((0.3 * s.weight) / s.width, 9);
    });
    expect(wet.fos!).toBeLessThan(run(mc(5, 30, 19)).fos!);
  });

  it("adds to the pore pressure of the material's water line", () => {
    const water = { waterTable: { mode: "custom" as const, value: [[0, 4], [45, 4]] as [number, number][] } };
    const line = run(mc(5, 30, 19), water).slope.search[0].slices!;
    const both = run({ ...mc(5, 30, 19), ru: 0.2 }, water).slope.search[0].slices!;
    both.forEach((s, i) => expect(s.U - line[i].U).toBeCloseTo((0.2 * s.weight) / s.width, 9));
  });

  it("follows F = m − n·ru for a cohesionless slope on a circle (Bishop & Morgenstern 1960: linear in ru)", () => {
    const f = (ru: number) => run({ ...mc(0.001, 35, 20), ...(ru ? { ru } : {}) }).fos!;
    const f0 = f(0), f1 = f(0.2), f2 = f(0.4);
    // equal steps in ru give (nearly) equal steps in F
    expect(Math.abs((f0 - f1) - (f1 - f2)) / (f0 - f2)).toBeLessThan(0.05);
  });

  it("must be at least 0 and below 1", () => {
    expect(validateMaterialModel({ ...mc(5, 30, 19), ru: 1 })).toHaveLength(1);
    expect(validateMaterialModel({ ...mc(5, 30, 19), ru: -0.1 })).toHaveLength(1);
    expect(validateMaterialModel({ ...mc(5, 30, 19), ru: 0.5 })).toHaveLength(0);
  });
});
