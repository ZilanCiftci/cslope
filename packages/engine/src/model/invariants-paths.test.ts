/**
 * Different code paths that must agree: a circle and the same circle as a
 * fine polyline about its centre; a line load and a narrow distributed
 * load of the same resultant.
 */
import { describe, it, expect } from "vitest";
import { rng, uniform, randomCase, onCircle, onPolyline, fosOf, relDiff, decorate, type Method } from "./property-helpers";
import { circleToPolyline, type Pt } from "./surface";

const METHODS: Method[] = ["Ordinary", "Bishop", "Janbu", "Morgenstern-Price"];

describe("circle vs polyline", () => {
  it("a circle as a fine polyline about its centre gives the circle's FOS (water, loads, reinforcement)", () => {
    const r = rng(8080);
    let compared = 0;
    for (let i = 0; i < 12; i++) {
      const g = randomCase(r);
      const features = new Set([["water"], ["udl"], ["nail"], ["pile"]][i % 4]);
      const def = decorate(r, g, features);
      const { cx, cy, radius } = g.circle;
      const yIn = g.shape.H;
      const lc: Pt = [cx - Math.sqrt(radius ** 2 - (yIn - cy) ** 2), yIn];
      const xToe = g.shape.crest + g.shape.run;
      // Exit on the toe (y = 0) or on the face.
      const xOut0 = cx + Math.sqrt(radius ** 2 - cy ** 2);
      let rc: Pt;
      if (xOut0 >= xToe) rc = [xOut0, 0];
      else {
        // Bisection for the crossing with the face.
        let lo = Math.max(cx, g.shape.crest);
        let hi = xToe;
        const f = (x: number) => cy - Math.sqrt(radius ** 2 - (x - cx) ** 2) - g.shape.H * (1 - (x - g.shape.crest) / g.shape.run);
        for (let k = 0; k < 80; k++) {
          const mid = (lo + hi) / 2;
          if (f(mid) < 0) lo = mid;
          else hi = mid;
        }
        rc = [hi, cy - Math.sqrt(radius ** 2 - (hi - cx) ** 2)];
      }
      const poly = circleToPolyline(cx, cy, radius, lc, rc, 401);
      for (const method of METHODS) {
        const a = fosOf(onCircle(def, g.circle), method, { slices: 400 });
        const b = fosOf(onPolyline(def, poly, [cx, cy]), method, { slices: 400 });
        expect(b === null, `seed 8080 case ${i} ${method}`).toBe(a === null);
        if (a !== null && b !== null) {
          // Chords instead of the arc (400 of them, one slice each).
          expect(relDiff(a, b), `seed 8080 case ${i} ${method} [${[...features]}]: ${a} vs ${b}`).toBeLessThan(5e-4);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(36);
  }, 30_000);
});

describe("line load vs narrow distributed load", () => {
  it("a line load P equals a UDL of P/w over a narrow width w", () => {
    const r = rng(8081);
    for (let i = 0; i < 10; i++) {
      const g = randomCase(r, { layers: 1 });
      const P = uniform(r, 20, 120);
      const x = uniform(r, 0.3, 0.9) * g.shape.crest;
      const w = 0.02;
      const line = onCircle({ ...g.def, lineLoads: [{ magnitude: P, x }] }, g.circle);
      const udl = onCircle({ ...g.def, udls: [{ magnitude: P / w, x1: x - w / 2, x2: x + w / 2 }] }, g.circle);
      for (const method of METHODS) {
        const a = fosOf(line, method, { slices: 50 })!;
        const b = fosOf(udl, method, { slices: 50 })!;
        expect(relDiff(a, b), `seed 8081 case ${i} ${method}: ${a} vs ${b}`).toBeLessThan(1e-4);
      }
    }
  }, 30_000);
});
