import { describe, expect, it } from "vitest";
import { layered, runVerification } from "../verification/cases";
import { drawdownStrength } from "./drawdown";
import type { MaterialModel, SlopeDefinition } from "../types/index";

describe("rapid drawdown (three-stage)", () => {
  it("τff between the R envelope at Kc = 1 and the effective envelope at Kc = Kf", () => {
    const c = 10, phi = 25, cR = 20, phiR = 15, sfc = 100;
    const r = (phiR * Math.PI) / 180;
    const p = (phi * Math.PI) / 180;
    // the Kc = 1 envelope by Duncan, Wright & Brandon (2014), Eqs. 9.6–9.7
    const tau1 = (cR * Math.cos(r) * Math.cos(p)) / (1 - Math.sin(r)) + sfc * ((Math.sin(r) * Math.cos(p)) / (1 - Math.sin(r)));
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

  it("the Kc = 1 envelope of Pilarcitos Dam: d = 64 psf, ψ = 24.4°", () => {
    // Duncan, Wright & Wong (1990): c′ = 0, φ′ = 45°, cR = 60 psf, φR = 23°
    // (64.10 and 24.39° by Eqs. 9.6–9.7 of Duncan, Wright & Brandon 2014)
    // with τfc = 0 (Kc = 1) τff is on that envelope
    const tau = (sfc: number) => drawdownStrength(sfc, 0, 0, 45, 60, 23);
    const tanPsi = (tau(1500) - tau(500)) / 1000;
    expect(tau(500) - 500 * tanPsi).toBeCloseTo(64.1, 2);
    expect((Math.atan(tanPsi) * 180) / Math.PI).toBeCloseTo(24.39, 2);
    expect(tau(1000)).toBeCloseTo(64.1 + 1000 * Math.tan((24.39 * Math.PI) / 180), 0);
  });

  it("an upstream slope after drawdown: no higher than drained throughout; free-draining soil unchanged", () => {
    const clay = (extra: object = {}): MaterialModel => ({ kind: "mohr-coulomb", unitWeight: 19, cohesion: 5, frictionAngle: 28, ...extra });
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

describe("rapid drawdown with other inputs", () => {
  const ground: [number, number][] = [[0, 0], [30, 15], [40, 15], [60, 15]];
  const after = [[0, 0], [60, 0]] as [number, number][];
  const plane = { customSearchPlanes: [{ cx: 12, cy: 32, radius: 30 }], customPlanesOnly: true };
  const run = (def: SlopeDefinition) => runVerification(def, "Morgenstern-Price", { intersliceFunction: "constant", slices: 30 }).fos!;

  it("with a waternet: the water before drawdown is waterBefore alone, as with the equivalent water table", () => {
    const m = { kind: "mohr-coulomb", unitWeight: 19, cohesion: 5, frictionAngle: 28, drawdownStrength: { cohesion: 15, frictionAngle: 12 } } as MaterialModel;
    const def = (waternet: boolean, drawdown: boolean): SlopeDefinition => ({
      ...layered(ground, -10, [{ name: "C", topY: null, model: m }]),
      orientation: "rtl",
      waterTable: { mode: "custom", value: after, followBoundary: false },
      // hydrostatic below the line at 0: the water table's pore pressures
      ...(waternet ? { waternet: { headLines: [{ id: "h", points: after }], referenceLines: [{ points: [[0, -20], [60, -20]], topHeadLineId: "h", bottomHeadLineId: "h" }], phreaticLineId: "h" } } : {}),
      ...(drawdown ? { rapidDrawdown: { waterBefore: [[0, 13], [60, 13]] as [number, number][] } } : {}),
      ...plane,
    });
    expect(run(def(true, false))).toBeCloseTo(run(def(false, false)), 9);
    const dd = run(def(true, true));
    expect(Math.abs(dd - run(def(true, false)))).toBeGreaterThan(0.01);
    expect(dd).toBeCloseTo(run(def(false, true)), 9);
  });

  it("SHANSEP below and Mohr-Coulomb above the water, a yield stress from an earlier stage and a load not yet consolidated: no change without a drawdown", () => {
    const clay: MaterialModel = {
      kind: "shansep", unitWeight: 18, ratio: 0.25, exponent: 0.8, yieldFromEarlierStage: true,
      aboveWater: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 8, frictionAngle: 30 },
    };
    const water = [[0, 8], [60, 8]] as [number, number][];
    const def = (drawdown: boolean): SlopeDefinition => {
      const d = layered(ground, -10, [{ name: "C", topY: null, model: clay }], { waterTable: { mode: "custom", value: water, followBoundary: false } });
      return {
        ...d,
        orientation: "rtl",
        earlierStage: { ...d, orientation: "rtl", udls: [{ magnitude: 60, x1: 30, x2: 60 }] },
        udls: [{ magnitude: 20, x1: 35, x2: 60, excessPorePressure: [{ material: "C", ratio: 0.5 }] }],
        ...(drawdown ? { rapidDrawdown: { waterBefore: water } } : {}),
        ...plane,
      };
    };
    const slices = runVerification(def(false), "Morgenstern-Price", { intersliceFunction: "constant", slices: 30 }).slope.search[0].slices!;
    // both strengths on the surface
    expect(slices.some((s) => s.strengthModel?.kind === "mohr-coulomb")).toBe(true);
    expect(slices.some((s) => !s.strengthModel && s.baseMaterial?.model.kind === "shansep")).toBe(true);
    expect(run(def(true))).toBeCloseTo(run(def(false)), 9);
  });
});
