// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SliceData } from "@cslope/engine";
import { EMBANKMENT_EXAMPLES } from "../templates/embankment-examples";
import { embankmentGeometry } from "../templates/embankment";
import { EXCAVATION_EXAMPLES } from "../templates/excavation-examples";
import { geometry } from "../templates/excavation";
import { clipBand, embankmentShapes, excavationShapes, groundAt, lineAt, surfaceLine, ticks, viewOf, type Point } from "./section-geometry";

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
    expect(groundAt(square, 3)).toBe(10);
  });

  it("gives each layer its band of the outline, the road, the water in the ground and the load", () => {
    const p = EXCAVATION_EXAMPLES["clay-road-design-sk2"];
    const s = excavationShapes(p);
    const g = geometry(p);
    expect(s.layers).toHaveLength(1);
    expect(Math.min(...s.layers[0].map((q) => q[1]))).toBe(g.base);
    expect(Math.max(...s.layers[0].map((q) => q[1]))).toBe(0);
    expect(s.fill).toHaveLength(4);
    // The water at −1 runs level to the face (at x = 2), then along the face and the excavation's bottom.
    expect(s.water[0]).toEqual([g.left, -1]);
    expect(lineAt(s.water, -10)).toBe(-1);
    expect(lineAt(s.water, 2)).toBeCloseTo(-1);
    expect(lineAt(s.water, 4)).toBeCloseTo(-2);
    expect(lineAt(s.water, 20)).toBe(-4);
    expect(s.load).toEqual({ x1: -7, x2: -3, y: 0.8, q: 20 });
    const view = viewOf(s, null);
    expect(view.x0).toBeGreaterThan(g.left);
    expect(view.x1).toBeLessThan(g.right);
    expect(view.y1).toBe(0.8);
  });

  it("draws the embankment over its layers, the load on its crest, and shows it whole", () => {
    const p = EMBANKMENT_EXAMPLES["crust-over-clay"];
    const s = embankmentShapes(p);
    const g = embankmentGeometry(p);
    expect(s.fill).toEqual([
      [-16, 0],
      [-10, 3],
      [0, 3],
      [6, 0],
    ]);
    expect(s.layers).toHaveLength(2);
    expect(s.boundaries).toEqual([
      [
        [g.left, -1.5],
        [g.right, -1.5],
      ],
      [
        [-16, 0],
        [6, 0],
      ],
    ]);
    expect(s.load).toEqual({ x1: -10, x2: 0, y: 3, q: 10 });
    // The water at −1: level under the embankment.
    expect(lineAt(s.water, -5)).toBe(-1);
    const view = viewOf(s, null);
    expect(view.x0).toBeLessThan(-16);
    expect(view.x0).toBeGreaterThan(g.left);
    expect(view.y1).toBe(3);
  });

  it("draws water above the ground along the ground, and in the road's fill up to its level", () => {
    const p = EXCAVATION_EXAMPLES["clay-road-design-sk2"];
    const high = excavationShapes({ ...p, waterLevel: 2 });
    expect(lineAt(high.water, -20)).toBe(0);
    expect(lineAt(high.water, -5)).toBe(0.8);
    expect(lineAt(high.water, 20)).toBe(-4);
    const inRoad = excavationShapes({ ...p, waterLevel: 0.3 });
    expect(lineAt(inRoad.water, -20)).toBe(0);
    expect(lineAt(inRoad.water, -5)).toBe(0.3);
    expect(excavationShapes({ ...p, waterLevel: -30 }).water).toEqual([]);
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
