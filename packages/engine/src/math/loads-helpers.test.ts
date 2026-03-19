import { describe, expect, it } from "vitest";
import { calculateAllLoads } from "./loads";
import {
  constantInterslice,
  halfsine,
  clippedSine,
  trapezoidal,
  dataPointSpecified,
  getIntersliceFunctionValue,
  midCoord,
  distPoints,
  extrapolateLambda,
  getPrecision,
  MATERIAL_COLORS,
} from "./helpers";

describe("calculateAllLoads", () => {
  it("computes UDL and LL forces correctly", () => {
    const widths = [2, 2, 2];
    const centers = [1, 3, 5];
    const udls: [number, number, number][] = [[0.5, 4.5, 10]];
    const lls: [number, number][] = [[3, 50]];

    const [udlForces, llForces] = calculateAllLoads(widths, centers, udls, lls);

    // expected: udl [15.0, 20.0, 5.0], ll [0.0, 50.0, 0.0]
    expect(udlForces[0]).toBeCloseTo(15.0, 8);
    expect(udlForces[1]).toBeCloseTo(20.0, 8);
    expect(udlForces[2]).toBeCloseTo(5.0, 8);
    expect(llForces[0]).toBeCloseTo(0.0, 8);
    expect(llForces[1]).toBeCloseTo(50.0, 8);
    expect(llForces[2]).toBeCloseTo(0.0, 8);
  });

  it("handles no loads", () => {
    const [udlForces, llForces] = calculateAllLoads([2], [1], [], []);
    expect(udlForces[0]).toBe(0);
    expect(llForces[0]).toBe(0);
  });

  it("handles UDL entirely inside a slice (regression for 2.1)", () => {
    // Slice [0,10], UDL [3,7] mag 10 → expected force = (7−3)×10 = 40
    const widths = [10];
    const centers = [5];
    const udls: [number, number, number][] = [[3, 7, 10]];
    const [udlForces] = calculateAllLoads(widths, centers, udls, []);
    expect(udlForces[0]).toBeCloseTo(40.0, 8);
  });

  it("handles reversed UDL endpoints", () => {
    const widths = [10];
    const centers = [5];
    const udls: [number, number, number][] = [[7, 3, 10]];
    const [udlForces] = calculateAllLoads(widths, centers, udls, []);
    expect(udlForces[0]).toBeCloseTo(40.0, 8);
  });
});

describe("halfsine", () => {
  it("returns 1.0 at midpoint (expected: 1.0)", () => {
    expect(halfsine(5, 0, 10)).toBeCloseTo(1.0, 10);
  });

  it("returns ~0.707 at quarter (expected: 0.7071067811865476)", () => {
    expect(halfsine(2.5, 0, 10)).toBeCloseTo(0.7071067811865476, 10);
  });

  it("returns 0 outside domain (expected: 0.0)", () => {
    expect(halfsine(-1, 0, 10)).toBe(0);
    expect(halfsine(11, 0, 10)).toBe(0);
  });

  it("returns 0 at boundaries", () => {
    expect(halfsine(0, 0, 10)).toBe(0);
    expect(halfsine(10, 0, 10)).toBe(0);
  });
});

describe("constantInterslice", () => {
  it("returns 1 inside domain and 0 outside", () => {
    expect(constantInterslice(5, 0, 10)).toBe(1);
    expect(constantInterslice(0, 0, 10)).toBe(0);
    expect(constantInterslice(10, 0, 10)).toBe(0);
  });
});

describe("clippedSine", () => {
  it("clips low values above tails", () => {
    expect(clippedSine(1, 0, 10)).toBeGreaterThan(0.34);
    expect(clippedSine(5, 0, 10)).toBeCloseTo(1, 10);
  });
});

describe("trapezoidal", () => {
  it("has plateau in center and ramps on sides", () => {
    expect(trapezoidal(2, 0, 10)).toBeCloseTo(1, 10);
    expect(trapezoidal(5, 0, 10)).toBeCloseTo(1, 10);
    expect(trapezoidal(9, 0, 10)).toBeCloseTo(0.5, 10);
  });
});

describe("dataPointSpecified", () => {
  it("interpolates from normalized points", () => {
    const pts: [number, number][] = [
      [0, 0],
      [0.5, 1],
      [1, 0],
    ];
    expect(dataPointSpecified(5, 0, 10, pts)).toBeCloseTo(1, 10);
    expect(dataPointSpecified(2.5, 0, 10, pts)).toBeCloseTo(0.5, 10);
  });
});

describe("getIntersliceFunctionValue", () => {
  it("dispatches by function name", () => {
    expect(getIntersliceFunctionValue("constant", 5, 0, 10)).toBe(1);
    expect(getIntersliceFunctionValue("half-sine", 5, 0, 10)).toBeCloseTo(
      1,
      10,
    );
  });
});

describe("midCoord", () => {
  it("computes midpoint", () => {
    const [x, y] = midCoord([0, 0], [10, 6]);
    expect(x).toBe(5);
    expect(y).toBe(3);
  });
});

describe("distPoints", () => {
  it("computes Euclidean distance", () => {
    expect(distPoints([0, 0], [3, 4])).toBeCloseTo(5.0, 10);
  });

  it("returns 0 for same point", () => {
    expect(distPoints([5, 5], [5, 5])).toBe(0);
  });
});

describe("extrapolateLambda", () => {
  it("extrapolates correctly (expected: [0.8348, 1.3947])", () => {
    const [lambda, fs] = extrapolateLambda([
      [0.2, 1.387, 1.289],
      [0.4, 1.386, 1.336],
      [0.6, 1.39, 1.363],
    ]);
    expect(lambda).toBeCloseTo(0.8347826086956522, 6);
    expect(fs).toBeCloseTo(1.394695652173913, 6);
  });

  it("throws for fewer than 2 points", () => {
    expect(() => extrapolateLambda([[0.2, 1.0, 1.0]])).toThrow();
  });
});

describe("getPrecision", () => {
  it("returns 0 for integers", () => {
    expect(getPrecision(42)).toBe(0);
  });

  it("returns correct precision for decimals", () => {
    expect(getPrecision(1.23)).toBe(2);
    expect(getPrecision(0.1)).toBe(1);
  });
});

describe("MATERIAL_COLORS", () => {
  it("has 10 colors", () => {
    expect(MATERIAL_COLORS.length).toBe(10);
  });

  it("all start with #", () => {
    for (const c of MATERIAL_COLORS) {
      expect(c.startsWith("#")).toBe(true);
    }
  });
});
