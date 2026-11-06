/**
 * Geometry operations through the facade: degenerate inputs and property
 * checks (area is conserved by every split, lenses become holes). The
 * internal functions (polylineYAtX, clipLineToSurface, keyholeRing,
 * materialLayerTopAt, the detailed splits) are tested in Rust:
 * packages/engine-rs/crates/cslope-engine/tests/geometry_ops.rs.
 */
import { describe, it, expect } from "vitest";
import { lineSegmentIntersection, getSurfaceLine, splitPolygonByPolyline, polygonizeRegions } from "./geometry-ops";
import { calculatePolygonArea, isPointInPolygon } from "../math/polygon";
import { rng, uniform } from "./property-helpers";

const ringArea = (r: [number, number][]) => calculatePolygonArea(r.map((p) => p[0]), r.map((p) => p[1]));
const BOX: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];

describe("line and polyline helpers", () => {
  it("segment intersection: crossing, touching ends, parallel, apart", () => {
    expect(lineSegmentIntersection(0, 0, 2, 2, 0, 2, 2, 0)).toEqual([1, 1]);
    expect(lineSegmentIntersection(0, 0, 1, 0, 1, 0, 1, 1)).toEqual([1, 0]);
    expect(lineSegmentIntersection(0, 0, 1, 0, 0, 1, 1, 1)).toBeNull();
    expect(lineSegmentIntersection(0, 0, 1, 0, 2, -1, 2, 1)).toBeNull();
  });

  it("surface line: needs 3 vertices; vertical faces and the top of the polygon", () => {
    expect(() => getSurfaceLine([0, 1], [0, 1])).toThrow(/at least 3/);
    const s = getSurfaceLine([0, 0, 5, 5, 10, 10, 0], [-5, 4, 4, 0, 0, -5, -5]);
    expect(s.x).toEqual([0, 5, 5, 10]);
    expect(s.y).toEqual([4, 4, 0, 0]);
    // Clockwise input gives the same surface.
    const cw = getSurfaceLine([0, 10, 10, 5, 5, 0], [-5, -5, 0, 0, 4, 4]);
    expect(cw).toEqual(s);
  });
});

describe("splitting polygons", () => {
  it("a line that misses and a single point leave the polygon whole", () => {
    expect(splitPolygonByPolyline(BOX.map((p) => p[0]), BOX.map((p) => p[1]), [20, 30], [0, 0])).toHaveLength(1);
    expect(splitPolygonByPolyline(BOX.map((p) => p[0]), BOX.map((p) => p[1]), [5], [5])).toHaveLength(1);
  });

  it("an open polygon is closed; pieces are ordered top first and add up", () => {
    const pieces = splitPolygonByPolyline([0, 10, 10, 0], [0, 0, 10, 10], [-1, 11], [4, 6]);
    expect(pieces).toHaveLength(2);
    const avg = (p: { py: number[] }) => p.py.reduce((a, b) => a + b, 0) / p.py.length;
    expect(avg(pieces[0])).toBeGreaterThan(avg(pieces[1]));
    const total = pieces.reduce((s, p) => s + calculatePolygonArea(p.px, p.py), 0);
    expect(total).toBeCloseTo(100, 9);
  });

  it("a closed boundary inside (a lens) gives a lens and a piece with a hole", () => {
    const lens: [number, number][] = [[3, 3], [7, 3], [7, 6], [3, 6], [3, 3]];
    const pieces = splitPolygonByPolyline(BOX.map((p) => p[0]), BOX.map((p) => p[1]), lens.map((p) => p[0]), lens.map((p) => p[1]));
    expect(pieces).toHaveLength(2);
    const areas = pieces.map((p) => calculatePolygonArea(p.px, p.py)).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(12, 9);
    expect(areas[1]).toBeCloseTo(88, 9);
    const outer = pieces.find((p) => Math.abs(calculatePolygonArea(p.px, p.py) - 88) < 1e-6)!;
    expect(isPointInPolygon(5, 4.5, outer.px, outer.py)).toBe(false);
    expect(isPointInPolygon(1, 1, outer.px, outer.py)).toBe(true);
  });

  it("property: random polylines across random convex polygons conserve the area", () => {
    const r = rng(77);
    for (let i = 0; i < 40; i++) {
      const n = 3 + Math.floor(r() * 6);
      const ang = Array.from({ length: n }, () => r() * 2 * Math.PI).sort((a, b) => a - b);
      const rad = uniform(r, 5, 20);
      const px = ang.map((a) => rad * Math.cos(a));
      const py = ang.map((a) => rad * Math.sin(a));
      const k = 2 + Math.floor(r() * 3);
      const lx = Array.from({ length: k }, (_, j) => -30 + (60 * j) / (k - 1));
      const ly = lx.map(() => uniform(r, -rad, rad));
      const pieces = splitPolygonByPolyline(px, py, lx, ly);
      const total = pieces.reduce((s, p) => s + calculatePolygonArea(p.px, p.py), 0);
      expect(total, `case ${i}`).toBeCloseTo(calculatePolygonArea(px, py), 6);
    }
  });
});

describe("regions cut by all boundaries", () => {
  it("degenerate inputs: no usable lines", () => {
    const whole = polygonizeRegions([0, 10, 10, 0], [0, 0, 10, 10], [[[1, 1]]]);
    expect(whole).toHaveLength(1);
    expect(whole[0].outer).toHaveLength(5);
  });

  it("property: faces (outer − holes) add up to the slope for random layered boundaries and lenses", () => {
    const r = rng(78);
    const slope: [number, number][] = [[0, -10], [0, 10], [10, 10], [25, 0], [40, 0], [40, -10]];
    const px = slope.map((p) => p[0]);
    const py = slope.map((p) => p[1]);
    const total = calculatePolygonArea(px, py);
    for (let i = 0; i < 25; i++) {
      const lines: [number, number][][] = [];
      const nLayers = 1 + Math.floor(r() * 3);
      for (let k = 0; k < nLayers; k++) {
        const y0 = uniform(r, -9, 8);
        lines.push([[-1, y0], [20, y0 + uniform(r, -3, 3)], [41, y0 + uniform(r, -4, 2)]]);
      }
      if (r() < 0.6) {
        const cx = uniform(r, 5, 35);
        const cy = uniform(r, -8, -3);
        const w = uniform(r, 1, 4);
        const h = uniform(r, 0.5, 1.5);
        lines.push([[cx - w, cy - h], [cx + w, cy - h], [cx + w, cy + h], [cx - w, cy + h], [cx - w, cy - h]]);
      }
      const faces = polygonizeRegions(px, py, lines);
      const sum = faces.reduce((s, f) => s + ringArea(f.outer) - f.holes.reduce((a, h) => a + ringArea(h), 0), 0);
      expect(sum, `case ${i}`).toBeCloseTo(total, 6);
    }
  });
});
