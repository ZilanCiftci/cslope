import { describe, expect, it } from "vitest";
import type { Slice } from "../types/index";
import type { SlopeDefinition } from "../types/slope-definition";
import { buildSlope } from "./build-slope";
import { polygonizeRegionsDetailed } from "./geometry-ops";
import { analysisWarnings, M_ALPHA_WARNING_LIMIT } from "./result-warnings";
import type { Slope } from "./slope";
import { analyseSlope, solvedEffectiveNormals } from "./solvers";

const mc = (unitWeight: number, cohesion: number, frictionAngle: number) =>
  ({ kind: "mohr-coulomb", unitWeight, cohesion, frictionAngle }) as const;

describe("boundary end snapping", () => {
  const ring: [number, number][] = [[0, -10], [0, 10], [10, 10], [30, 0], [40, 0], [40, -10]];
  const split = (lines: [number, number][][]) =>
    polygonizeRegionsDetailed(ring.map((p) => p[0]), ring.map((p) => p[1]), lines);

  it("puts an end short of another boundary (a T-junction) on it", () => {
    // A layer across the slope and a vertical boundary stopping 2 cm above
    // it (tolerance 1e-3 × 40 m = 4 cm): three regions.
    const r = split([[[0, -3], [40, -5]], [[20, -4 + 0.02], [20, 5]]]);
    expect(r.danglingBoundaries).toEqual([]);
    expect(r.faces).toHaveLength(3);
  });

  it("closes a lens drawn with a small gap", () => {
    const r = split([[[10, -2], [20, -6], [30, -2], [10.01, -2]]]);
    expect(r.danglingBoundaries).toEqual([]);
    expect(r.faces).toHaveLength(2);
  });

  it("reports an end farther away than the tolerance, and only that line", () => {
    const r = split([[[0, -3], [40, -5]], [[20, -4 + 0.5], [20, 5]]]);
    expect(r.danglingBoundaries).toEqual([1]);
    expect(r.faces).toHaveLength(2);
  });

  it("does not report a boundary that runs past the outline", () => {
    const r = split([[[-1, 2], [41, -3]]]);
    expect(r.danglingBoundaries).toEqual([]);
    expect(r.faces).toHaveLength(2);
  });
});

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
