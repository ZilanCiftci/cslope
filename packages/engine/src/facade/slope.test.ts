/**
 * The facade's Slope: handles, snapshots and
 * their cache, material identity, slices written back, reentrancy.
 */
import { describe, expect, it } from "vitest";
import { engine } from "../engine";
import { Material } from "../types/material";
import { Slope, type SearchPlane } from "../model/slope";
import { buildSlope } from "../model/build-slope";
import { analyseBishop, analyseSlope, evaluatePlanes } from "../model/solvers";
import { getSlices } from "../model/slices";
import { optimiseNonCircular } from "../model/optimize";

const ground: [number, number][] = [[0, -10], [0, 10], [10, 10], [30, 0], [40, 0], [40, -10]];

function model(): { slope: Slope; clay: Material } {
  const clay = new Material({ name: "Clay", unitWeight: 18, cohesion: 8, frictionAngle: 25 });
  const slope = new Slope();
  slope.addMaterial(clay);
  slope.setExternalBoundary(ground);
  slope.updateAnalysisOptions({ iterations: 500, refinedIterations: 0 });
  return { slope, clay };
}

describe("facade Slope", () => {
  it("frees its engine slope; a freed slope is refused", () => {
    const counts = () => (engine() as unknown as { slope_count(): number }).slope_count();
    const before = counts();
    const { slope } = model();
    expect(counts()).toBe(before + 1);
    (slope as unknown as { free(): void }).free();
    expect(counts()).toBe(before);
    expect(() => slope.sliceCount).toThrow(/freed/);
  });

  it("gives the same snapshot until the slope changes", () => {
    const { slope } = model();
    analyseSlope(slope);
    const search = slope.search;
    expect(slope.search).toBe(search);
    expect(slope.materialGeometries).toBe(slope.materialGeometries);
    slope.updateAnalysisOptions({ slices: 30 });
    expect(slope.search).not.toBe(search);
    expect(slope.search).toEqual([]);
    // the old snapshot is unchanged
    expect(search.length).toBeGreaterThan(0);
  });

  it("keeps the identity of materials, also of those the engine made", () => {
    const { slope, clay } = model();
    analyseSlope(slope);
    const best = slope.search[0];
    expect(best.slices![0].baseMaterial).toBe(clay);
    expect(slope.materialGeometries[0].material).toBe(clay);
    const built = buildSlope({ coordinates: ground, materials: [{ name: "Sand", model: { kind: "mohr-coulomb", unitWeight: 19, cohesion: 2, frictionAngle: 32 } }] });
    const sand = built.materialGeometries[0].material;
    expect(sand).toBeInstanceOf(Material);
    expect(sand.name).toBe("Sand");
    built.updateAnalysisOptions({ iterations: 500, refinedIterations: 0 });
    analyseSlope(built);
    expect(built.search[0].slices![0].baseMaterial).toBe(sand);
  });

  it("writes the solver's changes back onto the caller's slices", () => {
    const { slope } = model();
    analyseSlope(slope);
    const p = slope.search[0];
    const slices = getSlices(slope, p.lc[0], p.rc[0], p.cx, p.cy, p.radius);
    const [fos] = analyseBishop(slope, slices);
    expect(fos).toBeCloseTo(p.fos!, 9);
    const planes: SearchPlane[] = [{ ...p, fos: null, slices: null }];
    evaluatePlanes(slope, planes);
    expect(planes[0].fos).toBe(p.fos);
    expect(planes[0].slices!.length).toBe(p.slices!.length);
  });

  it("refuses to change a slope while the engine runs a callback on it", () => {
    const { slope } = model();
    analyseSlope(slope);
    const seeds = slope.search.filter((p) => p.fos != null).slice(0, 1);
    const change = () => slope.updateAnalysisOptions({ slices: 30 });
    expect(() => optimiseNonCircular(slope, seeds, change, { budgetPerSeed: 1 })).toThrow("The slope is in use by a running analysis.");
    // and the slope is whole afterwards
    expect(slope.sliceCount).toBe(25);
  });
});
