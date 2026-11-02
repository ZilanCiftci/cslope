import { describe, it, expect } from "vitest";
import { hoekBrownOf, hoekBrownParameters, instantaneousAtNormalStress, instantaneousAtSigma3 } from "./hoek-brown";
import { validateMaterialModel } from "./validation";
import { buildSlope } from "../model/build-slope";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import { analyseSlope, solvedEffectiveNormals } from "../model/solvers";
import { analyzeFem } from "../fem/analysis";
import type { SlopeDefinition } from "./slope-definition";

describe("generalised Hoek–Brown", () => {
  it("gives the parameters of Hoek et al. (2002): intact rock at GSI 100", () => {
    const p = hoekBrownParameters(50000, 100, 12, 0);
    expect(p.mb).toBeCloseTo(12, 12);
    expect(p.s).toBeCloseTo(1, 12);
    expect(p.a).toBeCloseTo(0.5, 12);
    const q = hoekBrownParameters(50000, 25, 12, 0.5);
    expect(q.mb).toBeCloseTo(12 * Math.exp(-75 / 21), 12);
    expect(q.s).toBeCloseTo(Math.exp(-75 / 7.5), 12);
    expect(q.a).toBeCloseTo(0.5 + (Math.exp(-25 / 15) - Math.exp(-20 / 3)) / 6, 12);
  });

  it("has instantaneous parameters tangent to the Mohr circle of the envelope", () => {
    const p = hoekBrownParameters(20000, 40, 15, 0.3);
    for (const s3 of [0, 50, 300, 2000]) {
      const base = (p.mb * s3) / p.ucs + p.s, s1 = s3 + p.ucs * base ** p.a;
      const { cohesion: c, frictionAngle } = instantaneousAtSigma3(p, s3);
      const phi = (frictionAngle * Math.PI) / 180;
      // the line τ = c + σn tan φ touches the circle of (σ1, σ3): distance from its centre = radius
      const centre = (s1 + s3) / 2, radius = (s1 - s3) / 2;
      expect((c + centre * Math.tan(phi)) * Math.cos(phi)).toBeCloseTo(radius, 6);
      // and the normal-stress form inverts it
      const sn = centre - radius * Math.sin(phi);
      const back = instantaneousAtNormalStress(p, sn);
      expect(back.frictionAngle).toBeCloseTo(frictionAngle, 6);
      expect(back.cohesion).toBeCloseTo(c, 4);
    }
    // the friction angle falls with the stress (a curved envelope)
    expect(instantaneousAtNormalStress(p, 50).frictionAngle).toBeGreaterThan(instantaneousAtNormalStress(p, 1000).frictionAngle);
  });
});

describe("Hoek–Brown parameters given directly", () => {
  it("uses mb, s and a when given (a = 0.5 by default), else those from GSI, mi and D", () => {
    const base = { ucs: 20000, gsi: 20, mi: 10, disturbance: 1 };
    expect(hoekBrownOf(base)).toEqual(hoekBrownParameters(20000, 20, 10, 1));
    expect(hoekBrownOf({ ...base, mb: 0.045, s: 1e-6 })).toEqual({ ucs: 20000, mb: 0.045, s: 1e-6, a: 0.5 });
    // The format's example with the original criterion: τ at σn = 44.6 kPa
    // from c and φ there.
    const i = instantaneousAtNormalStress(hoekBrownOf({ ...base, mb: 0.045, s: 1e-6, a: 0.5 }), 44.6);
    expect(i.cohesion + 44.6 * Math.tan((i.frictionAngle * Math.PI) / 180)).toBeCloseTo(52.28, 1);
  });

  it("validates them instead of GSI and mi", () => {
    const m = { kind: "hoek-brown", unitWeight: 20, ucs: 20000, gsi: 100, mi: 1 } as const;
    expect(validateMaterialModel({ ...m, mb: 0.045, s: 1e-6 })).toEqual([]);
    expect(validateMaterialModel({ ...m, mb: -1, s: 2 }).join(" ")).toMatch(/mb must be > 0.*s must be between 0 and 1/);
  });
});

describe("Hoek–Brown slopes", () => {
  const H = 20, w = H / Math.tan(Math.PI / 3);
  const def = {
    coordinates: [[0, 0], [0, H + 10], [20, H + 10], [20 + w, 10], [60, 10], [60, 0]],
    materials: [{ name: "rock", model: { kind: "hoek-brown", unitWeight: 25, ucs: 10000, gsi: 20, mi: 10 } }],
  } as unknown as SlopeDefinition;

  it("use on each slice the instantaneous strength at its solved normal stress", () => {
    const slope = buildSlope(toCanonicalSlopeDefinition(def));
    slope.updateAnalysisOptions({ method: "Bishop" });
    const fos = analyseSlope(slope)!;
    expect(fos).toBeGreaterThan(1);
    // the critical surface (the search results are sorted by F)
    const slices = slope.search.find((p) => p.fos != null)!.slices!;
    const normals = solvedEffectiveNormals(slope, slices, fos)!;
    for (let i = 0; i < slices.length; i++) {
      const s = slices[i], inst = instantaneousAtNormalStress(s.hoekBrown!, normals[i] / s.baseLength);
      expect(s.frictionAngle).toBeCloseTo(inst.frictionAngle, 1);
    }
  }, 120000);

  it("give the finite element factor within 10 % of the limit equilibrium one", () => {
    const slope = buildSlope(toCanonicalSlopeDefinition(def));
    slope.updateAnalysisOptions({ method: "Morgenstern-Price" });
    const le = analyseSlope(slope)!;
    const fe = analyzeFem(buildSlope(toCanonicalSlopeDefinition(def)), { flowRule: "associated", elementSize: 1.5, fTolerance: 0.01 }).factorOfSafety;
    expect(Math.abs(fe - le) / le).toBeLessThan(0.1);
  }, 300000);
});
