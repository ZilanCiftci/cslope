/**
 * Option combinations (partial factors × reinforcement × tension crack ×
 * ponding × γsat × method) checked against exact relations:
 *
 * - Strength factors k on c, cu and tan φ (load factor 1) divide the FOS
 *   by exactly k on a fixed surface — the FOS is itself a strength
 *   reduction factor — whatever water, loads, active reinforcement, piles
 *   or fixed crack the model has. Passive reinforcement (divided by F, not
 *   by k) can only make F·k larger.
 * - Water in a crack never raises the FOS.
 */
import { describe, it, expect } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import type { AnalysisOptions, PartialFactors } from "../types/analysis";
import { rng, uniform, randomCase, onCircle, fosOf, mohrCoulomb, relDiff, decorate, type Method, mc } from "./property-helpers";

const METHODS: Method[] = ["Bishop", "Janbu", "Morgenstern-Price"];
const strengthFactors = (k: number): PartialFactors => ({ cu: k, cohesion: k, tanPhi: k, variableLoad: 1 });

function withSat(def: SlopeDefinition, extra: number): SlopeDefinition {
  return {
    ...def,
    materials: def.materials.map((m) => ({
      ...m,
      model: mohrCoulomb(mc(m).unitWeight, mc(m).cohesion, mc(m).frictionAngle, mc(m).unitWeight + extra),
    })),
  };
}

function withPond(def: SlopeDefinition, level: number): SlopeDefinition {
  // Free water up to `level` above the toe (y = 0), with the phreatic
  // surface through the slope behind it.
  const xEnd = Math.max(...def.coordinates.map((c) => c[0]));
  return {
    ...def,
    waterTable: { mode: "custom", value: [[0, level - 0.5], [xEnd, level]], followBoundary: false },
  };
}

describe("partial factors on strength", () => {
  it("divide the FOS by exactly k (water, ponding, γsat, loads, active reinforcement, fixed crack)", () => {
    const r = rng(9001);
    let checked = 0;
    for (let i = 0; i < 24; i++) {
      const g = randomCase(r);
      const features = new Set<string>();
      if (i % 2) features.add("udl");
      if (i % 3 === 1) features.add("water");
      if (i % 4 === 2) features.add("nail");
      if (i % 5 === 3) features.add("pile");
      let def = decorate(r, g, features);
      // Active reinforcement only (passive is checked below).
      def = {
        ...def,
        reinforcements: def.reinforcements?.map((q) => ({ ...q, application: "active" as const })),
        piles: def.piles?.map((p) => ({ ...p, application: "active" as const })),
      };
      if (i % 6 === 5) def = withPond(def, uniform(r, 0.5, 2));
      if (i % 4 === 1) def = withSat(def, uniform(r, 0.5, 3));
      def = onCircle(def, g.circle);
      const crack: Partial<AnalysisOptions> = i % 3 === 2 ? { tensionCrackDepth: g.shape.H * 0.15, tensionCrackWater: uniform(r, 0, 1) } : {};
      const k = uniform(r, 1.05, 1.6);
      for (const method of METHODS) {
        const janbu = method === "Janbu" ? { janbuCorrection: i % 2 === 0 } : {};
        const f = fosOf(def, method, { ...crack, ...janbu });
        const fk = fosOf(def, method, { ...crack, ...janbu, partialFactors: strengthFactors(k) });
        const label = `seed 9001 case ${i} ${method} [${[...features]}] k ${k}`;
        expect(fk === null, label).toBe(f === null);
        if (f === null || fk === null) continue;
        expect(relDiff(fk * k, f), `${label}: ${fk}·k vs ${f}`).toBeLessThan(2e-5);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(55);
  }, 30_000);

  it("with passive reinforcement F·k is never below F", () => {
    const r = rng(9002);
    for (let i = 0; i < 12; i++) {
      const g = randomCase(r, { layers: 1 });
      let def = decorate(r, g, new Set(["nail", "pile"]));
      def = onCircle(
        {
          ...def,
          reinforcements: def.reinforcements!.map((q) => ({ ...q, application: "passive" as const })),
          piles: def.piles!.map((p) => ({ ...p, application: "passive" as const })),
        },
        g.circle,
      );
      const k = uniform(r, 1.1, 1.5);
      for (const method of METHODS) {
        const f = fosOf(def, method);
        const fk = fosOf(def, method, { partialFactors: strengthFactors(k) });
        if (f === null || fk === null) continue;
        expect(fk * k, `seed 9002 case ${i} ${method}`).toBeGreaterThanOrEqual(f * (1 - 2e-5));
      }
    }
  }, 30_000);

  it("the undrained factor applies to φ = 0 soil, the drained ones to c-φ soil", () => {
    const r = rng(9003);
    for (let i = 0; i < 6; i++) {
      const clay = randomCase(r, { phi: [0, 0], c: [15, 40], layers: 1 });
      const sand = randomCase(r, { phi: [25, 35], c: [2, 8], layers: 1 });
      const dc = onCircle(clay.def, clay.circle);
      const ds = onCircle(sand.def, sand.circle);
      for (const method of METHODS) {
        const fc = fosOf(dc, method)!;
        // Only γcu acts on φ = 0 soil.
        expect(relDiff(fosOf(dc, method, { partialFactors: { cu: 1.4, cohesion: 3, tanPhi: 3, variableLoad: 1 } })! * 1.4, fc)).toBeLessThan(2e-5);
        // γcu does nothing to c-φ soil.
        const fs = fosOf(ds, method)!;
        expect(relDiff(fosOf(ds, method, { partialFactors: { cu: 3, cohesion: 1, tanPhi: 1, variableLoad: 1 } })!, fs)).toBeLessThan(2e-5);
      }
    }
  }, 30_000);

  it("the load factor only acts on variable loads", () => {
    const r = rng(9004);
    for (let i = 0; i < 6; i++) {
      const g = randomCase(r, { layers: 1 });
      const dry = onCircle(g.def, g.circle);
      const loaded = onCircle({ ...g.def, udls: [{ magnitude: 20, x1: 0, x2: g.shape.crest }] }, g.circle);
      const factored = { partialFactors: { cu: 1, cohesion: 1, tanPhi: 1, variableLoad: 1.5 } };
      for (const method of METHODS) {
        expect(relDiff(fosOf(dry, method, factored)!, fosOf(dry, method)!)).toBeLessThan(1e-9);
        // A factored 20 kPa load is a 30 kPa load.
        const heavier = onCircle({ ...g.def, udls: [{ magnitude: 30, x1: 0, x2: g.shape.crest }] }, g.circle);
        expect(relDiff(fosOf(loaded, method, factored)!, fosOf(heavier, method)!)).toBeLessThan(1e-6);
      }
    }
  }, 30_000);
});

describe("tension crack", () => {
  it("water in a crack never raises the FOS", () => {
    const r = rng(9005);
    for (let i = 0; i < 12; i++) {
      const g = randomCase(r);
      const def = onCircle(g.def, g.circle);
      const depth = g.shape.H * uniform(r, 0.1, 0.3);
      for (const method of METHODS) {
        let prev = Infinity;
        for (const w of [0, 0.5, 1]) {
          const f = fosOf(def, method, { tensionCrackDepth: depth, tensionCrackWater: w });
          if (f === null) continue;
          expect(f, `seed 9005 case ${i} ${method} water ${w}`).toBeLessThanOrEqual(prev * (1 + 1e-6));
          prev = f;
        }
      }
    }
  }, 30_000);

  it("automatic crack: none in cohesionless soil; a finite FOS with partial factors, ponding and γsat", () => {
    const r = rng(9006);
    for (let i = 0; i < 8; i++) {
      const sand = randomCase(r, { c: [0, 0], phi: [30, 40], layers: 1 });
      const ds = onCircle(sand.def, sand.circle);
      for (const method of METHODS) {
        expect(fosOf(ds, method, { tensionCrackAuto: true })).toBe(fosOf(ds, method));
      }
      const g = randomCase(r);
      const def = onCircle(withSat(withPond(g.def, 1), 1.5), g.circle);
      for (const method of METHODS) {
        const f = fosOf(def, method, { tensionCrackAuto: true, tensionCrackWater: 1, partialFactors: { cu: 1.4, cohesion: 1.25, tanPhi: 1.25, variableLoad: 1.3 } });
        if (f !== null) expect(Number.isFinite(f) && f > 0, `case ${i} ${method}`).toBe(true);
      }
    }
  }, 30_000);
});
