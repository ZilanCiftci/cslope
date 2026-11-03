import { describe, expect, it } from "vitest";
import type { MaterialModel, SlopeDefinition } from "../types";
import { layered, mc, runVerification } from "../verification/cases";
import { waternetPorePressure, type Waternet } from "./waternet";

const GW = 9.81;

describe("waternet pore pressure", () => {
  // phreatic line at 8; a clay between reference lines at 4 (head 8) and 0
  // (an aquifer with head 12)
  const wn: Waternet = {
    headLines: [
      { id: "p", points: [[0, 8], [40, 8]] },
      { id: "a", points: [[0, 12], [40, 12]] },
    ],
    referenceLines: [
      { points: [[0, 4], [40, 4]], topHeadLineId: "p", bottomHeadLineId: "p" },
      { points: [[0, 0], [40, 0]], topHeadLineId: "a", bottomHeadLineId: "a" },
    ],
    phreaticLineId: "p",
  };

  it("is hydrostatic below the phreatic line down to the uppermost reference line, none above", () => {
    expect(waternetPorePressure(wn, 10, 9)).toBe(0);
    expect(waternetPorePressure(wn, 10, 6)).toBeCloseTo(2 * GW, 9);
  });

  it("varies the head linearly with elevation between two reference lines", () => {
    // halfway between 4 (head 8) and 0 (head 12): head 10
    expect(waternetPorePressure(wn, 10, 2)).toBeCloseTo((10 - 2) * GW, 9);
  });

  it("takes the lowest reference line's bottom head below it", () => {
    expect(waternetPorePressure(wn, 10, -3)).toBeCloseTo((12 + 3) * GW, 9);
  });

  it("interpolates from the uppermost reference line's top head to the phreatic level", () => {
    // the top line carries the aquifer head: from 12 at z = 4 to 8 at z = 8
    const up: Waternet = { ...wn, referenceLines: [{ points: [[0, 4], [40, 4]], topHeadLineId: "a", bottomHeadLineId: "a" }] };
    expect(waternetPorePressure(up, 10, 6)).toBeCloseTo((10 - 6) * GW, 9);
    expect(waternetPorePressure(up, 10, 8.5)).toBe(0);
  });

  it("leaves out a reference line without head lines and one that does not reach x", () => {
    const extra: Waternet = {
      ...wn,
      referenceLines: [
        ...wn.referenceLines,
        { points: [[0, 2], [40, 2]] },
        { points: [[20, 3], [40, 3]], topHeadLineId: "a", bottomHeadLineId: "a" },
      ],
    };
    expect(waternetPorePressure(extra, 10, 2.5)).toBeCloseTo(waternetPorePressure(wn, 10, 2.5), 12);
  });
});

describe("staged strength and pore pressure", () => {
  const ground: [number, number][] = [[0, 10], [10, 10], [25, 0], [45, 0]];
  const circle = { customSearchPlanes: [{ cx: 20, cy: 20, radius: 21 }], customPlanesOnly: true };
  const run = (layers: { name: string; topY: number | null; model: MaterialModel }[], extra: Partial<SlopeDefinition> = {}) =>
    runVerification({ ...layered(ground, -10, layers, extra), ...circle }, "Morgenstern-Price", { slices: 30 });
  const water = { waterTable: { mode: "custom" as const, value: [[0, 4], [45, 4]] as [number, number][] } };

  it("a material's strength above its water line applies above it, and everywhere without water", () => {
    const below = mc(5, 30, 19), above = mc(20, 35, 19);
    const split = run([{ name: "S", topY: null, model: { ...below, aboveWater: above } }], water).slope.search[0].slices!;
    for (const s of split) expect(s.strengthModel ?? s.baseMaterial?.model).toEqual(s.yBottom > 4 ? above : { ...below, aboveWater: above });
    const dry = run([{ name: "S", topY: null, model: { ...below, aboveWater: above } }]);
    expect(dry.fos).toBeCloseTo(run([{ name: "S", topY: null, model: above }]).fos!, 9);
  });

  it("SHANSEP with a POP: OCR = (σ′v + POP)/σ′v; a yield stress: OCR = σ′y/σ′v", () => {
    const base: MaterialModel = { kind: "shansep", unitWeight: 18, ratio: 0.25, exponent: 0.8 };
    for (const s of run([{ name: "C", topY: null, model: { ...base, pop: 20 } }], water).slope.search[0].slices!) {
      const sv = (s.weight + s.udl) / s.width - s.U;
      expect(s.cohesionUndrained).toBeCloseTo(0.25 * sv * ((sv + 20) / sv) ** 0.8, 6);
    }
    for (const s of run([{ name: "C", topY: null, model: { ...base, yieldStress: 60 } }], water).slope.search[0].slices!) {
      const sv = (s.weight + s.udl) / s.width - s.U;
      expect(s.cohesionUndrained).toBeCloseTo(0.25 * sv * Math.max(1, 60 / sv) ** 0.8, 6);
    }
  });

  it("an earlier stage with a higher water level sets the yield stress (OCR from the stress it kept)", () => {
    const clay: MaterialModel = { kind: "shansep", unitWeight: 18, ratio: 0.25, exponent: 0.8, pop: 5, yieldFromEarlierStage: true };
    const earlier = layered(ground, -10, [{ name: "C", topY: null, model: clay }]);
    // the earlier stage was drier (lower water: higher effective stress)
    const now = run([{ name: "C", topY: null, model: clay }], { ...water, earlierStage: earlier });
    const fresh = run([{ name: "C", topY: null, model: { ...clay, yieldFromEarlierStage: undefined } }], water);
    expect(now.fos!).toBeGreaterThan(fresh.fos!);
    for (const s of now.slope.search[0].slices!) {
      const sv = (s.weight + s.udl) / s.width - s.U;
      // the earlier stage had no pore pressure: σ′v0 ≈ W/b (at the slice's centre line)
      const sy = (s.weight + s.udl) / s.width + 5;
      expect(s.cohesionUndrained / (0.25 * sv * Math.max(1, sy / sv) ** 0.8)).toBeCloseTo(1, 1);
    }
  });

  it("a load not yet consolidated adds ratio × q of pore pressure under it, below the water only", () => {
    const clay: MaterialModel = { kind: "shansep", unitWeight: 18, ratio: 0.25, exponent: 0.8 };
    const load = (excess?: { material: string; ratio: number }[]) => ({ ...water, udls: [{ magnitude: 20, x1: 0, x2: 10, ...(excess ? { excessPorePressure: excess } : {}) }] });
    const drained = run([{ name: "C", topY: null, model: clay }], load()).slope.search[0].slices!;
    const loaded = run([{ name: "C", topY: null, model: clay }], load([{ material: "C", ratio: 0.9 }]));
    loaded.slope.search[0].slices!.forEach((s, i) => {
      const under = Math.max(0, Math.min(10, s.xRight) - Math.max(0, s.xLeft)) / s.width;
      const expected = drained[i].U > 0 ? 0.9 * 20 * under : 0;
      expect(s.U - drained[i].U).toBeCloseTo(expected, 9);
    });
    expect(loaded.fos!).toBeLessThan(run([{ name: "C", topY: null, model: clay }], load()).fos!);
    // another material's excess does not apply
    const other = run([{ name: "C", topY: null, model: clay }], load([{ material: "X", ratio: 0.9 }]));
    expect(other.fos).toBeCloseTo(run([{ name: "C", topY: null, model: clay }], load()).fos!, 12);
  });
});
