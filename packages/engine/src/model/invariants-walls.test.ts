/**
 * Invariants for ground with vertical faces (walls, quays, steps) and free
 * water against them: mirror symmetry, buoyancy under full submergence and
 * the sign of the water thrust.
 */
import { describe, it, expect } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import { WATER_UNIT_WEIGHT } from "../types/constants";
import { buildSlope } from "./build-slope";
import { getSlices } from "./slices";
import { rng, uniform, onCircle, fosOf, mirrorDefinition, relDiff, mohrCoulomb, type Method, type Circle } from "./property-helpers";

interface Stepped {
  def: SlopeDefinition;
  circle: Circle;
  H: number;
  xFace: number;
  yFaceFoot: number;
}

/** Crest, a vertical face down to yFaceFoot, an inclined slope to the toe at y = 0. */
function stepped(r: () => number): Stepped {
  const H = uniform(r, 6, 12);
  const D = uniform(r, 6, 10);
  const xFace = uniform(r, 8, 14);
  const yFaceFoot = H * uniform(r, 0.3, 0.7);
  const run = uniform(r, 6, 15);
  const xToe = xFace + run;
  const xEnd = xToe + uniform(r, 8, 14);
  const gamma = uniform(r, 17, 21);
  const c = uniform(r, 5, 25);
  const phi = uniform(r, 15, 35);
  const def: SlopeDefinition = {
    orientation: "ltr",
    coordinates: [[0, -D], [0, H], [xFace, H], [xFace, yFaceFoot], [xToe, 0], [xEnd, 0], [xEnd, -D]],
    materials: [{ name: "S", unitWeight: gamma, cohesion: c, frictionAngle: phi, model: mohrCoulomb(gamma, c, phi) }],
  };
  // Circle through a crest point and a toe point, centre high above.
  const a: [number, number] = [xFace * uniform(r, 0.3, 0.8), H];
  const b: [number, number] = [xToe + uniform(r, 0.5, 4), 0];
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nx = (a[1] - b[1]) / len;
  const ny = (b[0] - a[0]) / len;
  for (let off = 0.6; off < 3; off += 0.1) {
    const cx = mx + nx * off * len;
    const cy = my + ny * off * len;
    const radius = Math.hypot(a[0] - cx, a[1] - cy);
    if (cy - radius > -D + 0.3) return { def, circle: { cx, cy, radius }, H, xFace, yFaceFoot };
  }
  throw new Error("no circle");
}

const METHODS: Method[] = ["Bishop", "Janbu", "Morgenstern-Price"];

describe("vertical faces with free water", () => {
  it("mirror symmetry with the water level below, at and above the foot of the face", () => {
    const r = rng(7070);
    let compared = 0;
    for (let i = 0; i < 12; i++) {
      const s = stepped(r);
      // Water level: on the inclined slope, up the face, or over the crest.
      const level = [s.yFaceFoot * 0.5, (s.yFaceFoot + s.H) / 2, s.H + 1][i % 3];
      const def = onCircle({ ...s.def, waterTable: { mode: "height", value: level, followBoundary: false } }, s.circle);
      const mirrored = mirrorDefinition(def, uniform(r, -10, 50));
      for (const method of [...METHODS, "Ordinary" as Method]) {
        const a = fosOf(def, method);
        const b = fosOf(mirrored, method);
        expect(b === null, `seed 7070 case ${i} ${method}`).toBe(a === null);
        if (a !== null && b !== null) {
          expect(relDiff(a, b), `seed 7070 case ${i} ${method}: ${a} vs ${b}`).toBeLessThan(1e-6);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(36);
  }, 30_000);

  it("fully submerged: equals the dry slope with buoyant unit weight (Bishop, Janbu)", () => {
    const r = rng(7071);
    for (let i = 0; i < 8; i++) {
      const s = stepped(r);
      const def = onCircle(s.def, s.circle);
      const m = def.materials[0];
      const sub: SlopeDefinition = { ...def, waterTable: { mode: "height", value: s.H + uniform(r, 0.5, 5), followBoundary: false } };
      const g = m.unitWeight - WATER_UNIT_WEIGHT;
      const buoyant: SlopeDefinition = { ...def, materials: [{ ...m, unitWeight: g, model: mohrCoulomb(g, m.cohesion, m.frictionAngle) }] };
      for (const method of ["Bishop", "Janbu"] as Method[]) {
        const a = fosOf(sub, method, { slices: 80 })!;
        const b = fosOf(buoyant, method, { slices: 80 })!;
        expect(relDiff(a, b), `seed 7071 case ${i} ${method}: ${a} vs ${b}`).toBeLessThan(1e-3);
      }
    }
  }, 30_000);

  it("a water level rising up the face from its foot never lowers the FOS of a dry-backed wall (Bishop)", () => {
    // Water standing in front of the face pushes against the sliding mass.
    // The phreatic surface stays below the slip surface inside the slope
    // (followBoundary: false with a line that drops behind the face).
    const r = rng(7072);
    for (let i = 0; i < 8; i++) {
      const s = stepped(r);
      const def = onCircle(s.def, s.circle);
      const xEnd = Math.max(...s.def.coordinates.map((c) => c[0]));
      const yLow = Math.min(...s.def.coordinates.map((c) => c[1])) + 0.1;
      const pond = (level: number): SlopeDefinition => ({
        ...def,
        waterTable: {
          mode: "custom",
          value: [[0, yLow], [s.xFace - 1e-3, yLow], [s.xFace, level], [xEnd, level]],
          followBoundary: false,
        },
      });
      let prev = 0;
      for (const t of [0, 0.3, 0.6, 0.9]) {
        const level = s.yFaceFoot + t * (s.H - s.yFaceFoot);
        const f = fosOf(pond(level), "Bishop");
        if (f === null) continue;
        expect(f, `seed 7072 case ${i} level ${level}`).toBeGreaterThanOrEqual(prev * (1 - 1e-6));
        prev = f;
      }
    }
  }, 30_000);
});

describe("water against a face the slip surface leaves through (regression)", () => {
  // Crest 11.5, vertical face at x = 12.1 down to 5.07; the circle leaves
  // the soil through the face at y ≈ 5.34, above its foot, and re-enters
  // the slope below. Water stands over the crest (15.53).
  const def: SlopeDefinition = {
    coordinates: [[0, -8.6], [0, 11.5], [12.1, 11.5], [12.1, 5.07], [19.36, 0], [28.3, 0], [28.3, -8.6]],
    materials: [{ name: "S", unitWeight: 19, cohesion: 10, frictionAngle: 25, model: mohrCoulomb(19, 10, 25) }],
  };
  const circle = { cx: 23.2, cy: 14.2, radius: 14.2 };

  it("takes the face thrust only above the slip surface", () => {
    const slope = buildSlope({ ...def, waterTable: { mode: "height", value: 15.53, followBoundary: false } });
    slope.updateAnalysisOptions({ slices: 20 });
    const ints = slope.getCircleExternalIntersection(circle.cx, circle.cy, circle.radius);
    const slices = getSlices(slope, ints[0][0], ints[ints.length - 1][0], circle.cx, circle.cy, circle.radius);
    const atFace = slices.find((q) => Math.abs(q.xRight - 12.1) < 1e-9)!;
    // Arc at the face: cy − √(R² − (12.1 − cx)²).
    const yArc = circle.cy - Math.sqrt(circle.radius ** 2 - (12.1 - circle.cx) ** 2);
    expect(yArc).toBeGreaterThan(5.07);
    const h1 = 15.53 - yArc;
    const h2 = 15.53 - 11.5;
    expect(atFace.hForce).toBeCloseTo((-WATER_UNIT_WEIGHT * (h1 * h1 - h2 * h2)) / 2, 6);
  });

  it("submerged equals buoyant (the thrust below the surface made Bishop a third too high)", () => {
    const sub = onCircle({ ...def, waterTable: { mode: "height", value: 15.53, followBoundary: false } }, circle);
    const g = 19 - WATER_UNIT_WEIGHT;
    const buoyant = onCircle({ ...def, materials: [{ ...def.materials[0], unitWeight: g, model: mohrCoulomb(g, 10, 25) }] }, circle);
    for (const method of ["Bishop", "Janbu"] as Method[]) {
      expect(relDiff(fosOf(sub, method, { slices: 80 })!, fosOf(buoyant, method, { slices: 80 })!), method).toBeLessThan(1e-3);
    }
  });
});
