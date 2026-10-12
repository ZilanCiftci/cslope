/**
 * Reinforcement and pile mechanics: capacity envelopes (every pullout
 * kind, as properties along the element), force directions, tension only,
 * and the pile force limits.
 */
import { describe, it, expect } from "vitest";
import { Material } from "../types/index";
import type { MaterialModel } from "../types/material-models";
import type { Reinforcement, Pile } from "../types/reinforcement";
import { Slope } from "./slope";
import { buildEnvelope, envelopeAt, pulloutBeyond, pileForce, buildPileProfile, effectiveVerticalStress, pileForceDirection, applyReinforcement } from "./reinforcement";
import { getSlices } from "./slices";

const BOUNDARY: [number, number][] = [[0, -10], [0, 10], [10, 10], [25, 0], [40, 0], [40, -10]];
function slopeOf(model: MaterialModel = { kind: "mohr-coulomb", unitWeight: 19, cohesion: 10, frictionAngle: 30 }): Slope {
  const s = new Slope();
  s.addMaterial(new Material({ name: "M", unitWeight: model.unitWeight, cohesion: 0, frictionAngle: 0, model }));
  s.setExternalBoundary(BOUNDARY);
  return s;
}
const nail: Reinforcement = { x1: 20, y1: 3.33, x2: 8, y2: 0, tensileCapacity: 150, spacing: 1.5 };

describe("capacity envelopes", () => {
  const s = slopeOf();
  const kinds: [string, Reinforcement][] = [
    ["anchored (no pullout)", nail],
    ["bond over the whole length", { ...nail, pullout: { kind: "bond", strength: 20 } }],
    ["bond over 5 m at end 2", { ...nail, pullout: { kind: "bond", strength: 40, bondedLength: 5 }, end1Capacity: 30 }],
    ["development lengths", { ...nail, pullout: { kind: "development", length1: 2, length2: 3 } }],
    ["development length 0 (anchored ends)", { ...nail, pullout: { kind: "development", length1: 0, length2: 0 } }],
    ["interface friction", { ...nail, pullout: { kind: "interface", adhesion: 5, frictionAngle: 25, coverage: 0.8 } }],
  ];

  it.each(kinds)("%s: within [0, T], continuous along the element", (_l, r) => {
    const env = buildEnvelope(s, r);
    let prev = envelopeAt(env, 0);
    for (let k = 0; k <= 200; k++) {
      const v = envelopeAt(env, (k / 200) * env.length);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(r.tensileCapacity + 1e-9);
      // Lipschitz: the envelope cannot jump (pullout rates are finite).
      expect(Math.abs(v - prev)).toBeLessThan(r.tensileCapacity * 0.2);
      prev = v;
    }
    expect(pulloutBeyond(env, env.length + 1)).toBeGreaterThanOrEqual(0);
  });

  it("bond: the envelope is the smaller of the pullout from either end", () => {
    const env = buildEnvelope(s, { ...nail, pullout: { kind: "bond", strength: 20 } });
    const L = env.length;
    for (const t of [0.1, 0.3, 0.5, 0.9]) {
      expect(envelopeAt(env, t * L)).toBeCloseTo(Math.min(150, 20 * t * L, 20 * (1 - t) * L), 9);
    }
    // Before the bonded length, nothing is developed from end 1.
    const part = buildEnvelope(s, { ...nail, pullout: { kind: "bond", strength: 40, bondedLength: 5 }, end1Capacity: 30 });
    expect(envelopeAt(part, 1)).toBeCloseTo(30, 9);
    expect(envelopeAt(part, -1)).toBeCloseTo(30, 9);
  });

  it("development: linear over each length; anchored without pullout is T everywhere", () => {
    const env = buildEnvelope(s, { ...nail, pullout: { kind: "development", length1: 2, length2: 3 } });
    expect(envelopeAt(env, 1)).toBeCloseTo(75, 9);
    expect(envelopeAt(env, env.length - 1.5)).toBeCloseTo(75, 9);
    expect(envelopeAt(env, env.length / 2)).toBe(150);
    const anchored = buildEnvelope(s, nail);
    expect(envelopeAt(anchored, 3)).toBe(150);
    expect(pulloutBeyond(anchored, 3)).toBe(Infinity);
    expect(pulloutBeyond(buildEnvelope(s, { ...nail, pullout: { kind: "development", length1: 0, length2: 0 } }), 1)).toBe(Infinity);
  });

  it("interface friction: no resistance outside the soil, more with depth", () => {
    // An element sticking out of the ground beyond end 1.
    const out = buildEnvelope(s, { x1: 22, y1: 8, x2: 12, y2: 4, tensileCapacity: 1e6, pullout: { kind: "interface", adhesion: 5, frictionAngle: 25 } });
    // The first part (above the ground) adds nothing.
    expect(out.fromEnd1[1]).toBe(0);
    expect(effectiveVerticalStress(s, 5, 5)).toBeCloseTo(19 * 5, 1);
    expect(effectiveVerticalStress(s, 5, 12)).toBe(0);
    expect(effectiveVerticalStress(new Slope(), 5, 5)).toBe(0);
  });

  it("σ′v: γsat below the water line, ponded water on the column", () => {
    const sat = slopeOf({ kind: "mohr-coulomb", unitWeight: 18, unitWeightSat: 20, cohesion: 5, frictionAngle: 30 });
    sat.setWaterTable({ height: 5, followBoundary: false });
    // At x = 5: 5 m dry (18) + 3 m saturated (20) − u (3 m of water).
    expect(effectiveVerticalStress(sat, 5, 2)).toBeCloseTo(5 * 18 + 3 * 20 - 3 * 9.81, 6);
    // At x = 35 (ground 0) under 5 m of free water: buoyant column only.
    expect(effectiveVerticalStress(sat, 35, -2)).toBeCloseTo(2 * (20 - 9.81), 6);
  });
});

describe("forces on the slices", () => {
  function forcesFor(r: Reinforcement) {
    const s = slopeOf();
    s.setReinforcements([r]);
    s.updateAnalysisOptions({ slices: 30 });
    const ints = s.getCircleExternalIntersection(22, 18, 18.5);
    const slices = getSlices(s, ints[0][0], ints[ints.length - 1][0], 22, 18, 18.5);
    return slices.flatMap((q) => q.reinforcementForces ?? []);
  }

  it("axial, tangent and bisector directions; the bisector halves the angle", () => {
    const axial = forcesFor({ ...nail, direction: "axial" })[0];
    const tangent = forcesFor({ ...nail, direction: "tangent" })[0];
    const bis = forcesFor({ ...nail, direction: "bisector" })[0];
    for (const f of [axial, tangent, bis]) expect(Math.hypot(f.fx, f.fy)).toBeCloseTo(f.force, 9);
    // Along the sum of the two unit vectors.
    const u = (f: { fx: number; fy: number; force: number }) => [f.fx / f.force, f.fy / f.force];
    const [sx, sy] = [u(axial)[0] + u(tangent)[0], u(axial)[1] + u(tangent)[1]];
    const [bx, by] = u(bis);
    expect(bx * sy - by * sx).toBeCloseTo(0, 9);
    expect(bx * sx + by * sy).toBeGreaterThan(0);
    // All pull back against the sliding direction (+x).
    for (const f of [axial, tangent, bis]) expect(f.fx).toBeLessThan(0);
  });

  it("an element the movement would push carries nothing; so does one that misses the surface or has no length", () => {
    // Pointing down-slope out of the mass: compressed by the movement.
    expect(forcesFor({ x1: 20, y1: 3.33, x2: 34, y2: -6, tensileCapacity: 100 })).toHaveLength(0);
    expect(forcesFor({ x1: 35, y1: -1, x2: 38, y2: -3, tensileCapacity: 100 })).toHaveLength(0);
    expect(forcesFor({ x1: 20, y1: 0, x2: 20, y2: 0, tensileCapacity: 100 })).toHaveLength(0);
    // Zero capacity.
    expect(forcesFor({ ...nail, tensileCapacity: 0 })).toHaveLength(0);
  });

  it("passive elements go to the passive loads, divided by the spacing", () => {
    const [f] = forcesFor({ ...nail, application: "passive" });
    expect(f.passive).toBe(true);
    expect(f.force).toBeCloseTo(150 / 1.5, 9);
  });
});

describe("piles", () => {
  const s = slopeOf();
  const pile: Pile = { x1: 20, y1: 3.33, x2: 20, y2: -9, diameter: 0.6, spacing: 2 };

  it("Ito & Matsui: force grows with depth; capped by shear and by bending", () => {
    const profile = buildPileProfile(s, pile)!;
    const shallow = pileForce(s, pile, 20, 1, profile);
    const deep = pileForce(s, pile, 20, -4, profile);
    expect(shallow.governs).toBe("soil");
    expect(deep.perPile).toBeGreaterThan(shallow.perPile);
    expect(deep.perMetre).toBeCloseTo(deep.perPile / 2, 12);
    const shear = pileForce(s, { ...pile, shearCapacity: 10 }, 20, -4, profile);
    expect(shear).toMatchObject({ perPile: 10, governs: "shear" });
    const bending = pileForce(s, { ...pile, momentCapacity: 5 }, 20, -4, profile);
    expect(bending.governs).toBe("bending");
    expect(bending.perPile).toBeLessThan(deep.perPile);
    // Above the pile head: nothing.
    expect(pileForce(s, { ...pile, y1: -2 }, 20, -1).perPile).toBe(0);
  });

  it("design strength lowers the pressure; strong rock gives none; a given force needs no profile", () => {
    const f = slopeOf();
    f.updateAnalysisOptions({ partialFactors: { cu: 1.4, cohesion: 1.25, tanPhi: 1.25, variableLoad: 1 } });
    expect(pileForce(f, pile, 20, -4).perPile).toBeLessThan(pileForce(s, pile, 20, -4).perPile);
    const clay = slopeOf({ kind: "undrained", unitWeight: 18, undrainedShearStrength: 30 });
    clay.updateAnalysisOptions({ partialFactors: { cu: 1.4, cohesion: 1, tanPhi: 1, variableLoad: 1 } });
    expect(pileForce(clay, pile, 20, -4).perPile).toBeLessThan(pileForce(slopeOf({ kind: "undrained", unitWeight: 18, undrainedShearStrength: 30 }), pile, 20, -4).perPile);
    const rock = slopeOf({ kind: "high-strength", unitWeight: 25 });
    expect(pileForce(rock, pile, 20, -4).perPile).toBe(0);
    expect(buildPileProfile(s, { ...pile, force: 40 })).toBeNull();
    expect(buildPileProfile(s, { ...pile, x1: 60, x2: 60 })).toBeNull();
    expect(pileForce(s, { ...pile, force: 40 }, 20, -4)).toMatchObject({ perPile: 40, perMetre: 20, governs: "given" });
  });

  it("force directions: angle, tangent, perpendicular (opposing the movement)", () => {
    const [ax, ay] = pileForceDirection({ ...pile, angle: 30 }, 0.8, -0.6);
    expect(ax).toBeCloseTo(-Math.cos(Math.PI / 6), 12);
    expect(ay).toBeCloseTo(0.5, 12);
    expect(pileForceDirection({ ...pile, direction: "tangent" }, 0.8, -0.6)).toEqual([-0.8, 0.6]);
    const [px, py] = pileForceDirection({ ...pile, direction: "perpendicular" }, 0.8, -0.6);
    expect(px * 0.8 + py * -0.6).toBeLessThan(0);
    expect(Math.abs(py)).toBeLessThan(1e-12);
    // A pile of no length: falls back to the angle.
    expect(pileForceDirection({ ...pile, x2: 20, y2: 3.33, direction: "perpendicular" }, 1, 0)[0]).toBeCloseTo(-1, 12);
    // Movement perpendicular to the normal: the normal pointing to +x is flipped.
    const [qx] = pileForceDirection({ ...pile, direction: "perpendicular" }, 0, -1);
    expect(qx).toBeLessThan(0);
  });
});

describe("degenerate elements", () => {
  it("no slices, a pile of no length and a pile beside the surface give no forces", () => {
    const s = slopeOf();
    s.setReinforcements([nail]);
    expect(applyReinforcement(s, [], 22, 18)).toEqual([]);
    s.setReinforcements([]);
    s.setPiles([{ x1: 20, y1: 0, x2: 20, y2: 0, force: 50 }, { x1: 38, y1: 0, x2: 38, y2: -8, force: 50 }]);
    s.updateAnalysisOptions({ slices: 20 });
    const ints = s.getCircleExternalIntersection(22, 18, 18.5);
    const slices = getSlices(s, ints[0][0], ints[ints.length - 1][0], 22, 18, 18.5);
    expect(slices.flatMap((q) => q.reinforcementForces ?? [])).toEqual([]);
  });
});
