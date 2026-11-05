import { describe, it, expect } from "vitest";
import { buildSlope } from "./build-slope";
import { toCanonicalSlopeDefinition } from "./canonical";
import { analyseSlope } from "./solvers";
import { sgi3dFactorOfSafety } from "./sgi3d";
import { DEFAULT_ANALYSIS_OPTIONS } from "../types/analysis";
import type { SlopeDefinition } from "../types/slope-definition";

// A 1:2 cut in clay (crust over clay) with a strip load behind its crest.
const GAMMA = 18, CU_CRUST = 25, CU_CLAY = 15, Q = 20;
const ground = (x: number) => (x <= 6 ? 0 : x >= 14 ? -4 : -(x - 6) / 2);
const cut = (rtl = false): SlopeDefinition => {
  const m = (x: number) => (rtl ? 20 - x : x);
  const pts: [number, number][] = [[0, -12], [0, 0], [6, 0], [14, -4], [20, -4], [20, -12]].map(([x, y]) => [m(x), y]);
  return {
    orientation: rtl ? "rtl" : "ltr",
    coordinates: rtl ? pts.reverse() : pts,
    materials: [
      { name: "crust", model: { kind: "undrained", unitWeight: GAMMA, undrainedShearStrength: CU_CRUST } },
      { name: "clay", model: { kind: "undrained", unitWeight: GAMMA, undrainedShearStrength: CU_CLAY } },
    ],
    materialBoundaries: [{ coordinates: [[m(-0.05), -1], [m(8.05), -1]], materialName: "" }],
    regionAssignments: [{ point: [m(3), -0.5], materialName: "crust" }, { point: [m(10), -8], materialName: "clay" }],
    udls: [{ magnitude: Q, x1: Math.min(m(1), m(5)), x2: Math.max(m(1), m(5)) }],
  } as unknown as SlopeDefinition;
};
const analysed = (def: SlopeDefinition) => {
  const s = buildSlope(toCanonicalSlopeDefinition(def));
  s.updateAnalysisOptions({ ...DEFAULT_ANALYSIS_OPTIONS, method: "Morgenstern-Price", slices: 30, iterations: 300, refinedIterations: 150 });
  analyseSlope(s);
  return s;
};

// Polar quadrature over the circle's part below the ground (model space, ltr):
// end face area and ∫ c_u r dA (with or without the crust), and M_E
function byQuadrature(cx: number, cy: number, R: number, withCrust: boolean) {
  let area = 0, mc = 0, me = 0;
  const nr = 600, nt = 1800;
  for (let i = 0; i < nr; i++) {
    const r = ((i + 0.5) / nr) * R;
    for (let j = 0; j < nt; j++) {
      const t = ((j + 0.5) / nt) * 2 * Math.PI, x = cx + r * Math.cos(t), y = cy + r * Math.sin(t);
      if (x < 0 || x > 20 || y >= ground(x) || y < -12) continue;
      const dA = r * (R / nr) * ((2 * Math.PI) / nt);
      me += GAMMA * (x - cx) * dA;
      const crust = y > -1 && x < 8;
      if (crust && !withCrust) continue;
      area += dA; mc += (crust ? CU_CRUST : CU_CLAY) * r * dA;
    }
  }
  // the load on 1 ≤ x ≤ 5 where the circle passes below the ground
  for (let k = 0; k < 4000; k++) {
    const x = 1 + ((k + 0.5) / 4000) * 4, dx = x - cx;
    if (dx * dx < R * R && cy - Math.sqrt(R * R - dx * dx) < 0) me += Q * (4 / 4000) * dx;
  }
  return { area, mc, me: Math.abs(me) };
}

describe("sgi3dFactorOfSafety", () => {
  it("integrates the end faces and the driving moment, and applies eq. 2-2 and 2-3", () => {
    const s = analysed(cut());
    const r = sgi3dFactorOfSafety(s, { length: 10, cellSize: 0.025 })!;
    const c = r.critical;
    const ref = byQuadrature(c.cx, c.cy, c.radius, true);
    expect(c.endFaceArea / ref.area).toBeCloseTo(1, 2);
    expect(c.endFaceMoment / ref.mc).toBeCloseTo(1, 2);
    expect(c.drivingMoment / ref.me).toBeCloseTo(1, 2);
    expect(c.fp).toBeCloseTo(c.f2d + (2 * c.endFaceMoment) / (10 * c.drivingMoment), 12);
    expect(r.factorOfSafety).toBeCloseTo(c.f2d + 0.75 * (c.fp - c.f2d), 12);
    expect(r.factorOfSafety).toBeGreaterThan(r.f2dCritical);
    expect(r.equation).toBe("2-3");
  }, 120000);

  it("gives the same for the slope facing left, its circle in model space", () => {
    const a = sgi3dFactorOfSafety(analysed(cut()), { length: 10 })!;
    const b = sgi3dFactorOfSafety(analysed(cut(true)), { length: 10 })!;
    expect(b.factorOfSafety).toBeCloseTo(a.factorOfSafety, 6);
    expect(b.critical.cx).toBeCloseTo(20 - a.critical.cx, 6);
  }, 120000);

  it("takes finite overstrong adjacent stability by eq. 2-4, excluded materials out of the end faces, and a shorter stretch up", () => {
    const s = analysed(cut());
    const inf = sgi3dFactorOfSafety(s, { length: 10 })!;
    // k = 1 − F2D,krit,min / F2D,överstark,min = 0.5: half the 3D gain on each surface
    const fin = sgi3dFactorOfSafety(s, { length: 10, overstrongF2D: 2 * inf.f2dCritical })!;
    expect(fin.equation).toBe("2-4");
    expect(fin.factorOfSafety).toBeLessThan(inf.factorOfSafety);
    const fc = fin.critical;
    expect(fin.factorOfSafety).toBeCloseTo(fc.f2d + 0.5 * 0.75 * (fc.fp - fc.f2d), 12);
    // an overstrong stretch no stronger than the critical one: no 3D effect
    expect(sgi3dFactorOfSafety(s, { length: 10, overstrongF2D: inf.f2dCritical })!.factorOfSafety).toBeCloseTo(inf.f2dCritical, 12);
    const noCrust = sgi3dFactorOfSafety(s, { length: 10, excludeMaterials: ["crust"], cellSize: 0.025 })!;
    expect(noCrust.factorOfSafety).toBeLessThan(inf.factorOfSafety);
    const c = noCrust.critical, ref = byQuadrature(c.cx, c.cy, c.radius, false);
    expect(c.endFaceMoment / ref.mc).toBeCloseTo(1, 2);
    expect(sgi3dFactorOfSafety(s, { length: 5 })!.factorOfSafety).toBeGreaterThan(inf.factorOfSafety);
  }, 120000);

  it("takes the sliding mass between entry and exit, not where the circle dips into the far slope", () => {
    // a trench with a steep far side: this circle leaves the ground at the trench bottom (x ≈ 9.98)
    // and runs below the far slope again for 10.08 < x < 10.44
    const g = (x: number) => (x <= 6 ? 0 : x <= 8 ? -(x - 6) * 1.5 : x <= 10 ? -3 : x <= 11 ? -3 + (x - 10) * 3 : 0);
    const def = {
      orientation: "ltr",
      coordinates: [[-20, -14], [-20, 0], [6, 0], [8, -3], [10, -3], [11, 0], [20, 0], [20, -14]],
      materials: [{ name: "clay", model: { kind: "undrained", unitWeight: GAMMA, undrainedShearStrength: CU_CLAY } }],
      regionAssignments: [{ point: [0, -10], materialName: "clay" }],
      udls: [],
      customSearchPlanes: [{ cx: 0.6, cy: 1.0, radius: 10.2 }],
      customPlanesOnly: true,
    } as unknown as SlopeDefinition;
    const s = analysed(def);
    const plane = s.search.find((p) => p.fos != null)!;
    expect(plane.rc[0]).toBeLessThan(10.05);
    const r = sgi3dFactorOfSafety(s, { length: 10, cellSize: 0.025 })!;
    // quadrature over x between entry and exit only
    let area = 0;
    const R = 10.2, nr = 600, nt = 1800;
    for (let i = 0; i < nr; i++) {
      const rr = ((i + 0.5) / nr) * R;
      for (let j = 0; j < nt; j++) {
        const t = ((j + 0.5) / nt) * 2 * Math.PI, x = 0.6 + rr * Math.cos(t), y = 1 + rr * Math.sin(t);
        if (x < plane.lc[0] || x > plane.rc[0] || y >= g(x)) continue;
        area += rr * (R / nr) * ((2 * Math.PI) / nt);
      }
    }
    expect(r.critical.endFaceArea / area).toBeCloseTo(1, 2);
  }, 120000);

  it("rejects a bad length or overstrong F2D", () => {
    const s = analysed(cut());
    expect(() => sgi3dFactorOfSafety(s, { length: 0 })).toThrow(/length/);
    expect(() => sgi3dFactorOfSafety(s, { length: 10, overstrongF2D: -1 })).toThrow(/overstrong/);
  }, 120000);
});
