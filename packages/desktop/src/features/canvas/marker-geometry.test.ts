import { describe, expect, it } from "vitest";
import { crackMarkerPosition, limitMarkerBoxes, limitMarkerGeometry, rangeMarkerEnds } from "./marker-geometry";

const MODEL: [number, number][] = [
  [0, 0],
  [0, 10],
  [10, 10],
  [20, 5],
  [30, 5],
  [30, 0],
];

describe("search-limit markers", () => {
  it("marks both ends of a range pointing into it, one bar for a range of zero width", () => {
    expect(rangeMarkerEnds(2, 8)).toEqual([
      { x: 2, toward: 8, end: 0 },
      { x: 8, toward: 2, end: 1 },
    ]);
    expect(rangeMarkerEnds(8, 2)).toEqual([
      { x: 8, toward: 2, end: 0 },
      { x: 2, toward: 8, end: 1 },
    ]);
    expect(rangeMarkerEnds(5, 5)).toEqual([{ x: 5, toward: null, end: 0 }]);
  });

  it("puts the triangle outside the range with its tip at the bar, and boxes both", () => {
    const start = limitMarkerGeometry(100, 50, 200);
    expect(start.triangle).toEqual([
      [100, 50],
      [86, 43],
      [86, 57],
    ]);
    expect(limitMarkerGeometry(100, 50, 0).triangle![1][0]).toBe(114);
    const bar = limitMarkerGeometry(100, 50, null);
    expect(bar.triangle).toBeNull();
    expect(limitMarkerBoxes(bar)).toEqual([{ left: 98.5, top: 40, right: 101.5, bottom: 60 }]);
    expect(limitMarkerBoxes(start)[1]).toEqual({ left: 86, top: 43, right: 100, bottom: 57 });
  });
});

describe("crackMarkerPosition", () => {
  it("stands on the crest, in from its edge on the downslope side", () => {
    expect(crackMarkerPosition(MODEL, 2, false, 1)).toEqual({ x: 9, top: 10, bottom: 8, inward: -1 });
    // At most 30 % of the crest in from the edge.
    expect(crackMarkerPosition(MODEL, 2, false, 5)!.x).toBeCloseTo(7, 9);
    // A right-to-left model whose crest falls only to the right uses that edge.
    expect(crackMarkerPosition(MODEL, 2, true, 1)!.x).toBe(9);
    const mirrored = MODEL.map(([x, y]) => [30 - x, y] as [number, number]);
    expect(crackMarkerPosition(mirrored, 2, true, 1)).toEqual({ x: 21, top: 10, bottom: 8, inward: 1 });
  });

  it("moves in, clear of the search-limit markers, and stops at the model's base", () => {
    const m = crackMarkerPosition(MODEL, 2, false, 1, [9.2], 1)!;
    expect(Math.abs(m.x - 9.2)).toBeGreaterThanOrEqual(1);
    expect(m.x).toBeLessThan(9.2);
    expect(crackMarkerPosition(MODEL, 50, false, 1)!.bottom).toBe(0);
    expect(crackMarkerPosition(MODEL, 0, false, 1)).toBeNull();
  });
});

describe("limit markers at a vertex dot", () => {
  it("moves the triangle outward past a dot over it, the bar staying at the limit", () => {
    // Start of a range at x = 100 (pointing right), a dot of radius 6 on it.
    const m = limitMarkerGeometry(100, 50, 200, 1, [{ x: 100, y: 50, r: 6 }]);
    expect(m.x).toBe(100);
    expect(m.triangle).toEqual([
      [92, 50],
      [78, 43],
      [78, 57],
    ]);
    // The end of a range points the other way and moves right.
    expect(limitMarkerGeometry(100, 50, 0, 1, [{ x: 100, y: 50, r: 6 }]).triangle![0]).toEqual([108, 50]);
    // A dot elsewhere leaves it alone.
    expect(limitMarkerGeometry(100, 50, 200, 1, [{ x: 160, y: 50, r: 6 }]).triangle![0]).toEqual([100, 50]);
    // The boxes follow.
    expect(limitMarkerBoxes(m)[1]).toEqual({ left: 78, top: 43, right: 92, bottom: 57 });
  });
});

describe("crackMarkerPosition clear of boundaries", () => {
  it("moves along the crest until its bottom tick is off a material boundary", () => {
    // A boundary at y = 8 under the crest from x = 6 to 10: a 2 m crack ends on it.
    const line = [6, 8, 10, 8] as const;
    const m = crackMarkerPosition(MODEL, 2, false, 1, [], 0, { lines: [line], lineClear: 0.2, tickHalf: 0.1 })!;
    expect(m.x).toBeLessThan(6 - 0.2);
    expect(m.top).toBe(10);
    expect(m.bottom).toBe(8);
    // A boundary under the whole crest: just past its downslope edge, onto the slope.
    const wide = [0, 8, 30, 8] as const;
    const off = crackMarkerPosition(MODEL, 2, false, 1, [], 0, { lines: [wide], lineClear: 0.2 })!;
    expect(off.x).toBeGreaterThan(10);
    expect(off.x).toBeLessThanOrEqual(11);
    expect(off.bottom).toBeLessThanOrEqual(8 - 0.2);
    // Without a clear place it stays where it was.
    expect(crackMarkerPosition(MODEL, 2, false, 1, [], 0, { lines: [wide], lineClear: 5 })!.x).toBe(9);
  });
});
