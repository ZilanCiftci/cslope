/**
 * Strength from matric suction (φb, extended Mohr-Coulomb): resolution
 * and validation. (The design values, of the internal designStrength, are
 * tested in Rust: packages/engine-rs/crates/cslope-engine/tests/types_unit.rs.)
 */

import { describe, it, expect } from "vitest";
import { resolveStrength, suctionStrength, type StrengthContext } from "./strength";
import { suctionAngle, type MaterialModel } from "./material-models";
import { validateMaterialModel } from "./validation";

const ctx = (suction?: number): StrengthContext => ({ yBottom: 0, x: 0, yGround: 5, alpha: 0, ...(suction !== undefined ? { suction } : {}) });
const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);
const mc = (extra: Partial<Extract<MaterialModel, { kind: "mohr-coulomb" }>> = {}): MaterialModel => ({
  kind: "mohr-coulomb",
  unitWeight: 18,
  cohesion: 10,
  frictionAngle: 30,
  ...extra,
});

describe("strength from suction", () => {
  it("adds (−u)·tan φb to c′ above the water line", () => {
    const r = resolveStrength(mc({ phiB: 15 }), ctx(20));
    expect(r.cohesion).toBeCloseTo(10 + 20 * tan(15), 12);
    expect(r.suctionStrength).toBeCloseTo(20 * tan(15), 12);
    expect(r.frictionAngle).toBe(30);
  });

  it("changes nothing without suction (below the line) or without φb", () => {
    const plain = resolveStrength(mc(), ctx());
    expect(resolveStrength(mc({ phiB: 15 }), ctx(0))).toEqual(plain);
    expect(resolveStrength(mc({ phiB: 15 }), ctx())).toEqual(plain);
    expect(resolveStrength(mc({ phiB: 0 }), ctx(50))).toEqual(plain);
    expect(resolveStrength(mc(), ctx(50))).toEqual(plain);
  });

  it("caps the suction at the maximum", () => {
    expect(resolveStrength(mc({ phiB: 15, maxSuction: 8 }), ctx(20)).suctionStrength).toBeCloseTo(8 * tan(15), 12);
    expect(resolveStrength(mc({ phiB: 15, maxSuction: 80 }), ctx(20)).suctionStrength).toBeCloseTo(20 * tan(15), 12);
    expect(suctionStrength(mc({ phiB: 20, maxSuction: 5 }), 100)).toBeCloseTo(5 * tan(20), 12);
  });

  it("goes to the drained branch of a combined material only", () => {
    const comb = resolveStrength(mc({ phiB: 10, cFactor: 0.1, cohesionUndrained: 40 }), ctx(30));
    expect(comb.isCombined).toBe(true);
    expect(comb.cohesion).toBeCloseTo(1 + 30 * tan(10), 12);
    expect(comb.cohesionUndrained).toBe(40);

    const depth: MaterialModel = { kind: "s-f-depth", unitWeight: 18, suRef: 30, depthRef: 0, rate: 0, phiB: 10 };
    // undrained only: no drained branch, no suction strength
    expect(suctionAngle(depth)).toBe(0);
    expect(resolveStrength(depth, ctx(30))).toEqual(resolveStrength(depth, ctx()));
    const combined: MaterialModel = { ...depth, drainedCohesion: 3, drainedFrictionAngle: 30 };
    const r = resolveStrength(combined, ctx(30));
    expect(r.cohesion).toBeCloseTo(3 + 30 * tan(10), 12);
    expect(r.cohesionUndrained).toBe(30);
  });

  it("is not scaled by the anisotropic modifier", () => {
    const m: MaterialModel = { kind: "anisotropic-function", unitWeight: 18, cohesion: 10, frictionAngle: 30, modifierFunction: [[-90, 0.5], [90, 0.5]], phiB: 20 };
    expect(resolveStrength(m, ctx(10)).cohesion).toBeCloseTo(5 + 10 * tan(20), 12);
  });

  it("is ignored by models without a drained strength", () => {
    const m = { kind: "undrained", unitWeight: 18, undrainedShearStrength: 25, phiB: 20 } as unknown as MaterialModel;
    expect(suctionAngle(m)).toBe(0);
    expect(resolveStrength(m, ctx(40)).cohesion).toBe(25);
  });

});

describe("validation of φb and the maximum suction", () => {
  it("accepts valid values", () => {
    expect(validateMaterialModel(mc({ phiB: 15, maxSuction: 50 }))).toEqual([]);
    expect(validateMaterialModel(mc({ phiB: 0 }))).toEqual([]);
  });

  it("rejects values out of range", () => {
    expect(validateMaterialModel(mc({ phiB: 90 })).join()).toMatch(/φb/);
    expect(validateMaterialModel(mc({ phiB: -1 })).join()).toMatch(/φb/);
    expect(validateMaterialModel(mc({ phiB: Number.NaN })).join()).toMatch(/φb/);
    expect(validateMaterialModel(mc({ phiB: 10, maxSuction: 0 })).join()).toMatch(/maximum suction/);
  });

  it("rejects φb on a model that does not take it", () => {
    const u = { kind: "undrained", unitWeight: 18, undrainedShearStrength: 25, phiB: 20 } as unknown as MaterialModel;
    expect(validateMaterialModel(u).join()).toMatch(/only taken by/);
    const depth: MaterialModel = { kind: "s-f-depth", unitWeight: 18, suRef: 30, depthRef: 0, rate: 0, phiB: 10 };
    expect(validateMaterialModel(depth).join()).toMatch(/combined/);
    expect(validateMaterialModel({ ...depth, drainedCohesion: 2, drainedFrictionAngle: 30 })).toEqual([]);
  });
});
