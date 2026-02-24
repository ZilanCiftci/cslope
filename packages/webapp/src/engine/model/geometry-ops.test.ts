/**
 * Tests for geometry operations (Shapely replacements).
 *
 * Golden values from: webapp/tests/generate_phase2_golden.py
 */

import { describe, it, expect } from "vitest";
import {
  getSurfaceLine,
  splitPolygonByPolyline,
  lineSegmentIntersection,
} from "./geometry-ops";
import { calculatePolygonArea } from "../math/index";

// ── lineSegmentIntersection ───────────────────────────────────────

describe("lineSegmentIntersection", () => {
  it("finds intersection of crossing segments", () => {
    // (0,0)→(10,10) and (0,10)→(10,0) cross at (5,5)
    const pt = lineSegmentIntersection(0, 0, 10, 10, 0, 10, 10, 0);
    expect(pt).not.toBeNull();
    expect(pt![0]).toBeCloseTo(5, 6);
    expect(pt![1]).toBeCloseTo(5, 6);
  });

  it("returns null for parallel segments", () => {
    const pt = lineSegmentIntersection(0, 0, 10, 0, 0, 5, 10, 5);
    expect(pt).toBeNull();
  });

  it("returns null for non-intersecting segments", () => {
    // (0,0)→(1,0) and (5,5)→(10,5)
    const pt = lineSegmentIntersection(0, 0, 1, 0, 5, 5, 10, 5);
    expect(pt).toBeNull();
  });

  it("finds intersection at endpoint", () => {
    // (0,0)→(5,0) and (5,0)→(5,5)
    const pt = lineSegmentIntersection(0, 0, 5, 0, 5, 0, 5, 5);
    expect(pt).not.toBeNull();
    expect(pt![0]).toBeCloseTo(5, 6);
    expect(pt![1]).toBeCloseTo(0, 6);
  });
});

// ── getSurfaceLine ────────────────────────────────────────────────

describe("getSurfaceLine", () => {
  it("extracts surface of a rectangle (Python golden)", () => {
    // Rectangle: (0,0), (10,0), (10,-10), (0,-10), (0,0)
    // Python: x=[0, 10], y=[0, 0]
    const px = [0, 10, 10, 0, 0];
    const py = [0, 0, -10, -10, 0];
    const sl = getSurfaceLine(px, py);
    expect(sl.x).toEqual([0, 10]);
    expect(sl.y).toEqual([0, 0]);
  });

  it("extracts surface of a slope polygon (Python golden)", () => {
    // Slope: (0,0), (5,0), (25,-10), (30,-10), (30,-15), (0,-15), (0,0)
    // Python: x=[0, 5, 25, 30], y=[0, 0, -10, -10]
    const px = [0, 5, 25, 30, 30, 0, 0];
    const py = [0, 0, -10, -10, -15, -15, 0];
    const sl = getSurfaceLine(px, py);
    expect(sl.x).toEqual([0, 5, 25, 30]);
    expect(sl.y).toEqual([0, 0, -10, -10]);
  });

  it("extracts surface of the test slope (Python golden)", () => {
    // (0,0), (20,0), (40,-10), (50,-10), (50,-15), (0,-15), (0,0)
    // Python: x=[0, 20, 40, 50], y=[0, 0, -10, -10]
    const px = [0, 20, 40, 50, 50, 0, 0];
    const py = [0, 0, -10, -10, -15, -15, 0];
    const sl = getSurfaceLine(px, py);
    expect(sl.x).toEqual([0, 20, 40, 50]);
    expect(sl.y).toEqual([0, 0, -10, -10]);
  });

  it("handles a triangle", () => {
    const px = [0, 10, 5, 0];
    const py = [0, 0, -8, 0];
    const sl = getSurfaceLine(px, py);
    expect(sl.x).toEqual([0, 10]);
    expect(sl.y).toEqual([0, 0]);
  });

  it("throws for < 3 vertices", () => {
    expect(() => getSurfaceLine([0, 1], [0, 1])).toThrow();
  });
});

// ── splitPolygonByPolyline ────────────────────────────────────────

describe("splitPolygonByPolyline", () => {
  it("splits a rectangle horizontally into two equal pieces", () => {
    // Rectangle: (0,0), (10,0), (10,-10), (0,-10), (0,0)
    // Cut at y=-5
    const px = [0, 10, 10, 0, 0];
    const py = [0, 0, -10, -10, 0];
    const pieces = splitPolygonByPolyline(px, py, [0, 10], [-5, -5]);

    expect(pieces.length).toBe(2);

    // Both pieces should have area ~50
    const areas = pieces.map((p) => Math.abs(calculatePolygonArea(p.px, p.py)));
    areas.sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(50, 1);
    expect(areas[1]).toBeCloseTo(50, 1);

    // Total area should equal original
    const totalArea = areas[0] + areas[1];
    expect(totalArea).toBeCloseTo(100, 1);
  });

  it("splits the slope polygon horizontally (Python golden)", () => {
    // Slope: (0,0), (20,0), (40,-10), (50,-10), (50,-15), (0,-15), (0,0)
    // Cut at y=-5
    // Python upper: area of (0,0), (20,0), (30,-5), (0,-5) = 125
    // Python lower: area of remaining
    const px = [0, 20, 40, 50, 50, 0, 0];
    const py = [0, 0, -10, -10, -15, -15, 0];
    const pieces = splitPolygonByPolyline(px, py, [0, 50], [-5, -5]);

    expect(pieces.length).toBe(2);

    // Original area
    const origArea = Math.abs(calculatePolygonArea(px, py));
    const areas = pieces.map((p) => Math.abs(calculatePolygonArea(p.px, p.py)));
    const totalArea = areas[0] + areas[1];
    expect(totalArea).toBeCloseTo(origArea, 1);

    // Upper piece: trapezoid (0,0)→(20,0)→(30,-5)→(0,-5)
    // Area = 0.5 * (20 + 30) * 5 = 125
    const upperArea = Math.min(...areas);
    const lowerArea = Math.max(...areas);
    expect(upperArea).toBeCloseTo(125, 0);
    expect(lowerArea).toBeCloseTo(origArea - 125, 0);
  });

  it("returns original polygon if line does not intersect", () => {
    const px = [0, 10, 10, 0, 0];
    const py = [0, 0, -10, -10, 0];
    // Line above polygon
    const pieces = splitPolygonByPolyline(px, py, [0, 10], [5, 5]);
    expect(pieces.length).toBe(1);
  });

  it("handles two successive splits for 3 material layers", () => {
    // Split rectangle into 3 horizontal layers
    const px = [0, 10, 10, 0, 0];
    const py = [0, 0, -15, -15, 0];

    // First split at y=-5
    const pieces1 = splitPolygonByPolyline(px, py, [0, 10], [-5, -5]);
    expect(pieces1.length).toBe(2);

    // Second split at y=-10 on the larger piece
    let allPieces: { px: number[]; py: number[] }[] = [];
    for (const piece of pieces1) {
      const sub = splitPolygonByPolyline(
        piece.px,
        piece.py,
        [0, 10],
        [-10, -10],
      );
      allPieces = allPieces.concat(sub);
    }
    expect(allPieces.length).toBe(3);

    // Each layer should have area 50
    const areas = allPieces.map((p) =>
      Math.abs(calculatePolygonArea(p.px, p.py)),
    );
    areas.sort((a, b) => a - b);
    for (const a of areas) {
      expect(a).toBeCloseTo(50, 0);
    }
  });
});
