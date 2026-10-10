import { describe, it, expect } from "vitest";
import { Material } from "../types/index";
import { Slope } from "./slope";
import { clipLineToSurface } from "./geometry-ops";

const BOUNDARY: [number, number][] = [
  [0, -15],
  [0, 0],
  [20, 0],
  [40, -10],
  [50, -10],
  [50, -15],
];

function makeSlope(): Slope {
  const s = new Slope();
  s.addMaterial(new Material({ name: "M" }));
  s.setExternalBoundary(BOUNDARY);
  return s;
}

describe("clipLineToSurface", () => {
  it("returns the pointwise minimum including crossing points", () => {
    const out = clipLineToSurface([0, 50], [-5, -5], [0, 20, 40, 50], [0, 0, -10, -10]);
    expect(out).not.toBeNull();
    expect(out!.x).toEqual([0, 20, 30, 40, 50]);
    expect(out!.y).toEqual([-5, -5, -5, -10, -10]);
  });

  it("keeps both sides of a vertical step in the surface", () => {
    const out = clipLineToSurface([0, 20], [5, 5], [0, 10, 10, 20], [10, 10, 0, 0]);
    expect(out!.x).toEqual([0, 10, 10, 20]);
    expect(out!.y).toEqual([5, 5, 0, 0]);
  });

  it("returns null when the x-ranges do not overlap", () => {
    expect(clipLineToSurface([60, 70], [0, 0], [0, 50], [0, 0])).toBeNull();
  });
});

describe("Slope.setWaterTable with followBoundary", () => {
  it("horizontal level below the crest follows the ground only where the ground is lower", () => {
    const s = makeSlope();
    s.setWaterTable({ height: -5 });
    expect(s.waterRLXY!.x).toEqual([0, 20, 30, 40, 50]);
    expect(s.waterRLXY!.y).toEqual([-5, -5, -5, -10, -10]);
  });

  it("level below the whole ground surface stays horizontal", () => {
    const s = makeSlope();
    s.setWaterTable({ height: -12 });
    expect(s.waterRLXY!.y.every((y) => y === -12)).toBe(true);
  });

  it("level above the whole ground surface follows the ground surface", () => {
    const s = makeSlope();
    s.setWaterTable({ height: 5 });
    expect(s.hasWaterTable).toBe(true);
    expect(s.waterRLXY!.y).toEqual([0, 0, -10, -10]);
  });

  it("custom line is clipped to the ground surface by default", () => {
    const s = makeSlope();
    s.setWaterTable({ coordinates: [[0, -3], [50, -3]] });
    expect(s.waterRLXY!.x).toEqual([0, 20, 26, 40, 50]);
    expect(s.waterRLXY!.y).toEqual([-3, -3, -3, -10, -10]);
  });

  it("custom line is used as-is when followBoundary is false", () => {
    const s = makeSlope();
    s.setWaterTable({ coordinates: [[0, -3], [50, -3]], followBoundary: false });
    expect(s.waterRLXY).toEqual({ x: [0, 50], y: [-3, -3] });
  });
});
