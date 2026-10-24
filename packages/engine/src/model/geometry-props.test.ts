/**
 * Geometry operations: degenerate inputs and property checks (area is
 * conserved by every split, lenses become holes, keyhole rings behave as
 * polygons with holes).
 */
import { describe, it, expect } from "vitest";
import {
  lineSegmentIntersection,
  polylineYAtX,
  polylineYAtSide,
  polylineYFrom,
  getSurfaceLine,
  clipLineToSurface,
  splitPolygonByPolyline,
  splitPolygonByPolylineDetailed,
  materialLayerTopAt,
  keyholeRing,
  polygonizeRegions,
  polygonizeRegionsDetailed,
  createGeometryWithMaterial,
} from "./geometry-ops";
import { calculatePolygonArea, isPointInPolygon } from "../math/polygon";
import { Material } from "../types/material";
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

  it("polylineYAtX: inside, at a vertical segment, outside, either direction", () => {
    expect(polylineYAtX([0, 10], [0, 10], 4)).toBeCloseTo(4, 12);
    expect(polylineYAtX([10, 0], [10, 0], 4)).toBeCloseTo(4, 12);
    expect(polylineYAtX([0, 5, 5, 10], [0, 0, 4, 4], 5)).toBe(0);
    expect(polylineYAtX([0, 5, 5, 10], [0, 2, 4, 4], 5)).toBe(2);
    expect(polylineYAtX([5, 5], [0, 4], 5)).toBe(2);
    expect(polylineYAtX([0, 10], [0, 10], 11)).toBeUndefined();
    expect(polylineYAtX([0, 10], [0, 10], -1)).toBeUndefined();
  });

  it("one-sided values at a vertical step; plain value where a side has none", () => {
    const x = [0, 5, 5, 10];
    const y = [0, 0, 4, 4];
    expect(polylineYAtSide(x, y, 5, "left")).toBe(0);
    expect(polylineYAtSide(x, y, 5, "right")).toBe(4);
    expect(polylineYAtSide(x, y, 0, "left")).toBeNaN();
    expect(polylineYFrom(x, y, 0, "left")).toBe(0);
    expect(polylineYFrom(x, y, 10, "right")).toBe(4);
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

  it("clipping a water line to the ground: crossings, vertical steps, no overlap", () => {
    expect(clipLineToSurface([0], [1], [0, 1], [0, 0])).toBeNull();
    expect(clipLineToSurface([20, 30], [1, 1], [0, 10], [0, 0])).toBeNull();
    const c = clipLineToSurface([0, 10], [2, 2], [0, 5, 5, 10], [4, 4, 0, 0])!;
    expect(c.x).toEqual([0, 5, 5, 10]);
    expect(c.y).toEqual([2, 2, 0, 0]);
    // A line crossing an inclined ground: the crossing point is added.
    const d = clipLineToSurface([0, 10], [3, 3], [0, 10], [6, 0])!;
    expect(d.x).toEqual([0, 5, 10]);
    expect(d.y[1]).toBeCloseTo(3, 12);
    expect(d.y[2]).toBe(0);
  });
});

describe("splitting polygons", () => {
  it("a line that misses, a single point and an edge-running line leave the polygon whole", () => {
    expect(splitPolygonByPolyline(BOX.map((p) => p[0]), BOX.map((p) => p[1]), [20, 30], [0, 0])).toHaveLength(1);
    expect(splitPolygonByPolyline(BOX.map((p) => p[0]), BOX.map((p) => p[1]), [5], [5])).toHaveLength(1);
    const along = splitPolygonByPolylineDetailed([0, 10, 10, 0], [0, 0, 10, 10], [0, 10], [0, 0]);
    expect(along.pieces).toHaveLength(1);
    expect(along.splitFailed).toBe(false);
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
  it("degenerate inputs: too few points, no usable lines", () => {
    expect(polygonizeRegionsDetailed([0, 1], [0, 1], [])).toEqual({ faces: [], failed: false, danglingBoundaries: [] });
    const whole = polygonizeRegions([0, 10, 10, 0], [0, 0, 10, 10], [[[1, 1]]]);
    expect(whole).toHaveLength(1);
    expect(whole[0].outer).toHaveLength(5);
  });

  it("boundaries outside the slope: one face, not reported as failed", () => {
    const r = polygonizeRegionsDetailed([0, 10, 10, 0], [0, 0, 10, 10], [[[20, 0], [30, 5]]]);
    expect(r.faces).toHaveLength(1);
    expect(r.failed).toBe(false);
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
      // As keyhole rings (how the engine stores them) too.
      const sumRings = faces.reduce((s, f) => s + ringArea(keyholeRing(f.outer, f.holes)), 0);
      expect(sumRings, `case ${i} keyhole`).toBeCloseTo(total, 6);
    }
  });
});

describe("keyhole rings", () => {
  it("a hole of either orientation is cut out; tiny holes are skipped", () => {
    const hole: [number, number][] = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]];
    for (const h of [hole, [...hole].reverse()]) {
      const ring = keyholeRing(BOX, [h]);
      expect(ringArea(ring)).toBeCloseTo(96, 12);
      expect(isPointInPolygon(3, 3, ring.map((p) => p[0]), ring.map((p) => p[1]))).toBe(false);
      expect(isPointInPolygon(8, 8, ring.map((p) => p[0]), ring.map((p) => p[1]))).toBe(true);
    }
    expect(ringArea(keyholeRing(BOX, [[[1, 1], [2, 2]]]))).toBeCloseTo(100, 12);
    // Open input rings are accepted.
    expect(ringArea(keyholeRing(BOX.slice(0, -1), [hole.slice(0, -1)]))).toBeCloseTo(96, 12);
  });

  it("two holes", () => {
    const a: [number, number][] = [[1, 1], [3, 1], [3, 3], [1, 3]];
    const b: [number, number][] = [[6, 6], [9, 6], [9, 9], [6, 9]];
    const ring = keyholeRing(BOX, [a, b]);
    expect(ringArea(ring)).toBeCloseTo(100 - 4 - 9, 12);
  });
});

describe("top of a material layer", () => {
  const m1 = new Material({ name: "A", unitWeight: 18, cohesion: 5, frictionAngle: 30 });
  const m2 = new Material({ name: "B", unitWeight: 18, cohesion: 5, frictionAngle: 30 });

  it("stacked regions of the same material count as one layer; another material stops the climb", () => {
    const geos = [
      createGeometryWithMaterial([0, 10, 10, 0], [0, 0, 5, 5], m1),
      createGeometryWithMaterial([0, 10, 10, 0], [5, 5, 8, 8], m1),
      createGeometryWithMaterial([0, 10, 10, 0], [8, 8, 9, 9], m2),
      createGeometryWithMaterial([0, 10, 10, 0], [9, 9, 12, 12], m1),
    ];
    expect(materialLayerTopAt(geos, m1, 5, 1)).toBe(8);
    expect(materialLayerTopAt(geos, m1, 5, 10)).toBe(12);
    expect(materialLayerTopAt(geos, m2, 5, 8.5)).toBe(9);
    // Not inside the material, or beside every region.
    expect(materialLayerTopAt(geos, m2, 5, 1)).toBeNull();
    expect(materialLayerTopAt(geos, m1, 20, 1)).toBeNull();
  });

  it("regions without bounds are checked too", () => {
    const g = createGeometryWithMaterial([0, 10, 10, 0], [0, 0, 5, 5], m1, false);
    expect(g.xMin).toBeUndefined();
    expect(materialLayerTopAt([g], m1, 5, 2)).toBe(5);
  });
});
