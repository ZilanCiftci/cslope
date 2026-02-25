import { describe, expect, it } from "vitest";
import {
  getCircleYCoordinateAtX,
  getCircleLineIntersections,
  getCirclePolygonIntersection,
  circleRadiusFromAbcd,
  circleCentre,
  generateCircleCoordinates,
} from "./circle";

describe("getCircleYCoordinateAtX", () => {
  it("returns bottom of circle at center (expected: 5.0)", () => {
    expect(getCircleYCoordinateAtX(5, 10, 5, 5)).toBeCloseTo(5.0, 10);
  });

  it("returns correct y at offset x (expected: 5.4174…)", () => {
    expect(getCircleYCoordinateAtX(5, 10, 5, 3)).toBeCloseTo(
      5.41742430504416,
      8,
    );
  });

  it("returns cy instead of NaN when x is just outside radius (regression for 2.3)", () => {
    // x is radius + tiny epsilon outside the circle
    const result = getCircleYCoordinateAtX(5, 10, 5, 5 + 5 + 1e-14);
    expect(result).not.toBeNaN();
    expect(result).toBeCloseTo(10, 8);
  });
});

describe("getCircleLineIntersections", () => {
  it("finds intersections of circle and horizontal line (expected: [8,5],[2,5])", () => {
    const ints = getCircleLineIntersections(5, 5, 3, [0, 10], [5, 5]);
    expect(ints.length).toBe(2);
    // Sort by x
    ints.sort((a, b) => a[0] - b[0]);
    expect(ints[0][0]).toBeCloseTo(2.0, 8);
    expect(ints[0][1]).toBeCloseTo(5.0, 8);
    expect(ints[1][0]).toBeCloseTo(8.0, 8);
    expect(ints[1][1]).toBeCloseTo(5.0, 8);
  });

  it("returns empty for non-intersecting line", () => {
    const ints = getCircleLineIntersections(5, 5, 3, [0, 10], [20, 20]);
    expect(ints.length).toBe(0);
  });
});

describe("getCirclePolygonIntersection", () => {
  it("finds intersections of circle and horizontal polyline (expected: [(-4,3),(4,3)])", () => {
    const pts = getCirclePolygonIntersection(0, 0, 5, [-10, 10], [3, 3]);
    expect(pts.length).toBe(2);
    expect(pts[0][0]).toBeCloseTo(-4.0, 8);
    expect(pts[0][1]).toBeCloseTo(3.0, 8);
    expect(pts[1][0]).toBeCloseTo(4.0, 8);
    expect(pts[1][1]).toBeCloseTo(3.0, 8);
  });

  it("returns empty when circle is fully inside polygon", () => {
    const pts = getCirclePolygonIntersection(
      5,
      5,
      3,
      [0, 10, 10, 0, 0],
      [0, 0, 10, 10, 0],
    );
    expect(pts.length).toBe(0);
  });

  it("handles vertical line segments", () => {
    // Circle at origin r=5, vertical line x=3 from y=-10 to y=10
    const pts = getCirclePolygonIntersection(0, 0, 5, [3, 3], [-10, 10]);
    expect(pts.length).toBe(2);
    // y = ±4
    pts.sort((a, b) => a[1] - b[1]);
    expect(pts[0][1]).toBeCloseTo(-4.0, 8);
    expect(pts[1][1]).toBeCloseTo(4.0, 8);
  });
});

describe("circleRadiusFromAbcd", () => {
  it("computes radius correctly", () => {
    // R = (C + c²) / (2c) where C = half_chord² and c = chord_to_edge
    // For c=4, C=16 → R = (16 + 16) / 8 = 4
    expect(circleRadiusFromAbcd(4, 16)).toBeCloseTo(4.0, 10);
  });

  it("returns null when cToE is zero (regression for 2.4)", () => {
    expect(circleRadiusFromAbcd(0, 16)).toBeNull();
    expect(circleRadiusFromAbcd(1e-15, 16)).toBeNull();
    expect(circleRadiusFromAbcd(-1e-15, 16)).toBeNull();
  });
});

describe("circleCentre", () => {
  it("computes centre from chord intersection", () => {
    const [x, y] = circleCentre(0, [5, 5], 10);
    // beta=0 → dx = sin(0)*10 = 0, dy = cos(0)*10 = 10
    expect(x).toBeCloseTo(5.0, 10);
    expect(y).toBeCloseTo(15.0, 10);
  });
});

describe("generateCircleCoordinates", () => {
  it("generates correct number of points", () => {
    const [x, y] = generateCircleCoordinates(0, 0, 10, 50);
    expect(x.length).toBe(50);
    expect(y.length).toBe(50);
  });

  it("points are on the bottom half of the circle", () => {
    const [, y] = generateCircleCoordinates(0, 0, 10, 90);
    // Bottom half → all y <= 0 (cy=0, bottom = cy - R = -10)
    for (const yi of y) {
      expect(yi).toBeLessThanOrEqual(0.001); // rounding tolerance
    }
  });
});
