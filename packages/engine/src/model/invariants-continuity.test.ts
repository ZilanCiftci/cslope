/**
 * Continuity at degenerate positions: a slip circle exactly through a
 * vertex of the ground, of a layer boundary or of the water line (zero-
 * width slices, a touching arc) gives the FOS of circles a hair away.
 */
import { describe, it, expect } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import { rng, uniform, randomCase, onCircle, fosOf, relDiff, type Method, type Circle, type Pt } from "./property-helpers";

const METHODS: Method[] = ["Ordinary", "Bishop", "Janbu", "Morgenstern-Price"];

/** Circle through a, b with its centre on their bisector at height cy. */
function circleThrough(a: Pt, b: Pt, lift: number): Circle {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let nx = -(b[1] - a[1]) / len;
  let ny = (b[0] - a[0]) / len;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const cx = mx + nx * lift * len;
  const cy = my + ny * lift * len;
  return { cx, cy, radius: Math.hypot(a[0] - cx, a[1] - cy) };
}

function check(def: SlopeDefinition, c: Circle, label: string): number {
  let compared = 0;
  for (const method of METHODS) {
    const f = fosOf(onCircle(def, c), method, { slices: 40 });
    for (const dr of [-1e-7, 1e-7]) {
      const g = fosOf(onCircle(def, { ...c, radius: c.radius + dr }), method, { slices: 40 });
      expect(g === null, `${label} ${method} dr ${dr}: ${f} vs ${g}`).toBe(f === null);
      if (f !== null && g !== null) {
        expect(relDiff(f, g), `${label} ${method} dr ${dr}: ${f} vs ${g}`).toBeLessThan(1e-4);
        compared++;
      }
    }
  }
  return compared;
}

describe("continuity at vertices", () => {
  it("circles through the crest edge, the toe and an interior point of the face", () => {
    const r = rng(5150);
    let compared = 0;
    for (let i = 0; i < 10; i++) {
      const g = randomCase(r, { water: i % 2 === 0 });
      const { shape } = g;
      const crestEdge: Pt = [shape.crest, shape.H];
      const toe: Pt = [shape.crest + shape.run, 0];
      const behind: Pt = [shape.crest * uniform(r, 0.2, 0.7), shape.H];
      const beyond: Pt = [toe[0] + shape.toe * uniform(r, 0.2, 0.6), 0];
      for (const [name, a, b] of [
        ["entry at crest edge", crestEdge, beyond],
        ["exit at toe", behind, toe],
        ["crest edge to toe", crestEdge, toe],
      ] as [string, Pt, Pt][]) {
        const c = circleThrough(a, b, uniform(r, 0.4, 1));
        if (c.cy - c.radius < -shape.depth + 0.2) continue;
        compared += check(g.def, c, `seed 5150 case ${i} ${name}`);
      }
    }
    expect(compared).toBeGreaterThan(100);
  }, 30_000);

  it("circles through a vertex of a layer boundary or of the water line", () => {
    const r = rng(5151);
    let compared = 0;
    for (let i = 0; i < 10; i++) {
      const g = randomCase(r, { layers: 2, water: true });
      const { shape } = g;
      const behind: Pt = [shape.crest * uniform(r, 0.2, 0.6), shape.H];
      const beyond: Pt = [shape.crest + shape.run + shape.toe * uniform(r, 0.1, 0.5), 0];
      // A boundary and a water line with a kink inside the slope.
      const kink: Pt = [shape.crest + shape.run * uniform(r, 0.2, 0.6), uniform(r, -0.4, 0.1) * shape.H];
      const xEnd = shape.crest + shape.run + shape.toe;
      const def: SlopeDefinition = {
        ...g.def,
        materialBoundaries: [{ coordinates: [[0, kink[1] + 1], kink, [xEnd, kink[1] - 2]], materialName: "Lower" }],
        regionAssignments: [
          { point: [0.5, shape.H - 0.5], materialName: "Upper" },
          { point: [0.5, -shape.depth + 0.5], materialName: "Lower" },
        ],
        waterTable: { mode: "custom", value: [[0, kink[1] + 3], [kink[0], kink[1] + 0.5], [xEnd, kink[1] - 1]], followBoundary: true },
      };
      // The circle through behind, beyond and the kink.
      const [x1, y1] = behind;
      const [x2, y2] = beyond;
      const [x3, y3] = kink;
      const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
      const s1 = x1 * x1 + y1 * y1;
      const s2 = x2 * x2 + y2 * y2;
      const s3 = x3 * x3 + y3 * y3;
      const cx = (s1 * (y2 - y3) + s2 * (y3 - y1) + s3 * (y1 - y2)) / d;
      const cy = (s1 * (x3 - x2) + s2 * (x1 - x3) + s3 * (x2 - x1)) / d;
      const c = { cx, cy, radius: Math.hypot(x1 - cx, y1 - cy) };
      if (!(cy > shape.H) || c.cy - c.radius < -shape.depth + 0.2) continue;
      compared += check(def, c, `seed 5151 case ${i}`);
    }
    expect(compared).toBeGreaterThan(30);
  }, 30_000);
});
