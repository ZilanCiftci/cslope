/**
 * Tests for the Slope model class and slice generation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  Slope,
  getSlices,
  setEntryExitPlanes,
  generatePlanes,
  addSingleCircularPlane,
  Material,
  Udl,
  LineLoad,
  getDomainX,
  mirrorLimits,
  mirrorPoints,
} from "@cslope/engine";
import { EXAMPLE_MODELS } from "../../store/benchmarks";

// ── Test fixtures ─────────────────────────────────────────────────

const SLOPE_BOUNDARY: [number, number][] = [
  [0, 0],
  [20, 0],
  [40, -10],
  [50, -10],
  [50, -15],
  [0, -15],
  [0, 0],
];

const TALBINGO_MODEL = EXAMPLE_MODELS.find(
  (model) => model.id === "example-talbingo-dam",
);

if (!TALBINGO_MODEL) {
  throw new Error("Talbingo example model is missing from EXAMPLE_MODELS");
}

const TALBINGO_DOMAIN = getDomainX(TALBINGO_MODEL.coordinates);

const TALBINGO_BOUNDARY: [number, number][] =
  TALBINGO_MODEL.orientation === "rtl"
    ? mirrorPoints(
        TALBINGO_MODEL.coordinates,
        TALBINGO_DOMAIN[0],
        TALBINGO_DOMAIN[1],
      )
    : TALBINGO_MODEL.coordinates;

const TALBINGO_LIMITS =
  TALBINGO_MODEL.orientation === "rtl"
    ? mirrorLimits(
        TALBINGO_MODEL.analysisLimits,
        TALBINGO_DOMAIN[0],
        TALBINGO_DOMAIN[1],
      )
    : TALBINGO_MODEL.analysisLimits;

const CLAY = new Material({
  name: "Clay",
  unitWeight: 18,
  frictionAngle: 25,
  cohesion: 10,
  color: "#ff0000",
});

const SAND = new Material({
  name: "Sand",
  unitWeight: 20,
  frictionAngle: 35,
  cohesion: 2,
  color: "#00ff00",
});

const ROCK = new Material({
  name: "Rock",
  unitWeight: 25,
  frictionAngle: 40,
  cohesion: 50,
  color: "#0000ff",
});

// ── Slope Model Setup ─────────────────────────────────────────────

describe("Slope model setup", () => {
  let slope: Slope;

  beforeEach(() => {
    slope = new Slope();
    slope.setExternalBoundary(SLOPE_BOUNDARY);
  });

  it("extracts the correct surface line", () => {
    const sl = slope.surfaceLineXY;
    expect(sl).not.toBeNull();
    expect(sl!.x).toEqual([0, 20, 40, 50]);
    expect(sl!.y).toEqual([0, 0, -10, -10]);
  });

  it("computes y-intersections matching expected values", () => {
    // expected: {0: 0, 10: 0, 20: 0, 30: -5, 40: -10, 50: -10}
    expect(slope.getExternalYIntersection(0)).toBeCloseTo(0, 6);
    expect(slope.getExternalYIntersection(10)).toBeCloseTo(0, 6);
    expect(slope.getExternalYIntersection(20)).toBeCloseTo(0, 6);
    expect(slope.getExternalYIntersection(30)).toBeCloseTo(-5, 6);
    expect(slope.getExternalYIntersection(40)).toBeCloseTo(-10, 6);
    expect(slope.getExternalYIntersection(50)).toBeCloseTo(-10, 6);
  });

  it("has correct default analysis limits (full slope)", () => {
    // expected: [0, 50, 0, 50]
    expect(slope.limits[0]).toBeCloseTo(0, 6);
    expect(slope.limits[1]).toBeCloseTo(50, 6);
    expect(slope.limits[2]).toBeCloseTo(0, 6);
    expect(slope.limits[3]).toBeCloseTo(50, 6);
  });

  it("updates analysis limits correctly", () => {
    slope.setAnalysisLimits({
      entryLeftX: 17,
      entryRightX: 22,
      exitLeftX: 37,
      exitRightX: 43,
    });
    expect(slope.limits[0]).toBeCloseTo(17, 6);
    expect(slope.limits[1]).toBeCloseTo(22, 6);
    expect(slope.limits[2]).toBeCloseTo(37, 6);
    expect(slope.limits[3]).toBeCloseTo(43, 6);
  });

  it("has one material geometry after setExternalBoundary", () => {
    expect(slope.materialGeometries.length).toBe(1);
  });

  it("updates analysis options with validation", () => {
    slope.updateAnalysisOptions({ slices: 5 }); // below min
    expect(slope.sliceCount).toBe(10); // clamped to min

    slope.updateAnalysisOptions({ slices: 1000 }); // above max
    expect(slope.sliceCount).toBe(500); // clamped to max

    slope.updateAnalysisOptions({ slices: 30, method: "Morgenstern-Price" });
    expect(slope.sliceCount).toBe(30);
    expect(slope.method).toBe("Morgenstern-Price");

    slope.updateAnalysisOptions({ refinedIterations: -10 });
    expect(slope.refinedIterations).toBe(0);

    slope.updateAnalysisOptions({ refinedIterations: 1200 });
    expect(slope.refinedIterations).toBe(1200);
  });

  it("rejects invalid method", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      slope.updateAnalysisOptions({ method: "Invalid" as any }),
    ).toThrow();
  });
});

// ── Material Boundaries ───────────────────────────────────────────

describe("Material boundaries and assignment", () => {
  let slope: Slope;

  beforeEach(() => {
    slope = new Slope();
    slope.setExternalBoundary(SLOPE_BOUNDARY);
  });

  it("splits into correct number of geometries", () => {
    slope.setMaterialBoundary([
      [0, -5],
      [50, -5],
    ]);
    slope.setMaterialBoundary([
      [0, -10],
      [50, -10],
    ]);
    // expected: 3 geometries
    expect(slope.materialGeometries.length).toBe(3);
  });

  it("assigns materials to correct regions", () => {
    slope.setMaterialBoundary([
      [0, -5],
      [50, -5],
    ]);
    slope.setMaterialBoundary([
      [0, -10],
      [50, -10],
    ]);

    slope.assignMaterial([1, -1], CLAY);
    slope.assignMaterial([1, -6], SAND);
    slope.assignMaterial([1, -11], ROCK);

    const names = slope.materialGeometries.map((mg) => mg.material.name);
    expect(names).toEqual(["Clay", "Sand", "Rock"]);
  });

  it("rejects non-Material in assignMaterial", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      slope.assignMaterial([0, 0], "not a material" as any),
    ).toThrow();
  });
});

// ── Loads ─────────────────────────────────────────────────────────

describe("Loads", () => {
  let slope: Slope;

  beforeEach(() => {
    slope = new Slope();
    slope.setExternalBoundary(SLOPE_BOUNDARY);
  });

  it("adds UDLs", () => {
    const u1 = new Udl({ magnitude: 10, x1: 5, x2: 15 });
    const u2 = new Udl({ magnitude: 20, x1: 10, x2: 20 });
    slope.setUdls(u1, u2);
    expect(slope.udls.length).toBe(2);
  });

  it("ignores zero-magnitude UDLs", () => {
    const u = new Udl({ magnitude: 0, x1: 5, x2: 15 });
    slope.setUdls(u);
    expect(slope.udls.length).toBe(0);
  });

  it("sets line loads", () => {
    const ll = new LineLoad({ magnitude: 50, x: 10 });
    slope.setLineLoads(ll);
    expect(slope.lineLoads.length).toBe(1);
  });

  it("removes all UDLs", () => {
    slope.setUdls(new Udl({ magnitude: 10, x1: 5, x2: 15 }));
    slope.removeUdls();
    expect(slope.udls.length).toBe(0);
  });
});

// ── Water Table ───────────────────────────────────────────────────

describe("Water table", () => {
  let slope: Slope;

  beforeEach(() => {
    slope = new Slope();
    slope.setExternalBoundary(SLOPE_BOUNDARY);
  });

  it("sets water table by height (followBoundary=false)", () => {
    slope.setWaterTable({ height: -3, followBoundary: false });
    expect(slope.hasWaterTable).toBe(true);
    const wl = slope.waterRLXY;
    expect(wl).not.toBeNull();
    expect(wl!.y[0]).toBeCloseTo(-3, 6);
    expect(wl!.y[1]).toBeCloseTo(-3, 6);
  });

  it("sets water table by depth", () => {
    // slope max y = 0, depth = 3 → height = -3
    slope.setWaterTable({ depth: 3, followBoundary: false });
    expect(slope.hasWaterTable).toBe(true);
    const wl = slope.waterRLXY;
    expect(wl!.y[0]).toBeCloseTo(-3, 6);
  });

  it("removes water table", () => {
    slope.setWaterTable({ height: -3 });
    slope.removeWaterTable();
    expect(slope.hasWaterTable).toBe(false);
    expect(slope.waterRLXY).toBeNull();
  });
});

// ── Circle-Surface Intersection ───────────────────────────────────

describe("Circle-surface intersection", () => {
  it("matches expected values", () => {
    const slope = new Slope();
    slope.setExternalBoundary(SLOPE_BOUNDARY);

    // Circle: center (30, 10), radius 25
    // expected: [(7.087, 0.0), (45.0, -10.0)]
    const ints = slope.getCircleExternalIntersection(30, 10, 25);
    expect(ints.length).toBe(2);
    expect(ints[0][0]).toBeCloseTo(7.0871, 3);
    expect(ints[0][1]).toBeCloseTo(0, 6);
    expect(ints[1][0]).toBeCloseTo(45, 6);
    expect(ints[1][1]).toBeCloseTo(-10, 6);
  });
});

// ── Slice Generation ──────────────────────────────────────────────

describe("Slice generation", () => {
  let slope: Slope;

  beforeEach(() => {
    slope = new Slope();
    slope.setExternalBoundary(SLOPE_BOUNDARY);
    slope.assignMaterial([1, -1], CLAY);
  });

  it("generates slices for a circular failure surface", () => {
    const cx = 30,
      cy = 10,
      radius = 25;
    const ints = slope.getCircleExternalIntersection(cx, cy, radius);
    expect(ints.length).toBe(2);

    const slices = getSlices(slope, ints[0][0], ints[1][0], cx, cy, radius);

    // expected: 26 slices
    expect(slices.length).toBeGreaterThan(0);
    expect(slices.length).toBeCloseTo(26, -1); // within ±5

    // All slices should be valid
    for (const s of slices) {
      expect(s.isValid).toBe(true);
      expect(s.width).toBeGreaterThan(0);
      expect(s.yBottom).toBeLessThanOrEqual(s.yTop);
    }
  });

  it("produces slice weights matching expected values", () => {
    const cx = 30,
      cy = 10,
      radius = 25;
    const ints = slope.getCircleExternalIntersection(cx, cy, radius);
    const slices = getSlices(slope, ints[0][0], ints[1][0], cx, cy, radius);

    // expected total weight: 5376.058 (with unitWeight=18)
    const totalWeight = slices.reduce((s, sl) => s + sl.weight, 0);
    expect(totalWeight).toBeCloseTo(5376, -1); // within ±5 kN

    // First slice properties
    const first = slices[0];
    expect(first.xLeft).toBeCloseTo(7.087, 2);
    expect(first.yTop).toBeCloseTo(0, 2);
    expect(first.yBottom).toBeCloseTo(-1.505, 1);
    expect(first.alpha).toBeCloseTo(1.093, 1);

    // Last slice properties
    const last = slices[slices.length - 1];
    expect(last.xRight).toBeCloseTo(45, 2);
    expect(last.yTop).toBeCloseTo(-10, 2);
  });

  it("uses fixed slices when specified", () => {
    slope.addFixedSlices([10, 20, 30, 40]);
    const cx = 30,
      cy = 10,
      radius = 25;
    const ints = slope.getCircleExternalIntersection(cx, cy, radius);
    const slices = getSlices(slope, ints[0][0], ints[1][0], cx, cy, radius);

    // With fixed slices, boundaries should include 10, 20, 30, 40
    const leftXs = slices.map((s) => s.xLeft);
    for (const fx of [10, 20, 30, 40]) {
      // Check that a slice boundary is close to each fixed x
      const closest = leftXs.reduce((best, x) =>
        Math.abs(x - fx) < Math.abs(best - fx) ? x : best,
      );
      expect(Math.abs(closest - fx)).toBeLessThan(1);
    }
  });

  it("throws for x0 >= x1", () => {
    expect(() => getSlices(slope, 10, 5, 30, 10, 25)).toThrow();
  });
});

// ── Search Planes ─────────────────────────────────────────────────

describe("Search plane generation", () => {
  let slope: Slope;

  beforeEach(() => {
    slope = new Slope();
    slope.setExternalBoundary(SLOPE_BOUNDARY);
    slope.assignMaterial([1, -1], CLAY);
  });

  it("generates search planes", () => {
    slope.updateAnalysisOptions({ iterations: 1000 });
    setEntryExitPlanes(slope);

    // expected: ~1034 planes (may differ slightly due to circle intersection)
    expect(slope.search.length).toBeGreaterThan(100);
  });

  it("generates planes between two points", () => {
    const planes = generatePlanes(
      slope,
      [5, slope.getExternalYIntersection(5)],
      [40, slope.getExternalYIntersection(40)],
      5,
    );
    expect(planes.length).toBeGreaterThan(0);
    expect(planes.length).toBeLessThanOrEqual(5);

    for (const p of planes) {
      expect(p.radius).toBeGreaterThan(0);
      expect(p.lc[0] === p.rc[0] && p.lc[1] === p.rc[1]).toBe(false);
    }
  });

  it("adds single circular plane", () => {
    addSingleCircularPlane(slope, 30, 10, 25);
    expect(slope.individualPlanes.length).toBe(1);
    expect(slope.individualPlanes[0].cx).toBeCloseTo(30);
    expect(slope.individualPlanes[0].cy).toBeCloseTo(10);
    expect(slope.individualPlanes[0].radius).toBeCloseTo(25);
  });

  it("keeps Talbingo search planes inside external boundary", () => {
    const talbingo = new Slope();
    talbingo.setExternalBoundary(TALBINGO_BOUNDARY);
    talbingo.setAnalysisLimits(TALBINGO_LIMITS);
    talbingo.updateAnalysisOptions({ iterations: 800 });

    setEntryExitPlanes(talbingo);
    expect(talbingo.search.length).toBeGreaterThan(0);

    for (const plane of talbingo.search) {
      for (let i = 1; i < 24; i++) {
        const t = i / 24;
        const x = plane.lc[0] + (plane.rc[0] - plane.lc[0]) * t;
        const radiusTerm = plane.radius ** 2 - (x - plane.cx) ** 2;
        expect(radiusTerm).toBeGreaterThanOrEqual(0);
        const y = plane.cy - Math.sqrt(Math.max(0, radiusTerm));
        expect(talbingo.isInsideExternalBoundary(x, y + 1e-6)).toBe(true);
      }
    }
  });
});

// ── Integration: Multi-layer Slope ────────────────────────────────

describe("Integration: multi-layer slope with loads", () => {
  it("sets up a complete slope model", () => {
    const s = new Slope();
    s.setExternalBoundary(SLOPE_BOUNDARY);

    // Add material boundaries
    s.setMaterialBoundary([
      [0, -5],
      [50, -5],
    ]);
    s.setMaterialBoundary([
      [0, -10],
      [50, -10],
    ]);

    // Assign materials
    s.assignMaterial([1, -1], CLAY);
    s.assignMaterial([1, -6], SAND);
    s.assignMaterial([1, -11], ROCK);

    // Add loads
    s.setUdls(new Udl({ magnitude: 10, x1: 5, x2: 15 }));
    s.setLineLoads(new LineLoad({ magnitude: 50, x: 10 }));

    // Set water table
    s.setWaterTable({ height: -3, followBoundary: false });

    // Set analysis options
    s.updateAnalysisOptions({
      slices: 30,
      method: "Bishop",
    });

    // Verify state
    expect(s.materialGeometries.length).toBe(3);
    expect(s.udls.length).toBe(1);
    expect(s.lineLoads.length).toBe(1);
    expect(s.hasWaterTable).toBe(true);
    expect(s.sliceCount).toBe(30);
    expect(s.method).toBe("Bishop");

    // Generate slices for a specific circle
    const ints = s.getCircleExternalIntersection(30, 10, 25);
    if (ints.length >= 2) {
      const slices = getSlices(s, ints[0][0], ints[1][0], 30, 10, 25);
      expect(slices.length).toBeGreaterThan(0);

      // With water table, slices should have pore pressure
      const hasU = slices.some((sl) => sl.U > 0);
      expect(hasU).toBe(true);

      // With UDL, some slices should have udl force
      const hasUdl = slices.some((sl) => sl.udl > 0);
      expect(hasUdl).toBe(true);

      // Verify material diversity at base
      const materials = new Set(slices.map((sl) => sl.baseMaterial?.name));
      expect(materials.size).toBeGreaterThanOrEqual(2);
    }
  });
});
