import { describe, expect, it } from "vitest";
import { isPointInPolygon } from "@cslope/engine";
import {
  computeRegions,
  isClosedBoundary,
  regionCentroid,
  regionInteriorPoint,
} from "./regions";

const SQUARE: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe("isClosedBoundary", () => {
  it("needs three distinct corners and matching ends", () => {
    expect(isClosedBoundary([])).toBe(false);
    expect(isClosedBoundary([[0, 0], [1, 0], [0, 0]])).toBe(false);
    expect(isClosedBoundary([[0, 0], [1, 0], [1, 1], [0, 0]])).toBe(true);
    expect(isClosedBoundary([[0, 0], [1, 0], [1, 1], [0, 1e-6]])).toBe(false);
    expect(isClosedBoundary([[0, 0], [1, 0], [1, 1], [1e-10, 0]])).toBe(true);
  });
});

describe("regionCentroid", () => {
  it("averages the vertices and handles an empty polygon", () => {
    expect(regionCentroid([], [])).toEqual([0, 0]);
    expect(regionCentroid([0, 4, 4, 0], [0, 0, 2, 2])).toEqual([2, 1]);
  });
});

describe("regionInteriorPoint", () => {
  it("returns the middle of a convex region", () => {
    expect(regionInteriorPoint([0, 10, 10, 0], [0, 0, 10, 10])).toEqual([5, 5]);
  });

  it("finds a point in a ring, not in its hole", () => {
    const outer = { px: [0, 10, 10, 0], py: [0, 0, 10, 10] };
    const hole = { px: [2, 8, 8, 2], py: [2, 2, 8, 8] };
    const [x, y] = regionInteriorPoint(outer.px, outer.py, [hole]);
    expect(isPointInPolygon(x, y, outer.px, outer.py)).toBe(true);
    expect(isPointInPolygon(x, y, hole.px, hole.py)).toBe(false);
  });

  it("finds a point inside a concave (U-shaped) region", () => {
    // U: the vertex average (≈ the notch) lies outside.
    const px = [0, 10, 10, 7, 7, 3, 3, 0];
    const py = [0, 0, 10, 10, 2, 2, 10, 10];
    const [cx, cy] = regionCentroid(px, py);
    expect(isPointInPolygon(cx, cy, px, py)).toBe(false);
    const [x, y] = regionInteriorPoint(px, py);
    expect(isPointInPolygon(x, y, px, py)).toBe(true);
  });

  it("falls back to the centroid for a degenerate (flat) region", () => {
    expect(regionInteriorPoint([0, 5, 10], [3, 3, 3])).toEqual([5, 3]);
  });
});

describe("computeRegions", () => {
  it("needs at least three coordinates", () => {
    expect(computeRegions([[0, 0], [1, 1]], [], [], "m")).toEqual([]);
  });

  it("without boundaries the whole closed slope is one region", () => {
    const [r] = computeRegions(SQUARE, [], [], "default");
    expect(r).toEqual({
      px: [0, 10, 10, 0, 0],
      py: [0, 0, 10, 10, 0],
      materialId: "default",
      regionKey: "region-0",
    });
  });

  it("does not close an already closed outline again", () => {
    const [r] = computeRegions([...SQUARE, [0, 0]], [], [], "d");
    expect(r.px).toHaveLength(5);
  });

  it("assigns the material whose point lies in the region", () => {
    const [r] = computeRegions(
      SQUARE,
      [],
      [
        { point: [20, 20], materialId: "outside" },
        { point: [5, 5], materialId: "inside" },
      ],
      "default",
    );
    expect(r.materialId).toBe("inside");
  });

  it("a lens becomes a hole in the surrounding region, largest region first", () => {
    const lens: [number, number][] = [[3, 3], [6, 3], [6, 6], [3, 6], [3, 3]];
    const regions = computeRegions(
      SQUARE,
      [{ id: "b", coordinates: lens }],
      [
        { point: [1, 1], materialId: "outer" },
        // Inside the lens: must not count for the outer region.
        { point: [4.5, 4.5], materialId: "core" },
      ],
      "default",
    );
    expect(regions).toHaveLength(2);
    const [outer, core] = regions;
    expect(outer.materialId).toBe("outer");
    expect(outer.holes).toHaveLength(1);
    expect(core.materialId).toBe("core");
    expect(core.holes).toBeUndefined();
  });

  it("an assignment in the lens only does not colour the ring", () => {
    const lens: [number, number][] = [[3, 3], [6, 3], [6, 6], [3, 6], [3, 3]];
    const [outer, core] = computeRegions(
      SQUARE,
      [{ id: "b", coordinates: lens }],
      [{ point: [4.5, 4.5], materialId: "core" }],
      "default",
    );
    expect(outer.materialId).toBe("default");
    expect(core.materialId).toBe("core");
  });
});
