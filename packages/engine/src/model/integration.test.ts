/**
 * Phase 4 — Integration tests for complete slope analysis workflows.
 *
 * Tests cover end-to-end analysis with:
 *   - Loads (UDL, line load)
 *   - Water table
 *   - Multiple materials
 *   - Method comparisons
 *   - Search plane generation and critical surface extraction
 */

import { describe, it, expect } from "vitest";
import { Material, Udl, LineLoad } from "../types/index";
import type { SlopeDefinition } from "../types/slope-definition";
import { Slope } from "./slope";
import { analyseSlope } from "./solvers";
import { addSingleCircularPlane } from "./search";
import { buildSlope } from "./build-slope";
import { getSlices } from "./slices";
import { analyseBishop } from "./solvers";

// ── Common fixtures ─────────────────────────────────────────────

const T_ACADS_BOUNDARY: [number, number][] = [
  [0, -15],
  [0, 0],
  [20, 0],
  [40, -10],
  [50, -10],
  [50, -15],
];

const M1 = new Material({
  name: "M1",
  unitWeight: 20,
  frictionAngle: 19.6,
  cohesion: 3,
});

function createBaseSlope(): Slope {
  const s = new Slope();
  s.setExternalBoundary(T_ACADS_BOUNDARY);
  s.assignMaterial([1, -1], M1);
  s.setAnalysisLimits({
    entryLeftX: 17,
    entryRightX: 22,
    exitLeftX: 37,
    exitRightX: 43,
  });
  return s;
}

// ── Simple Slope ─────────────────────────────────────────────────

describe("Integration: Simple slope analysis", () => {
  it("homogeneous slope Bishop end-to-end", () => {
    const s = createBaseSlope();
    s.updateAnalysisOptions({ slices: 50, iterations: 200, method: "Bishop" });
    analyseSlope(s);

    const fos = s.getMinFOS();
    expect(fos).toBeGreaterThan(0.5);
    expect(fos).toBeLessThan(5.0);

    const { cx, cy, radius } = s.getMinFOSCircle();
    expect(radius).toBeGreaterThan(0);
    expect(cx).toBeGreaterThan(0);
    expect(cy).toBeGreaterThan(0);
  });
});

// ── Slope with Loads ─────────────────────────────────────────────

describe("Integration: Slope with loads", () => {
  it("slope with UDL on crest", () => {
    const s = createBaseSlope();
    s.setUdls(new Udl({ magnitude: 10, x1: 5, x2: 15 }));
    s.updateAnalysisOptions({ slices: 40, iterations: 200, method: "Bishop" });
    analyseSlope(s);

    const fos = s.getMinFOS();
    expect(fos).toBeGreaterThan(0);
    // expected: 0.985762
    expect(fos).toBeGreaterThan(0.5);
    expect(fos).toBeLessThan(2.0);
  });

  it("slope with line load on crest", () => {
    const s = createBaseSlope();
    s.setLineLoads(new LineLoad({ magnitude: 50, x: 10 }));
    s.updateAnalysisOptions({ slices: 40, iterations: 200, method: "Bishop" });
    analyseSlope(s);

    const fos = s.getMinFOS();
    expect(fos).toBeGreaterThan(0);
    // expected: 0.985762
    expect(fos).toBeGreaterThan(0.5);
    expect(fos).toBeLessThan(2.0);
  });

  it("UDL reduces FOS compared to no load (same circle)", () => {
    const CX = 28,
      CY = 25,
      R = 35;

    // Dry, no load
    const sDry = createBaseSlope();
    sDry.updateAnalysisOptions({ slices: 30, method: "Bishop" });
    const intsDry = sDry.getCircleExternalIntersection(CX, CY, R);
    const slicesDry = getSlices(
      sDry,
      intsDry[0][0],
      intsDry[intsDry.length - 1][0],
      CX,
      CY,
      R,
    );
    const [fosDry] = analyseBishop(sDry, slicesDry);

    // With UDL on crest
    const sLoad = createBaseSlope();
    sLoad.setUdls(new Udl({ magnitude: 50, x1: 5, x2: 15 }));
    sLoad.updateAnalysisOptions({ slices: 30, method: "Bishop" });
    const intsLoad = sLoad.getCircleExternalIntersection(CX, CY, R);
    const slicesLoad = getSlices(
      sLoad,
      intsLoad[0][0],
      intsLoad[intsLoad.length - 1][0],
      CX,
      CY,
      R,
    );
    const [fosLoad] = analyseBishop(sLoad, slicesLoad);

    expect(fosDry).not.toBeNull();
    expect(fosLoad).not.toBeNull();
    // UDL on crest should reduce FOS (more weight driving failure)
    expect(fosLoad!).toBeLessThan(fosDry!);
  });
});

// ── Slope with Water Table ──────────────────────────────────────

describe("Integration: Slope with water table", () => {
  it("horizontal water table (followBoundary=true, default)", () => {
    const s = createBaseSlope();
    // followBoundary=true clips the water line to the terrain surface
    s.setWaterTable({ height: -5 });
    s.updateAnalysisOptions({ slices: 40, iterations: 200, method: "Bishop" });
    analyseSlope(s);

    const fos = s.getMinFOS();
    expect(fos).toBeGreaterThan(0);
    // expected: 0.714313
    expect(fos).toBeGreaterThan(0.3);
    expect(fos).toBeLessThan(1.5);
  });

  it("water table reduces FOS (search-based)", () => {
    // Run dry
    const sDry = createBaseSlope();
    sDry.updateAnalysisOptions({
      slices: 40,
      iterations: 200,
      method: "Bishop",
    });
    analyseSlope(sDry);
    const fosDry = sDry.getMinFOS();

    // Run with water
    const sWet = createBaseSlope();
    sWet.setWaterTable({ height: -5, followBoundary: false });
    sWet.updateAnalysisOptions({
      slices: 40,
      iterations: 200,
      method: "Bishop",
    });
    analyseSlope(sWet);
    const fosWet = sWet.getMinFOS();

    // Water should reduce FOS significantly
    expect(fosWet).toBeLessThan(fosDry);
  });
});

// ── Multiple Materials ──────────────────────────────────────────

describe("Integration: Multiple materials", () => {
  it("layered slope with clay over sand", () => {
    const s = new Slope();
    const clay = new Material({
      name: "Clay",
      unitWeight: 20,
      frictionAngle: 19.6,
      cohesion: 3,
    });
    const sand = new Material({
      name: "Sand",
      unitWeight: 19,
      frictionAngle: 32,
      cohesion: 0,
    });

    s.setExternalBoundary(T_ACADS_BOUNDARY);
    s.setMaterialBoundary([
      [0, -5],
      [50, -5],
    ]);
    s.assignMaterial([25, -3], clay);
    s.assignMaterial([25, -12], sand);
    s.setAnalysisLimits({
      entryLeftX: 17,
      entryRightX: 22,
      exitLeftX: 37,
      exitRightX: 43,
    });
    s.updateAnalysisOptions({ slices: 50, iterations: 200, method: "Bishop" });
    analyseSlope(s);

    const fos = s.getMinFOS();
    expect(fos).toBeGreaterThan(0);
    // expected: 1.193234
    expect(fos).toBeGreaterThan(0.5);
    expect(fos).toBeLessThan(3.0);
  });
});

// ── Search Plane Generation ─────────────────────────────────────

describe("Integration: Search plane generation", () => {
  it("generates reasonable number of search planes", () => {
    const s = createBaseSlope();
    s.updateAnalysisOptions({ slices: 30, iterations: 1000, method: "Bishop" });
    analyseSlope(s);

    // expected: ~1041 planes for 1000 iterations
    expect(s.search.length).toBeGreaterThan(100);
    expect(s.search.length).toBeLessThan(2000);
  });

  it("fewer iterations = fewer search planes", () => {
    const sLow = createBaseSlope();
    sLow.updateAnalysisOptions({
      slices: 30,
      iterations: 200,
      method: "Bishop",
    });
    analyseSlope(sLow);

    const sHigh = createBaseSlope();
    sHigh.updateAnalysisOptions({
      slices: 30,
      iterations: 1000,
      method: "Bishop",
    });
    analyseSlope(sHigh);

    expect(sLow.search.length).toBeLessThan(sHigh.search.length);
  });

  it("individual planes are included in results", () => {
    const s = createBaseSlope();
    s.updateAnalysisOptions({ slices: 30, method: "Bishop" });

    // Add specific circle
    addSingleCircularPlane(s, 28, 25, 35);
    s.customPlanesOnly = true;
    analyseSlope(s);

    // Should have exactly 1 result (the individual plane)
    expect(s.search.length).toBe(1);
    expect(s.search[0].fos).toBeGreaterThan(0);
    expect(s.search[0].fos).toBeLessThan(100);
  });

  it("critical surface matches entry/exit within limits", () => {
    const s = createBaseSlope();
    s.updateAnalysisOptions({
      slices: 30,
      iterations: 500,
      method: "Bishop",
    });
    analyseSlope(s);

    const { entry, exit } = s.getMinFOSEndPoints();
    expect(entry[0]).toBeGreaterThanOrEqual(17);
    expect(entry[0]).toBeLessThanOrEqual(22);
    expect(exit[0]).toBeGreaterThanOrEqual(37);
    expect(exit[0]).toBeLessThanOrEqual(43);
  });
});

// ── Analysis Method Comparison ──────────────────────────────────

describe("Integration: Analysis method comparison", () => {
  it("all methods produce consistent FOS", () => {
    const results: Record<string, number> = {};

    for (const method of ["Bishop", "Janbu", "Morgenstern-Price"] as const) {
      const s = createBaseSlope();
      s.updateAnalysisOptions({ slices: 40, iterations: 150, method });
      analyseSlope(s);
      results[method] = s.getMinFOS();
    }

    // All methods should agree within 20%
    const vals = Object.values(results);
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    for (const [method, fos] of Object.entries(results)) {
      const deviation = Math.abs(fos - avg) / avg;
      expect(
        deviation,
        `${method} deviates ${(deviation * 100).toFixed(1)}% from avg`,
      ).toBeLessThan(0.2);
    }
  });
});

// ── High Strength & Impenetrable surface exclusion ───────────────

describe("Integration: High-strength and impenetrable exclusion", () => {
  it("high-strength layer excludes surfaces passing through it", () => {
    const clay = new Material({
      name: "Clay",
      unitWeight: 20,
      frictionAngle: 19.6,
      cohesion: 3,
    });
    const rock = new Material({
      name: "Rock",
      unitWeight: 24,
      model: { kind: "high-strength", unitWeight: 24 },
    });

    // Slope with a high-strength layer at y = -5
    const s = new Slope();
    s.setExternalBoundary(T_ACADS_BOUNDARY);
    s.setMaterialBoundary([
      [0, -5],
      [50, -5],
    ]);
    s.assignMaterial([25, -3], clay);
    s.assignMaterial([25, -12], rock);
    s.updateAnalysisOptions({ slices: 30, method: "Bishop" });
    s.customPlanesOnly = true;

    // Shallow circle (bottom at y = -4, stays above rock layer)
    addSingleCircularPlane(s, 28, 25, 29);
    // Deep circle (bottom at y = -10, passes into rock)
    addSingleCircularPlane(s, 28, 25, 35);
    analyseSlope(s);

    // The deep circle should be excluded (fos = null)
    const deepPlane = s.search.find((p) => p.radius === 35);
    expect(deepPlane).toBeDefined();
    expect(deepPlane!.fos).toBeNull();

    // The shallow circle should have a valid FOS
    const shallowPlane = s.search.find((p) => p.radius === 29);
    expect(shallowPlane).toBeDefined();
    expect(shallowPlane!.fos).toBeGreaterThan(0);
  });

  it("impenetrable layer excludes surfaces passing through it", () => {
    const clay = new Material({
      name: "Clay",
      unitWeight: 20,
      frictionAngle: 19.6,
      cohesion: 3,
    });
    const bedrock = new Material({
      name: "Bedrock",
      unitWeight: 26,
      model: { kind: "impenetrable", unitWeight: 26 },
    });

    // Slope with impenetrable bedrock at y = -5
    const s = new Slope();
    s.setExternalBoundary(T_ACADS_BOUNDARY);
    s.setMaterialBoundary([
      [0, -5],
      [50, -5],
    ]);
    s.assignMaterial([25, -3], clay);
    s.assignMaterial([25, -12], bedrock);
    s.updateAnalysisOptions({ slices: 30, method: "Bishop" });
    s.customPlanesOnly = true;

    // Shallow circle (bottom at y = -4, stays above bedrock layer)
    addSingleCircularPlane(s, 28, 25, 29);
    // Deep circle (bottom at y = -10, passes into bedrock)
    addSingleCircularPlane(s, 28, 25, 35);
    analyseSlope(s);

    // The deep circle should be excluded (fos = null)
    const deepPlane = s.search.find((p) => p.radius === 35);
    expect(deepPlane).toBeDefined();
    expect(deepPlane!.fos).toBeNull();

    // The shallow circle should have a valid FOS
    const shallowPlane = s.search.find((p) => p.radius === 29);
    expect(shallowPlane).toBeDefined();
    expect(shallowPlane!.fos).toBeGreaterThan(0);
  });

  it("single circle through impenetrable returns null FOS", () => {
    const clay = new Material({
      name: "Clay",
      unitWeight: 20,
      frictionAngle: 19.6,
      cohesion: 3,
    });
    const bedrock = new Material({
      name: "Bedrock",
      unitWeight: 26,
      model: { kind: "impenetrable", unitWeight: 26 },
    });

    const s = new Slope();
    s.setExternalBoundary(T_ACADS_BOUNDARY);
    s.setMaterialBoundary([
      [0, -5],
      [50, -5],
    ]);
    s.assignMaterial([25, -3], clay);
    s.assignMaterial([25, -12], bedrock);
    s.updateAnalysisOptions({ slices: 30, method: "Bishop" });
    s.customPlanesOnly = true;

    // Add a single circle that passes deep into the bedrock (bottom at y = -10)
    addSingleCircularPlane(s, 28, 25, 35);
    analyseSlope(s);

    // The single plane should be excluded
    expect(s.search.length).toBe(1);
    expect(s.search[0].fos).toBeNull();
  });

  it("single circle through high-strength returns null FOS", () => {
    const clay = new Material({
      name: "Clay",
      unitWeight: 20,
      frictionAngle: 19.6,
      cohesion: 3,
    });
    const rock = new Material({
      name: "Rock",
      unitWeight: 24,
      model: { kind: "high-strength", unitWeight: 24 },
    });

    const s = new Slope();
    s.setExternalBoundary(T_ACADS_BOUNDARY);
    s.setMaterialBoundary([
      [0, -5],
      [50, -5],
    ]);
    s.assignMaterial([25, -3], clay);
    s.assignMaterial([25, -12], rock);
    s.updateAnalysisOptions({ slices: 30, method: "Bishop" });
    s.customPlanesOnly = true;

    // Add a single circle that passes deep into the rock (bottom at y = -10)
    addSingleCircularPlane(s, 28, 25, 35);
    analyseSlope(s);

    // The single plane should be excluded
    expect(s.search.length).toBe(1);
    expect(s.search[0].fos).toBeNull();
  });

  it("buildSlope DTO path assigns impenetrable material correctly", () => {
    // Exact DTO from a user-reported bug: 2-point boundary whose endpoint
    // falls outside the slope geometry. The old vertex-index midpoint
    // would fail to assign the bedrock material.
    const def: SlopeDefinition = {
      orientation: "ltr",
      coordinates: [
        [0, -15],
        [0, 0],
        [20, 0],
        [40, -10],
        [50, -10],
        [50, -15],
      ],
      materials: [
        {
          name: "M1",
          unitWeight: 20,
          frictionAngle: 19.6,
          cohesion: 3,
        },
        {
          name: "Bedrock",
          unitWeight: 20,
          frictionAngle: 0,
          cohesion: 0,
          model: { kind: "impenetrable", unitWeight: 20 },
        },
      ],
      materialBoundaries: [
        {
          coordinates: [
            [-7, -14.5],
            [50, -7.5],
          ],
          materialName: "Bedrock",
        },
      ],
      topRegionMaterialName: "M1",
      analysisLimits: {
        entryLeftX: 17,
        entryRightX: 22,
        exitLeftX: 31.5,
        exitRightX: 43,
      },
    };

    const s = buildSlope(def);
    s.updateAnalysisOptions({ slices: 30, method: "Bishop" });
    s.customPlanesOnly = true;

    // Circle that passes into bedrock
    addSingleCircularPlane(s, 40.85, 19.9, 29.9);
    analyseSlope(s);

    const plane = s.search[0];
    expect(plane.fos).toBeNull();

    const bedrockSlices = plane.slices?.filter((sl) => sl.impenetrable) ?? [];
    expect(bedrockSlices.length).toBeGreaterThan(0);
  });
});
