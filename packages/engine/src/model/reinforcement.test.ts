/**
 * Reinforcement: capacity envelope, force direction and application,
 * against closed-form solutions and FHWA's published pullout tables. The
 * Slide2 / SLOPE/W problems are in verification/reinforcement-cases.ts.
 */
import { describe, it, expect } from "vitest";
import { layered, mc, runVerification } from "../verification/cases";
import { FHWA_PULLOUT_TABLES } from "../verification/pullout-tables";
import { buildSlope } from "./build-slope";
import { Material } from "../types/material";
import { buildEnvelope, effectiveVerticalStress, envelopeAt, pulloutBeyond } from "./reinforcement";
import type { Reinforcement } from "../types/reinforcement";
import type { SlopeDefinition } from "../types/slope-definition";

// Homogeneous 10 m slope on Baker's 49.6° plane from the toe (VP43): a
// rigid block, so every method gives the closed-form block solution.
const W = 600; // kN/m: 30 m² × 20 kN/m³
const PSI = Math.atan2(10, 8.5);
const L = Math.hypot(8.5, 10);
const CL = 30 * L;
const TAN = Math.tan((30 * Math.PI) / 180);
const block = (reinforcements: Reinforcement[]): SlopeDefinition =>
  layered([[-5, 0], [0, 0], [2.5, 10], [20, 10]], -5, [{ name: "Soil", topY: null, model: mc(30, 30, 20) }], {
    orientation: "rtl",
    customSurfaces: [{ points: [[0, 0], [8.5, 10]] }],
    customPlanesOnly: true,
    reinforcements,
  });
// Horizontal anchor at mid-height, crossing the plane, 100 kN/m.
const anchor = (extra: Partial<Reinforcement> = {}): Reinforcement => ({
  x1: 1.25, y1: 5, x2: 15, y2: 5, tensileCapacity: 100, ...extra,
});
// Spencer returns the moment FOS where it meets the force FOS within the
// solver tolerance (0.005).
const methods = [
  ["Janbu", {}, 3],
  ["Morgenstern-Price", { intersliceFunction: "constant" as const }, 2],
] as const;

describe("Reinforcement on a rigid block", () => {
  it("active axial force: F = (cL + (W cos ψ + T sin ψ) tan φ) / (W sin ψ − T cos ψ)", () => {
    const T = 100;
    const exact = (CL + (W * Math.cos(PSI) + T * Math.sin(PSI)) * TAN) / (W * Math.sin(PSI) - T * Math.cos(PSI));
    for (const [m, o, digits] of methods) {
      expect(runVerification(block([anchor()]), m, o).fos!).toBeCloseTo(exact, digits);
    }
  });

  it("passive force is divided by F", () => {
    // F·(W sin ψ) − T cos ψ = cL + W cos ψ tan φ + (T/F) sin ψ tan φ
    const T = 100;
    const a = W * Math.sin(PSI);
    const b = -(T * Math.cos(PSI) + CL + W * Math.cos(PSI) * TAN);
    const c = -T * Math.sin(PSI) * TAN;
    const exact = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
    for (const [m, o, digits] of methods) {
      expect(runVerification(block([anchor({ application: "passive" })]), m, o).fos!).toBeCloseTo(exact, digits);
    }
  });

  it("tangent force acts along the slip surface", () => {
    const exact = (CL + W * Math.cos(PSI) * TAN) / (W * Math.sin(PSI) - 100);
    for (const [m, o, digits] of methods) {
      expect(runVerification(block([anchor({ direction: "tangent" })]), m, o).fos!).toBeCloseTo(exact, digits);
    }
  });

  it("a passive force larger than the driving moment at F = 1 still gives F = (R + T) / D", () => {
    // Tangent, passive: F·W sin ψ − T = cL + W cos ψ tan φ.
    const T = 1500;
    const exact = (CL + W * Math.cos(PSI) * TAN + T) / (W * Math.sin(PSI));
    for (const [m, o, digits] of methods) {
      const def = block([anchor({ tensileCapacity: T, direction: "tangent", application: "passive" })]);
      expect(runVerification(def, m, o).fos!).toBeCloseTo(exact, digits);
    }
  });

  it("spacing divides the capacity; an element that misses the surface does nothing", () => {
    const plain = runVerification(block([]), "Janbu").fos!;
    const per2 = runVerification(block([anchor({ tensileCapacity: 200, spacing: 2 })]), "Janbu").fos!;
    expect(per2).toBeCloseTo(runVerification(block([anchor()]), "Janbu").fos!, 6);
    // Entirely inside the sliding mass.
    expect(runVerification(block([anchor({ x2: 3 })]), "Janbu").fos!).toBeCloseTo(plain, 6);
  });

  it("the movement pulls the element out of stable ground, never pushes it", () => {
    // The same anchor drawn the other way round acts the same.
    const a = runVerification(block([anchor()]), "Janbu").fos!;
    const b = runVerification(block([{ x1: 15, y1: 5, x2: 1.25, y2: 5, tensileCapacity: 100 }]), "Janbu").fos!;
    expect(b).toBeCloseTo(a, 6);
  });

  it("gives the same FOS mirrored", () => {
    const def = block([anchor({ application: "passive" })]);
    const mirror = (x: number) => 20 - x - 5;
    const m: SlopeDefinition = {
      ...def,
      orientation: "ltr",
      coordinates: def.coordinates.map(([x, y]) => [mirror(x), y] as [number, number]).reverse(),
      regionAssignments: def.regionAssignments!.map((r) => ({ ...r, point: [mirror(r.point[0]), r.point[1]] as [number, number] })),
      customSurfaces: [{ points: [[mirror(8.5), 10], [mirror(0), 0]] }],
      reinforcements: def.reinforcements!.map((r) => ({ ...r, x1: mirror(r.x1), x2: mirror(r.x2) })),
    };
    for (const [meth, o] of methods) {
      expect(runVerification(m, meth, o).fos!).toBeCloseTo(runVerification(def, meth, o).fos!, 6);
    }
  });
});

describe("Large active loads", () => {
  // 10 m vertical cut on a 60° plane with a 500 kN/m horizontal anchor:
  // high up, the Ordinary start value is so low that the driving side
  // vanished in the first iteration and the surface was dropped.
  const wall = (y: number) =>
    layered([[-5, 0], [0, 0], [0, 10], [20, 10]], -5, [{ name: "S", topY: null, model: mc(0, 30, 20) }], {
      orientation: "rtl",
      customSurfaces: [{ points: [[0, 0], [10 / Math.tan(Math.PI / 3), 10]] }],
      customPlanesOnly: true,
      reinforcements: [{ x1: 0, y1: y, x2: 15, y2: y, tensileCapacity: 500, application: "active" }],
    });
  it("force methods converge from a low start value, whatever the anchor height", () => {
    const high = runVerification(wall(9), "Janbu").fos;
    const low = runVerification(wall(10 / 3), "Janbu").fos;
    expect(high).not.toBeNull();
    expect(high!).toBeCloseTo(low!, 2);
    expect(runVerification(wall(9), "Morgenstern-Price", { intersliceFunction: "constant" }).fos!).toBeCloseTo(high!, 1);
  });
});

describe("Capacity envelope", () => {
  const slope = buildSlope(layered([[0, 10], [10, 10], [20, 0], [30, 0]], -10, [{ name: "S", topY: null, model: mc(0, 30, 20) }]));
  const line = { x1: 0, y1: 5, x2: 10, y2: 5, tensileCapacity: 100 };

  it("fully anchored without pullout", () => {
    const env = buildEnvelope(slope, line);
    for (const s of [0, 3, 10]) expect(envelopeAt(env, s)).toBe(100);
  });

  it("bond with a plate and a bonded length (tieback)", () => {
    // Bond 20 kN/m over the last 4 m, plate 60 kN at the head.
    const env = buildEnvelope(slope, { ...line, end1Capacity: 60, pullout: { kind: "bond", strength: 20, bondedLength: 4 } });
    expect(envelopeAt(env, 2)).toBeCloseTo(60, 9); // free length: min(100, 60 + 0, 80)
    expect(envelopeAt(env, 7)).toBeCloseTo(60, 9); // min(100, 60 + 20, 60)
    expect(envelopeAt(env, 9)).toBeCloseTo(20, 9); // min(100, 60 + 60, 20)
    expect(pulloutBeyond(env, 2)).toBeCloseTo(80, 9);
  });

  it("development lengths, 0 = fully anchored end", () => {
    const env = buildEnvelope(slope, { ...line, pullout: { kind: "development", length1: 0, length2: 5 } });
    expect(envelopeAt(env, 0)).toBeCloseTo(100, 9);
    expect(envelopeAt(env, 8)).toBeCloseTo(40, 9);
  });

  it("interface friction from the overburden: r = 2σ′v tan δ", () => {
    // 5 m of soil above the line: σ′v = 100 kPa, r = 2·100·tan 20°.
    const env = buildEnvelope(slope, { ...line, tensileCapacity: 1e6, pullout: { kind: "interface", adhesion: 0, frictionAngle: 20 } });
    expect(pulloutBeyond(env, 6)).toBeCloseTo(2 * 100 * Math.tan((20 * Math.PI) / 180) * 4, 6);
  });

  it("no interface outside the soil", () => {
    const adhesion = { kind: "interface" as const, adhesion: 10, frictionAngle: 0 };
    const inside = buildEnvelope(slope, { ...line, x2: 15, tensileCapacity: 1e6, pullout: adhesion });
    const partlyInAir = buildEnvelope(slope, { ...line, x2: 25, tensileCapacity: 1e6, pullout: adhesion });
    expect(pulloutBeyond(partlyInAir, 0)).toBeCloseTo(pulloutBeyond(inside, 0), 6);
    expect(pulloutBeyond(inside, 0)).toBeCloseTo(2 * 10 * 15, 6);
  });

  it("ponded water weighs on the overburden", () => {
    // Flat ground at 10, pond to 12: σ′v at depth 5 = 100 + 2·γw − 7·γw.
    const def = layered([[0, 10], [40, 10]], -10, [{ name: "S", topY: null, model: mc(0, 30, 20) }], {
      waterTable: { mode: "custom", value: [[0, 12], [40, 12]], followBoundary: false },
    });
    expect(effectiveVerticalStress(buildSlope(def), 20, 5)).toBeCloseTo(100 - 5 * 9.81, 6);
  });

  it("follows changes of the materials (σ′v)", () => {
    const def = layered([[0, 10], [10, 10], [20, 0], [30, 0]], -10, [{ name: "S", topY: null, model: mc(0, 30, 20) }]);
    const s2 = buildSlope(def);
    s2.setReinforcements([{ ...line, tensileCapacity: 1e6, pullout: { kind: "interface", adhesion: 0, frictionAngle: 20 } }]);
    const before = pulloutBeyond(s2.reinforcementEnvelopes[0], 6);
    // Half the unit weight: half the overburden and pullout.
    s2.assignMaterial([5, 5], new Material({ name: "Light", unitWeight: 10, frictionAngle: 30, cohesion: 0 }));
    expect(pulloutBeyond(s2.reinforcementEnvelopes[0], 6)).toBeCloseTo(before / 2, 6);
  });

  it("rejects invalid input", () => {
    expect(() => slope.setReinforcements([{ ...line, tensileCapacity: -1 }])).toThrow();
    expect(() => slope.setReinforcements([{ ...line, spacing: 0 }])).toThrow();
    expect(() => slope.setReinforcements([{ ...line, pullout: { kind: "bond", strength: -2 } }])).toThrow();
    expect(() => slope.setReinforcements([{ ...line, pullout: { kind: "interface", adhesion: 0, frictionAngle: 95 } }])).toThrow();
  });
});

describe("FHWA pullout tables (FHWA-NHI-10-025, Appendix E)", () => {
  for (const table of FHWA_PULLOUT_TABLES) {
    it(`${table.id} ${table.title}`, () => {
      const slope = buildSlope(table.definition);
      const envs = slope.reinforcementEnvelopes;
      expect(envs.length).toBe(table.layers.length);
      slope.reinforcements.forEach((r, i) => {
        const [x, pullout, capacity] = table.layers[i];
        const t = Math.max(0, Math.min(1, (x - r.x1) / (r.x2 - r.x1)));
        const s = t * envs[i].length;
        const spacing = r.spacing ?? 1;
        // E6 is the impact load case, 0.3 % from the table.
        expect(Math.abs(pulloutBeyond(envs[i], s) / spacing / pullout - 1)).toBeLessThan(0.003);
        expect(Math.abs(envelopeAt(envs[i], s) / spacing / capacity - 1)).toBeLessThan(0.003);
      });
    });
  }
});

describe("Vertical steps (walls) in the geometry and the water table", () => {
  it("a water table entered right to left keeps its vertical step", () => {
    const slope = buildSlope({
      ...layered([[0, 5], [10, 5], [10, 10], [20, 10]], -5, [{ name: "C", topY: null, model: mc(10, 0, 18) }]),
      waterTable: { mode: "custom", value: [[20, 8], [10, 8], [10, 5], [0, 5]], followBoundary: false },
    });
    const w = slope.waterRLXY!;
    const i = w.x.indexOf(10);
    expect(w.y[i]).toBe(5);
    expect(w.y[i + 1]).toBe(8);
  });
});
