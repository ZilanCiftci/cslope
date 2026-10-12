/**
 * The Slope model's setters, validation and query methods: every error
 * path and the boundary values that are accepted.
 */
import { describe, it, expect } from "vitest";
import { Material, Udl, LineLoad } from "../types/index";
import type { Pile, Reinforcement } from "../types/reinforcement";
import type { AnalysisOptions } from "../types/analysis";
import { SLICES_RANGE, ITERATIONS_RANGE, REFINED_ITERATIONS_RANGE } from "../types/constants";
import { Slope } from "./slope";
import { analyseSlope } from "./solvers";
import { addSingleCircularPlane } from "./search";

const BOUNDARY: [number, number][] = [[0, -10], [0, 10], [10, 10], [25, 0], [40, 0], [40, -10]];
const soil = () => new Material({ name: "S", unitWeight: 19, cohesion: 10, frictionAngle: 25 });

function model(): Slope {
  const s = new Slope();
  s.addMaterial(soil());
  s.setExternalBoundary(BOUNDARY);
  return s;
}

describe("Slope: geometry setup", () => {
  it("rejects a boundary with fewer than 3 points and closes an open one", () => {
    expect(() => new Slope().setExternalBoundary([[0, 0], [1, 1]])).toThrow(/at least 3 points/);
    expect(() => new Slope().setExternalBoundary(undefined as unknown as [number, number][])).toThrow(/at least 3/);
    const s = model();
    expect(s.materialGeometries[0].px.length).toBe(BOUNDARY.length + 1);
    // Already closed: not closed again.
    const t = new Slope();
    t.setExternalBoundary([...BOUNDARY, BOUNDARY[0]]);
    expect(t.materialGeometries[0].px.length).toBe(BOUNDARY.length + 1);
  });

  it("uses a placeholder material without addMaterial; addMaterial ignores duplicates", () => {
    const s = new Slope();
    s.setExternalBoundary(BOUNDARY);
    expect(s.materialGeometries[0].material).toBeInstanceOf(Material);
    const m = soil();
    const t = new Slope();
    t.addMaterial(m);
    t.addMaterial(m);
    t.setExternalBoundary(BOUNDARY);
    expect(t.materialGeometries[0].material).toBe(m);
  });

  it("material boundaries need the external boundary and two points", () => {
    expect(() => new Slope().setMaterialBoundaries([[[0, 0], [1, 0]]])).toThrow(/External boundary must be set/);
    expect(() => model().setMaterialBoundary([[0, 0]])).toThrow(/at least 2 coordinate points/);
    expect(() => model().setMaterialBoundary(null as unknown as [number, number][])).toThrow(/at least 2/);
  });

  it("setMaterialBoundary reports whether it split anything", () => {
    const s = model();
    expect(s.setMaterialBoundary([[0, 2], [40, -2]])).toBe(true);
    expect(s.materialGeometries).toHaveLength(2);
    // Entirely outside the model.
    expect(s.setMaterialBoundary([[0, 50], [40, 50]])).toBe(false);
    expect(s.splitFailed).toBe(false);
  });

  it("assignMaterial accepts only Material instances; a point outside every region is ignored", () => {
    const s = model();
    expect(() => s.assignMaterial([1, 1], { name: "x" } as unknown as Material)).toThrow(/instances of the Material class/);
    const other = new Material({ name: "O", unitWeight: 18, cohesion: 1, frictionAngle: 30 });
    s.assignMaterial([100, 100], other);
    expect(s.materialGeometries[0].material.name).toBe("S");
    s.assignMaterial([1, 1], other);
    expect(s.materialGeometries[0].material).toBe(other);
  });

  it("model area, height and ground relief; automatic minimum slip area", () => {
    const empty = new Slope();
    expect(empty.modelArea).toBe(0);
    expect(empty.modelHeight).toBe(0);
    expect(empty.groundRelief).toBe(0);
    expect(empty.surfaceLineXY).toBeNull();
    const s = model();
    // 40 × 10 below y = 0 plus the slope above it.
    expect(s.modelArea).toBeCloseTo(400 + 10 * 10 + 0.5 * 15 * 10, 9);
    expect(s.modelHeight).toBe(20);
    expect(s.groundRelief).toBe(10);
    expect(s.minSlipArea).toBeCloseTo(1e-2 * 100, 12);
    s.updateAnalysisOptions({ minSlipArea: 3 });
    expect(s.minSlipArea).toBe(3);
    s.updateAnalysisOptions({ minSlipArea: null });
    expect(s.minSlipArea).toBeCloseTo(1, 12);
  });

  it("queries need the geometry", () => {
    const s = new Slope();
    expect(() => s.getExternalYIntersection(1)).toThrow(/Surface line coordinates are not defined/);
    expect(() => s.getCircleExternalIntersection(0, 0, 1)).toThrow(/Surface line is not defined/);
    expect(() => s.removeAnalysisLimits()).toThrow(/Surface line is not defined/);
    expect(() => s.getWaterYIntersection(1)).toThrow(/Water table coordinates are not defined/);
    expect(s.isInsideExternalBoundary(0, 0)).toBe(false);
    expect(s.toString()).toBe("Slope");
  });

  it("surface and water elevations (cached), inside test", () => {
    const s = model();
    expect(s.getExternalYIntersection(17.5)).toBeCloseTo(5, 12);
    expect(s.getExternalYIntersection(17.5)).toBeCloseTo(5, 12);
    expect(s.isInsideExternalBoundary(20, 0)).toBe(true);
    expect(s.isInsideExternalBoundary(20, 9)).toBe(false);
    s.setWaterTable({ height: 2, followBoundary: false });
    expect(s.getWaterYIntersection(30)).toBe(2);
    expect(s.getWaterYIntersection(30)).toBe(2);
  });

  it("a circle through a surface vertex is found once", () => {
    const s = model();
    // Through (10, 10) and (25, 0), centre on their bisector.
    const ints = s.getCircleExternalIntersection(10, 0, 10);
    const xs = ints.map((p) => p[0]);
    expect(new Set(xs.map((x) => x.toFixed(9))).size).toBe(xs.length);
  });
});

describe("Slope: water tables", () => {
  it("depth and height need the external boundary", () => {
    expect(() => new Slope().setWaterTable({ depth: 2 })).toThrow(/before using depth/);
    expect(() => new Slope().setWaterTable({ height: 2 })).toThrow(/before setting water table/);
  });

  it("depth is measured below the highest point of the boundary", () => {
    const s = model();
    s.setWaterTable({ depth: 4, followBoundary: false });
    expect(s.waterRLXY!.y).toEqual([6, 6]);
    expect(s.hasWaterTable).toBe(true);
  });

  it("rejects non-finite points and lines with fewer than two points", () => {
    const s = model();
    expect(() => s.setWaterTable({ coordinates: [[0, 1], [NaN, 2]] })).toThrow(/finite numbers/);
    expect(() => s.setWaterTable({ coordinates: [[0, 1]] })).toThrow(/two points/);
    expect(() => s.setWaterTableById("w", [[5, 1]])).toThrow(/two points/);
  });

  it("accepts two points at one x as a vertical step extended to both edges", () => {
    const s = model();
    s.setWaterTable({ coordinates: [[5, 1], [5, 2]], followBoundary: false });
    expect(s.hasWaterTable).toBe(true);
    expect(s.waterRLXY!.x[0]).toBe(BOUNDARY[0][0]);
    s.setWaterTableById("w", [[5, 1], [5, 3]], false);
  });

  it("a line given before the boundary is extended to its edges once the boundary is set", () => {
    const s = new Slope();
    s.addMaterial(soil());
    s.setWaterTable({ coordinates: [[10, 1], [20, 0]], followBoundary: false });
    s.setWaterTableById("p", [[10, -2], [30, -3]], false);
    s.setExternalBoundary(BOUNDARY);
    expect(s.waterRLXY!.x[0]).toBe(0);
    expect(s.waterRLXY!.x[s.waterRLXY!.x.length - 1]).toBe(40);
    const m = s.materialGeometries[0].material;
    s.assignMaterialWaterTable(m, "p");
    expect(s.hasMaterialWaterTables).toBe(true);
    expect(s.getWaterLineForMaterial(m)!.y[0]).toBe(-2);
    expect(s.allWaterLines).toHaveLength(2);
    // Unknown id: the default line.
    const other = soil();
    s.assignMaterialWaterTable(other, "missing");
    expect(s.getWaterLineForMaterial(other)).toBe(s.waterRLXY);
    expect(s.getWaterLineForMaterial(null)).toBe(s.waterRLXY);
  });

  it("a line entered right to left is reversed; removeWaterTable clears every line", () => {
    const s = model();
    s.setWaterTable({ coordinates: [[40, -1], [0, 3]], followBoundary: false });
    expect(s.waterRLXY!.x).toEqual([0, 40]);
    expect(s.waterRLXY!.y).toEqual([3, -1]);
    s.setWaterTableById("p", [[0, 0], [40, 0]]);
    s.assignMaterialWaterTable(s.materialGeometries[0].material, "p");
    s.removeWaterTable();
    expect(s.hasWaterTable).toBe(false);
    expect(s.hasMaterialWaterTables).toBe(false);
    expect(s.allWaterLines).toEqual([]);
    expect(s.getWaterLineForMaterial(s.materialGeometries[0].material)).toBeNull();
  });

  it("with followBoundary the line never rises above the ground", () => {
    const s = model();
    s.setWaterTable({ height: 8 });
    for (const x of [5, 15, 20, 30]) {
      expect(s.getWaterYIntersection(x)).toBeLessThanOrEqual(s.getExternalYIntersection(x) + 1e-9);
    }
  });
});

describe("Slope: loads", () => {
  it("drops zero loads; UDLs add up, line loads replace", () => {
    const s = model();
    s.setUdls(new Udl({ magnitude: 10, x1: 0, x2: 5 }), new Udl({ magnitude: 0, x1: 0, x2: 5 }));
    s.setUdls(new Udl({ magnitude: 5, x1: 5, x2: 8 }));
    expect(s.udls).toHaveLength(2);
    s.removeUdls();
    expect(s.udls).toHaveLength(0);
    s.setLineLoads(new LineLoad({ magnitude: 10, x: 3 }), new LineLoad({ magnitude: 0, x: 4 }));
    s.setLineLoads(new LineLoad({ magnitude: 20, x: 5 }));
    expect(s.lineLoads).toHaveLength(1);
    s.removeLineLoads();
    expect(s.lineLoads).toHaveLength(0);
  });
});

describe("Slope: reinforcement and pile validation", () => {
  const nail: Reinforcement = { x1: 20, y1: 4, x2: 10, y2: 1, tensileCapacity: 100 };
  const bad: [string, Partial<Reinforcement>, RegExp][] = [
    ["non-finite end", { x2: NaN }, /finite end points/],
    ["non-finite capacity", { tensileCapacity: Infinity }, /finite end points/],
    ["negative capacity", { tensileCapacity: -1 }, /capacities must be ≥ 0/],
    ["negative end capacity", { end1Capacity: -1 }, /capacities must be ≥ 0/],
    ["NaN end capacity", { end2Capacity: NaN }, /capacities must be ≥ 0/],
    ["zero spacing", { spacing: 0 }, /spacing must be > 0/],
    ["bond strength < 0", { pullout: { kind: "bond", strength: -1 } }, /bond strength/],
    ["bonded length < 0", { pullout: { kind: "bond", strength: 10, bondedLength: -1 } }, /bond strength/],
    ["development length missing", { pullout: { kind: "development", length1: 1 } as never }, /development lengths/],
    ["development length < 0", { pullout: { kind: "development", length1: 1, length2: -1 } }, /development lengths/],
    ["adhesion < 0", { pullout: { kind: "interface", adhesion: -1, frictionAngle: 20 } }, /adhesion/],
    ["interface φ = 90", { pullout: { kind: "interface", adhesion: 0, frictionAngle: 90 } }, /adhesion/],
    ["coverage 0", { pullout: { kind: "interface", adhesion: 0, frictionAngle: 20, coverage: 0 } }, /adhesion/],
  ];
  it.each(bad)("reinforcement: rejects %s", (_l, change, msg) => {
    expect(() => model().setReinforcements([{ ...nail, ...change } as Reinforcement])).toThrow(msg);
  });

  it("reinforcement: accepts the boundary values and keeps zero-capacity elements", () => {
    const s = model();
    s.setReinforcements([
      { ...nail, tensileCapacity: 0, end1Capacity: 0, end2Capacity: 0, spacing: 1e-6 },
      { ...nail, pullout: { kind: "bond", strength: 0, bondedLength: 0 } },
      { ...nail, pullout: { kind: "development", length1: 0, length2: 0 } },
      { ...nail, pullout: { kind: "interface", adhesion: 0, frictionAngle: 0, coverage: 1e-6 } },
    ]);
    expect(s.reinforcements).toHaveLength(4);
    expect(s.reinforcementEnvelopes).toHaveLength(4);
  });

  const pile: Pile = { x1: 20, y1: 4, x2: 20, y2: -8, force: 50 };
  const badPiles: [string, Partial<Pile>, RegExp][] = [
    ["non-finite tip", { y2: NaN }, /finite head and tip/],
    ["negative force", { force: -1 }, /≥ 0, spacing and diameter > 0/],
    ["negative shear capacity", { shearCapacity: -1 }, /≥ 0/],
    ["NaN moment capacity", { momentCapacity: NaN }, /≥ 0/],
    ["zero spacing", { spacing: 0 }, /spacing and diameter > 0/],
    ["zero diameter", { diameter: 0 }, /spacing and diameter > 0/],
    ["angle 90", { angle: 90 }, /between −90° and 90°/],
    ["angle NaN", { angle: NaN }, /between −90° and 90°/],
    ["unknown direction", { direction: "down" as never }, /'angle', 'tangent' or 'perpendicular'/],
    ["no force and no diameter", { force: undefined }, /shear force, or a diameter/],
    ["Ito & Matsui inclined", { force: undefined, diameter: 0.5, spacing: 2, x2: 21 }, /vertical pile/],
    ["Ito & Matsui no gap", { force: undefined, diameter: 1, spacing: 1 }, /spacing larger than the pile diameter/],
    ["Ito & Matsui default spacing", { force: undefined, diameter: 1 }, /spacing larger/],
  ];
  it.each(badPiles)("pile: rejects %s", (_l, change, msg) => {
    expect(() => model().setPiles([{ ...pile, ...change }])).toThrow(msg);
  });

  it("pile: accepts the boundary values", () => {
    const s = model();
    s.setPiles([
      { ...pile, force: 0, shearCapacity: 0, momentCapacity: 0, angle: -89.9 },
      { ...pile, force: undefined, diameter: 0.5, spacing: 0.5001 },
      { ...pile, direction: "tangent" },
      { ...pile, direction: "perpendicular", x2: 21 },
    ]);
    expect(s.piles).toHaveLength(4);
    expect(s.pileProfiles[0]).toBeNull();
    expect(s.pileProfiles[1]).not.toBeNull();
  });
});

describe("Slope: analysis options", () => {
  const invalid: [string, Partial<AnalysisOptions>, RegExp][] = [
    ["method", { method: "Spencer" as never }, /Method must be one of/],
    ["pore pressure head", { porePressureHead: "hydrostatic" as never }, /porePressureHead/],
    ["crack depth < 0", { tensionCrackDepth: -1 }, /tensionCrackDepth/],
    ["crack depth NaN", { tensionCrackDepth: NaN }, /tensionCrackDepth/],
    ["crack water > 1", { tensionCrackWater: 1.01 }, /between 0 and 1/],
    ["crack water < 0", { tensionCrackWater: -0.01 }, /between 0 and 1/],
    ["crack water NaN", { tensionCrackWater: NaN }, /between 0 and 1/],
    ["min slip depth < 0", { minSlipDepth: -1 }, /minSlipDepth/],
    ["min slip depth Infinity", { minSlipDepth: Infinity }, /minSlipDepth/],
    ["min slip area < 0", { minSlipArea: -1 }, /minSlipArea/],
    ["min slip area NaN", { minSlipArea: NaN }, /minSlipArea/],
    ["partial factor 0", { partialFactors: { cu: 1, cohesion: 1, tanPhi: 0, variableLoad: 1 } }, /Partial factors/],
    ["partial factor NaN", { partialFactors: { cu: NaN, cohesion: 1, tanPhi: 1, variableLoad: 1 } }, /Partial factors/],
    ["interslice function", { intersliceFunction: "cubic" as never }, /intersliceFunction must be one of/],
  ];
  it.each(invalid)("rejects an invalid %s", (_l, opts, msg) => {
    expect(() => model().updateAnalysisOptions(opts)).toThrow(msg);
  });

  it("accepts the boundary values", () => {
    const s = model();
    s.updateAnalysisOptions({
      tensionCrackDepth: 0,
      tensionCrackWater: 1,
      minSlipDepth: 0,
      minSlipArea: 0,
      porePressureHead: "phreatic-correction",
      partialFactors: { cu: 1e-9, cohesion: 1, tanPhi: 1, variableLoad: 1 },
      tensionCrackAuto: true,
      janbuCorrection: true,
      nonCircularOptimization: true,
    });
    expect(s.tensionCrackWater).toBe(1);
    expect(s.porePressureHead).toBe("phreatic-correction");
    expect(s.partialFactors!.cu).toBe(1e-9);
    expect(s.tensionCrackAuto).toBe(true);
    expect(s.janbuCorrection).toBe(true);
    expect(s.nonCircularOptimization).toBe(true);
    s.updateAnalysisOptions({ partialFactors: null });
    expect(s.partialFactors).toBeNull();
  });

  it("clamps slices, iterations and the inner iteration limit", () => {
    const s = model();
    s.updateAnalysisOptions({ slices: 1, iterations: 1, refinedIterations: -5, maxIterations: 1 });
    expect(s.sliceCount).toBe(SLICES_RANGE.min);
    expect(s.iterations).toBe(ITERATIONS_RANGE.min);
    expect(s.refinedIterations).toBe(REFINED_ITERATIONS_RANGE.min);
    expect(s.maxIterations).toBe(6);
    s.updateAnalysisOptions({ slices: 1e9, iterations: 1e12, refinedIterations: 1e12 });
    expect(s.sliceCount).toBe(SLICES_RANGE.max);
    expect(s.iterations).toBe(ITERATIONS_RANGE.max);
    expect(s.refinedIterations).toBe(REFINED_ITERATIONS_RANGE.max);
    // The minimum failure distance is at most 90 % of the model length.
    s.updateAnalysisOptions({ minFailureDist: 1000 });
    expect(s.minFailureDistance).toBeCloseTo(36, 12);
  });

  it("keeps only finite interslice data points; mirrored models mirror them", () => {
    const s = model();
    s.updateAnalysisOptions({
      intersliceFunction: "data-point-specified",
      intersliceDataPoints: [[0, 0.2], [NaN, 1], [0.3, Infinity], [1] as unknown as [number, number], [0.6, 1]],
    });
    expect(s.intersliceDataPoints).toEqual([[0, 0.2], [0.6, 1]]);
    expect(s.mirrored).toBe(false);
    s.setMirrored(true);
    expect(s.mirrored).toBe(true);
    const mirrored = s.intersliceDataPoints;
    expect(mirrored[0][0]).toBeCloseTo(0.4, 12);
    expect(mirrored[0][1]).toBe(1);
    expect(mirrored[1]).toEqual([1, 0.2]);
  });
});

describe("Slope: analysis limits and results", () => {
  it("one bound of a pair sets both; bounds are put in order", () => {
    const s = model();
    s.setAnalysisLimits({ entryLeftX: 5, exitLeftX: 30 });
    expect(s.limits).toEqual([5, 5, 30, 30]);
    s.setAnalysisLimits({ entryLeftX: 8, entryRightX: 2, exitLeftX: 39, exitRightX: 26 });
    expect(s.limits).toEqual([2, 8, 26, 39]);
    // Only a right bound: the left one is kept.
    s.setAnalysisLimits({ entryRightX: 9 });
    expect(s.limits).toEqual([2, 9, 26, 39]);
    s.removeAnalysisLimits();
    expect(s.limits).toEqual([0, 40, 0, 40]);
  });

  it("result queries throw before an analysis and answer after it", () => {
    const s = model();
    expect(() => s.getMinFOS()).toThrow(/No analysis results/);
    expect(() => s.getMaxFOS()).toThrow(/No analysis results/);
    expect(() => s.getMinFOSCircle()).toThrow(/No analysis results/);
    expect(() => s.getMinFOSEndPoints()).toThrow(/No analysis results/);
    addSingleCircularPlane(s, 20, 20, 18);
    addSingleCircularPlane(s, 22, 16, 17);
    s.customPlanesOnly = true;
    expect(s.customPlanesOnly).toBe(true);
    s.updateAnalysisOptions({ slices: 20 });
    const f = analyseSlope(s)!;
    expect(s.getMinFOS()).toBe(f);
    expect(s.getMaxFOS()).toBeGreaterThanOrEqual(f);
    expect(s.getMinFOSCircle().radius).toBeGreaterThan(0);
    const { entry, exit } = s.getMinFOSEndPoints();
    expect(entry[0]).toBeLessThan(exit[0]);
    // Changing the model drops the results.
    s.materialsChanged();
    expect(() => s.getMinFOS()).toThrow(/No analysis results/);
    s.removeIndividualPlanes();
    expect(s.individualPlanes).toHaveLength(0);
  });

  it("fixed slice boundaries", () => {
    const s = model();
    s.addFixedSlices([12, 15, 18]);
    expect(s.fixedSlices).toEqual([12, 15, 18]);
  });
});
