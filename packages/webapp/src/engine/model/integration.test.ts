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
import { Slope } from "./slope";
import { analyseSlope } from "./solvers";
import { addSingleCircularPlane } from "./search";
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
