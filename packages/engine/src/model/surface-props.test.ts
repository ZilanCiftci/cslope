/**
 * Non-circular surfaces: fitting user polylines to the ground (property
 * checks on random polylines) and the admissibility rules.
 */
import { describe, it, expect } from "vitest";
import { Material } from "../types/index";
import { Slope } from "./slope";
import { fitPolylineToGround, isAdmissiblePolyline, circleToPolyline, polylineYAt, defaultAxisPoint, type Pt } from "./surface";
import { rng, uniform } from "./property-helpers";

const BOUNDARY: Pt[] = [[0, -10], [0, 10], [10, 10], [25, 0], [40, 0], [40, -10]];
function model(boundary = BOUNDARY): Slope {
  const s = new Slope();
  s.addMaterial(new Material({ name: "S", unitWeight: 19, cohesion: 5, frictionAngle: 30 }));
  s.setExternalBoundary(boundary);
  return s;
}
const ground = (s: Slope, x: number) => s.getExternalYIntersection(x);

describe("fitPolylineToGround", () => {
  const s = model();

  it("property: a fitted polyline starts and ends on the ground, lies below it and follows the input", () => {
    const r = rng(12);
    let fitted = 0;
    for (let i = 0; i < 150; i++) {
      const n = 2 + Math.floor(r() * 4);
      const xs = Array.from({ length: n }, () => uniform(r, -5, 45)).sort((a, b) => a - b);
      // Half fully random, half shaped like a slip surface (ends near the
      // ground, possibly below it, the middle in the soil).
      const shaped = i % 2 === 0;
      const pts: Pt[] = xs.map((x, k) => {
        const g = ground(s, Math.min(40, Math.max(0, x)));
        if (!shaped) return [x, uniform(r, -9, 12)];
        const end = k === 0 || k === n - 1;
        return [x, end ? g + uniform(r, -1, 2) : Math.max(-9, g - uniform(r, 1, 6))];
      });
      const out = fitPolylineToGround(s, pts);
      if (!out) continue;
      fitted++;
      const [a, b] = [out[0], out[out.length - 1]];
      expect(Math.abs(a[1] - ground(s, a[0])), `case ${i} entry`).toBeLessThan(1e-6);
      expect(Math.abs(b[1] - ground(s, b[0])), `case ${i} exit`).toBeLessThan(1e-6);
      for (let k = 1; k < out.length - 1; k++) {
        expect(out[k][1], `case ${i} vertex ${k}`).toBeLessThan(ground(s, out[k][0]) + 1e-9);
      }
      for (let k = 1; k < out.length; k++) expect(out[k][0]).toBeGreaterThan(out[k - 1][0]);
      // Inside the input's x-range the fitted line is the input line.
      for (const t of [0.25, 0.5, 0.75]) {
        const x = a[0] + t * (b[0] - a[0]);
        if (x > xs[0] && x < xs[n - 1]) expect(polylineYAt(out, x)).toBeCloseTo(polylineYAt(pts, x), 9);
      }
    }
    expect(fitted).toBeGreaterThan(20);
  });

  it("extends end segments that stop below the ground", () => {
    const out = fitPolylineToGround(s, [[12, 4], [18, 0], [24, 0.5]])!;
    expect(out).not.toBeNull();
    expect(out[0][0]).toBeLessThan(12);
    expect(out[out.length - 1][0]).toBeGreaterThan(24);
    expect(out[out.length - 1][1]).toBeCloseTo(ground(s, out[out.length - 1][0]), 6);
  });

  it("rejects too few, duplicate-x and non-finite points, lines above the ground and extensions out of the model", () => {
    expect(fitPolylineToGround(s, [[5, 0]])).toBeNull();
    expect(fitPolylineToGround(s, [[5, 0], [5, -1], [30, -2]])).toBeNull();
    expect(fitPolylineToGround(s, [[5, NaN], [30, -2]])).toBeNull();
    expect(fitPolylineToGround(s, [[0, 20], [40, 20]])).toBeNull();
    // Rising to the left forever below the ground: the extension leaves the model.
    expect(fitPolylineToGround(s, [[5, -8], [30, -9]])).toBeNull();
    expect(fitPolylineToGround(new Slope(), [[5, 0], [30, -2]])).toBeNull();
    // Finite points are kept: one NaN point among three.
    expect(fitPolylineToGround(s, [[2, 14], [NaN, 0], [17, -2], [38, 6]])).not.toBeNull();
  });

  it("rejects a polyline that comes in through the side of the model below the ground (regression)", () => {
    // The first point lies left of the model, below the crest continued
    // there. Extending the first segment walked away from the model and put
    // the new end point (0, 10) on the wrong side of its neighbour: the
    // "surface" then entered the soil at (0, 6.76) on the model's side.
    const pts: Pt[] = [[-2.94, -5.26], [-1.17, 6.62], [25.37, 9.91], [30.82, 4.38]];
    expect(fitPolylineToGround(s, pts)).toBeNull();
    // Mirror case at the right edge.
    expect(fitPolylineToGround(s, [[2, 12], [20, -2], [41, -3], [43, -8]])).toBeNull();
  });

  it("a surface starting on the foot of a vertical face enters there", () => {
    const wall = model([[0, -10], [0, 10], [10, 10], [10, 4], [25, 0], [40, 0], [40, -10]]);
    const out = fitPolylineToGround(wall, [[10, 4], [20, -2], [35, 2]]);
    expect(out).not.toBeNull();
    expect(out![0]).toEqual([10, 4]);
  });
});

describe("isAdmissiblePolyline", () => {
  const s = model();
  it("accepts a concave-up polyline through the soil", () => {
    expect(isAdmissiblePolyline(s, [[5, 10], [15, 2], [25, -2], [33, 0]])).toBe(true);
  });
  it("rejects kinks upward, vertical segments, vertices above ground or outside the model, non-finite points", () => {
    expect(isAdmissiblePolyline(s, [[5, 10], [15, 6], [20, -2], [33, 0]])).toBe(false);
    expect(isAdmissiblePolyline(s, [[5, 10], [15, 2], [15, -2], [33, 0]])).toBe(false);
    expect(isAdmissiblePolyline(s, [[5, 10], [15, 9.5], [33, 0]], Infinity)).toBe(false);
    expect(isAdmissiblePolyline(s, [[5, 10], [15, -12], [33, 0]], Infinity)).toBe(false);
    expect(isAdmissiblePolyline(s, [[5, 10], [15, NaN], [33, 0]])).toBe(false);
    expect(isAdmissiblePolyline(s, [[5, 10]])).toBe(false);
    expect(isAdmissiblePolyline(new Slope(), [[5, 10], [33, 0]])).toBe(false);
  });
});

describe("helpers", () => {
  it("polylineYAt: NaN outside, vertical step, last point", () => {
    expect(polylineYAt([[0, 0], [1, 1]], 2)).toBeNaN();
    expect(polylineYAt([[0, 0]], 0)).toBeNaN();
    expect(polylineYAt([[0, 0], [1, 1], [1, 3], [2, 3]], 1)).toBe(1);
    expect(polylineYAt([[0, 0], [1, 1]], 1)).toBe(1);
  });

  it("circleToPolyline puts the vertices on the arc between the end points", () => {
    const pts = circleToPolyline(20, 20, 18, [8, 6.58], [32, 6.58], 7);
    expect(pts).toHaveLength(7);
    for (const [x, y] of pts.slice(1, -1)) expect(Math.hypot(x - 20, y - 20)).toBeCloseTo(18, 9);
  });

  it("default axis: circumcentre for a curved surface, above the chord for a straight one", () => {
    const curved = defaultAxisPoint([[0, 0], [5, -3], [10, 0]]);
    expect(Math.hypot(curved[0], curved[1])).toBeCloseTo(Math.hypot(curved[0] - 5, curved[1] + 3), 9);
    const straight = defaultAxisPoint([[0, 10], [10, 0]]);
    expect(straight[0]).toBeCloseTo(5 + 10, 9);
    expect(straight[1]).toBeCloseTo(5 + 10, 9);
    // A deep skewed surface whose circumcentre drops below the chord: fallback.
    const skewed = defaultAxisPoint([[0, 0], [0.5, -20], [10, 0]]);
    expect(skewed[1]).toBeGreaterThan(0);
  });
});
