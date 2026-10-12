/**
 * Property-based invariants of the limit equilibrium mechanics: strength
 * and load monotonicity, method agreement where theory demands it,
 * buoyancy, the planar block and slice-count convergence. Random models
 * from fixed seeds (property-helpers.ts); failures name seed and case.
 */
import { describe, it, expect } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import { WATER_UNIT_WEIGHT } from "../types/constants";
import { buildSlope } from "./build-slope";
import { analyseSlope } from "./solvers";
import { toCanonicalSlopeDefinition } from "./canonical";
import {
  rng,
  uniform,
  randomCase,
  onCircle,
  onPolyline,
  fosOf,
  mohrCoulomb,
  relDiff,
  groundY,
  PROPERTY_OPTIONS,
  type Method,
} from "./property-helpers";

const METHODS: Method[] = ["Ordinary", "Bishop", "Janbu", "Morgenstern-Price"];
const ALL_METHODS: Method[] = [...METHODS, "Spencer" as Method];

/** FOS, also for "Spencer" (Morgenstern-Price with a constant function). */
function fos(def: SlopeDefinition, method: Method, extra = {}): number | null {
  if ((method as string) === "Spencer") {
    return fosOf(def, "Morgenstern-Price", { intersliceFunction: "constant", ...extra });
  }
  return fosOf(def, method, extra);
}

/** Same definition with the strength of every material changed. */
function withStrength(def: SlopeDefinition, f: (c: number, phi: number) => [number, number]): SlopeDefinition {
  return {
    ...def,
    materials: def.materials.map((m) => {
      const [c, phi] = f(m.cohesion, m.frictionAngle);
      return { ...m, cohesion: c, frictionAngle: phi, model: mohrCoulomb(m.unitWeight, c, phi) };
    }),
  };
}

function withUnitWeight(def: SlopeDefinition, f: (g: number) => number): SlopeDefinition {
  return {
    ...def,
    materials: def.materials.map((m) => {
      const g = f(m.unitWeight);
      return { ...m, unitWeight: g, model: mohrCoulomb(g, m.cohesion, m.frictionAngle) };
    }),
  };
}

describe("strength monotonicity", () => {
  it("raising c or φ of every material never lowers the FOS on a fixed surface", () => {
    const r = rng(31337);
    for (let i = 0; i < 20; i++) {
      const g = randomCase(r, { water: i % 2 === 1 });
      const def = onCircle(g.def, g.circle);
      const dc = uniform(r, 0, 10);
      const dphi = uniform(r, 0, 8);
      const variants: [string, SlopeDefinition][] = [
        ["c", withStrength(def, (c, phi) => [c + dc, phi])],
        ["phi", withStrength(def, (c, phi) => [c, phi + dphi])],
        ["both", withStrength(def, (c, phi) => [c * 1.3, phi + dphi / 2])],
      ];
      for (const method of METHODS) {
        const base = fos(def, method);
        expect(base, `case ${i} ${method}`).not.toBeNull();
        for (const [name, stronger] of variants) {
          const f = fos(stronger, method)!;
          expect(f, `seed 31337 case ${i} ${method} +${name}: ${f} < ${base}`).toBeGreaterThanOrEqual(base! * (1 - 1e-6));
        }
      }
    }
  }, 30_000);

  it("the FOS is proportional to c for φ = 0 (every method)", () => {
    const r = rng(8);
    for (let i = 0; i < 10; i++) {
      const g = randomCase(r, { phi: [0, 0], c: [10, 40] });
      const def = onCircle(g.def, g.circle);
      const k = uniform(r, 1.1, 3);
      for (const method of ALL_METHODS) {
        const a = fos(def, method)!;
        const b = fos(withStrength(def, (c, phi) => [c * k, phi]), method)!;
        expect(relDiff(b, a * k), `case ${i} ${method}`).toBeLessThan(1e-5);
      }
    }
  }, 30_000);
});

describe("strength of one material, reinforcement capacity", () => {
  it("raising the strength of one layer only never lowers the FOS", () => {
    const r = rng(4747);
    for (let i = 0; i < 10; i++) {
      const g = randomCase(r, { layers: 2, water: i % 2 === 0 });
      const def = onCircle(g.def, g.circle);
      const k = i % 2;
      const stronger: SlopeDefinition = {
        ...def,
        materials: def.materials.map((m, j) => {
          if (j !== k) return m;
          const c = m.cohesion + uniform(r, 0, 10);
          const phi = m.frictionAngle + uniform(r, 0, 6);
          return { ...m, cohesion: c, frictionAngle: phi, model: mohrCoulomb(m.unitWeight, c, phi) };
        }),
      };
      for (const method of METHODS) {
        const a = fos(def, method);
        const b = fos(stronger, method);
        if (a === null || b === null) continue;
        expect(b, `seed 4747 case ${i} ${method} layer ${k}`).toBeGreaterThanOrEqual(a * (1 - 1e-6));
      }
    }
  }, 30_000);

  it("a larger capacity of a tangent nail or a pile force never lowers the FOS", () => {
    const r = rng(4748);
    let raised = 0;
    for (let i = 0; i < 10; i++) {
      const g = randomCase(r, { layers: 1 });
      const t = uniform(r, 0.3, 0.7);
      const x1 = g.shape.crest + g.shape.run * t;
      const y1 = g.shape.H * (1 - t);
      const application = i % 2 ? ("passive" as const) : ("active" as const);
      const withNail = (T: number): SlopeDefinition =>
        onCircle(
          {
            ...g.def,
            reinforcements: [{ x1, y1, x2: x1 - 12, y2: y1 - 3, tensileCapacity: T, direction: "tangent", application }],
            piles: [{ x1: x1 + 1, y1: g.shape.H * (1 - (x1 + 1 - g.shape.crest) / g.shape.run), x2: x1 + 1, y2: -g.shape.depth + 0.1, force: T / 2, direction: "tangent", application }],
          },
          g.circle,
        );
      for (const method of METHODS) {
        let prev = 0;
        for (const T of [0, 20, 60, 150]) {
          const f = fos(withNail(T), method);
          if (f === null) continue;
          expect(f, `seed 4748 case ${i} ${method} T ${T} ${application}`).toBeGreaterThanOrEqual(prev * (1 - 1e-6));
          if (T > 0 && f > prev * 1.001) raised++;
          prev = f;
        }
      }
    }
    expect(raised).toBeGreaterThan(30);
  }, 30_000);
});

describe("load monotonicity", () => {
  it("for φ = 0, a load on the driving side never raises the FOS, on the resisting side never lowers it", () => {
    const r = rng(271828);
    for (let i = 0; i < 16; i++) {
      const g = randomCase(r, { phi: [0, 0], c: [15, 40] });
      const def = onCircle(g.def, g.circle);
      const { cx } = g.circle;
      const xEntry = g.circle.cx - Math.sqrt(g.circle.radius ** 2 - (g.shape.H - g.circle.cy) ** 2);
      // Driving side: between entry and the centre (base inclined down to +x).
      const x1 = uniform(r, xEntry, cx);
      const drive: SlopeDefinition = {
        ...def,
        udls: [{ magnitude: uniform(r, 5, 50), x1, x2: x1 + uniform(r, 0, cx - x1) }],
      };
      const lineDrive: SlopeDefinition = { ...def, lineLoads: [{ magnitude: uniform(r, 10, 100), x: uniform(r, xEntry, cx) }] };
      for (const method of ALL_METHODS) {
        const base = fos(def, method)!;
        for (const [name, loaded] of [["udl", drive], ["line", lineDrive]] as const) {
          const f = fos(loaded, method)!;
          expect(f, `seed 271828 case ${i} ${method} ${name}`).toBeLessThanOrEqual(base * (1 + 1e-6));
        }
      }
      // Resisting side: beyond the centre (base rising to +x), on the toe.
      const xToe = g.shape.crest + g.shape.run;
      const xExit = g.circle.cx + Math.sqrt(g.circle.radius ** 2 - g.circle.cy ** 2);
      const lo = Math.max(cx, xToe) + 0.05;
      if (xExit - lo > 0.5) {
        const resist: SlopeDefinition = { ...def, udls: [{ magnitude: uniform(r, 5, 50), x1: lo, x2: xExit }] };
        for (const method of ["Ordinary", "Bishop", "Morgenstern-Price"] as Method[]) {
          expect(fos(resist, method)!, `seed 271828 case ${i} ${method} resisting`).toBeGreaterThanOrEqual(
            fos(def, method)! * (1 - 1e-6),
          );
        }
      }
    }
  }, 30_000);

  it("raising the phreatic surface (below the ground) never raises the FOS", () => {
    const r = rng(1618);
    for (let i = 0; i < 12; i++) {
      const g = randomCase(r, { phi: [20, 35] });
      const def = onCircle(g.def, g.circle);
      const { shape } = g;
      const xEnd = shape.crest + shape.run + shape.toe;
      const line = (lift: number): SlopeDefinition => ({
        ...def,
        waterTable: {
          mode: "custom",
          value: [
            [0, -shape.depth * 0.5 + lift],
            [xEnd, -shape.depth * 0.5 + lift * 0.2],
          ],
          followBoundary: true,
        },
      });
      const levels = [0, 0.3, 0.6, 0.9].map((t) => t * shape.H);
      for (const method of METHODS) {
        let prev = Infinity;
        for (const lift of levels) {
          const f = fos(line(lift), method)!;
          expect(f, `seed 1618 case ${i} ${method} lift ${lift}`).toBeLessThanOrEqual(prev * (1 + 1e-6));
          prev = f;
        }
      }
    }
  }, 30_000);
});

describe("method agreement", () => {
  it("φ = 0 on a circle: Ordinary = Bishop = Spencer = Morgenstern-Price", () => {
    const r = rng(161803);
    let solved = 0;
    for (let i = 0; i < 16; i++) {
      const g = randomCase(r, { phi: [0, 0], c: [10, 50] });
      const def = onCircle(i % 2 ? { ...g.def, udls: [{ magnitude: 20, x1: 0, x2: g.shape.crest }] } : g.def, g.circle);
      const ord = fos(def, "Ordinary")!;
      expect(relDiff(fos(def, "Bishop")!, ord), `seed 161803 case ${i} Bishop`).toBeLessThan(1e-9);
      // Moment equilibrium does not depend on λ, so wherever Spencer or
      // M-P finds Fm = Ff it is at Bishop's FOS. (On some surfaces Ff(λ)
      // stays above Fm for every admissible λ and there is no solution:
      // the solver then reports none instead of a spurious one.)
      for (const fn of ["constant", "half-sine", "clipped-sine", "trapezoidal"] as const) {
        const f = fosOf(def, "Morgenstern-Price", { intersliceFunction: fn });
        if (f === null) continue;
        expect(relDiff(f, ord), `seed 161803 case ${i} M-P ${fn}: ${f} vs Ordinary ${ord}`).toBeLessThan(1e-5);
        solved++;
      }
    }
    expect(solved).toBeGreaterThan(16 * 4 * 0.75);
  }, 30_000);

  it("Janbu f0 raises the simplified FOS by the factor of its soil type (c, φ, c-φ)", () => {
    const r = rng(42);
    const types: [string, [number, number], [number, number], number][] = [
      ["c only", [10, 40], [0, 0], 0.69],
      ["phi only", [0, 0], [25, 35], 0.31],
      ["c-phi", [5, 15], [20, 30], 0.5],
    ];
    for (const [name, c, phi, b1] of types) {
      for (let i = 0; i < 4; i++) {
        const g = randomCase(r, { c, phi, layers: 1 });
        const def = onCircle(g.def, g.circle);
        const plain = fosOf(def, "Janbu", { janbuCorrection: false })!;
        const corrected = fosOf(def, "Janbu", { janbuCorrection: true })!;
        const f0 = corrected / plain;
        expect(f0, `${name} case ${i}`).toBeGreaterThan(1);
        // f0 = 1 + b1 (d/L − 1.4 (d/L)²) ≤ 1 + b1 / 5.6
        expect(f0, `${name} case ${i}`).toBeLessThanOrEqual(1 + b1 / 5.6 + 1e-9);
      }
    }
  }, 30_000);
});

describe("Janbu correction factor", () => {
  function f0Expected(def: SlopeDefinition, b1: number): number {
    const slope = buildSlope(toCanonicalSlopeDefinition(def));
    const p = slope.individualPlanes[0];
    const L = Math.hypot(p.rc[0] - p.lc[0], p.rc[1] - p.lc[1]);
    // Depth of the arc below the chord: R minus the distance of the centre
    // from the chord (the deepest point lies between entry and exit here).
    const dist = Math.abs((p.rc[0] - p.lc[0]) * (p.lc[1] - p.cy) - (p.rc[1] - p.lc[1]) * (p.lc[0] - p.cx)) / L;
    const dl = (p.radius - dist) / L;
    return 1 + b1 * (dl - 1.4 * dl * dl);
  }

  it("f0 = 1 + b1 (d/L − 1.4 (d/L)²) with b1 0.69 (c only), 0.31 (φ only), 0.50 (c-φ or both kinds of layer)", () => {
    const r = rng(43);
    const cases: [string, Parameters<typeof randomCase>[1], number][] = [
      ["c only", { c: [10, 40], phi: [0, 0] }, 0.69],
      ["φ only", { c: [0, 0], phi: [25, 35] }, 0.31],
      ["c-φ", { c: [5, 15], phi: [20, 30] }, 0.5],
    ];
    for (const [name, opts, b1] of cases) {
      for (let i = 0; i < 4; i++) {
        const g = randomCase(r, opts);
        const def = onCircle(g.def, g.circle);
        const f0 = fosOf(def, "Janbu", { janbuCorrection: true, slices: 200 })! / fosOf(def, "Janbu", { slices: 200 })!;
        expect(f0, `seed 43 ${name} case ${i}`).toBeCloseTo(f0Expected(def, b1), 3);
      }
    }
    // A c-only layer over a φ-only layer: the surface sees both, b1 = 0.5.
    const g = randomCase(r, { layers: 2 });
    const mixed = onCircle(
      {
        ...g.def,
        materials: [
          { ...g.def.materials[0], cohesion: 20, frictionAngle: 0, model: mohrCoulomb(g.def.materials[0].unitWeight, 20, 0) },
          { ...g.def.materials[1], cohesion: 0, frictionAngle: 32, model: mohrCoulomb(g.def.materials[1].unitWeight, 0, 32) },
        ],
      },
      g.circle,
    );
    const f0 = fosOf(mixed, "Janbu", { janbuCorrection: true, slices: 200 })! / fosOf(mixed, "Janbu", { slices: 200 })!;
    expect(f0).toBeCloseTo(f0Expected(mixed, 0.5), 3);
  }, 30_000);

  it("a planar surface has f0 = 1", () => {
    const r = rng(44);
    for (let i = 0; i < 4; i++) {
      const g = randomCase(r, { layers: 1 });
      const xb = g.shape.crest + g.shape.run * 0.8;
      const def = onPolyline(g.def, [[g.shape.crest * 0.5, g.shape.H], [xb, groundY(g.shape, xb)]]);
      expect(fosOf(def, "Janbu", { janbuCorrection: true })! / fosOf(def, "Janbu")!).toBeCloseTo(1, 9);
    }
  });
});

describe("buoyancy", () => {
  it("a fully submerged slope equals the dry slope with buoyant unit weight", () => {
    const r = rng(2718);
    for (let i = 0; i < 12; i++) {
      const g = randomCase(r, { layers: i % 2 ? 2 : 1 });
      const def = onCircle(g.def, g.circle);
      const wl = g.shape.H + uniform(r, 0.5, 10);
      const submerged: SlopeDefinition = { ...def, waterTable: { mode: "height", value: wl, followBoundary: false } };
      const buoyant = withUnitWeight(def, (gamma) => gamma - WATER_UNIT_WEIGHT);
      // Not the Ordinary method: N = W cos α − u·l is known to be wrong
      // under high pore pressure (Whitman & Bailey 1967).
      for (const method of ["Bishop", "Janbu"] as Method[]) {
        const a = fos(submerged, method, { slices: 80 })!;
        const b = fos(buoyant, method, { slices: 80 })!;
        // Exact up to the discretisation: the pore pressure is taken at the
        // base centre, the weight from the two-chord base (O(1/n²)).
        expect(relDiff(a, b), `seed 2718 case ${i} ${method}: submerged ${a} vs buoyant ${b}`).toBeLessThan(1e-3);
        if (i < 3) {
          const fine = relDiff(fos(submerged, method, { slices: 320 })!, fos(buoyant, method, { slices: 320 })!);
          expect(fine, `case ${i} ${method} at 320 slices`).toBeLessThan(Math.max(relDiff(a, b) / 4, 1e-6));
        }
      }
      // With interslice shear X = λ·f·E the two are not identical: E is the
      // total interslice force (with the water pressure) in the submerged
      // slope and the effective one in the buoyant slope; the difference
      // stays at ~0.1–0.2 % for any slice count.
      for (const method of ["Spencer", "Morgenstern-Price"] as Method[]) {
        const a = fos(submerged, method);
        const b = fos(buoyant, method);
        if (a === null || b === null) continue;
        expect(relDiff(a, b), `seed 2718 case ${i} ${method}: submerged ${a} vs buoyant ${b}`).toBeLessThan(5e-3);
      }
    }
  }, 30_000);
});

describe("planar block", () => {
  it("a straight slip surface matches the closed-form wedge solution", () => {
    const r = rng(1729);
    for (let i = 0; i < 16; i++) {
      const g = randomCase(r, { layers: 1 });
      const { shape } = g;
      const m = g.def.materials[0];
      // Straight line from a crest point to a point on the face (or at the toe).
      const xa = uniform(r, 0.2, 0.9) * shape.crest;
      const xb = shape.crest + shape.run * uniform(r, 0.5, 1);
      const a: [number, number] = [xa, shape.H];
      const b: [number, number] = [xb, groundY(shape, xb)];
      const beta = Math.atan2(a[1] - b[1], b[0] - a[0]);
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      // Wedge area between the line and the ground.
      const xc = shape.crest;
      const area = 0.5 * Math.abs((xc - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (shape.H - a[1]));
      const q = i % 2 ? uniform(r, 5, 30) : 0;
      const def = onPolyline(
        q ? { ...g.def, udls: [{ magnitude: q, x1: xa, x2: xc }] } : g.def,
        [a, b],
      );
      const W = area * m.unitWeight + q * (xc - xa);
      const tanPhi = Math.tan((m.frictionAngle * Math.PI) / 180);
      const exact = (m.cohesion * L + W * Math.cos(beta) * tanPhi) / (W * Math.sin(beta));
      for (const method of ["Ordinary", "Janbu", "Spencer", "Morgenstern-Price"] as Method[]) {
        const f = fos(def, method)!;
        expect(relDiff(f, exact), `seed 1729 case ${i} ${method}: ${f} vs ${exact}`).toBeLessThan(1e-4);
      }
    }
  }, 30_000);

  it("a frictional block (c = 0) on a plane: every method gives tan φ / tan β", () => {
    const r = rng(1730);
    for (let i = 0; i < 8; i++) {
      const g = randomCase(r, { layers: 1, c: [0, 0], phi: [25, 40] });
      const { shape } = g;
      const xa = uniform(r, 0.2, 0.9) * shape.crest;
      const xb = shape.crest + shape.run * uniform(r, 0.5, 1);
      const a: [number, number] = [xa, shape.H];
      const b: [number, number] = [xb, groundY(shape, xb)];
      const beta = Math.atan2(a[1] - b[1], b[0] - a[0]);
      const exact = Math.tan((g.def.materials[0].frictionAngle * Math.PI) / 180) / Math.tan(beta);
      const def = onPolyline(g.def, [a, b]);
      for (const method of ALL_METHODS) {
        expect(relDiff(fos(def, method)!, exact), `case ${i} ${method}`).toBeLessThan(1e-4);
      }
    }
  }, 30_000);
});

describe("slice-count convergence", () => {
  it("the FOS changes by less than 1 % from 50 to 200 slices on smooth geometry", () => {
    const r = rng(500);
    for (let i = 0; i < 10; i++) {
      const g = randomCase(r, { water: i % 2 === 0 });
      const def = onCircle(g.def, g.circle);
      for (const method of ALL_METHODS) {
        const f50 = fos(def, method, { slices: 50 })!;
        const f200 = fos(def, method, { slices: 200 })!;
        expect(relDiff(f50, f200), `seed 500 case ${i} ${method}: ${f50} vs ${f200}`).toBeLessThan(0.01);
      }
    }
  }, 60_000);
});

describe("Morgenstern-Price solution", () => {
  it("the reported FOS satisfies moment and force equilibrium at its λ (every interslice function)", () => {
    const r = rng(9191);
    let checked = 0;
    for (let i = 0; i < 10; i++) {
      const g = randomCase(r, { water: i % 2 === 0 });
      const def = onCircle(i % 3 === 0 ? { ...g.def, udls: [{ magnitude: 15, x1: 0.5, x2: g.shape.crest * 0.6 }] } : g.def, g.circle);
      for (const fn of ["constant", "half-sine", "clipped-sine", "trapezoidal"] as const) {
        const slope = buildSlope(toCanonicalSlopeDefinition(def));
        slope.updateAnalysisOptions({ ...PROPERTY_OPTIONS, method: "Morgenstern-Price", intersliceFunction: fn, tolerance: 1e-6 });
        const f = analyseSlope(slope);
        if (f === null) continue;
        const lff = slope.search[0].lffArray!;
        const at = lff.find((e) => Math.abs(e[1] - f) < 1e-9);
        expect(at, `seed 9191 case ${i} ${fn}`).toBeDefined();
        // Converged: Fm and Ff agree to the solver tolerance there.
        expect(at![3], `seed 9191 case ${i} ${fn} λ ${at![0]}`).toBeLessThan(1e-5);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
  }, 30_000);
});
