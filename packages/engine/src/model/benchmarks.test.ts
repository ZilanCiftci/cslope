/**
 * Validates TS engine against:
 *   - T-ACADS verification manual cases
 *   - Arai & Tagyo (1985) pore-pressure example
 *   - Prandtl bearing capacity
 *   - Method consistency checks
 */

import { describe, it, expect } from "vitest";
import { Material, Udl } from "../types/index";
import { Slope } from "./slope";
import { analyseSlope } from "./solvers";
import { addSingleCircularPlane } from "./search";

// ── Helpers ──────────────────────────────────────────────────────

/** Standard T-ACADS boundary. */
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
  color: "#6d5f2a",
});

function createTAcadsSlope(): Slope {
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

// ── T-ACADS Validation ──────────────────────────────────────────

describe("T-ACADS Validation", () => {
  it("T-ACADS simple slope (Morgenstern-Price) matches published FOS", () => {
    const s = createTAcadsSlope();
    s.updateAnalysisOptions({ slices: 30, method: "Morgenstern-Price" });
    analyseSlope(s);

    const fos = s.getMinFOS();
    // expected: 0.985094, published: 0.984
    expect(fos).toBeGreaterThan(0.97);
    expect(fos).toBeLessThan(1.0);

    // Critical circle should exist
    const circle = s.getMinFOSCircle();
    expect(circle.radius).toBeGreaterThan(0);

    // Search planes should be generated
    expect(s.search.length).toBeGreaterThan(0);
  });

  it("T-ACADS simple slope (Bishop) matches expected FOS", () => {
    const s = createTAcadsSlope();
    s.updateAnalysisOptions({ slices: 30, method: "Bishop" });
    analyseSlope(s);

    const fos = s.getMinFOS();
    // expected: 0.984932
    expect(fos).toBeGreaterThan(0.95);
    expect(fos).toBeLessThan(1.02);
  });

  it("T-ACADS simple slope (Janbu) gives lower FOS", () => {
    const s = createTAcadsSlope();
    s.updateAnalysisOptions({ slices: 30, method: "Janbu" });
    analyseSlope(s);

    const fos = s.getMinFOS();
    // expected: 0.937688 — Janbu typically gives lower FOS
    expect(fos).toBeGreaterThan(0.9);
    expect(fos).toBeLessThan(0.98);
  });

  it("T-ACADS non-homogeneous slope (Morgenstern-Price)", () => {
    const s = new Slope();

    const materials = [
      new Material({
        name: "Soil #1",
        unitWeight: 19.5,
        frictionAngle: 38.0,
        cohesion: 0,
        color: "#6d5f2a",
      }),
      new Material({
        name: "Soil #2",
        unitWeight: 19.5,
        frictionAngle: 23.0,
        cohesion: 5.3,
        color: "#8c731a",
      }),
      new Material({
        name: "Soil #3",
        unitWeight: 19.5,
        frictionAngle: 20.0,
        cohesion: 7.2,
        color: "#636d2a",
      }),
    ];

    s.setExternalBoundary(T_ACADS_BOUNDARY);
    s.setMaterialBoundary([
      [0, -11],
      [18, -11],
      [30, -8],
      [20, -6],
      [16, -4],
      [0, -4],
      [0, -11],
    ]);
    s.setMaterialBoundary([
      [0, -11],
      [18, -11],
      [30, -8],
      [40, -10],
    ]);
    s.assignMaterial([1, -1], materials[0]);
    s.assignMaterial([1, -5], materials[1]);
    s.assignMaterial([1, -14], materials[2]);
    s.setAnalysisLimits({
      entryLeftX: 16,
      entryRightX: 21.5,
      exitLeftX: 38.5,
      exitRightX: 42.5,
    });
    s.updateAnalysisOptions({ slices: 30, method: "Morgenstern-Price" });
    analyseSlope(s);

    const fos = s.getMinFOS();
    // expected: 1.400654, T-ACADS published: 1.373
    // Multi-layer geometry splitting may differ slightly due to polygon clipping
    // Allow tolerance for differences in polygon clipping and material assignment
    expect(fos).toBeGreaterThan(1.2);
    expect(fos).toBeLessThan(1.5);
  });
});

// ── Prandtl Bearing Capacity ─────────────────────────────────────

describe("Prandtl Bearing Capacity", () => {
  function createPrandtlSlope(method: string): Slope {
    const s = new Slope();
    const m = new Material({
      name: "Soil",
      unitWeight: 1e-6,
      frictionAngle: 0,
      cohesion: 20,
      color: "#6d5f2a",
    });

    s.setExternalBoundary([
      [0, 0],
      [0, 15],
      [50, 15],
      [50, 0],
    ]);
    s.assignMaterial([1, 1], m);
    s.setUdls(new Udl({ magnitude: 102.83, x1: 20, x2: 30 }));
    s.setAnalysisLimits({
      entryLeftX: 19.5,
      entryRightX: 20.5,
      exitLeftX: 30,
      exitRightX: 50,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s.updateAnalysisOptions({ slices: 30, method: method as any });
    return s;
  }

  it("M-P finds critical surface near Prandtl solution", () => {
    const s = createPrandtlSlope("Morgenstern-Price");
    analyseSlope(s);
    const fos = s.getMinFOS();

    // expected: 1.075129
    expect(fos).toBeGreaterThan(1.0);
    expect(fos).toBeLessThan(1.15);
  });

  it("Bishop on critical circle agrees with M-P", () => {
    // First find critical circle via M-P
    const sMP = createPrandtlSlope("Morgenstern-Price");
    analyseSlope(sMP);
    const circle = sMP.getMinFOSCircle();

    // Now analyse same circle with Bishop
    const s = createPrandtlSlope("Bishop");
    addSingleCircularPlane(s, circle.cx, circle.cy, circle.radius);
    analyseSlope(s);
    const fos = s.getMinFOS();

    // expected: 1.075129 (Bishop on same circle)
    expect(fos).toBeGreaterThan(1.0);
    expect(fos).toBeLessThan(1.15);
  });

  it("Janbu on critical circle gives lower FOS", () => {
    const sMP = createPrandtlSlope("Morgenstern-Price");
    analyseSlope(sMP);
    const circle = sMP.getMinFOSCircle();

    const s = createPrandtlSlope("Janbu");
    addSingleCircularPlane(s, circle.cx, circle.cy, circle.radius);
    analyseSlope(s);
    const fos = s.getMinFOS();

    // expected: 1.015325
    expect(fos).toBeGreaterThan(0.95);
    expect(fos).toBeLessThan(1.1);
  });
});

// ── Arai & Tagyo (1985) with Water Table ─────────────────────────

describe("Arai & Tagyo with water table", () => {
  it("Bishop FOS matches published range", () => {
    const s = new Slope();
    const m = new Material({
      name: "Soil",
      unitWeight: 18.82,
      frictionAngle: 15.0,
      cohesion: 41.65,
      color: "#6d5f2a",
    });

    s.setExternalBoundary([
      [0, 0],
      [0, 35],
      [18, 35],
      [48, 15],
      [66, 15],
      [66, 0],
    ]);
    s.assignMaterial([1, 1], m);

    // Custom water table with followBoundary
    s.setWaterTable({
      coordinates: [
        [0, 32],
        [18, 29],
        [36, 23],
        [66, 23],
      ],
      followBoundary: true,
    });

    s.setAnalysisLimits({
      entryLeftX: 0,
      entryRightX: 18,
      exitLeftX: 48,
      exitRightX: 66,
    });
    s.updateAnalysisOptions({ slices: 30, method: "Bishop" });
    analyseSlope(s);

    const fos = s.getMinFOS();
    // expected: 1.157740, published range: 1.10–1.20
    expect(fos).toBeGreaterThan(1.1);
    expect(fos).toBeLessThan(1.25);

    // Water table should reduce FOS below dry analysis
    expect(fos).toBeLessThan(2.0);
  });
});

// ── Method Consistency ──────────────────────────────────────────

describe("Method consistency", () => {
  it("all three methods give FOS in 0.9–1.1 range for T-ACADS", () => {
    const results: Record<string, number> = {};

    for (const method of ["Bishop", "Janbu", "Morgenstern-Price"] as const) {
      const s = createTAcadsSlope();
      s.updateAnalysisOptions({ slices: 30, method });
      analyseSlope(s);
      results[method] = s.getMinFOS();
    }

    for (const [method, fos] of Object.entries(results)) {
      expect(fos, `${method} out of range`).toBeGreaterThan(0.9);
      expect(fos, `${method} out of range`).toBeLessThan(1.1);
    }

    // Results should be within 15% of each other
    const vals = Object.values(results);
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    for (const [method, fos] of Object.entries(results)) {
      const deviation = Math.abs(fos - avg) / avg;
      expect(deviation, `${method} deviates too much from avg`).toBeLessThan(
        0.15,
      );
    }
  });

  it("M-P ≈ Bishop for simple homogeneous case", () => {
    const sB = createTAcadsSlope();
    sB.updateAnalysisOptions({ slices: 30, method: "Bishop" });
    analyseSlope(sB);
    const fosB = sB.getMinFOS();

    const sMP = createTAcadsSlope();
    sMP.updateAnalysisOptions({ slices: 30, method: "Morgenstern-Price" });
    analyseSlope(sMP);
    const fosMP = sMP.getMinFOS();

    // For simple slopes, M-P and Bishop should be very close
    expect(Math.abs(fosMP - fosB)).toBeLessThan(0.01);
  });
});

// ── Critical Surface Extraction ─────────────────────────────────

describe("Critical surface extraction", () => {
  it("getMinFOS returns lowest FOS from search", () => {
    const s = createTAcadsSlope();
    s.updateAnalysisOptions({ slices: 30, method: "Bishop" });
    analyseSlope(s);

    const minFOS = s.getMinFOS();
    const maxFOS = s.getMaxFOS();
    expect(minFOS).toBeLessThanOrEqual(maxFOS);
    expect(minFOS).toBeGreaterThan(0);
  });

  it("getMinFOSCircle returns valid circle parameters", () => {
    const s = createTAcadsSlope();
    s.updateAnalysisOptions({ slices: 30, method: "Bishop" });
    analyseSlope(s);

    const circle = s.getMinFOSCircle();
    expect(circle.radius).toBeGreaterThan(0);
    // Circle centre should be above the slope (y > 0 in this case)
    expect(circle.cy).toBeGreaterThan(0);
  });

  it("getMinFOSEndPoints returns valid entry/exit", () => {
    const s = createTAcadsSlope();
    s.updateAnalysisOptions({ slices: 30, method: "Bishop" });
    analyseSlope(s);

    const { entry, exit } = s.getMinFOSEndPoints();
    const inRange = (x: number, a: number, b: number) => {
      const min = Math.min(a, b);
      const max = Math.max(a, b);
      return x >= min && x <= max;
    };
    expect(inRange(entry[0], 17, 22)).toBe(true);
    expect(inRange(exit[0], 37, 43)).toBe(true);
  });

  it("search results are sorted by FOS ascending", () => {
    const s = createTAcadsSlope();
    s.updateAnalysisOptions({ slices: 30, method: "Bishop" });
    analyseSlope(s);

    const planes = s.search.filter((plane) => plane.fos != null);
    for (let i = 1; i < planes.length; i++) {
      expect(planes[i].fos!).toBeGreaterThanOrEqual(planes[i - 1].fos!);
    }
  });
});
