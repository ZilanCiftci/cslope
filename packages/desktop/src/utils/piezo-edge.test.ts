import { describe, expect, it } from "vitest";
import { freeWaterPolygons, piezoExtensions } from "./piezo";

type Pt = [number, number];

// Crest at y = 5, a vertical step at x = 10 down to y = 2.
const STEP: Pt[] = [
  [0, 0],
  [0, 5],
  [10, 5],
  [10, 2],
  [20, 2],
  [20, 0],
];

describe("piezometric line helpers: degenerate input", () => {
  it("needs a line of two points and a model of three", () => {
    expect(piezoExtensions([[0, 1]], STEP)).toEqual([]);
    expect(piezoExtensions([[0, 1], [5, 1]], [[0, 0], [1, 1]])).toEqual([]);
    expect(freeWaterPolygons([[0, 1]], STEP)).toEqual([]);
    expect(freeWaterPolygons([[0, 1], [5, 1]], [[0, 0], [1, 1]])).toEqual([]);
  });

  it("a line spanning the model has no extensions", () => {
    expect(piezoExtensions([[-5, 1], [25, 1]], STEP)).toEqual([]);
  });
});

describe("freeWaterPolygons", () => {
  it("follows a vertical ground face under water", () => {
    const polys = freeWaterPolygons([[0, 6], [20, 6]], STEP);
    expect(polys).toEqual([
      [
        [0, 6],
        [10, 6],
        [20, 6],
        [20, 2],
        [10, 2],
        [10, 5],
        [0, 5],
      ],
    ]);
  });

  it("starts and ends where the water line crosses the ground", () => {
    // Water at y = 3: dry on the crest, ponding on the lower bench.
    const polys = freeWaterPolygons([[0, 3], [20, 3]], STEP);
    expect(polys).toEqual([
      [
        [10, 3],
        [20, 3],
        [20, 2],
        [10, 2],
      ],
    ]);
  });

  it("a sloping line that dips below the ground splits into its wet part", () => {
    // Above the bench at the left end (x = 10), below it at x = 20.
    const polys = freeWaterPolygons([[10, 4], [20, 0]], STEP);
    expect(polys).toHaveLength(1);
    const [poly] = polys;
    // Crosses the bench (y = 2) half way.
    expect(poly).toContainEqual([15, 2]);
    expect(poly[0]).toEqual([10, 4]);
  });
});
