/**
 * SHANSEP and the shear-normal function in the analysis. The strength
 * functions themselves (shansepSu, shearNormalAt, the spline), internal
 * functions, are tested in Rust: packages/engine-rs/crates/cslope-engine/tests/types_unit.rs
 * and math_unit.rs.
 */
import { describe, expect, it } from "vitest";
import { layered, mc, runVerification } from "../verification/cases";
import type { MaterialModel } from "./material-models";

const shansep = (extra: Partial<Extract<MaterialModel, { kind: "shansep" }>> = {}): Extract<MaterialModel, { kind: "shansep" }> => ({
  kind: "shansep",
  unitWeight: 18,
  ratio: 0.25,
  ...extra,
});

describe("SHANSEP", () => {
  it("on a slice: S times the slice's weight per width less its pore pressure; B̄ adds the fill's weight to it", () => {
    // clay (SHANSEP) under 3 m of fill; water at the top of the clay
    const def = (clay: MaterialModel) =>
      layered([[0, 13], [20, 13], [30, 10], [60, 10]], 0, [
        { name: "Fill", topY: null, model: { ...mc(0, 35, 18), bBarLoad: true } },
        { name: "Clay", topY: 10, model: clay },
      ], { waterTable: { mode: "custom", value: [[0, 10], [60, 10]], followBoundary: false } });
    const circle = { customSearchPlanes: [{ cx: 25, cy: 25, radius: 21 }], customPlanesOnly: true };
    const run = (clay: MaterialModel) => runVerification({ ...def(clay), ...circle }, "Bishop", { slices: 40 });
    const plain = run(shansep({ unitWeight: 17 }));
    const withB = run(shansep({ unitWeight: 17, bBar: 1 }));
    for (const s of plain.slope.search[0].slices!) {
      if (s.baseMaterial?.name !== "Clay") continue;
      expect(s.cohesion).toBeCloseTo(0.25 * ((s.weight + s.udl + s.ll) / s.width - s.U), 9);
    }
    // the fill's weight per width becomes pore pressure in the clay below it
    const a = plain.slope.search[0].slices!, b = withB.slope.search[0].slices!;
    let checked = 0;
    a.forEach((s, i) => {
      if (s.baseMaterial?.name !== "Clay" || s.yTop <= 10.01) return;
      const fill = (Math.min(s.y0Top, s.y1Top) - 10) * 18;
      expect(b[i].U - s.U).toBeGreaterThanOrEqual(fill - 1e-6);
      checked++;
    });
    expect(checked).toBeGreaterThan(3);
    expect(withB.fos!).toBeLessThan(plain.fos!);
  });
});

describe("shear-normal function", () => {
  it("the analysis updates the tangent strength from the normal stress it finds", () => {
    const def = layered([[0, 10], [10, 10], [20, 0], [40, 0]], -10, [
      { name: "S", topY: null, model: { kind: "shear-normal", unitWeight: 19, points: [[0, 5], [50, 35], [200, 100]] } as MaterialModel },
    ]);
    const r = runVerification({ ...def, customSearchPlanes: [{ cx: 18, cy: 18, radius: 19 }], customPlanesOnly: true }, "Morgenstern-Price", { slices: 30 });
    expect(r.fos).not.toBeNull();
    // each base on the envelope at its final normal stress (within the fixed point's tolerance)
    const slices = r.slope.search[0].slices!;
    const varied = new Set(slices.map((s) => s.frictionAngle.toFixed(3)));
    expect(varied.size).toBeGreaterThan(1);
  });
});
