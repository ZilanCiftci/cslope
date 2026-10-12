/**
 * Equivalent inputs give the same FOS: material models that reduce to
 * one another, a region split into parts of the same material, water
 * lines given in different ways, γsat where no soil is saturated.
 */
import { describe, it, expect } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import type { MaterialModel } from "../types/material-models";
import { rng, uniform, randomCase, onCircle, fosOf, relDiff, mohrCoulomb, type Method } from "./property-helpers";

const METHODS: Method[] = ["Ordinary", "Bishop", "Janbu", "Morgenstern-Price"];

function withModel(def: SlopeDefinition, f: (m: SlopeDefinition["materials"][number]) => MaterialModel): SlopeDefinition {
  return { ...def, materials: def.materials.map((m) => ({ ...m, model: f(m) })) };
}

function expectSame(a: SlopeDefinition, b: SlopeDefinition, label: string, tol = 1e-9, methods = METHODS) {
  for (const method of methods) {
    const fa = fosOf(a, method);
    const fb = fosOf(b, method);
    expect(fb === null, `${label} ${method}`).toBe(fa === null);
    if (fa !== null && fb !== null) expect(relDiff(fa, fb), `${label} ${method}: ${fa} vs ${fb}`).toBeLessThan(tol);
  }
}

describe("material models that reduce to Mohr-Coulomb", () => {
  it("spatial MC with uniform points, anisotropic with factor 1 = MC", () => {
    const r = rng(600);
    for (let i = 0; i < 6; i++) {
      const g = randomCase(r);
      const def = onCircle(g.def, g.circle);
      const xEnd = Math.max(...def.coordinates.map((c) => c[0]));
      for (const interpolation of ["nearest", "linear", "idw"] as const) {
        const spatial = withModel(def, (m) => ({
          kind: "spatial-mohr-coulomb",
          unitWeight: m.unitWeight,
          interpolation,
          dataPoints: [
            [0, 0, m.cohesion, m.frictionAngle, m.unitWeight],
            [xEnd, -5, m.cohesion, m.frictionAngle, m.unitWeight],
            [xEnd / 2, 10, m.cohesion, m.frictionAngle, m.unitWeight],
          ],
        }));
        expectSame(def, spatial, `seed 600 case ${i} spatial ${interpolation}`, 1e-9);
      }
      const aniso = withModel(def, (m) => ({
        kind: "anisotropic-function",
        unitWeight: m.unitWeight,
        cohesion: m.cohesion,
        frictionAngle: m.frictionAngle,
        modifierFunction: [[-90, 1], [0, 1], [90, 1]],
      }));
      expectSame(def, aniso, `seed 600 case ${i} anisotropic`);
    }
  }, 30_000);

  it("undrained, S = f(depth) and S = f(datum) with rate 0, and lime-cement columns of ratio 0 = MC with φ = 0", () => {
    const r = rng(601);
    for (let i = 0; i < 6; i++) {
      const g = randomCase(r, { phi: [0, 0], c: [15, 40] });
      const def = onCircle(g.def, g.circle);
      const variants: [string, (m: SlopeDefinition["materials"][number]) => MaterialModel][] = [
        ["undrained", (m) => ({ kind: "undrained", unitWeight: m.unitWeight, undrainedShearStrength: m.cohesion })],
        ["s-f-depth", (m) => ({ kind: "s-f-depth", unitWeight: m.unitWeight, suRef: m.cohesion, depthRef: 3, rate: 0 })],
        ["s-f-datum", (m) => ({ kind: "s-f-datum", unitWeight: m.unitWeight, suRef: m.cohesion, yRef: -2, rate: 0 })],
        ["lime-cement", (m) => ({ kind: "lime-cement-columns", unitWeight: m.unitWeight, soilSu: m.cohesion, columnSu: 500, areaRatio: 0 })],
        // Columns of the soil's own strength change nothing at any ratio.
        ["lime-cement same", (m) => ({ kind: "lime-cement-columns", unitWeight: m.unitWeight, soilSu: m.cohesion, columnSu: m.cohesion, areaRatio: 0.4 })],
      ];
      for (const [name, f] of variants) expectSame(def, withModel(def, f), `seed 601 case ${i} ${name}`);
    }
  }, 30_000);

  it("strength rising with depth: undrained, S = f(datum) and MC with a rate are the same profile", () => {
    const r = rng(602);
    for (let i = 0; i < 4; i++) {
      const g = randomCase(r, { phi: [0, 0], c: [15, 30], layers: 1 });
      const def = onCircle(g.def, g.circle);
      const rate = uniform(r, 0.5, 3);
      const yRef = g.shape.H;
      const su = withModel(def, (m) => ({ kind: "undrained", unitWeight: m.unitWeight, undrainedShearStrength: m.cohesion, suRefDepth: yRef, suRateOfChange: rate }));
      const datum = withModel(def, (m) => ({ kind: "s-f-datum", unitWeight: m.unitWeight, suRef: m.cohesion, yRef, rate }));
      const mc = withModel(def, (m) => ({ kind: "mohr-coulomb", unitWeight: m.unitWeight, cohesion: m.cohesion, frictionAngle: 0, cohesionRefDepth: yRef, cohesionRateOfChange: rate }));
      expectSame(su, datum, `seed 602 case ${i} undrained vs datum`);
      expectSame(su, mc, `seed 602 case ${i} undrained vs MC`);
      // On a horizontal crest, depth below the ground is yRef − y as well.
      const depth = withModel(def, (m) => ({ kind: "s-f-depth", unitWeight: m.unitWeight, suRef: m.cohesion, depthRef: 0, rate }));
      expect(fosOf(depth, "Bishop")!).toBeLessThanOrEqual(fosOf(su, "Bishop")! * (1 + 1e-9));
    }
  }, 30_000);
});

describe("geometry and water given in different ways", () => {
  it("splitting a region into parts of the same material changes the FOS by discretisation only", () => {
    const r = rng(603);
    for (let i = 0; i < 6; i++) {
      const g = randomCase(r, { layers: 1 });
      const def = onCircle(g.def, g.circle);
      const xEnd = Math.max(...def.coordinates.map((c) => c[0]));
      const y = uniform(r, -0.5, 0.5) * g.shape.H;
      const split: SlopeDefinition = {
        ...def,
        materials: [def.materials[0], { ...def.materials[0], name: "Copy" }],
        materialBoundaries: [{ coordinates: [[0, y], [xEnd, y + uniform(r, -2, 0)]], materialName: "Copy" }],
        regionAssignments: [{ point: [0.5, -g.shape.depth + 0.5], materialName: "Copy" }],
      };
      for (const method of METHODS) {
        const a = fosOf(def, method, { slices: 80 })!;
        const b = fosOf(split, method, { slices: 80 })!;
        expect(relDiff(a, b), `seed 603 case ${i} ${method}: ${a} vs ${b}`).toBeLessThan(2e-3);
      }
    }
  }, 30_000);

  it("a horizontal water table by height, by depth and by points is the same line", () => {
    const r = rng(604);
    for (let i = 0; i < 4; i++) {
      const g = randomCase(r);
      const def = onCircle(g.def, g.circle);
      const xEnd = Math.max(...def.coordinates.map((c) => c[0]));
      const h = uniform(r, -0.3, 0.6) * g.shape.H;
      const byHeight: SlopeDefinition = { ...def, waterTable: { mode: "height", value: h } };
      const byDepth: SlopeDefinition = { ...def, waterTable: { mode: "depth", value: g.shape.H - h } };
      const byPoints: SlopeDefinition = { ...def, waterTable: { mode: "custom", value: [[0, h], [xEnd, h]] } };
      // A short line is continued horizontally to the model edges.
      const short: SlopeDefinition = { ...def, waterTable: { mode: "custom", value: [[5, h], [6, h]] } };
      expectSame(byHeight, byDepth, `seed 604 case ${i} depth`, 1e-12);
      expectSame(byHeight, byPoints, `seed 604 case ${i} points`, 1e-12);
      expectSame(byHeight, short, `seed 604 case ${i} short`, 1e-12);
    }
  }, 30_000);

  it("a material's own water table equal to the default one changes nothing", () => {
    const r = rng(605);
    for (let i = 0; i < 4; i++) {
      const g = randomCase(r, { water: true, layers: 2 });
      const def = onCircle(g.def, g.circle);
      const line = def.waterTable!.value as [number, number][];
      const own: SlopeDefinition = {
        ...def,
        waterTables: [{ id: "w", coordinates: line, followBoundary: true }],
        materials: def.materials.map((m, k) => (k === 1 ? { ...m, waterTableId: "w" } : m)),
      };
      expectSame(def, own, `seed 605 case ${i}`, 1e-9);
      // ... and an unknown id falls back to the default line.
      const unknown: SlopeDefinition = { ...def, materials: def.materials.map((m) => ({ ...m, waterTableId: "nope" })), waterTables: [{ id: "w", coordinates: line }] };
      expectSame(def, unknown, `seed 605 case ${i} unknown id`, 1e-9);
    }
  }, 30_000);

  it("γsat changes nothing above the water table and equals γ when given as γ", () => {
    const r = rng(606);
    for (let i = 0; i < 4; i++) {
      const g = randomCase(r, { layers: 1 });
      const def = onCircle(g.def, g.circle);
      const m = def.materials[0];
      const sat = (gs: number): SlopeDefinition => ({ ...def, materials: [{ ...m, model: mohrCoulomb(m.unitWeight, m.cohesion, m.frictionAngle, gs) }] });
      // Water table below the whole model.
      const deep = { mode: "height" as const, value: -g.shape.depth - 5 };
      expectSame({ ...def, waterTable: deep }, { ...sat(m.unitWeight + 3), waterTable: deep }, `seed 606 case ${i} deep`);
      const wet = { mode: "height" as const, value: g.shape.H * 0.5 };
      expectSame({ ...def, waterTable: wet }, { ...sat(m.unitWeight), waterTable: wet }, `seed 606 case ${i} γsat = γ`);
      // Heavier saturated soil below the water: never a different null-ness and finite.
      const f = fosOf({ ...sat(m.unitWeight + 3), waterTable: wet }, "Bishop");
      expect(f === null || Number.isFinite(f)).toBe(true);
    }
  }, 30_000);
});

describe("options that describe the same thing", () => {
  it("swapping which line is the default and which a material's own gives the same pore pressures", () => {
    const r = rng(607);
    for (let i = 0; i < 4; i++) {
      const g = randomCase(r, { layers: 2 });
      const def = onCircle(g.def, g.circle);
      const xEnd = Math.max(...def.coordinates.map((c) => c[0]));
      const high: [number, number][] = [[0, g.shape.H * 0.5], [xEnd, -0.5]];
      const low: [number, number][] = [[0, -g.shape.depth * 0.5], [xEnd, -g.shape.depth * 0.6]];
      // Upper layer on the high line, lower layer on the low line.
      const a: SlopeDefinition = {
        ...def,
        waterTable: { mode: "custom", value: high },
        waterTables: [{ id: "low", coordinates: low }],
        materials: def.materials.map((m, k) => (k === 1 ? { ...m, waterTableId: "low" } : m)),
      };
      const b: SlopeDefinition = {
        ...def,
        waterTable: { mode: "custom", value: low },
        waterTables: [{ id: "high", coordinates: high }],
        materials: def.materials.map((m, k) => (k === 0 ? { ...m, waterTableId: "high" } : m)),
      };
      expectSame(a, b, `seed 607 case ${i}`, 1e-9);
    }
  }, 30_000);

  it("a horizontal water table: phreatic correction = vertical head", () => {
    const r = rng(608);
    for (let i = 0; i < 4; i++) {
      const g = randomCase(r);
      const def = onCircle({ ...g.def, waterTable: { mode: "height", value: uniform(r, 0, 0.6) * g.shape.H, followBoundary: false } }, g.circle);
      for (const method of METHODS) {
        const a = fosOf(def, method, { porePressureHead: "vertical" });
        const b = fosOf(def, method, { porePressureHead: "phreatic-correction" });
        expect(relDiff(a!, b!), `seed 608 case ${i} ${method}`).toBeLessThan(1e-12);
      }
      // An inclined line: the correction lowers the pore pressure, so it never lowers the FOS.
      const inclined = onCircle({ ...g.def, waterTable: { mode: "custom", value: [[0, g.shape.H * 0.6], [g.shape.crest + g.shape.run, -0.5]] } }, g.circle);
      for (const method of ["Ordinary", "Bishop"] as Method[]) {
        expect(fosOf(inclined, method, { porePressureHead: "phreatic-correction" })!).toBeGreaterThanOrEqual(
          fosOf(inclined, method, { porePressureHead: "vertical" })! * (1 - 1e-9),
        );
      }
    }
  }, 30_000);

  it("data-point interslice functions equal to the built-in shapes give their FOS", () => {
    const r = rng(609);
    const halfSine: [number, number][] = Array.from({ length: 201 }, (_, k) => [k / 200, Math.sin((Math.PI * k) / 200)]);
    for (let i = 0; i < 4; i++) {
      const g = randomCase(r);
      const def = onCircle(g.def, g.circle);
      const constant = fosOf(def, "Morgenstern-Price", { intersliceFunction: "constant" });
      const ones = fosOf(def, "Morgenstern-Price", { intersliceFunction: "data-point-specified", intersliceDataPoints: [[0, 1], [1, 1]] });
      if (constant !== null && ones !== null) expect(relDiff(constant, ones), `seed 609 case ${i} constant`).toBeLessThan(1e-9);
      const hs = fosOf(def, "Morgenstern-Price", { intersliceFunction: "half-sine" });
      const pts = fosOf(def, "Morgenstern-Price", { intersliceFunction: "data-point-specified", intersliceDataPoints: halfSine });
      if (hs !== null && pts !== null) expect(relDiff(hs, pts), `seed 609 case ${i} half-sine`).toBeLessThan(1e-4);
      // No data points: the half-sine.
      const none = fosOf(def, "Morgenstern-Price", { intersliceFunction: "data-point-specified", intersliceDataPoints: [] });
      if (hs !== null && none !== null) expect(relDiff(hs, none), `seed 609 case ${i} none`).toBeLessThan(1e-12);
    }
  }, 30_000);
});
