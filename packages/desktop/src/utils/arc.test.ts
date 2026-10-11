import { describe, expect, it } from "vitest";
import {
  circleArcPoints,
  fosLabelAnchor,
  sameSurface,
  surfaceBaseYAt,
  surfacePoints,
  type DrawableSurface,
} from "./arc";

const circle: DrawableSurface = {
  cx: 0,
  cy: 10,
  radius: 10,
  entryPoint: [-10, 10],
  exitPoint: [10, 10],
};

describe("circleArcPoints", () => {
  it("runs from entry to exit along the lower half of the circle", () => {
    const pts = circleArcPoints(0, 10, 10, [-10, 10], [10, 10], 4);
    expect(pts).toHaveLength(5);
    expect(pts[0][0]).toBeCloseTo(-10, 9);
    expect(pts[4][0]).toBeCloseTo(10, 9);
    // Midpoint is the bottom of the circle, not the top.
    expect(pts[2][0]).toBeCloseTo(0, 9);
    expect(pts[2][1]).toBeCloseTo(0, 9);
    for (const [x, y] of pts) expect(Math.hypot(x, y - 10)).toBeCloseTo(10, 9);
  });

  it("also takes the lower arc when the exit is left of the entry (right-to-left)", () => {
    const pts = circleArcPoints(0, 10, 10, [10, 10], [-10, 10], 4);
    expect(pts[0][0]).toBeCloseTo(10, 9);
    expect(pts[2][1]).toBeCloseTo(0, 9);
    expect(pts[4][0]).toBeCloseTo(-10, 9);
  });

  it("handles entry and exit at different heights", () => {
    const r = Math.hypot(6, 8);
    const pts = circleArcPoints(0, 0, r, [-6, -8], [8, -6]);
    expect(pts).toHaveLength(61);
    for (const [, y] of pts) expect(y).toBeLessThan(0);
  });
});

describe("surfacePoints", () => {
  it("returns the polyline of a non-circular surface as is", () => {
    const points: [number, number][] = [
      [0, 5],
      [3, 1],
      [8, 4],
    ];
    expect(surfacePoints({ ...circle, points })).toBe(points);
  });

  it("samples the arc of a circle (or a degenerate polyline)", () => {
    expect(surfacePoints(circle)).toHaveLength(61);
    expect(surfacePoints({ ...circle, points: [[0, 0]] })).toHaveLength(61);
  });
});

describe("surfaceBaseYAt", () => {
  it("gives the lower arc of a circle and null outside it", () => {
    expect(surfaceBaseYAt(circle, 0)).toBeCloseTo(0, 9);
    expect(surfaceBaseYAt(circle, 6)).toBeCloseTo(2, 9);
    expect(surfaceBaseYAt(circle, 10.5)).toBeNull();
  });

  it("interpolates a polyline in either direction", () => {
    const poly = {
      ...circle,
      points: [
        [8, 4],
        [4, 0],
        [0, 4],
      ] as [number, number][],
    };
    expect(surfaceBaseYAt(poly, 6)).toBeCloseTo(2, 9);
    expect(surfaceBaseYAt(poly, 1)).toBeCloseTo(3, 9);
    expect(surfaceBaseYAt(poly, 9)).toBeNull();
    expect(surfaceBaseYAt(poly, -1)).toBeNull();
  });

  it("takes the lower end of a vertical polyline segment", () => {
    const poly = {
      ...circle,
      points: [
        [0, 6],
        [0, 2],
        [5, 0],
      ] as [number, number][],
    };
    expect(surfaceBaseYAt(poly, 0)).toBe(2);
  });
});

describe("sameSurface", () => {
  it("compares circles by centre and radius", () => {
    expect(sameSurface(circle, { ...circle, entryPoint: [0, 0] })).toBe(true);
    expect(sameSurface(circle, { ...circle, radius: 9 })).toBe(false);
  });

  it("compares polylines point by point and never matches a circle", () => {
    const pts: [number, number][] = [
      [0, 0],
      [1, -1],
    ];
    const a = { ...circle, points: pts };
    expect(sameSurface(a, { ...circle, points: pts.map((p) => [...p] as [number, number]) })).toBe(true);
    expect(sameSurface(a, { ...circle, points: [[0, 0], [1, -2]] })).toBe(false);
    expect(sameSurface(a, { ...circle, points: [[0, 0]] })).toBe(false);
    expect(sameSurface(a, circle)).toBe(false);
    expect(sameSurface(circle, a)).toBe(false);
  });
});

describe("fosLabelAnchor", () => {
  it("is the centre of a circle", () => {
    expect(fosLabelAnchor(circle)).toEqual([0, 10]);
  });

  it("is above the middle of a non-circular sliding mass", () => {
    expect(
      fosLabelAnchor({
        cx: 99,
        cy: 99,
        radius: 0,
        entryPoint: [2, 8],
        exitPoint: [12, 3],
        points: [
          [2, 8],
          [12, 3],
        ],
      }),
    ).toEqual([7, 8]);
  });
});
