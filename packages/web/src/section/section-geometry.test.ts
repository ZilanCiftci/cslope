// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SliceData } from "@cslope/engine";
import { EXCAVATION_EXAMPLES } from "../templates/excavation-examples";
import { clipBand, groundAt, horizontalSpans, sectionShapes, surfaceLine, ticks, viewOf, type Point } from "./section-geometry";

const square: Point[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe("the section's shapes", () => {
  it("clips a polygon to a band and finds where a level is inside it", () => {
    expect(clipBand(square, 2, 5)).toEqual([
      [10, 2],
      [10, 5],
      [0, 5],
      [0, 2],
    ]);
    expect(horizontalSpans(square, 4)).toEqual([[0, 10]]);
    expect(horizontalSpans(square, 12)).toEqual([]);
    expect(groundAt(square, 3)).toBe(10);
  });

  it("gives each layer its band of the outline, the road, the water in the ground and the load", () => {
    const p = EXCAVATION_EXAMPLES["clay-road-design-sk2"];
    const s = sectionShapes(p);
    expect(s.layers).toHaveLength(1);
    expect(Math.min(...s.layers[0].map((q) => q[1]))).toBe(s.g.base);
    expect(Math.max(...s.layers[0].map((q) => q[1]))).toBe(0);
    expect(s.road).toHaveLength(4);
    // The water at −1 runs from the left edge to the face (at x = 2) and from the face's other side… none: the pit is below it.
    expect(s.water).toHaveLength(1);
    expect(s.water[0][0]).toBe(s.g.left);
    expect(s.water[0][1]).toBeCloseTo(2);
    expect(s.load).toEqual({ x1: -7, x2: -3, y: 0.8 });
    const view = viewOf(s.g, p.excavationDepth, null);
    expect(view.x0).toBeGreaterThan(s.g.left);
    expect(view.x1).toBeLessThan(s.g.right);
    expect(view.y1).toBe(0.8);
  });

  it("draws the critical surface along the slices' bases", () => {
    const slice = (xLeft: number, xRight: number, yBottom: number, alpha: number) => ({ x: (xLeft + xRight) / 2, xLeft, xRight, yBottom, alpha }) as SliceData;
    const line = surfaceLine([slice(0, 2, 9, Math.PI / 4), slice(2, 4, 7, Math.PI / 4)]);
    expect(line.map(([x, y]) => [x, Number(y.toFixed(9))])).toEqual([
      [0, 10],
      [2, 8],
      [4, 6],
    ]);
  });

  it("picks round ticks", () => {
    expect(ticks(-12.3, 31, 4)).toEqual([-10, 0, 10, 20, 30]);
    expect(ticks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });
});
