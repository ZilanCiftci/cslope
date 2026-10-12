import { describe, it, expect } from "vitest";
import { buildSlope } from "./build-slope";
import { toCanonicalSlopeDefinition } from "./canonical";
import { VERIFICATION_CASES, runVerification } from "../verification/cases";
import { analyseReliability } from "./reliability";
import { fitPolylineToGround } from "./surface";
import { Slope } from "./slope";
import { getSlices } from "./slices";
import { buildEnvelope, envelopeAt, pileForceDirection } from "./reinforcement";
import type { Pile } from "../types/reinforcement";
import type { AnalysisOptions } from "../types/analysis";
import { Material } from "../types/index";
import type { SlopeDefinition } from "../types/slope-definition";

const caseById = (id: string) => {
  const c = VERIFICATION_CASES.find((v) => v.id === id);
  if (!c) throw new Error(`No verification case ${id}`);
  return c;
};

describe("interslice data points of a right-to-left model", () => {
  it("are given with x = 0 at the left end of the surface in model space", () => {
    // V018 (Prandtl mechanism) slides right to left. An asymmetric f(x)
    // must give the same FOS as on the explicitly mirrored left-to-right
    // model with the mirrored function.
    const vp25 = caseById("V018").definition;
    const points: [number, number][] = [[0, 0], [0.3, 1], [1, 0.2]];
    const mirrored = points.map(([x, f]) => [1 - x, f] as [number, number]);
    const opts = { intersliceFunction: "data-point-specified" as const };
    const rtl = runVerification(vp25, "Morgenstern-Price", { ...opts, intersliceDataPoints: points }).fos!;
    const ltrDef = { ...toCanonicalSlopeDefinition(vp25), orientation: "ltr" as const };
    const ltr = runVerification(ltrDef, "Morgenstern-Price", { ...opts, intersliceDataPoints: mirrored }).fos!;
    expect(rtl).toBeCloseTo(ltr, 6);
    // Unmirrored the asymmetric function gives a clearly different FOS.
    const wrong = runVerification(ltrDef, "Morgenstern-Price", { ...opts, intersliceDataPoints: points }).fos!;
    expect(Math.abs(wrong - rtl)).toBeGreaterThan(0.005);
  });

  it("are mirrored only on a mirrored model", () => {
    const slope = buildSlope(toCanonicalSlopeDefinition(caseById("V018").definition));
    slope.updateAnalysisOptions({ intersliceDataPoints: [[0, 0], [0.25, 1]] });
    expect(slope.intersliceDataPoints).toEqual([[0.75, 1], [1, 0]]);
    slope.setMirrored(false);
    expect(slope.intersliceDataPoints).toEqual([[0, 0], [0.25, 1]]);
  });
});

describe("Morgenstern-Price λ iteration", () => {
  // Non-circular surface the optimisation reached on V002 (canonical
  // coordinates). Fm(λ) and Ff(λ) run parallel; beyond λ ≈ −0.95 the force
  // iteration no longer converges and its value dropped onto Fm, which was
  // taken for the Spencer solution (0.326 against Bishop 0.447).
  const surface: [number, number][] = [[39.28, 35], [43.44, 30.84], [47.43, 26.74], [49.63, 24.77], [51.83, 22.84], [54.03, 20.89], [56.23, 18.93], [58.43, 17.2], [60.63, 15.64], [62.83, 14.4], [65.03, 13.58], [67.23, 13.13], [69.43, 13.11], [71.62, 13.52], [73.82, 14.36], [75.36, 15.02], [76.9, 15.73]];

  it("does not take an unconverged force solution for the intersection", () => {
    const def = {
      ...toCanonicalSlopeDefinition(caseById("V002").definition),
      orientation: "ltr" as const,
      customSurfaces: [{ points: surface }],
      customPlanesOnly: true,
    };
    const spencer = runVerification(def, "Morgenstern-Price", { intersliceFunction: "constant", slices: 25 }).fos!;
    const bishop = runVerification(def, "Bishop", { slices: 25 }).fos!;
    expect(bishop).toBeCloseTo(0.4465, 3);
    expect(spencer).toBeGreaterThan(0.4);
  });

  it("keeps the V002 non-circular Spencer search within the published range", () => {
    // A commercial program 0.414, literature 0.39–0.44; the spurious intersections gave
    // 0.27–0.39 with exit segments of −60° and steeper (0.387 and −63°
    // with these settings).
    const { fos, slope } = runVerification(caseById("V002").definition, "Morgenstern-Price", {
      intersliceFunction: "constant",
      nonCircularOptimization: true,
    });
    expect(fos!).toBeGreaterThan(0.39);
    expect(fos!).toBeLessThan(0.44);
    const points = slope.search.find((p) => p.fos != null)!.points!;
    const [a, b] = points.slice(-2);
    const exitDeg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    expect(exitDeg).toBeLessThan(45);
  }, 120_000);
});

describe("Monte Carlo on a specified non-circular surface", () => {
  const vp34 = caseById("V061");
  const def = toCanonicalSlopeDefinition(vp34.definition);
  const options = { ...vp34.checks[0].options, method: "Morgenstern-Price" as const, intersliceFunction: "constant" as const };

  it("fits an already fitted polyline to the same surface", () => {
    // The printed surface ends just above the ground; once fitted its exit
    // lies on the ground and the crossing came out a hair beyond the end
    // vertex (exit height NaN), so the surface was dropped when rebuilt.
    const slope = buildSlope(def);
    const fitted = fitPolylineToGround(slope, def.customSurfaces![0].points)!;
    const refit = fitPolylineToGround(slope, fitted);
    expect(refit).not.toBeNull();
    expect(refit!.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(refit!.length).toBe(fitted.length);
  });

  it("samples V061's printed surface", () => {
    const r = analyseReliability(def, options, [{ material: 0, field: "cohesion", sd: 1e-6 }], {
      method: "monte-carlo",
      samples: 20,
    });
    expect(r.failed).toBe(0);
    expect(r.samples!.length).toBe(20);
    expect(r.meanFOS).toBeCloseTo(r.fos, 6);
  });
});

describe("water tables that do not span the slip surface", () => {
  const def: SlopeDefinition = {
    coordinates: [[0, -20], [0, 0], [20, 0], [40, -10], [60, -10], [60, -20]],
    materials: [
      { name: "Upper", unitWeight: 18, frictionAngle: 28, cohesion: 5, waterTableId: "own" },
      { name: "Lower", unitWeight: 20, frictionAngle: 32, cohesion: 2 },
    ],
    materialBoundaries: [{ coordinates: [[0, -6], [60, -6]], materialName: "" }],
    regionAssignments: [
      { point: [5, -2], materialName: "Upper" },
      { point: [5, -15], materialName: "Lower" },
    ],
    waterTable: { mode: "custom", value: [[0, -4], [60, -4]] },
    waterTables: [{ id: "own", coordinates: [[0, -3], [60, -3]] }],
  };

  it("rejects a material water table that cannot span anything", () => {
    // A one-point line gave the material no pore pressure at all, silently.
    expect(() => buildSlope({ ...def, waterTables: [{ id: "own", coordinates: [[10, -3]] }] })).toThrow(/water table/i);
    expect(() => buildSlope(def)).not.toThrow();
  });

  it("accepts two points at one x as a vertical step, extended both ways", () => {
    // E.g. the second point snapped straight above the first in the editor.
    const slope = buildSlope({ ...def, waterTable: { mode: "custom", value: [[30, -5], [30, -2]] } });
    expect(slope.waterRLXY!.x[0]).toBe(0);
    expect(slope.waterRLXY!.x.at(-1)).toBe(60);
    expect(slope.hasWaterTable).toBe(true);
  });

  it("a water line that cannot be built leaves no input behind", () => {
    const slope = new Slope();
    slope.addMaterial(new Material({ name: "M", unitWeight: 20, frictionAngle: 30, cohesion: 5 }));
    // Following the boundary before there is one fails...
    expect(() => slope.setWaterTable({ coordinates: [[0, 5], [10, 5]], followBoundary: true })).toThrow();
    // ...and must not come back to life when the boundary is set later.
    slope.setExternalBoundary([[0, 0], [0, 10], [60, 10], [60, 0]]);
    expect(slope.hasWaterTable).toBe(false);
  });

  it("extends a line given before the external boundary to the model edges", () => {
    const slope = new Slope();
    slope.addMaterial(new Material({ name: "M", unitWeight: 20, frictionAngle: 30, cohesion: 5 }));
    // Short line, entered before the boundary (nothing to extend it to yet).
    slope.setWaterTable({ coordinates: [[15, -3], [25, -3]], followBoundary: false });
    slope.setWaterTableById("own", [[15, -4], [25, -4]], false);
    slope.setExternalBoundary(def.coordinates);
    expect(slope.waterRLXY).toEqual({ x: [0, 15, 25, 60], y: [-3, -3, -3, -3] });
    // Slices beyond the ends of the given line have pore pressure.
    const slices = getSlices(slope, 5, 50, 30, 30, Math.hypot(25, 30));
    const beyond = slices.filter((s) => s.x > 30 && s.yBottom < -3);
    expect(beyond.length).toBeGreaterThan(0);
    expect(beyond.every((s) => s.U > 0)).toBe(true);
  });
});

describe("reinforcement coverage", () => {
  it("scales the interface pullout but not the per-element capacities", () => {
    // Tensile and end capacities are per element (strip); the coverage
    // Rc = strip width / spacing only sets the soil contact width.
    const slope = buildSlope({
      coordinates: [[0, -10], [0, 0], [20, 0], [30, -10]],
      materials: [{ name: "S", unitWeight: 20, frictionAngle: 30, cohesion: 0 }],
    });
    const element = (coverage: number) => ({
      x1: 2, y1: -3, x2: 12, y2: -3, tensileCapacity: 1e6, spacing: 1.5, end1Capacity: 40, end2Capacity: 0,
      pullout: { kind: "interface" as const, adhesion: 0, frictionAngle: 25, coverage },
    });
    const full = buildEnvelope(slope, element(1));
    const strip = buildEnvelope(slope, element(0.2));
    expect(strip.tensile).toBe(full.tensile);
    expect(strip.end1).toBe(full.end1);
    const total = (e: typeof full) => e.fromEnd1[e.fromEnd1.length - 1];
    expect(total(strip)).toBeCloseTo(0.2 * total(full), 9);
    // Pullout per element: 2·σ′v·tan δ·Rc·S per metre of element.
    expect(total(full)).toBeCloseTo(2 * 20 * 3 * Math.tan((25 * Math.PI) / 180) * 1.5 * 10, 6);
    // Midway the pullout behind (no end-2 anchorage) governs.
    expect(envelopeAt(strip, 5)).toBeCloseTo(0.5 * total(strip), 6);
  });
});

describe("pile force direction", () => {
  // The V095c input as it was when the commercial cross-check was made (the
  // no-pile circle, an Ito & Matsui pile capped at 10.7 kN); the
  // verification case itself now uses the program's with-pile circle.
  const pileCase = caseById("V095c");
  const definition: SlopeDefinition = {
    ...pileCase.definition,
    piles: [{ x1: 9, y1: 4, x2: 9, y2: -2, spacing: 1, diameter: 0.3, shearCapacity: 10.7, momentCapacity: 1000000 }],
    customSearchPlanes: [{ cx: 2.674, cy: 7.573, radius: 8.031 }],
    customPlanesOnly: true,
  };
  const run = (extra: Partial<Pile>) =>
    runVerification({ ...definition, piles: [{ ...definition.piles![0], ...extra }] }, "Bishop", pileCase.checks[0].options as Partial<AnalysisOptions>).fos!;

  it("keeps the given angle when no direction is set", () => {
    expect(run({})).toBeCloseTo(run({ direction: "angle" }), 9);
    expect(run({ angle: 10 })).not.toBeCloseTo(run({}), 3);
  });

  it("acts along the slip surface with direction tangent (the usual default)", () => {
    // A commercial program on cSlope's V095c input, pile passive and tangential: 1.1989.
    expect(run({ application: "passive", direction: "tangent" })).toBeCloseTo(1.1989, 3);
  });

  it("is horizontal perpendicular to a vertical pile", () => {
    expect(run({ direction: "perpendicular" })).toBeCloseTo(run({}), 9);
    expect(run({ direction: "perpendicular", application: "passive" })).toBeCloseTo(run({ application: "passive" }), 9);
  });

  it("is normal to an inclined pile, against the movement", () => {
    const pile: Pile = { x1: 0, y1: 0, x2: 3, y2: -4, force: 10 };
    // Movement down the slip surface at 30°, towards +x.
    const [tx, ty] = [Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6)];
    const [ux, uy] = pileForceDirection({ ...pile, direction: "perpendicular" }, tx, ty);
    expect(ux * 3 + uy * -4).toBeCloseTo(0, 12);
    expect(Math.hypot(ux, uy)).toBeCloseTo(1, 12);
    expect(ux * tx + uy * ty).toBeLessThan(0);
    expect(pileForceDirection({ ...pile, direction: "tangent" }, tx, ty)).toEqual([-tx, -ty]);
    expect(pileForceDirection({ ...pile, angle: 0 }, tx, ty)).toEqual([-1, 0]);
  });

  it("rejects an unknown direction", () => {
    expect(() => run({ direction: "sideways" as Pile["direction"] })).toThrow(/direction/);
  });
});

describe("strength cutoff as a floor", () => {
  it("a floor above the reference Su is valid, also for reliability with varied values", () => {
    // S = f(datum) 30 kPa at y = 0, decreasing 0.5 kPa/m downwards, floor 25:
    // Taylor's mean − σ (24 kPa) used to fail validation and abort the run.
    const ground: [number, number][] = [[0, 10], [10, 10], [25, 0], [40, 0]];
    const clay = { kind: "s-f-datum" as const, unitWeight: 18, suRef: 30, yRef: 0, rate: -0.5, suMax: 25 };
    const def = {
      coordinates: [[0, -10], [0, 10], [10, 10], [25, 0], [40, 0], [40, -10]] as [number, number][],
      materials: [{ name: "Clay", unitWeight: 18, frictionAngle: 0, cohesion: 0, model: clay }],
      materialBoundaries: [],
      regionAssignments: [{ point: [5, 0] as [number, number], materialName: "Clay" }],
    };
    void ground;
    const r = analyseReliability(def, { method: "Bishop", iterations: 300, refinedIterations: 100 }, [{ material: 0, field: "suRef", sd: 6 }], { method: "taylor", search: false });
    expect(Number.isFinite(r.fos)).toBe(true);
    expect(r.terms![0].fMinus).toBeGreaterThan(0);
  });
});

