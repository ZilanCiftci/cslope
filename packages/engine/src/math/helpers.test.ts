/**
 * Interslice functions, λ extrapolation and small helpers.
 */
import { describe, it, expect } from "vitest";
import {
  constantInterslice,
  halfsine,
  clippedSine,
  trapezoidal,
  dataPointSpecified,
  getIntersliceFunctionValue,
  extrapolateLambda,
  getPrecision,
  midCoord,
  distPoints,
} from "./helpers";
import type { IntersliceFunctionType } from "../types/analysis";
import { getYAtXStrict, getLineBetweenPoints } from "./interpolation";
import { generateCircleCoordinates } from "./circle";

const KINDS: IntersliceFunctionType[] = ["constant", "half-sine", "clipped-sine", "trapezoidal", "data-point-specified"];

describe("interslice functions", () => {
  it("every function is 0 at and outside the ends of its domain and in [0, 1] inside", () => {
    const pts: [number, number][] = [[0, 0.2], [0.5, 1], [1, 0.2]];
    for (const kind of KINDS) {
      for (const x of [-5, 10, 10 - 1e-15, 30, 31]) {
        expect(getIntersliceFunctionValue(kind, x, 10, 30, pts), `${kind} at ${x}`).toBe(0);
      }
      for (let k = 1; k < 40; k++) {
        const v = getIntersliceFunctionValue(kind, 10 + k * 0.5, 10, 30, pts);
        expect(v, `${kind} at ${10 + k * 0.5}`).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is mirror symmetric about the middle of the domain (symmetric data points too)", () => {
    const pts: [number, number][] = [[0, 0.1], [0.3, 0.8], [0.5, 1], [0.7, 0.8], [1, 0.1]];
    for (const kind of KINDS) {
      for (const t of [0.05, 0.13, 0.2, 0.37, 0.5]) {
        const a = getIntersliceFunctionValue(kind, 2 + 8 * t, 2, 10, pts);
        const b = getIntersliceFunctionValue(kind, 2 + 8 * (1 - t), 2, 10, pts);
        expect(a, `${kind} t=${t}`).toBeCloseTo(b, 12);
      }
    }
  });

  it("values of each shape", () => {
    expect(constantInterslice(5, 0, 10)).toBe(1);
    expect(halfsine(5, 0, 10)).toBeCloseTo(1, 12);
    expect(halfsine(2.5, 0, 10)).toBeCloseTo(Math.SQRT1_2, 12);
    // Clipped from below at 0.35.
    expect(clippedSine(0.1, 0, 10)).toBe(0.35);
    expect(clippedSine(5, 0, 10)).toBeCloseTo(1, 12);
    // Trapezoid: rise to 20 %, flat to 80 %, fall.
    expect(trapezoidal(1, 0, 10)).toBeCloseTo(0.5, 12);
    expect(trapezoidal(2, 0, 10)).toBe(1);
    expect(trapezoidal(8, 0, 10)).toBe(1);
    expect(trapezoidal(9, 0, 10)).toBeCloseTo(0.5, 12);
  });

  it("an empty or inverted domain gives 0", () => {
    for (const kind of KINDS) {
      expect(getIntersliceFunctionValue(kind, 5, 5, 5)).toBe(0);
      expect(getIntersliceFunctionValue(kind, 5, 10, 0)).toBe(0);
    }
  });

  it("an unknown or missing kind is the half-sine", () => {
    expect(getIntersliceFunctionValue(undefined, 2.5, 0, 10)).toBeCloseTo(Math.SQRT1_2, 12);
    expect(getIntersliceFunctionValue("cubic" as IntersliceFunctionType, 2.5, 0, 10)).toBeCloseTo(Math.SQRT1_2, 12);
  });
});

describe("data-point-specified interslice function", () => {
  it("interpolates linearly in normalised x", () => {
    const pts: [number, number][] = [[0, 0], [0.5, 1], [1, 0]];
    expect(dataPointSpecified(25, 0, 100, pts)).toBeCloseTo(0.5, 12);
    expect(dataPointSpecified(50, 0, 100, pts)).toBeCloseTo(1, 12);
    expect(dataPointSpecified(90, 0, 100, pts)).toBeCloseTo(0.2, 12);
  });

  it("sorts the points and holds the end values beyond the first and last point", () => {
    const pts: [number, number][] = [[0.8, 0.4], [0.2, 0.6]];
    expect(dataPointSpecified(10, 0, 100, pts)).toBeCloseTo(0.6, 12);
    expect(dataPointSpecified(95, 0, 100, pts)).toBeCloseTo(0.4, 12);
    expect(dataPointSpecified(50, 0, 100, pts)).toBeCloseTo(0.5, 12);
  });

  it("clamps x to [0, 1] and negative f to 0", () => {
    const pts: [number, number][] = [[-1, -2], [2, 1]];
    // (0, 0) to (1, 1).
    expect(dataPointSpecified(30, 0, 100, pts)).toBeCloseTo(0.3, 12);
  });

  it("ignores non-finite points; without valid points falls back to the half-sine", () => {
    expect(dataPointSpecified(25, 0, 100, [[NaN, 1], [0.5, Infinity]])).toBeCloseTo(Math.SQRT1_2, 12);
    expect(dataPointSpecified(25, 0, 100, [])).toBeCloseTo(Math.SQRT1_2, 12);
    expect(dataPointSpecified(50, 0, 100, [[NaN, 1], [0.5, 0.3]])).toBeCloseTo(0.3, 12);
  });

  it("a vertical step (two points at the same x) jumps there", () => {
    const pts: [number, number][] = [[0, 0.2], [0.5, 0.2], [0.5, 0.9], [1, 0.9]];
    expect(dataPointSpecified(49, 0, 100, pts)).toBeCloseTo(0.2, 12);
    expect(dataPointSpecified(51, 0, 100, pts)).toBeCloseTo(0.9, 12);
  });

  it("a single point is a constant", () => {
    for (const x of [1, 50, 99]) expect(dataPointSpecified(x, 0, 100, [[0.4, 0.7]])).toBeCloseTo(0.7, 12);
  });
});

describe("extrapolateLambda", () => {
  it("needs two points", () => {
    expect(() => extrapolateLambda([[0, 1, 1.2]])).toThrow(/at least two/);
  });

  it("finds the intersection of the two secants", () => {
    // Fm = 1.5 + 0.1 λ, Ff = 1.3 + 0.5 λ → λ = 0.5, F = 1.55.
    const [lambda, fs] = extrapolateLambda([
      [0, 1.5, 1.3],
      [0.2, 1.52, 1.4],
    ]);
    expect(lambda).toBeCloseTo(0.5, 12);
    expect(fs).toBeCloseTo(1.55, 12);
  });

  it("uses the two points with the smallest gap", () => {
    const [lambda] = extrapolateLambda([
      [-1, 9, 1],
      [0, 1.5, 1.3],
      [0.2, 1.52, 1.4],
    ]);
    expect(lambda).toBeCloseTo(0.5, 12);
  });

  it("parallel curves (no intersection): returns one of the closest points", () => {
    // Equal slopes mean an equal gap; float noise decides.
    const r = extrapolateLambda([[0, 1.5, 1.25], [0.2, 1.6, 1.35], [0.4, 3, 1]]);
    expect([[0, 1.5], [0.2, 1.6]]).toContainEqual(r);
  });

  it("clamps λ to ±5", () => {
    expect(extrapolateLambda([[0, 1.5, 1.3], [0.1, 1.5, 1.3001]])[0]).toBe(5);
    expect(extrapolateLambda([[0, 1.5, 1.7], [0.1, 1.5, 1.7001]])[0]).toBe(-5);
  });
});

describe("small helpers", () => {
  it("getPrecision", () => {
    expect(getPrecision(5)).toBe(0);
    expect(getPrecision(1.25)).toBe(2);
    expect(getPrecision(0.1)).toBe(1);
    // Stops at a run of three zeros (float noise).
    expect(getPrecision(1.2000004)).toBe(1);
  });

  it("midCoord and distPoints", () => {
    expect(midCoord([0, 0], [4, -2])).toEqual([2, -1]);
    expect(distPoints([1, 1], [4, 5])).toBe(5);
  });
});

describe("strict interpolation and circle points", () => {
  it("getYAtXStrict: vertical segment, out of range, NaN", () => {
    expect(getYAtXStrict([[0, 5, 5, 10], [0, 0, 4, 4]], 5)).toBe(0);
    expect(getYAtXStrict([[5, 5], [0, 4]], 5)).toBe(2);
    expect(() => getYAtXStrict([[0, 10], [0, 1]], 11)).toThrow(/outside the limits/);
    expect(() => getYAtXStrict([[0, 10], [0, 1]], NaN)).toThrow(/Could not interpolate/);
  });

  it("getLineBetweenPoints without vertices between the ends", () => {
    expect(getLineBetweenPoints([[0, 10], [0, 10]], 2, 3)).toEqual([[2, 3], [2, 3]]);
    expect(() => getLineBetweenPoints([[0, 10], [0, 10]], -1, 3)).toThrow(/outside the limits/);
  });

  it("generateCircleCoordinates with a single point gives the lowest point", () => {
    expect(generateCircleCoordinates(2, 5, 3, 1)).toEqual([[2], [2]]);
    const [x, y] = generateCircleCoordinates(0, 0, 1, 5);
    expect(x).toHaveLength(5);
    for (let i = 0; i < 5; i++) expect(Math.hypot(x[i], y[i])).toBeCloseTo(1, 2);
  });
});
