import { describe, it, expect } from "vitest";
import { returnMap, returnMapInto } from "./newton";

const E = 1e5, nu = 0.3;
const lam = (E * nu) / ((1 + nu) * (1 - 2 * nu)), mu = E / (2 * (1 + nu));
const elastic = (e: number[]): [number, number, number, number] => {
  const tr = e[0] + e[1] + e[3];
  return [lam * tr + 2 * mu * e[0], lam * tr + 2 * mu * e[1], mu * e[2], lam * tr + 2 * mu * e[3]];
};
function principal(s: ArrayLike<number>): number[] {
  const pm = (s[0] + s[1]) / 2, r = Math.hypot((s[0] - s[1]) / 2, s[2]);
  return [pm + r, pm - r, s[3]].sort((a, b) => b - a);
}

/** A return to the apex of the pyramid: all three principal stresses equal. */
const atApex = (p: number[], c: number) => p[0] - p[2] < 1e-9 * c;
/** At the apex the tangent is 10⁻³ of the elastic one (newton.ts, APEX_STIFFNESS). */
function expectApexTangent(C: Float64Array): void {
  const el = [lam + 2 * mu, lam, 0, lam, lam, lam + 2 * mu, 0, lam, 0, 0, mu, 0, lam, lam, 0, lam + 2 * mu];
  for (let k = 0; k < 16; k++) expect(Math.abs(C[k] - 1e-3 * el[k])).toBeLessThan(1e-9 * E);
}

describe("returnMap", () => {
  it("returns to the yield surface with a symmetric tangent that matches finite differences", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let t = 0; t < 400; t++) {
      const phi = ([0, 20, 35, 45][t % 4] * Math.PI) / 180, c = 5 + 20 * rand(), cut = t % 3 === 0;
      const eps = [(rand() - 0.5) * 2e-3, (rand() - 0.5) * 2e-3, (rand() - 0.5) * 2e-3, 0];
      const C = new Float64Array(16);
      const r = returnMap(elastic(eps), E, nu, c, Math.sin(phi), Math.cos(phi), cut, C);
      const p = principal(r.stress);
      const f = (p[0] - p[2]) / 2 + ((p[0] + p[2]) / 2) * Math.sin(phi) - c * Math.cos(phi);
      expect(f).toBeLessThan(1e-9 * c);
      if (cut) expect(p[0]).toBeLessThan(1e-9 * c);
      if (!r.plastic) continue;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) expect(Math.abs(C[4 * i + j] - C[4 * j + i])).toBeLessThan(1e-9 * E);
      if (!cut && atApex(p, c)) { expectApexTangent(C); continue; }
      for (let j = 0; j < 3; j++) {
        const h = 1e-9, a = eps.slice(), b = eps.slice();
        a[j] += h; b[j] -= h;
        const sa = returnMap(elastic(a), E, nu, c, Math.sin(phi), Math.cos(phi), cut, new Float64Array(16)).stress;
        const sb = returnMap(elastic(b), E, nu, c, Math.sin(phi), Math.cos(phi), cut, new Float64Array(16)).stress;
        for (let i = 0; i < 3; i++) expect(Math.abs((sa[i] - sb[i]) / (2 * h) - C[4 * i + j])).toBeLessThan(1e-6 * E);
      }
    }
  });

  it("caps a combined material at its undrained strength, with a tangent that matches finite differences", () => {
    let seed = 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const phi = (30 * Math.PI) / 180, c = 5, cu = 12;
    let capped = 0;
    for (let t = 0; t < 300; t++) {
      const eps = [(rand() - 0.7) * 2e-3, (rand() - 0.7) * 2e-3, (rand() - 0.5) * 2e-3, 0];
      const C = new Float64Array(16);
      const r = returnMap(elastic(eps), E, nu, c, Math.sin(phi), Math.cos(phi), false, C, cu);
      const p = principal(r.stress);
      expect((p[0] - p[2]) / 2 - cu).toBeLessThan(1e-9 * cu);
      expect((p[0] - p[2]) / 2 + ((p[0] + p[2]) / 2) * Math.sin(phi) - c * Math.cos(phi)).toBeLessThan(1e-9 * c);
      if (Math.abs((p[0] - p[2]) / 2 - cu) < 1e-6) capped++;
      if (!r.plastic) continue;
      if (atApex(p, c)) { expectApexTangent(C); continue; }
      for (let j = 0; j < 3; j++) {
        const h = 1e-9, a = eps.slice(), b = eps.slice();
        a[j] += h; b[j] -= h;
        const sa = returnMap(elastic(a), E, nu, c, Math.sin(phi), Math.cos(phi), false, new Float64Array(16), cu).stress;
        const sb = returnMap(elastic(b), E, nu, c, Math.sin(phi), Math.cos(phi), false, new Float64Array(16), cu).stress;
        for (let i = 0; i < 3; i++) expect(Math.abs((sa[i] - sb[i]) / (2 * h) - C[4 * i + j])).toBeLessThan(1e-6 * E);
      }
    }
    expect(capped).toBeGreaterThan(10);
  });

  it("gives an unsymmetric tangent that matches finite differences for non-associated flow (ψ < φ)", () => {
    let seed = 5;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let unsymmetric = 0, apex = 0;
    for (let t = 0; t < 400; t++) {
      const phi = ([20, 30, 40][t % 3] * Math.PI) / 180, psi = ([0, 10][t % 2] * Math.PI) / 180;
      const c = 5 + 20 * rand(), cut = t % 4 === 0;
      const eps = [(rand() - 0.5) * 2e-3, (rand() - 0.5) * 2e-3, (rand() - 0.5) * 2e-3, 0];
      const ret = (e: number[], C: Float64Array | null) => {
        const s = elastic(e), out = new Float64Array(4);
        const plastic = returnMapInto(s[0], s[1], s[2], s[3], E, nu, c, Math.sin(phi), Math.cos(phi), cut, Infinity, out, C, Math.sin(psi));
        return { stress: out, plastic };
      };
      const C = new Float64Array(16);
      const r = ret(eps, C);
      const p = principal(r.stress);
      expect((p[0] - p[2]) / 2 + ((p[0] + p[2]) / 2) * Math.sin(phi) - c * Math.cos(phi)).toBeLessThan(1e-9 * c);
      if (!r.plastic) continue;
      if (Math.abs(C[1] - C[4]) > 1e-3 * E) unsymmetric++;
      if (Math.abs(p[0] - p[2]) < 1e-9 * c) { apex++; if (!cut) expectApexTangent(C); continue; }
      for (let j = 0; j < 3; j++) {
        const h = 1e-9, a = eps.slice(), b = eps.slice();
        a[j] += h; b[j] -= h;
        const sa = ret(a, null).stress, sb = ret(b, null).stress;
        for (let i = 0; i < 3; i++) expect(Math.abs((sa[i] - sb[i]) / (2 * h) - C[4 * i + j])).toBeLessThan(1e-6 * E);
      }
    }
    expect(unsymmetric).toBeGreaterThan(20);
    expect(apex).toBeGreaterThan(5);
  });

  it("returns a Tresca trial stress by half the excess of the shear stress", () => {
    // σ1 = 30, σ2 = 10, σ3 = 0 with c = 10, φ = 0: f = 5, return along (1, 0, −1)/2 → (25, 10, 5)
    const C = new Float64Array(16);
    const r = returnMap([30, 0, 0, 10], E, nu, 10, 0, 1, false, C);
    expect(r.stress[0]).toBeCloseTo(25, 9);
    expect(r.stress[1]).toBeCloseTo(5, 9);
    expect(r.stress[3]).toBeCloseTo(10, 9);
  });
});
