import { describe, expect, it } from "vitest";
import {
  calculatePolygonArea,
  isPointInPolygon,
  clipPolygonHalfplane,
  clipPolygonVertical,
} from "./polygon";

describe("calculatePolygonArea", () => {
  it("returns 0 for fewer than 3 points", () => {
    expect(calculatePolygonArea([0, 1], [0, 1])).toBe(0);
    expect(calculatePolygonArea([], [])).toBe(0);
  });

  it("calculates area of unit square (golden: 1.0)", () => {
    expect(calculatePolygonArea([0, 1, 1, 0], [0, 0, 1, 1])).toBeCloseTo(
      1.0,
      10,
    );
  });

  it("calculates area of triangle (golden: 6.0)", () => {
    expect(calculatePolygonArea([0, 4, 2], [0, 0, 3])).toBeCloseTo(6.0, 10);
  });

  it("is independent of winding order", () => {
    const cw = calculatePolygonArea([0, 1, 1, 0], [0, 0, 1, 1]);
    const ccw = calculatePolygonArea([0, 0, 1, 1], [0, 1, 1, 0]);
    expect(cw).toBeCloseTo(ccw, 10);
  });
});

describe("isPointInPolygon", () => {
  const sqX = [0, 1, 1, 0];
  const sqY = [0, 0, 1, 1];

  it("returns true for interior point (golden: True)", () => {
    expect(isPointInPolygon(0.5, 0.5, sqX, sqY)).toBe(true);
  });

  it("returns false for exterior point (golden: False)", () => {
    expect(isPointInPolygon(2.0, 0.5, sqX, sqY)).toBe(false);
  });

  it("handles point near edge", () => {
    expect(isPointInPolygon(0.001, 0.5, sqX, sqY)).toBe(true);
  });
});

describe("clipPolygonHalfplane", () => {
  it("clips square by x >= 1 (half-plane 1·x + 0·y - 1 >= 0)", () => {
    const [rx, ry] = clipPolygonHalfplane(
      [0, 4, 4, 0],
      [0, 0, 3, 3],
      1.0,
      0.0,
      -1.0,
    );
    expect(rx.length).toBeGreaterThanOrEqual(3);
    const area = calculatePolygonArea(rx, ry);
    expect(area).toBeCloseTo(9.0, 6); // 3x3 → clip to 3x3 at x>=1 → 3x3=9
  });

  it("returns empty for fully excluded polygon", () => {
    const [rx] = clipPolygonHalfplane(
      [0, 1, 1, 0],
      [0, 0, 1, 1],
      1.0,
      0.0,
      -10.0, // x >= 10
    );
    expect(rx.length).toBe(0);
  });
});

describe("clipPolygonVertical", () => {
  it("clips [0,4]x[0,3] to [1,3] strip (golden area: 6.0)", () => {
    const [rx, ry] = clipPolygonVertical([0, 4, 4, 0], [0, 0, 3, 3], 1.0, 3.0);
    expect(rx.length).toBeGreaterThanOrEqual(3);
    expect(calculatePolygonArea(rx, ry)).toBeCloseTo(6.0, 6);
  });

  it("returns empty if strip is outside polygon", () => {
    const [rx] = clipPolygonVertical([0, 1, 1, 0], [0, 0, 1, 1], 5.0, 10.0);
    expect(rx.length).toBe(0);
  });
});
