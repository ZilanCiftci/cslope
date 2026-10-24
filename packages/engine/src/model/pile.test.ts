/**
 * Piles (Ito & Matsui, capacity limits) and lime-cement columns. The
 * published problems are in verification/problems.ts (V013, V015, V095).
 */
import { describe, it, expect } from "vitest";
import { layered, mc, su, runVerification } from "../verification/cases";
import { buildSlope } from "./build-slope";
import { itoMatsuiCoefficients, pileForce } from "./reinforcement";
import { resolveStrength } from "../types/strength";
import { validateMaterialModel } from "../types/validation";
import type { LimeCementColumnModel } from "../types/material-models";
import type { Pile } from "../types/reinforcement";

const ground: [number, number][] = [[0, 10], [10, 10], [25, 0], [40, 0]];

describe("Ito & Matsui pile force", () => {
  it("integrates p(z) = c·A1 + γ·z·A2 down to the slip surface", () => {
    const slope = buildSlope(layered(ground, -10, [{ name: "S", topY: null, model: mc(10, 20, 20) }]));
    const pile: Pile = { x1: 5, y1: 10, x2: 5, y2: -10, diameter: 0.8, spacing: 2.4 };
    const zf = 4;
    const [A1, A2] = itoMatsuiCoefficients(1.6, 0.8, 20);
    const expected = 10 * A1 * zf + (20 * A2 * zf * zf) / 2;
    const f = pileForce(slope, pile, 5, 10 - zf);
    expect(f.perPile).toBeCloseTo(expected, 1);
    expect(f.perMetre).toBeCloseTo(expected / 2.4, 1);
    expect(f.governs).toBe("soil");
  });

  it("uses the effective overburden γ′z below the water table (Ito & Matsui 1975, Poulos 1995)", () => {
    // Saturated c′–φ′ soil, water table at the ground, slip surface 6 m down.
    const model = { ...mc(5, 25, 20), unitWeightSat: 20 };
    const dry = buildSlope(layered(ground, -10, [{ name: "S", topY: null, model }]));
    const wet = buildSlope(
      layered(ground, -10, [{ name: "S", topY: null, model }], {
        waterTable: { mode: "custom", value: ground, followBoundary: false },
      }),
    );
    const pile: Pile = { x1: 5, y1: 10, x2: 5, y2: -10, diameter: 0.8, spacing: 2.4 };
    const zf = 6;
    const [A1, A2] = itoMatsuiCoefficients(1.6, 0.8, 25);
    const perPile = (gamma: number) => 5 * A1 * zf + (gamma * A2 * zf * zf) / 2;
    const fDry = pileForce(dry, pile, 5, 10 - zf).perPile;
    const fWet = pileForce(wet, pile, 5, 10 - zf).perPile;
    expect(fDry).toBeCloseTo(perPile(20), 1);
    expect(fDry).toBeCloseTo(1053, 0);
    expect(fWet).toBeCloseTo(perPile(20 - 9.81), 1);
    expect(fWet).toBeCloseTo(593, 0);
  });

  it("loads the pile only from its head down, with design strength", () => {
    const slope = buildSlope(layered(ground, -10, [{ name: "S", topY: null, model: mc(10, 20, 20) }]));
    const [A1, A2] = itoMatsuiCoefficients(1.6, 0.8, 20);
    // Head 2 m below the ground, slip surface 5 m deep.
    const buried: Pile = { x1: 5, y1: 8, x2: 5, y2: -10, diameter: 0.8, spacing: 2.4 };
    const expected = 10 * A1 * 3 + (20 * A2 * (25 - 4)) / 2;
    expect(pileForce(slope, buried, 5, 5).perPile).toBeCloseTo(expected, 1);
    // Partial factors reduce c and tan φ.
    const full = pileForce(slope, { ...buried, y1: 10 }, 5, 5).perPile;
    slope.updateAnalysisOptions({ partialFactors: { cu: 1.5, cohesion: 1.3, tanPhi: 1.3, variableLoad: 1.3 } });
    expect(pileForce(slope, { ...buried, y1: 10 }, 5, 5).perPile).toBeLessThan(full * 0.85);
  });

  it("the φ = 0 solution is a lower bound (no dip at small φ)", () => {
    const [a0, b0] = itoMatsuiCoefficients(1.6, 0.8, 0);
    for (const phi of [1, 2, 5, 10]) {
      const [a, b] = itoMatsuiCoefficients(1.6, 0.8, phi);
      expect(a).toBeGreaterThanOrEqual(a0);
      expect(b).toBeGreaterThanOrEqual(b0);
    }
  });

  it("is limited by the shear and bending capacity", () => {
    const slope = buildSlope(layered(ground, -10, [{ name: "C", topY: null, model: su(30, 18) }]));
    const base: Pile = { x1: 5, y1: 10, x2: 5, y2: -10, diameter: 0.6, spacing: 2 };
    const soil = pileForce(slope, base, 5, 6).perPile;
    expect(pileForce(slope, { ...base, shearCapacity: soil / 2 }, 5, 6)).toMatchObject({ perPile: soil / 2, governs: "shear" });
    // Uniform pressure (φ = 0, c only plus γz·D): arm between z/3 and z/2.
    const bent = pileForce(slope, { ...base, momentCapacity: soil / 10 }, 5, 6);
    expect(bent.governs).toBe("bending");
    expect(bent.perPile).toBeGreaterThan(soil / 10 / 2);
    expect(bent.perPile).toBeLessThan((soil / 10) * (3 / 4));
    // A given force: arm z/3.
    expect(pileForce(slope, { ...base, force: 100, momentCapacity: 40 }, 5, 6).perPile).toBeCloseTo(30, 9);
  });

  it("raises the FOS and resists in either orientation", () => {
    const def = layered(ground, -10, [{ name: "S", topY: null, model: mc(10, 20, 20) }], {
      customSearchPlanes: [{ cx: 22, cy: 22, radius: 22 }],
      customPlanesOnly: true,
    });
    const plain = runVerification(def, "Bishop").fos!;
    const piled = runVerification({ ...def, piles: [{ x1: 15, y1: 10, x2: 15, y2: -10, force: 50 }] }, "Bishop").fos!;
    expect(piled).toBeGreaterThan(plain * 1.05);
    // The mirror image gives the same.
    const m = (x: number) => 40 - x;
    const mirrored = runVerification(
      {
        ...def,
        coordinates: def.coordinates.map(([x, y]) => [m(x), y] as [number, number]).reverse(),
        regionAssignments: def.regionAssignments!.map((r) => ({ ...r, point: [m(r.point[0]), r.point[1]] as [number, number] })),
        customSearchPlanes: [{ cx: m(22), cy: 22, radius: 22 }],
        piles: [{ x1: m(15), y1: 10, x2: m(15), y2: -10, force: 50 }],
      },
      "Bishop",
    ).fos!;
    expect(mirrored).toBeCloseTo(piled, 6);
  });

  it("rejects input Ito & Matsui cannot use", () => {
    const slope = buildSlope(layered(ground, -10, [{ name: "S", topY: null, model: mc(10, 20, 20) }]));
    expect(() => slope.setPiles([{ x1: 5, y1: 10, x2: 6, y2: -10, diameter: 0.6, spacing: 2 }])).toThrow(/vertical/);
    expect(() => slope.setPiles([{ x1: 5, y1: 10, x2: 5, y2: -10, diameter: 0.6, spacing: 0.5 }])).toThrow(/spacing/);
    expect(() => slope.setPiles([{ x1: 5, y1: 10, x2: 5, y2: -10 }])).toThrow(/diameter/);
  });
});

describe("Lime-cement columns", () => {
  const kc: LimeCementColumnModel = {
    kind: "lime-cement-columns",
    unitWeight: 16,
    soilSu: 10,
    suRefDepth: 0,
    suRateOfChange: 1.5,
    columnSu: 120,
    areaRatio: 0.25,
  };
  const ctx = { yBottom: -4, x: 0, yGround: 0, alpha: 0 };

  it("undrained: τ = a·cu,col + (1 − a)·cu,soil", () => {
    const st = resolveStrength(kc, ctx);
    expect(st.cohesion).toBeCloseTo(0.25 * 120 + 0.75 * (10 + 1.5 * 4), 9);
    expect(st.frictionAngle).toBe(0);
    // The same FOS as an undrained clay of that strength.
    const geom: [number, number][] = [[0, 0], [10, 0], [16, -4], [26, -4]];
    const surface = { customSearchPlanes: [{ cx: 13, cy: 6, radius: 11 }], customPlanesOnly: true };
    const a = runVerification(layered(geom, -12, [{ name: "KC", topY: null, model: { ...kc, suRateOfChange: 0 } }], surface), "Bishop").fos!;
    const b = runVerification(layered(geom, -12, [{ name: "Su", topY: null, model: su(0.25 * 120 + 0.75 * 10, 16) }], surface), "Bishop").fos!;
    expect(a).toBeCloseTo(b, 6);
  });

  it("drained limit of the columns: a combined material", () => {
    const st = resolveStrength({ ...kc, columnCohesion: 36, columnFrictionAngle: 30 }, ctx);
    expect(st.isCombined).toBe(true);
    expect(st.cohesion).toBeCloseTo(0.75 * 16 + 0.25 * 36, 9);
    expect(Math.tan((st.frictionAngle * Math.PI) / 180)).toBeCloseTo(0.25 * Math.tan(Math.PI / 6), 9);
    expect(st.cohesionUndrained).toBeCloseTo(0.25 * 120 + 0.75 * 16, 9);
  });

  it("validates its parameters", () => {
    expect(validateMaterialModel(kc)).toEqual([]);
    expect(validateMaterialModel({ ...kc, areaRatio: 1.2 }).length).toBe(1);
    expect(validateMaterialModel({ ...kc, columnCohesion: 30 }).length).toBe(1);
  });
});
