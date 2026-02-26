import { describe, expect, it } from "vitest";
import {
  Material,
  Udl,
  LineLoad,
  DEFAULT_ANALYSIS_OPTIONS,
  MATERIAL_EPSILON,
  WATER_UNIT_WEIGHT,
  FOS_TOLERANCE,
} from "./index";

describe("Material", () => {
  it("creates with defaults", () => {
    const m = new Material({ name: "Clay" });
    expect(m.name).toBe("Clay");
    expect(m.unitWeight).toBe(20);
    expect(m.frictionAngle).toBe(35);
    expect(m.cohesion).toBe(2);
    expect(m.materialType).toBe("Mohr-Coulomb");
  });

  it("getCohesion returns base cohesion when rateOfChange is 0", () => {
    const m = new Material({ name: "Sand", cohesion: 5 });
    expect(m.getCohesion(10)).toBe(5);
    expect(m.getCohesion(0)).toBe(5);
  });

  it("getCohesion increases with depth when rateOfChange > 0", () => {
    const m = new Material({
      name: "Clay",
      cohesion: 10,
      cohesionRefDepth: 5,
      cohesionRateOfChange: 2,
    });
    // At depth 5 (ref depth) → cohesion = 10
    expect(m.getCohesion(5)).toBe(10);
    // At depth 3 (below ref depth) → cohesion = 10 + 2 * (5 - 3) = 14
    expect(m.getCohesion(3)).toBe(14);
  });

  it("throws for invalid unit weight", () => {
    expect(() => new Material({ name: "Bad", unitWeight: -1 })).toThrow();
    expect(() => new Material({ name: "Bad", unitWeight: 501 })).toThrow();
  });

  it("throws for invalid friction angle", () => {
    expect(() => new Material({ name: "Bad", frictionAngle: -1 })).toThrow();
    expect(() => new Material({ name: "Bad", frictionAngle: 91 })).toThrow();
  });
});

describe("Udl", () => {
  it("creates with correct properties", () => {
    const u = new Udl({ magnitude: -5, x1: 2, x2: 8 });
    expect(u.magnitude).toBe(5); // abs
    expect(u.x1).toBe(2);
    expect(u.x2).toBe(8);
    expect(u.length).toBe(6);
  });
});

describe("LineLoad", () => {
  it("creates with correct properties", () => {
    const l = new LineLoad({ magnitude: -10, x: 5 });
    expect(l.magnitude).toBe(10); // abs
    expect(l.x).toBe(5);
  });
});

describe("constants", () => {
  it("has correct default analysis options", () => {
    expect(DEFAULT_ANALYSIS_OPTIONS.slices).toBe(25);
    expect(DEFAULT_ANALYSIS_OPTIONS.iterations).toBe(1000);
    expect(DEFAULT_ANALYSIS_OPTIONS.refinedIterations).toBe(0);
    expect(DEFAULT_ANALYSIS_OPTIONS.tolerance).toBe(0.005);
    expect(DEFAULT_ANALYSIS_OPTIONS.maxIterations).toBe(15);
    expect(DEFAULT_ANALYSIS_OPTIONS.method).toBe("Bishop");
    expect(DEFAULT_ANALYSIS_OPTIONS.intersliceFunction).toBe("half-sine");
  });

  it("has correct numerical constants", () => {
    expect(MATERIAL_EPSILON).toBe(1e-10);
    expect(WATER_UNIT_WEIGHT).toBe(9.81);
    expect(FOS_TOLERANCE).toBe(0.005);
  });
});
