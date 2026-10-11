import { describe, expect, it } from "vitest";
import { freeWaterPolygons, piezoExtensions } from "./piezo";

describe("piezoExtensions", () => {
  const model: [number, number][] = [[0, 0], [0, 10], [10, 10], [20, 5], [30, 5], [30, 0]];
  it("extends a short line horizontally to both model edges", () => {
    expect(piezoExtensions([[12, 6], [18, 4]], model)).toEqual([
      [[0, 6], [12, 6]],
      [[18, 4], [30, 4]],
    ]);
  });
  it("handles lines given right to left and lines spanning the model", () => {
    expect(piezoExtensions([[18, 4], [12, 6]], model)).toHaveLength(2);
    expect(piezoExtensions([[0, 6], [30, 4]], model)).toEqual([]);
  });
});

describe("freeWaterPolygons", () => {
  // Slope rising from a toe flat at y = 0 to a crest at y = 10.
  const model: [number, number][] = [[0, -5], [0, 0], [20, 0], [40, 10], [60, 10], [60, -5]];

  it("is empty when the water stays below the ground", () => {
    expect(freeWaterPolygons([[0, -1], [60, -1]], model)).toEqual([]);
  });

  it("covers the toe and the submerged part of the face", () => {
    const polys = freeWaterPolygons([[0, 4], [60, 4]], model);
    expect(polys).toHaveLength(1);
    const xs = polys[0].map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(0);
    // The water meets the face (y = (x − 20) / 2) at x = 28.
    expect(Math.max(...xs)).toBeCloseTo(28);
    expect(polys[0].every(([, y]) => y <= 4 + 1e-9 && y >= -1e-9)).toBe(true);
  });
});
