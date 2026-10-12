/**
 * Property-based invariants: mirror symmetry, translation and unit
 * consistency. Each test draws a few dozen random models from a fixed
 * seed (see property-helpers.ts), so failures are reproducible: the
 * message names the seed and case index.
 */
import { describe, it, expect } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import { toCanonicalSlopeDefinition, oppositeDirectionDefinition } from "./canonical";
import {
  rng,
  uniform,
  randomCase,
  onCircle,
  onPolyline,
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

describe("mirror symmetry: surfaces, water and strength given per point", () => {
  it("polyline surfaces, cracks, per-material water tables, spatial strength and asymmetric interslice points", () => {
    const r = rng(31);
    let compared = 0;
    for (let i = 0; i < 12; i++) {
      const g = randomCase(r, { layers: 2 });
      const { shape, circle } = g;
      // A three-segment polyline through the circle's entry, bottom and exit region.
      const xIn = circle.cx - Math.sqrt(circle.radius ** 2 - (shape.H - circle.cy) ** 2);
      const xOut = shape.crest + shape.run + 0.3 * shape.toe;
      const yLow = circle.cy - circle.radius * uniform(r, 0.9, 0.99);
      const pts: [number, number][] = [
        [xIn - 1, shape.H + 0.5],
        [xIn + 0.3 * (xOut - xIn), yLow],
        [xIn + 0.7 * (xOut - xIn), yLow + uniform(r, 0, 1)],
        [xOut + 1, 0.5],
      ];
      const xEnd = shape.crest + shape.run + shape.toe;
      let def: SlopeDefinition = {
        ...g.def,
        waterTables: [{ id: "p", coordinates: [[0, -shape.depth * 0.3], [xEnd, -shape.depth * 0.5]], followBoundary: true }],
        waterTable: { mode: "custom", value: [[0, shape.H * 0.4], [xEnd, -0.5]], followBoundary: true },
      };
      def.materials = [
        { ...def.materials[0] },
        {
          ...def.materials[1],
          waterTableId: "p",
          model: {
            kind: "spatial-mohr-coulomb",
            unitWeight: def.materials[1].unitWeight,
            dataPoints: [
              [0, 0, 5, 25, 18],
              [xEnd * 0.5, -shape.depth * 0.5, 15, 30, 19],
              [xEnd, 0, 8, 20, 20],
            ],
            interpolation: "idw",
          },
        },
      ];
      def = onPolyline(def, pts, i % 2 ? [circle.cx, circle.cy] : undefined);
      const axis = uniform(r, -20, 60);
      const mirrored = mirrorDefinition(def, axis);
      const dp: [number, number][] = [[0, 0.1], [0.2, 0.9], [0.6, 1], [1, 0.3]];
      const dpMirrored = dp.map(([x, f]) => [1 - x, f] as [number, number]).reverse();
      // A fixed or automatic tension crack (with water) on every other case.
      const crack =
        i % 4 === 1
          ? { tensionCrackDepth: shape.H * 0.15, tensionCrackWater: 1 }
          : i % 4 === 3
            ? { tensionCrackAuto: true, tensionCrackWater: 0.5 }
            : {};
      for (const method of ["Ordinary", "Bishop", "Janbu", "Morgenstern-Price"] as Method[]) {
        const a = fosOf(def, method, crack);
        const b = fosOf(mirrored, method, crack);
        const label = `seed 31 case ${i} ${method} ${JSON.stringify(crack)}`;
        expect(b === null, label).toBe(a === null);
        if (a !== null && b !== null) {
          expect(relDiff(a, b), `${label}: ${a} vs ${b}`).toBeLessThan(1e-6);
          compared++;
        }
      }
      // Interslice points are entered with x = 0 at the left end in model
      // space: the mirror image of a function is the mirrored point list.
      const opts = { intersliceFunction: "data-point-specified" as const };
      const a = fosOf(def, "Morgenstern-Price", { ...opts, intersliceDataPoints: dp });
      const b = fosOf(mirrored, "Morgenstern-Price", { ...opts, intersliceDataPoints: dpMirrored });
      expect(b === null, `case ${i} data points`).toBe(a === null);
      if (a !== null && b !== null) {
        expect(relDiff(a, b), `seed 31 case ${i} data points: ${a} vs ${b}`).toBeLessThan(1e-6);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(40);
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

  it("with nails (every pullout kind) and piles (given force and Ito & Matsui)", () => {
    const r = rng(77);
    const pullouts = [
      undefined,
      { kind: "bond", strength: 40, bondedLength: 4 },
      { kind: "development", length1: 1.5, length2: 2 },
      { kind: "interface", adhesion: 5, frictionAngle: 25, coverage: 0.9 },
    ] as const;
    for (let i = 0; i < 8; i++) {
      const g = randomCase(r, { layers: 1 });
      let def = decorate(r, g, new Set(["nail", "pile"]));
      def = {
        ...def,
        reinforcements: def.reinforcements!.map((q) => ({ ...q, pullout: pullouts[i % 4], end1Capacity: 10 })),
        piles: def.piles!.map((p) =>
          i % 2 ? { ...p, force: undefined, diameter: 0.6, spacing: 2, shearCapacity: 300, momentCapacity: 400 } : p,
        ),
      };
      def = onCircle(def, g.circle);
      const k = uniform(r, 0.5, 2);
      const scaled = transformDefinition(def, { k, s: k });
      for (const method of METHODS) {
        const a = fosOf(def, method);
        const b = fosOf(scaled, method);
        const label = `seed 77 case ${i} ${method} k ${k}`;
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

describe("both sliding directions", () => {
  it("a symmetric ridge: the opposite direction gives the FOS of the mirrored circle", () => {
    const r = rng(2525);
    for (let i = 0; i < 8; i++) {
      const H = uniform(r, 5, 12);
      const half = uniform(r, 15, 30);
      const top = uniform(r, 2, 6);
      const run = uniform(r, 1, 2.5) * H;
      const D = uniform(r, 5, 10);
      const L = 2 * half;
      const coordinates: [number, number][] = [
        [0, -D], [0, 0], [half - top - run, 0], [half - top, H], [half + top, H], [half + top + run, 0], [L, 0], [L, -D],
      ];
      const gamma = uniform(r, 17, 21);
      const c = uniform(r, 3, 15);
      const phi = uniform(r, 20, 35);
      const def: SlopeDefinition = {
        orientation: "ltr",
        coordinates,
        materials: [{ name: "S", unitWeight: gamma, cohesion: c, frictionAngle: phi }],
        udls: [{ magnitude: uniform(r, 5, 20), x1: half - top * 0.8, x2: half + top * 0.8 }],
      };
      // A circle on the right face (sliding to +x) and its mirror image.
      const cx = half + top + run * uniform(r, 0.3, 0.7);
      const cy = H + uniform(r, 3, 10);
      const radius = Math.hypot(cx - (half + top * 0.3), cy - H);
      if (cy - radius < -D + 0.2) continue;
      const canonical = toCanonicalSlopeDefinition({ ...def, customSearchPlanes: [{ cx, cy, radius }], customPlanesOnly: true });
      const opposite = oppositeDirectionDefinition(toCanonicalSlopeDefinition(def));
      // The opposite direction analyses the left face, mirrored onto the
      // right: the mirror image of the circle (L − cx) mirrored again.
      const oppositeOnCircle = { ...opposite, customSearchPlanes: [{ cx: L - (L - cx), cy, radius }], customPlanesOnly: true };
      for (const method of METHODS) {
        const a = fosOf(canonical, method);
        // The opposite definition is canonical already (its circle in its
        // own coordinates): analysed as is, not mirrored again.
        const b = fosOf({ ...oppositeOnCircle, orientation: "ltr" }, method);
        expect(b === null, `seed 2525 case ${i} ${method}`).toBe(a === null);
        if (a !== null && b !== null) expect(relDiff(a, b), `seed 2525 case ${i} ${method}: ${a} vs ${b}`).toBeLessThan(1e-6);
      }
    }
  }, 30_000);
});
