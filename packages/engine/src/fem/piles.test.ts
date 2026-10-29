import { describe, it, expect } from "vitest";
import { buildSlope } from "../model/build-slope";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import type { SlopeDefinition } from "../types/slope-definition";
import { frameStiffness, springCapacity } from "./piles";
import { analyzeFem } from "./analysis";
import { buildFeModel } from "./model";

/** Solve a small dense system (Gaussian elimination). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length, a = A.map((r) => r.slice()), x = b.slice();
  for (let k = 0; k < n; k++) {
    for (let i = k + 1; i < n; i++) {
      const m = a[i][k] / a[k][k];
      for (let j = k; j < n; j++) a[i][j] -= m * a[k][j];
      x[i] -= m * x[k];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let j = i + 1; j < n; j++) s -= a[i][j] * x[j];
    x[i] = s / a[i][i];
  }
  return x;
}

describe("pile beams", () => {
  it("bend as an Euler–Bernoulli cantilever, at any inclination", () => {
    // a cantilever of 4 elements, fixed at node 0, load P across its tip
    const L = 8, n = 4, EI = 2e4, EA = 1e6, P = 10;
    for (const angle of [0, 30, 90]) {
      const c = Math.cos((angle * Math.PI) / 180), s = Math.sin((angle * Math.PI) / 180);
      const N = 3 * (n + 1), K = Array.from({ length: N }, () => new Array(N).fill(0));
      const k = new Float64Array(36);
      for (let e = 0; e < n; e++) {
        frameStiffness(c, s, L / n, EA, EI, k);
        for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) K[3 * e + i][3 * e + j] += k[6 * i + j];
      }
      const free = Array.from({ length: N - 3 }, (_, i) => i + 3);
      const Kf = free.map((i) => free.map((j) => K[i][j]));
      const f = new Array(N).fill(0);
      f[3 * n] = -s * P; f[3 * n + 1] = c * P; // perpendicular to the axis
      const u = solve(Kf, free.map((i) => f[i]));
      const tip = -s * u[3 * n - 3] + c * u[3 * n - 2]; // deflection across the axis
      expect(tip).toBeCloseTo((P * L ** 3) / (3 * EI), 9);
      expect(u[3 * n - 1]).toBeCloseTo((P * L ** 2) / (2 * EI), 9);
    }
  });

  it("limit the soil's pressure as Broms (net passive pressure), reduced with the strength", () => {
    const d = 0.6, c = 20, sv = 50, phi = (30 * Math.PI) / 180;
    const kp = (1 + Math.sin(phi)) / (1 - Math.sin(phi));
    expect(springCapacity(1, 9 * c * d, 3 * sv * d, Math.tan(phi), 1)).toBeCloseTo(9 * c * d + 3 * (kp - 1 / kp) * sv * d, 9);
    const phiF = Math.atan(Math.tan(phi) / 2), kpF = (1 + Math.sin(phiF)) / (1 - Math.sin(phiF));
    expect(springCapacity(1, 9 * c * d, 3 * sv * d, Math.tan(phi), 2)).toBeCloseTo((9 * c * d) / 2 + 3 * (kpF - 1 / kpF) * sv * d, 9);
    // undrained (φ = 0): Broms' 9 c d alone; the support vanishes with the strength
    expect(springCapacity(1, 9 * c * d, 3 * sv * d, 0, 1)).toBeCloseTo(9 * c * d, 9);
    expect(springCapacity(1, 9 * c * d, 3 * sv * d, Math.tan(phi), 1e6)).toBeLessThan(1e-3);
  });
});

describe("pile rows in the strength reduction", () => {
  const def = (piles: object[]) =>
    ({
      coordinates: [[0, 0], [0, 15], [15, 15], [30, 5], [50, 5], [50, 0]],
      materials: [{ name: "soil", model: { kind: "mohr-coulomb", unitWeight: 19, cohesion: 8, frictionAngle: 25 } }],
      piles,
    }) as unknown as SlopeDefinition;
  const row = (extra: object = {}) => ({ x1: 22, y1: 15 - (7 * 10) / 15, x2: 22, y2: 0.5, diameter: 0.6, spacing: 2, application: "passive", ...extra });
  const run = (piles: object[], solver: "newton" | "viscoplastic") =>
    analyzeFem(buildSlope(toCanonicalSlopeDefinition(def(piles))), { flowRule: "associated", solver, elementSize: 1.25, fTolerance: 0.01 });

  it("raise the factor of safety, with both solvers alike, and report their forces", () => {
    const plain = run([], "newton").factorOfSafety;
    const newton = run([row()], "newton"), vp = run([row()], "viscoplastic");
    expect(newton.factorOfSafety).toBeGreaterThan(plain + 0.1);
    expect(Math.abs(newton.factorOfSafety - vp.factorOfSafety)).toBeLessThan(0.03);
    expect(newton.piles).toHaveLength(1);
    expect(newton.piles[0].maxMoment).toBeGreaterThan(0);
    expect(newton.piles[0].maxShearForce).toBeGreaterThan(0);
  }, 300000);

  it("warn where the forces exceed the pile's capacity, and leave out a pile without a diameter", () => {
    const r = run([row({ momentCapacity: 10 })], "newton");
    expect(r.warnings.some((w) => /Pile 1: the bending moment/.test(w))).toBe(true);
    const m = buildFeModel(buildSlope(toCanonicalSlopeDefinition(def([{ ...row(), diameter: undefined, force: 100 }]))), { elementSize: 2 });
    expect(m.piles.count).toBe(0);
    expect(m.warnings.some((w) => /no diameter/.test(w))).toBe(true);
  }, 300000);

  it("keep the mesh of the construction stages that of the final model", async () => {
    const { prepareFeModel } = await import("./initial-stress");
    const slope = buildSlope(toCanonicalSlopeDefinition({
      ...def([row()]),
      materials: [
        { name: "found", model: { kind: "mohr-coulomb", unitWeight: 19, cohesion: 8, frictionAngle: 25 } },
        { name: "fill", model: { kind: "mohr-coulomb", unitWeight: 19, cohesion: 8, frictionAngle: 25 } },
      ],
      materialBoundaries: [{ coordinates: [[0, 8], [50, 8]], materialName: "found" }],
      regionAssignments: [{ point: [40, 3], materialName: "found" }, { point: [5, 12], materialName: "fill" }],
    } as unknown as SlopeDefinition));
    const { model } = prepareFeModel(slope, { elementSize: 1.5, materialStages: { fill: 1 } }, { flowRule: "associated" });
    expect(model.stress0!.length).toBe(12 * model.elementCount);
    expect(model.f.every(Number.isFinite)).toBe(true);
    expect(model.piles.count).toBeGreaterThan(0);
  }, 300000);
});
