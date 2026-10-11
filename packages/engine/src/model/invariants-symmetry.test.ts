/**
 * Property-based invariants: mirror symmetry, translation and unit
 * consistency. Each test draws a few dozen random models from a fixed
 * seed (see property-helpers.ts), so failures are reproducible: the
 * message names the seed and case index.
 */
import { describe, it, expect } from "vitest";
import {
  rng,
  uniform,
  randomCase,
  onCircle,
  fosOf,
  mirrorDefinition,
  transformDefinition,
  relDiff,
  type Method,
  decorate,
} from "./property-helpers";

const METHODS: Method[] = ["Ordinary", "Bishop", "Janbu", "Morgenstern-Price"];

const FEATURE_SETS: string[][] = [
  [],
  ["water"],
  ["udl", "lineLoad"],
  ["nail"],
  ["pile"],
  ["water", "udl", "nail", "pile"],
];

describe("mirror symmetry", () => {
  it("a model and its mirror image give the same FOS for every method", () => {
    const r = rng(20261011);
    let compared = 0;
    for (let i = 0; i < 24; i++) {
      const g = randomCase(r);
      const features = new Set(FEATURE_SETS[i % FEATURE_SETS.length]);
      const def = onCircle(decorate(r, g, features), g.circle);
      // Mirror about an arbitrary axis, so the mirrored domain differs.
      const mirrored = mirrorDefinition(def, uniform(r, -50, 80));
      const crack = i % 4 === 3 ? { tensionCrackDepth: g.shape.H * 0.2, tensionCrackWater: 0.5 } : {};
      for (const method of METHODS) {
        const a = fosOf(def, method, crack);
        const b = fosOf(mirrored, method, crack);
        const label = `seed 20261011 case ${i} ${method} [${[...features].join(",")}]`;
        expect(b === null, label).toBe(a === null);
        if (a !== null && b !== null) {
          expect(relDiff(a, b), `${label}: ${a} vs ${b}`).toBeLessThan(1e-6);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(60);
  }, 30_000);

  it("piles and nails act against the sliding direction in both orientations", () => {
    // Reinforcement must raise the FOS of the mirrored model by the same
    // amount as of the original one.
    const r = rng(7);
    for (let i = 0; i < 8; i++) {
      const g = randomCase(r, { layers: 1 });
      const plain = onCircle(g.def, g.circle);
      const reinforced = onCircle(decorate(r, g, new Set(["nail", "pile"])), g.circle);
      const axis = uniform(r, 0, 40);
      for (const method of ["Bishop", "Morgenstern-Price"] as Method[]) {
        const gain = fosOf(reinforced, method)! - fosOf(plain, method)!;
        const gainMirrored =
          fosOf(mirrorDefinition(reinforced, axis), method)! - fosOf(mirrorDefinition(plain, axis), method)!;
        expect(gainMirrored, `case ${i} ${method}`).toBeCloseTo(gain, 6);
      }
    }
  }, 30_000);
});

describe("translation invariance", () => {
  it("shifting all coordinates leaves the FOS unchanged", () => {
    const r = rng(424242);
    for (let i = 0; i < 18; i++) {
      const g = randomCase(r);
      const features = new Set(FEATURE_SETS[i % FEATURE_SETS.length].filter((f) => f !== "pile"));
      const def = onCircle(decorate(r, g, features), g.circle);
      // Real-world eastings and elevations.
      const shift = { dx: uniform(r, -1e5, 6.5e6), dy: uniform(r, -200, 3000) };
      const moved = transformDefinition(def, shift);
      for (const method of METHODS) {
        const a = fosOf(def, method);
        const b = fosOf(moved, method);
        const label = `seed 424242 case ${i} ${method} dx ${shift.dx} dy ${shift.dy}`;
        expect(b === null, label).toBe(a === null);
        if (a !== null && b !== null) expect(relDiff(a, b), `${label}: ${a} vs ${b}`).toBeLessThan(1e-5);
      }
    }
  }, 30_000);
});

describe("unit consistency", () => {
  it("scaling lengths by k and stresses by s (γ by s/k) leaves the FOS unchanged", () => {
    const r = rng(99);
    for (let i = 0; i < 18; i++) {
      const g = randomCase(r);
      const features = new Set(i % 2 === 0 ? ["udl", "lineLoad"] : []);
      const def = onCircle(decorate(r, g, features), g.circle);
      const k = uniform(r, 0.3, 3);
      const s = uniform(r, 0.2, 5);
      const scaled = transformDefinition(def, { k, s });
      for (const method of METHODS) {
        const a = fosOf(def, method);
        const b = fosOf(scaled, method);
        const label = `seed 99 case ${i} ${method} k ${k} s ${s}`;
        expect(b === null, label).toBe(a === null);
        // Line loads get a thin slice of fixed width (0.02 m), which does
        // not scale; everything else is exact.
        if (a !== null && b !== null) expect(relDiff(a, b), `${label}: ${a} vs ${b}`).toBeLessThan(2e-3);
      }
    }
  }, 30_000);

  it("with water (γw fixed) scaling lengths and stresses by the same k leaves the FOS unchanged", () => {
    const r = rng(1234);
    for (let i = 0; i < 12; i++) {
      const g = randomCase(r, { water: true });
      const def = onCircle(g.def, g.circle);
      const k = uniform(r, 0.3, 3);
      const scaled = transformDefinition(def, { k, s: k });
      for (const method of METHODS) {
        const a = fosOf(def, method);
        const b = fosOf(scaled, method);
        const label = `seed 1234 case ${i} ${method} k ${k}`;
        expect(b === null, label).toBe(a === null);
        if (a !== null && b !== null) expect(relDiff(a, b), `${label}: ${a} vs ${b}`).toBeLessThan(1e-5);
      }
    }
  }, 30_000);

  it("the FOS depends on c and γ only through c/(γH) (φ fixed)", () => {
    const r = rng(5);
    for (let i = 0; i < 12; i++) {
      const g = randomCase(r, { layers: 1 });
      const def = onCircle(g.def, g.circle);
      // Same c/γ: c and γ both ×s, geometry unchanged.
      const s = uniform(r, 0.3, 4);
      const same = transformDefinition(def, { k: 1, s });
      for (const method of METHODS) {
        expect(relDiff(fosOf(def, method)!, fosOf(same, method)!), `case ${i} ${method}`).toBeLessThan(1e-6);
      }
    }
  }, 30_000);
});
