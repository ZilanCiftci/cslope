import { describe, expect, it } from "vitest";
import { freeWaterPolygons, nextPiezoPoint, piezoExtensions } from "./piezo";

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

  it("leaves out slivers: water on a vertical face or lying on the ground", () => {
    // A cut with a vertical face from (20, 0) to (20, 10).
    const cut: [number, number][] = [[0, -5], [0, 0], [20, 0], [20, 10], [60, 10], [60, -5]];
    expect(freeWaterPolygons([[0, 0.0001], [20, 0.0001], [20, 10], [60, 10]], cut)).toEqual([]);
    expect(freeWaterPolygons([[0, 0], [20, 0], [20, 10], [60, 10]], cut)).toEqual([]);
    expect(freeWaterPolygons([[0, 2], [60, 2]], cut)).toHaveLength(1);
  });
});

describe("nextPiezoPoint", () => {
  const model: [number, number][] = [[0, 0], [0, 10], [50, 10], [50, 0]];

  it("starts an empty line at the left edge at mid height", () => {
    expect(nextPiezoPoint([], model)).toEqual({ index: 0, point: [0, 5] });
  });

  it("continues a short line 5 m, at most to the right edge", () => {
    expect(nextPiezoPoint([[0, 4], [30, 4]], model)).toEqual({ index: 2, point: [35, 4] });
    expect(nextPiezoPoint([[0, 4], [48, 3]], model)).toEqual({ index: 2, point: [50, 3] });
  });

  it("fills the widest gap once the line reaches the right edge", () => {
    expect(nextPiezoPoint([[0, 4], [50, 8]], model)).toEqual({ index: 1, point: [25, 6] });
    const line: [number, number][] = [[0, 4], [10, 4], [40, 6], [50, 6]];
    expect(nextPiezoPoint(line, model)).toEqual({ index: 2, point: [25, 5] });
    // Repeated presses never leave the model.
    let pts = [[0, 4], [50, 8]] as [number, number][];
    for (let i = 0; i < 6; i++) {
      const { index, point } = nextPiezoPoint(pts, model);
      pts = [...pts.slice(0, index), point, ...pts.slice(index)];
    }
    expect(Math.max(...pts.map((p) => p[0]))).toBe(50);
    expect(Math.min(...pts.map((p) => p[0]))).toBe(0);
  });

  it("continues a line entered right to left towards the left edge", () => {
    expect(nextPiezoPoint([[50, 4], [30, 2]], model)).toEqual({ index: 2, point: [25, 2] });
    expect(nextPiezoPoint([[50, 4], [3, 2]], model)).toEqual({ index: 2, point: [0, 2] });
  });

  it("fills the widest gap of a right-to-left line that reaches the left edge", () => {
    // Not a point after the last one, which would double the line back.
    expect(nextPiezoPoint([[50, 4], [30, 2], [0, 1]], model)).toEqual({
      index: 2,
      point: [15, 1.5],
    });
    // Repeated presses keep the line running one way, inside the model.
    let pts = [[50, 4], [30, 2], [0, 1]] as [number, number][];
    for (let i = 0; i < 6; i++) {
      const { index, point } = nextPiezoPoint(pts, model);
      pts = [...pts.slice(0, index), point, ...pts.slice(index)];
    }
    expect(pts).toHaveLength(9);
    for (let i = 1; i < pts.length; i++) expect(pts[i][0]).toBeLessThan(pts[i - 1][0]);
    expect(pts[0][0]).toBe(50);
    expect(pts.at(-1)![0]).toBe(0);
  });
});
