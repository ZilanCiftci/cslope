/**
 * Circular search with competing basins (review A3) and the count of
 * surfaces left out by the minimum slip size (review B8).
 */
import { describe, expect, it } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import { buildSlope } from "./build-slope";
import { toCanonicalSlopeDefinition } from "./canonical";
import { analyseSlope } from "./solvers";
import { generateLocalPlanes, setEntryExitPlanes } from "./search";
import type { SearchPlane } from "./slope";

const undrained = (name: string, su: number) =>
  ({ name, model: { kind: "undrained", unitWeight: 19, undrainedShearStrength: su } }) as const;

/** 2:1 slope, H = 10 m, Su 30 kPa over Su 45 kPa from the toe level down. */
const twoBasins = {
  coordinates: [[0, 0], [0, 20], [20, 20], [40, 10], [80, 10], [80, 0]],
  materials: [undrained("Slope", 30), undrained("Found", 45)],
  materialBoundaries: [{ coordinates: [[-1, 10], [81, 10]], materialName: "" }],
  regionAssignments: [
    { point: [1, 15], materialName: "Slope" },
    { point: [1, 5], materialName: "Found" },
  ],
} as unknown as SlopeDefinition;

function run(def: SlopeDefinition, options: Record<string, unknown>) {
  const slope = buildSlope(toCanonicalSlopeDefinition(def));
  slope.updateAnalysisOptions({ method: "Bishop", slices: 40, tolerance: 0.001, ...options });
  return { fos: analyseSlope(slope)!, slope };
}

/**
 * Minimum by brute force: circle centres on a 1 m grid (x 20–60, y 11–45)
 * with the lowest point every 0.5 m from the model base up to 17.5 m and
 * just above the interface (y = 10), then three nested grids of 17 × 17
 * centres (steps 0.2, 0.04 and 0.008 m) around the best circle of each
 * basin (toe circles tangent to the interface; face circles; deep circles,
 * whose best is tangent to the model base at 1.3057). The toe circle
 * tangent to the interface governs: centre (30.76, 31.73), R = 21.73 m.
 * Same slices (40), tolerance and minimum slip area as the search.
 */
const BRUTE_FORCE_FOS = 1.2776;

describe("circular search with two basins (toe circle above a stronger layer, deep circle)", () => {
  it("does not get worse with more iterations, and finds the brute-force minimum", () => {
    const coarse = run(twoBasins, { iterations: 1000, refinedIterations: 1000 }).fos;
    const fine = run(twoBasins, { iterations: 4000, refinedIterations: 2000 }).fos;
    expect(fine).toBeLessThanOrEqual(coarse + 1e-9);
    expect(Math.abs(coarse / BRUTE_FORCE_FOS - 1)).toBeLessThan(0.005);
    expect(Math.abs(fine / BRUTE_FORCE_FOS - 1)).toBeLessThan(0.005);
  });

  it("the grid has circles tangent to the interface from above", () => {
    const slope = buildSlope(toCanonicalSlopeDefinition(twoBasins));
    slope.updateAnalysisOptions({ iterations: 1000 });
    setEntryExitPlanes(slope);
    const tangent = slope.search.filter((p) => p.tangentTo !== undefined);
    expect(tangent.length).toBeGreaterThan(5);
    for (const p of tangent) {
      // The circle touches the interface (y = 10, x 0–40) without cutting
      // it: tangent to it, or (exits beyond the toe) through its end.
      const gap = Math.hypot(Math.min(Math.max(p.cx, 0), 40) - p.cx, 10 - p.cy) - p.radius;
      expect(gap).toBeGreaterThanOrEqual(-1e-6);
      expect(gap).toBeLessThan(1e-3);
    }
  });

  it("the local search also starts from the best circle of a second basin", () => {
    const slope = buildSlope(toCanonicalSlopeDefinition(twoBasins));
    slope.updateAnalysisOptions({ iterations: 1000 });
    setEntryExitPlanes(slope);
    const low = (p: SearchPlane) => p.cy - p.radius;
    const deep = slope.search.filter((p) => low(p) < 5).slice(0, 6);
    const toe = slope.search.find((p) => p.tangentTo !== undefined && p.rc[0] <= 40)!;
    // Six deep circles rank first; the toe circle, 0.5 % higher, is seventh.
    const planes = [...deep.map((p, i) => ({ ...p, fos: 1 + i * 1e-4 })), { ...toe, fos: 1.005 }];
    const local = generateLocalPlanes(slope, planes, 10000, 1);
    const nearToe = local.filter(
      (p) => Math.abs(p.lc[0] - toe.lc[0]) < 2 && Math.abs(p.rc[0] - toe.rc[0]) < 2 && low(p) > 9,
    );
    expect(nearToe.length).toBeGreaterThan(0);
    // A basin far above the best gets no seed.
    const far = generateLocalPlanes(slope, [...planes.slice(0, -1), { ...toe, fos: 1.5 }], 10000, 1);
    expect(far.some((p) => Math.abs(p.lc[0] - toe.lc[0]) < 2 && Math.abs(p.rc[0] - toe.rc[0]) < 2 && low(p) > 9)).toBe(false);
  });

  it("an impenetrable layer gives the circle tangent to it, as the model base does", () => {
    const clay = undrained("Clay", 30);
    const ground = [[0, 20], [20, 20], [40, 10], [70, 10]];
    const withBase = {
      coordinates: [[0, 4], ...ground, [70, 4]],
      materials: [clay],
      materialBoundaries: [],
      regionAssignments: [{ point: [1, 15], materialName: "Clay" }],
    } as unknown as SlopeDefinition;
    const withRock = {
      coordinates: [[0, 0], ...ground, [70, 0]],
      materials: [clay, { name: "Rock", model: { kind: "impenetrable", unitWeight: 22 } }],
      materialBoundaries: [{ coordinates: [[-1, 4], [71, 4]], materialName: "" }],
      regionAssignments: [
        { point: [1, 15], materialName: "Clay" },
        { point: [1, 2], materialName: "Rock" },
      ],
    } as unknown as SlopeDefinition;
    const options = { iterations: 1000, refinedIterations: 0, slices: 50 };
    const base = run(withBase, options).fos;
    const rock = run(withRock, options).fos;
    expect(Math.abs(rock / base - 1)).toBeLessThan(1e-3);
  });
});

describe("surfaces below the minimum slip size", () => {
  // A 40 m high 3:1 slope with a 1.5 m vertical cut at its toe: the
  // automatic minimum area (17 m²) leaves out the surfaces through the cut.
  const cut = {
    coordinates: [[0, 0], [0, 50], [20, 50], [140, 10], [160, 10], [160, 8.5], [200, 8.5], [200, 0]],
    materials: [{ name: "S", model: { kind: "mohr-coulomb", unitWeight: 19, cohesion: 5, frictionAngle: 30 } }],
    materialBoundaries: [],
    regionAssignments: [{ point: [1, 1], materialName: "S" }],
  } as unknown as SlopeDefinition;
  const count = (options: Record<string, unknown>) =>
    run(cut, { iterations: 1000, refinedIterations: 0, slices: 30, ...options }).slope.search.filter(
      (p) => p.belowMinSize,
    ).length;

  it("are counted with the automatic minimum area", () => {
    expect(count({})).toBeGreaterThan(0);
    expect(count({ minSlipArea: 0 })).toBe(0);
  });

  it("are counted for the minimum slip depth too", () => {
    expect(count({ minSlipArea: 0, minSlipDepth: 2 })).toBeGreaterThan(0);
  });
});
