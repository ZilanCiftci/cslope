/**
 * Block search: surfaces through block search objects (points, lines,
 * windows) with end segments at the Rankine or the user's angles.
 */
import { describe, expect, it } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import type { AnalysisOptions } from "../types/analysis";
import { buildSlope } from "./build-slope";
import { toCanonicalSlopeDefinition, oppositeDirectionDefinition } from "./canonical";
import { analyseSlope } from "./solvers";
import type { SearchPlane } from "./slope";

const mc = (name: string, c: number, phi: number) =>
  ({ name, model: { kind: "mohr-coulomb", unitWeight: 18.84, cohesion: c, frictionAngle: phi } }) as const;

/**
 * ACADS problem 3(a) (Giam & Donald 1989), as V050b: a 0.5 m weak layer
 * (c = 0, φ = 10°) at el. 26.5–27 under a 1:2 slope, sliding to the left.
 * The best circle gives about 1.51; ACADS accepts 1.24–1.27 for surfaces
 * along the layer.
 */
const acads3a = {
  coordinates: [[20, 20], [20, 27.75], [43, 27.75], [67.5, 40], [84, 40], [84, 20]],
  materials: [mc("Soil 1", 28.5, 20), mc("Weak layer", 0, 10), mc("Soil 1 below", 28.5, 20)],
  materialBoundaries: [
    { coordinates: [[19, 27], [85, 27]], materialName: "" },
    { coordinates: [[19, 26.5], [85, 26.5]], materialName: "" },
  ],
  regionAssignments: [
    { point: [20.64, 27.05], materialName: "Soil 1" },
    { point: [20.64, 26.75], materialName: "Weak layer" },
    { point: [20.64, 23.25], materialName: "Soil 1 below" },
  ],
  orientation: "rtl",
  waterTable: { mode: "custom", value: [[20, 26.5], [84, 26.5]] },
} as unknown as SlopeDefinition;

/** Two lines along the middle of the weak layer (model coordinates). */
const layerLines = [
  { points: [[25, 26.75], [50, 26.75]] as [number, number][] },
  { points: [[50, 26.75], [80, 26.75]] as [number, number][] },
];

const spencer: Partial<AnalysisOptions> = {
  method: "Morgenstern-Price",
  intersliceFunction: "constant",
  slices: 40,
  tolerance: 0.001,
  iterations: 500,
  refinedIterations: 300,
  searchMethod: "block",
};

function run(def: SlopeDefinition, options: Partial<AnalysisOptions> = {}) {
  const canonical = toCanonicalSlopeDefinition(def);
  const slope = buildSlope(canonical);
  slope.updateAnalysisOptions({ ...spencer, ...options });
  const fos = analyseSlope(slope);
  const valid = slope.search.filter((p) => p.fos != null) as SearchPlane[];
  return { fos, slope, valid, canonical };
}

/** Inclination (°) of a segment from the horizontal. */
const inclination = (a: [number, number], b: [number, number]) =>
  (Math.atan2(Math.abs(b[1] - a[1]), Math.abs(b[0] - a[0])) * 180) / Math.PI;

describe("block search", () => {
  it("finds the sliding along a weak layer that the circles miss", () => {
    const { fos, valid } = run({ ...acads3a, blockSearchObjects: layerLines });
    expect(fos).not.toBeNull();
    // Below the best circle (≈ 1.51), within reach of the ACADS range.
    expect(fos!).toBeLessThan(1.35);
    expect(fos!).toBeGreaterThan(1.2);
    expect(valid.length).toBeGreaterThan(400);
    // Every surface: entry, one base point on each line, exit.
    for (const p of valid.slice(0, 50)) {
      expect(p.points).toHaveLength(4);
      expect(p.points![1][1]).toBeCloseTo(26.75, 9);
      expect(p.points![2][1]).toBeCloseTo(26.75, 9);
    }
  });

  it("uses the Rankine angles 45° ± φ/2 of the soil above the base by default", () => {
    const { valid } = run({ ...acads3a, blockSearchObjects: layerLines });
    // In canonical coordinates the entry is on the left; the soil above
    // the layer has φ = 20°, so 55° and 35°.
    for (const p of valid.slice(0, 50)) {
      const pts = p.points!;
      expect(inclination(pts[0], pts[1])).toBeCloseTo(55, 6);
      expect(inclination(pts[2], pts[3])).toBeCloseTo(35, 6);
    }
  });

  it("draws the end segments within the given angle ranges", () => {
    const { fos, valid } = run(
      { ...acads3a, blockSearchObjects: layerLines },
      { blockActiveAngle: [40, 70], blockPassiveAngle: [15, 40] },
    );
    expect(fos).not.toBeNull();
    for (const p of valid) {
      const pts = p.points!;
      expect(inclination(pts[0], pts[1])).toBeGreaterThanOrEqual(40 - 1e-9);
      expect(inclination(pts[0], pts[1])).toBeLessThanOrEqual(70 + 1e-9);
      expect(inclination(pts[2], pts[3])).toBeGreaterThanOrEqual(15 - 1e-9);
      expect(inclination(pts[2], pts[3])).toBeLessThanOrEqual(40 + 1e-9);
    }
  });

  it("keeps base points inside windows", () => {
    const window = (x0: number, x1: number) => ({
      points: [[x0, 26.55], [x1, 26.55], [x1, 26.95], [x0, 26.95]] as [number, number][],
    });
    const { fos, valid } = run({ ...acads3a, blockSearchObjects: [window(25, 50), window(50, 80)] });
    expect(fos).not.toBeNull();
    for (const p of valid) {
      for (const [x, y] of p.points!.slice(1, -1)) {
        expect(y).toBeGreaterThanOrEqual(26.55 - 1e-9);
        expect(y).toBeLessThanOrEqual(26.95 + 1e-9);
        // Canonical coordinates are mirrored about the model's x range (20–84).
        expect(104 - x).toBeGreaterThanOrEqual(25 - 1e-9);
        expect(104 - x).toBeLessThanOrEqual(80 + 1e-9);
      }
    }
  });

  it("is repeatable", () => {
    const a = run({ ...acads3a, blockSearchObjects: layerLines });
    const b = run({ ...acads3a, blockSearchObjects: layerLines });
    expect(a.fos).toBe(b.fos);
    expect(a.valid.length).toBe(b.valid.length);
  });

  it("gives the same surface and FOS mirrored", () => {
    const rtl = run({ ...acads3a, blockSearchObjects: layerLines });
    // The same model drawn left to right.
    const mirrorX = (x: number) => 104 - x;
    const mirror = (pts: [number, number][]) => pts.map(([x, y]) => [mirrorX(x), y] as [number, number]);
    const ltr = run({
      ...acads3a,
      orientation: "ltr",
      coordinates: mirror(acads3a.coordinates as [number, number][]),
      materialBoundaries: acads3a.materialBoundaries!.map((b) => ({ ...b, coordinates: mirror(b.coordinates) })),
      regionAssignments: acads3a.regionAssignments!.map((r) => ({ ...r, point: [mirrorX(r.point[0]), r.point[1]] as [number, number] })),
      blockSearchObjects: layerLines.map((o) => ({ points: mirror(o.points) })),
    } as SlopeDefinition);
    expect(ltr.fos).toBeCloseTo(rtl.fos!, 9);
  });

  it("analyses a single surface through fixed points, as the same custom surface", () => {
    const points: [number, number][][] = [[[40, 26.75]], [[60, 26.75]]];
    const block = run({ ...acads3a, blockSearchObjects: points.map((p) => ({ points: p })) });
    expect(block.valid).toHaveLength(1);
    const surface = block.valid[0].points!;
    // The same polyline as a custom surface (back in model coordinates).
    const custom = run(
      { ...acads3a, customSurfaces: [{ points: surface.map(([x, y]) => [104 - x, y] as [number, number]) }], customPlanesOnly: true },
      { searchMethod: "circular" },
    );
    expect(custom.fos).toBeCloseTo(block.fos!, 6);
  });

  it("keeps entry and exit within the search limits", () => {
    const { valid } = run({
      ...acads3a,
      blockSearchObjects: layerLines,
      analysisLimits: { entryLeftX: 72, entryRightX: 80, exitLeftX: 40, exitRightX: 46 },
    } as SlopeDefinition, { blockActiveAngle: [35, 80], blockPassiveAngle: [5, 60] });
    expect(valid.length).toBeGreaterThan(0);
    for (const p of valid) {
      // Canonical: entry on the left, mirrored from the model's crest side.
      expect(104 - p.lc[0]).toBeGreaterThanOrEqual(72 - 1e-9);
      expect(104 - p.lc[0]).toBeLessThanOrEqual(80 + 1e-9);
      expect(104 - p.rc[0]).toBeGreaterThanOrEqual(40 - 1e-9);
      expect(104 - p.rc[0]).toBeLessThanOrEqual(46 + 1e-9);
    }
  });

  it("optimises the best block surfaces on request", () => {
    const plain = run({ ...acads3a, blockSearchObjects: layerLines });
    const optimised = run({ ...acads3a, blockSearchObjects: layerLines }, { nonCircularOptimization: true });
    expect(optimised.fos!).toBeLessThan(plain.fos!);
    // Optimised surfaces are no duplicates of the block surfaces.
    expect(new Set(optimised.slope.search).size).toBe(optimised.slope.search.length);
  });

  it("keeps the objects for the opposite direction", () => {
    const canonical = toCanonicalSlopeDefinition({ ...acads3a, blockSearchObjects: layerLines });
    const opposite = oppositeDirectionDefinition(canonical);
    expect(opposite.blockSearchObjects).toHaveLength(2);
  });

  it("needs search objects and valid angle ranges", () => {
    expect(() => run(acads3a)).toThrow(/at least one search object/);
    expect(() => run({ ...acads3a, blockSearchObjects: layerLines }, { blockActiveAngle: [60, 40] })).toThrow(/blockActiveAngle/);
    expect(() => run({ ...acads3a, blockSearchObjects: layerLines }, { blockPassiveAngle: [0, 40] })).toThrow(/blockPassiveAngle/);
    expect(() =>
      run({ ...acads3a, blockSearchObjects: [{ points: [[30, 26], [40, 26], [50, 26]] }] }),
    ).toThrow(/no area/);
    expect(() => run({ ...acads3a, blockSearchObjects: [{ points: [[30, 26], [30, 26]] }] })).toThrow(/coincide/);
  });

  it("leaves the circular search unchanged when not selected", () => {
    const withObjects = run({ ...acads3a, blockSearchObjects: layerLines }, { searchMethod: "circular", iterations: 500, refinedIterations: 0 });
    const without = run(acads3a, { searchMethod: "circular", iterations: 500, refinedIterations: 0 });
    expect(withObjects.fos).toBe(without.fos);
  });
});
