import { describe, expect, it } from "vitest";
import type { Slice } from "../types/index";
import type { SlopeDefinition } from "../types/slope-definition";
import { VERIFICATION_CASES, runVerification } from "../verification/cases";
import { buildSlope } from "./build-slope";
import { analysisWarnings, entryInclination, M_ALPHA_WARNING_LIMIT } from "./result-warnings";
import type { Slope } from "./slope";
import { analyseSlope, solvedEffectiveNormals } from "./solvers";

const mc = (unitWeight: number, cohesion: number, frictionAngle: number) =>
  ({ kind: "mohr-coulomb", unitWeight, cohesion, frictionAngle }) as const;

describe("analysisWarnings on the critical surface", () => {
  /** A slope stub with one analysed surface of the given slices. */
  const stub = (slices: Partial<Slice>[], fos: number): Slope =>
    ({
      danglingBoundaries: [],
      method: "Bishop",
      janbuCorrection: false,
      search: [{ fos, slices }],
    }) as unknown as Slope;
  const deg = Math.PI / 180;

  it("counts slices with N′ < 0 and ignores N′ = 0 within rounding", () => {
    const slices = [0, 10, 20, 30].map((a) => ({ alpha: a * deg, phi: 30 * deg }));
    const w = analysisWarnings(stub(slices, 1.5), [-5, -1e-9, 40, 100]);
    expect(w).toEqual([
      {
        code: "negative-effective-normal",
        message: "1 slice of the critical surface has negative effective normal force (N′ < 0) at the base.",
        count: 1,
      },
    ]);
  });

  it("counts slices with m_α below 0.2 (Whitman and Bailey 1967)", () => {
    // m_α = cos α + sin α tan φ / F, F = 1: at α = −50°, φ = 40°:
    // 0.643 − 0.766 × 0.839 = 0.000; at α = −40°: 0.226.
    const slices = [-50, -45, -40, 0, 30].map((a) => ({ alpha: a * deg, phi: 40 * deg }));
    const w = analysisWarnings(stub(slices, 1), [1, 1, 1, 1, 1]);
    expect(M_ALPHA_WARNING_LIMIT).toBe(0.2);
    expect(w).toEqual([
      {
        code: "low-m-alpha",
        message:
          "2 slices of the critical surface have m_α below 0.2 (steep base); the factor of safety may be unreliable.",
        count: 2,
      },
    ]);
  });

  it("uses tan φ = 0 for a slice where the undrained strength governs", () => {
    const slices = [{ alpha: -50 * deg, phi: 40 * deg, undrainedGoverns: true }];
    expect(analysisWarnings(stub(slices, 1), [1])).toEqual([]);
  });

  it("checks only the critical (first analysed) surface", () => {
    const slope = {
      danglingBoundaries: [],
      method: "Bishop",
      janbuCorrection: false,
      search: [
        { fos: null, slices: [{ alpha: -50 * deg, phi: 40 * deg }] },
        { fos: 1.2, slices: [{ alpha: 0, phi: 30 * deg }] },
      ],
    } as unknown as Slope;
    expect(analysisWarnings(slope, [10])).toEqual([]);
  });

  it("solves N′ itself when none are given", () => {
    // Strong over weak, the critical surface has tension at the base of
    // the slice below the crest (cohesive crust without a tension crack).
    const def: SlopeDefinition = {
      coordinates: [[0, -10], [0, 10], [10, 10], [30, 0], [40, 0], [40, -10]],
      materials: [
        { name: "Strong", model: mc(18, 15, 30) },
        { name: "Weak", model: mc(18, 2, 8) },
      ],
      materialBoundaries: [{ coordinates: [[0, 3], [40, -1]], materialName: "Weak" }],
      regionAssignments: [
        { point: [1, 9], materialName: "Strong" },
        { point: [1, -5], materialName: "Weak" },
      ],
    };
    const slope = buildSlope(def);
    slope.updateAnalysisOptions({ method: "Bishop", iterations: 300, refinedIterations: 100 });
    analyseSlope(slope);
    const crit = slope.search.find((p) => p.fos != null)!;
    const normals = solvedEffectiveNormals(slope, crit.slices!, crit.fos!, crit.lffArray)!;
    const negative = normals.filter((n) => n < 0).length;
    expect(negative).toBeGreaterThan(0);
    const w = analysisWarnings(slope).find((x) => x.code === "negative-effective-normal");
    expect(w?.count).toBe(negative);
  });
});

describe("Bishop on a non-circular surface", () => {
  // V046: Fredlund and Krahn's (1977) composite surface along a weak seam.
  const v046 = VERIFICATION_CASES.find((c) => c.id === "V046a")!.definition;
  const points = v046.customSurfaces![0].points;
  // The default axis (defaultAxisPoint), the published circle's centre and
  // other points above the sliding mass.
  const axes: ([number, number] | undefined)[] = [undefined, [120, 90], [100, 110], [140, 100], [110, 70], [90, 120]];
  const withAxis = (axis?: [number, number]) => ({ ...v046, customSurfaces: [{ points, axis }] });
  const hasWarning = (slope: Slope) => analysisWarnings(slope).some((w) => w.code === "bishop-non-circular");

  it("Morgenstern-Price and Spencer do not depend on the moment axis", () => {
    // Both satisfy moment and force equilibrium, so the factor is the same
    // about any point (Fredlund and Krahn 1977). Tight tolerance: the
    // invariance holds to the solver's convergence.
    for (const intersliceFunction of ["half-sine", "constant"] as const) {
      const fos = axes.map((axis) =>
        runVerification(withAxis(axis), "Morgenstern-Price", { intersliceFunction, tolerance: 1e-5 }).fos!,
      );
      expect(Math.max(...fos) - Math.min(...fos)).toBeLessThan(1e-4);
    }
  });

  it("Bishop depends on the moment axis and is flagged", () => {
    // λ = 0 leaves horizontal force equilibrium unsatisfied, so the moment
    // factor moves with the axis (1.363 to 1.406 here).
    const runs = axes.map((axis) => runVerification(withAxis(axis), "Bishop"));
    const fos = runs.map((r) => r.fos!);
    expect(Math.max(...fos) - Math.min(...fos)).toBeGreaterThan(0.02);
    for (const { slope } of runs) {
      const w = analysisWarnings(slope).filter((x) => x.code === "bishop-non-circular");
      expect(w).toHaveLength(1);
      expect(w[0].message).toMatch(/depends on the moment axis/);
    }
  });

  it("is not flagged for Morgenstern-Price on the polyline", () => {
    expect(hasWarning(runVerification(withAxis(), "Morgenstern-Price").slope)).toBe(false);
  });

  it("is not flagged for Bishop on a circle", () => {
    const circleOnly = { ...v046, customSurfaces: undefined, customPlanesOnly: false };
    // (circles only: a composite circle along the base is flagged too)
    const { slope } = runVerification(circleOnly, "Bishop", { iterations: 200, refinedIterations: 0, compositeSurfaces: false });
    expect(slope.search.find((p) => p.fos != null)?.points).toBeUndefined();
    expect(hasWarning(slope)).toBe(false);
  });

  it("is flagged for Bishop after the non-circular optimisation", () => {
    const circleOnly = { ...v046, customSurfaces: undefined, customPlanesOnly: false };
    const { slope } = runVerification(circleOnly, "Bishop", {
      iterations: 200,
      refinedIterations: 0,
      nonCircularOptimization: true,
    });
    // The optimised surface follows the weak seam.
    expect(slope.search.find((p) => p.fos != null)?.points).toBeDefined();
    expect(hasWarning(slope)).toBe(true);
  });
});

describe("steep entry without complete equilibrium", () => {
  // φ = 0 slope with a vertical upper face: the circle enters at about 82°
  // and Spencer finds no λ where moment and force equilibrium meet.
  const def = {
    orientation: "ltr",
    coordinates: [[0, -10.1434], [0, 12.3984], [13.0087, 12.3984], [38.2674, 0], [52.0491, 0], [52.0491, -10.1434]],
    materials: [{ name: "Upper", model: mc(20.8894, 17.2195, 0) }],
    customSearchPlanes: [{ cx: 27.1581, cy: 14.9465, radius: 19.4513 }],
    customPlanesOnly: true,
  } as SlopeDefinition;
  const spencer = { intersliceFunction: "constant" } as const;

  it("names the steep entry and the crack angle when no surface solves", () => {
    const { fos, slope } = runVerification(def, "Morgenstern-Price", spencer);
    expect(fos).toBeNull();
    expect(entryInclination(slope.search[0])).toBeCloseTo(82.4, 0);
    const w = analysisWarnings(slope).find((x) => x.code === "steep-entry-no-equilibrium");
    expect(w?.message).toMatch(/enters the slope at 82°.*Crack at base angle/);
  });

  it("solves with the steep part cut off, without the warning", () => {
    const { fos, slope } = runVerification(def, "Morgenstern-Price", { ...spencer, tensionCrackAngle: 70 });
    const bishop = runVerification(def, "Bishop", { tensionCrackAngle: 70 }).fos!;
    // φ = 0: moment equilibrium alone fixes F, the same for every method.
    expect(fos!).toBeCloseTo(bishop, 3);
    expect(analysisWarnings(slope).some((x) => x.code === "steep-entry-no-equilibrium")).toBe(false);
  });

  it("is not given for Bishop, which names the tension at the steep entry instead", () => {
    const { fos, slope } = runVerification(def, "Bishop");
    const codes = analysisWarnings(slope).map((x) => x.code);
    expect(codes).not.toContain("steep-entry-no-equilibrium");
    const w = analysisWarnings(slope).find((x) => x.code === "steep-entry-tension");
    expect(w?.message).toMatch(/enters the slope at 82°.*tension.*Crack at base angle/);
    expect(w?.count).toBeGreaterThan(0);
    // Without the slices that hold by tension the factor is lower here.
    const cut = runVerification(def, "Bishop", { tensionCrackAngle: 70 });
    expect(cut.fos!).toBeLessThan(fos!);
    expect(analysisWarnings(cut.slope).map((x) => x.code)).not.toContain("steep-entry-tension");
  });

  it("names the steep entry for Janbu and a converged Morgenstern-Price too", () => {
    const cphi = { ...def, materials: [{ name: "U", model: mc(20, 15, 25) }] } as SlopeDefinition;
    for (const [method, o] of [["Janbu", {}], ["Morgenstern-Price", { intersliceFunction: "half-sine" }]] as const) {
      const { fos, slope } = runVerification(cphi, method, o);
      expect(fos).not.toBeNull();
      expect(analysisWarnings(slope).map((x) => x.code), method).toContain("steep-entry-tension");
    }
  });
});

describe("the critical surface on the edge of the search limits", () => {
  /** A 2:1 slope 10 m high, crest at x = 20, toe at x = 40 (a synthetic example). */
  const slope = (exit: [number, number]): SlopeDefinition =>
    ({
      coordinates: [
        [0, 0],
        [0, 15],
        [20, 15],
        [40, 5],
        [60, 5],
        [60, 0],
      ],
      materials: [{ name: "Clay", model: mc(19, 8, 28) }],
      materialBoundaries: [],
      regionAssignments: [{ point: [30, 1], materialName: "Clay" }],
      analysisLimits: { entryLeftX: 2, entryRightX: 19, exitLeftX: exit[0], exitRightX: exit[1] },
    });
  const edge = (exit: [number, number]) =>
    analysisWarnings(runVerification(slope(exit), "Bishop").slope).find((x) => x.code === "search-edge");

  it("warns when the critical circle exits at the end of its range", () => {
    // The toe circle would exit at the toe (x = 40), 2 m outside the range.
    expect(edge([42, 55])).toEqual({
      code: "search-edge",
      message:
        "The critical surface lies on the edge of the search limits (exit at the left end of its range); the minimum may lie outside. Widen the search limits.",
    });
  });

  it("does not warn with wide limits or at the toe", () => {
    expect(edge([30, 55])).toBeUndefined();
    expect(edge([40, 55])).toBeUndefined(); // a corner of the ground
  });
});
