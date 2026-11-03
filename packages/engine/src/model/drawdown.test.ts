import { describe, expect, it } from "vitest";
import { layered, runVerification } from "../verification/cases";
import { drawdownStrength } from "./drawdown";
import type { MaterialModel } from "../types/index";

describe("rapid drawdown (three-stage)", () => {
  it("τff between the R envelope at Kc = 1 and the effective envelope at Kc = Kf", () => {
    const c = 10, phi = 25, cR = 20, phiR = 15, sfc = 100;
    const r = (phiR * Math.PI) / 180;
    const tau1 = (cR * Math.cos(r)) / (1 - Math.sin(r)) + sfc * ((Math.sin(r) * Math.cos(r)) / (1 - Math.sin(r)));
    const tauKf = c + sfc * Math.tan((phi * Math.PI) / 180);
    // isotropic consolidation (no shear): the R envelope
    expect(drawdownStrength(sfc, 0, c, phi, cR, phiR)).toBeCloseTo(tau1, 9);
    // consolidated at failure (τfc on the effective envelope): the effective envelope
    expect(drawdownStrength(sfc, tauKf, c, phi, cR, phiR)).toBeCloseTo(tauKf, 6);
    // in between
    const mid = drawdownStrength(sfc, tauKf / 2, c, phi, cR, phiR);
    expect(mid).toBeGreaterThan(Math.min(tau1, tauKf));
    expect(mid).toBeLessThan(Math.max(tau1, tauKf));
  });

  it("an upstream slope after drawdown: no higher than drained throughout; free-draining soil unchanged", () => {
    const clay = (extra: object = {}): MaterialModel => ({ kind: "mohr-coulomb", unitWeight: 19, cohesion: 5, frictionAngle: 28, ...extra } as MaterialModel);
    // a dam's upstream face (sliding to the left, towards the reservoir)
    const def = (m: MaterialModel, drawdown: boolean) => ({
      ...layered([[0, 0], [30, 15], [40, 15], [60, 15]], -10, [{ name: "C", topY: null, model: m }]),
      orientation: "rtl" as const,
      waterTable: { mode: "custom" as const, value: [[0, 0], [60, 0]] as [number, number][], followBoundary: false },
      ...(drawdown ? { rapidDrawdown: { waterBefore: [[0, 13], [60, 13]] as [number, number][] } } : {}),
      customSearchPlanes: [{ cx: 12, cy: 32, radius: 30 }],
      customPlanesOnly: true,
    });
    const run = (m: MaterialModel, d: boolean) => runVerification(def(m, d), "Morgenstern-Price", { intersliceFunction: "constant", slices: 30 }).fos!;
    const drained = run(clay(), false);
    const dd = run(clay({ drawdownStrength: { cohesion: 15, frictionAngle: 12 } }), true);
    expect(dd).toBeLessThan(drained * 1.0001);
    expect(dd).toBeGreaterThan(0.3);
    // a free-draining material (no drawdown envelope): only the water after drawdown counts
    expect(run(clay(), true)).toBeCloseTo(drained, 9);
  });
});

describe("rapid drawdown with partial factors", () => {
  it("the undrained strength takes γcu, the drained one its own factors", () => {
    const m = { kind: "mohr-coulomb", unitWeight: 19, cohesion: 5, frictionAngle: 28, drawdownStrength: { cohesion: 15, frictionAngle: 12 } } as MaterialModel;
    const def = {
      ...layered([[0, 0], [30, 15], [40, 15], [60, 15]], -10, [{ name: "C", topY: null, model: m }]),
      orientation: "rtl" as const,
      waterTable: { mode: "custom" as const, value: [[0, 0], [60, 0]] as [number, number][], followBoundary: false },
      rapidDrawdown: { waterBefore: [[0, 13], [60, 13]] as [number, number][] },
      customSearchPlanes: [{ cx: 12, cy: 32, radius: 30 }],
      customPlanesOnly: true,
    };
    const run = (pf?: { cu: number; cohesion: number; tanPhi: number; variableLoad: number }) => runVerification(def, "Morgenstern-Price", { intersliceFunction: "constant", slices: 30, ...(pf ? { partialFactors: pf } : {}) }).fos!;
    const plain = run();
    const factored = run({ cu: 1.5, cohesion: 1.5, tanPhi: 1.5, variableLoad: 1 });
    expect(factored).toBeLessThan(plain / 1.3);
  });
});
