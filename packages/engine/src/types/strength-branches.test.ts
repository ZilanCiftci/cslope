/**
 * Strength resolution guards: unknown kinds and interpolation methods,
 * interpolated functions with steps and out-of-range arguments.
 */
import { describe, it, expect } from "vitest";
import { resolveStrength, interpolateFunction } from "./strength";
import type { MaterialModel } from "./material-models";

const ctx = { yBottom: 0, x: 5, yGround: 10, alpha: 0 };

describe("strength guards", () => {
  it("an unknown model kind throws", () => {
    expect(() => resolveStrength({ kind: "granite", unitWeight: 20 } as unknown as MaterialModel, ctx)).toThrow(/Unknown material model kind: granite/);
  });

  it("an unknown spatial interpolation falls back to inverse distance weighting", () => {
    const model = (interpolation: string) =>
      ({
        kind: "spatial-mohr-coulomb",
        unitWeight: 18,
        interpolation,
        dataPoints: [
          [0, 0, 10, 20, 18],
          [10, 0, 30, 40, 18],
        ],
      }) as unknown as MaterialModel;
    expect(resolveStrength(model("cubic"), ctx)).toEqual(resolveStrength(model("idw"), ctx));
    // Midway between two points: IDW gives the mean.
    expect(resolveStrength(model("idw"), ctx).cohesion).toBeCloseTo(20, 12);
  });

  it("interpolated functions: empty, single point, clamped ends, unsorted input, steps", () => {
    expect(interpolateFunction([], 3)).toBe(0);
    expect(interpolateFunction([[1, 7]], 3)).toBe(7);
    expect(interpolateFunction([[10, 2], [0, 0]], 5)).toBeCloseTo(1, 12);
    expect(interpolateFunction([[0, 0], [10, 2]], -5)).toBe(0);
    expect(interpolateFunction([[0, 0], [10, 2]], 15)).toBe(2);
    expect(interpolateFunction([[0, 0], [5, 1], [5, 3], [10, 3]], 5)).toBe(1);
    expect(interpolateFunction([[0, 0], [5, 1], [5, 3], [10, 3]], 5.0001)).toBeCloseTo(3, 9);
    // A NaN argument (a degenerate slice) falls through to the last value.
    expect(interpolateFunction([[0, 0], [10, 2]], NaN)).toBe(2);
  });

  it("the anisotropic modifier: empty function is factor 1; φ kept below 90°, negative factors give 0", () => {
    const aniso = (modifierFunction: [number, number][], phi = 30) =>
      ({ kind: "anisotropic-function", unitWeight: 18, cohesion: 10, frictionAngle: phi, modifierFunction }) as MaterialModel;
    expect(resolveStrength(aniso([]), ctx)).toMatchObject({ cohesion: 10, frictionAngle: 30 });
    expect(resolveStrength(aniso([[-90, 4], [90, 4]], 40), ctx).frictionAngle).toBe(89.9);
    expect(resolveStrength(aniso([[-90, -1], [90, -1]]), ctx)).toMatchObject({ cohesion: 0, frictionAngle: 0 });
  });
});
