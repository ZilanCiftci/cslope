/**
 * Seeded random models and helpers for the property-based (invariant)
 * tests. Test support only: not exported from the engine.
 *
 * Every generated model is a simple slope sliding to the right
 * (left-to-right): crest on the left, toe on the right, with up to two
 * Mohr-Coulomb layers, and a trial circle through the crest and the toe
 * area that stays inside the model.
 */

import type { AnalysisMethod, AnalysisOptions } from "../types/analysis";
import { materialModelOf, withMaterialModel, type SlopeDefinition, type SlopeMaterialDefinition } from "../types/slope-definition";
import type { MohrCoulombModel } from "../types/material-models";
import type { ReinforcementPullout } from "../types/reinforcement";
import { buildSlope } from "./build-slope";
import { analyseSlope, analyseOrdinary } from "./solvers";
import { toCanonicalSlopeDefinition } from "./canonical";
import { getSlices } from "./slices";

export type Pt = [number, number];

/** Small, fast, seedable PRNG (mulberry32), uniform on [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const uniform = (r: () => number, lo: number, hi: number): number => lo + (hi - lo) * r();

export interface Circle {
  cx: number;
  cy: number;
  radius: number;
}

export interface SlopeShape {
  /** Height of the slope face. */
  H: number;
  /** Horizontal run of the face. */
  run: number;
  /** Crest length (x of the crest edge). */
  crest: number;
  /** Toe length. */
  toe: number;
  /** Depth of the model below the toe. */
  depth: number;
}

export interface GeneratedCase {
  def: SlopeDefinition;
  circle: Circle;
  shape: SlopeShape;
}

export interface GenerateOptions {
  /** Second (lower) layer. Default: random. */
  layers?: 1 | 2;
  /** Cohesion range (kPa). */
  c?: [number, number];
  /** Friction angle range (°). */
  phi?: [number, number];
  /** Water table through the slope. Default false. */
  water?: boolean;
}

export function randomShape(r: () => number): SlopeShape {
  const H = uniform(r, 5, 15);
  return {
    H,
    run: H * uniform(r, 1, 3),
    crest: uniform(r, 8, 15),
    toe: uniform(r, 8, 15),
    depth: uniform(r, 0.6, 1.2) * H,
  };
}

export function shapeCoordinates(s: SlopeShape): Pt[] {
  const xToe = s.crest + s.run;
  const xEnd = xToe + s.toe;
  return [
    [0, -s.depth],
    [0, s.H],
    [s.crest, s.H],
    [xToe, 0],
    [xEnd, 0],
    [xEnd, -s.depth],
  ];
}

/** Ground elevation of the shape at x. */
export function groundY(s: SlopeShape, x: number): number {
  if (x <= s.crest) return s.H;
  if (x >= s.crest + s.run) return 0;
  return s.H * (1 - (x - s.crest) / s.run);
}

/**
 * Circle through an entry point on the crest and an exit point near the
 * toe, centre above the chord, inside the model (above its base).
 */
export function randomCircle(r: () => number, s: SlopeShape): Circle {
  for (let attempt = 0; attempt < 200; attempt++) {
    const xIn = uniform(r, 0.2, 0.9) * s.crest;
    const xOut = s.crest + s.run * uniform(r, 0.85, 1) + s.toe * uniform(r, 0, 0.4);
    const a: Pt = [xIn, s.H];
    const b: Pt = [xOut, groundY(s, xOut)];
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // Unit normal of the chord, pointing up.
    let nx = -(b[1] - a[1]) / len;
    let ny = (b[0] - a[0]) / len;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const off = uniform(r, 0.15, 1.2) * len;
    const cx = mx + nx * off;
    const cy = my + ny * off;
    const radius = Math.hypot(a[0] - cx, a[1] - cy);
    // Base of the circle above the model base, centre above the crest.
    if (cy - radius < -s.depth + 0.25) continue;
    if (cy <= s.H + 0.5) continue;
    // Circle cuts the ground only at the entry and the exit: the arc
    // below the ground between them, nowhere else inside the model.
    return { cx, cy, radius };
  }
  throw new Error("No admissible circle");
}

/** The Mohr-Coulomb model of a generated material. */
export function mc(m: SlopeMaterialDefinition): MohrCoulombModel {
  const model = materialModelOf(m);
  if (model.kind !== "mohr-coulomb") throw new Error(`Material "${m.name}" is not Mohr-Coulomb`);
  return model;
}

export function mohrCoulomb(gamma: number, c: number, phi: number, gammaSat?: number): MohrCoulombModel {
  return {
    kind: "mohr-coulomb",
    unitWeight: gamma,
    cohesion: c,
    frictionAngle: phi,
    ...(gammaSat !== undefined ? { unitWeightSat: gammaSat } : {}),
  };
}

/** A random left-to-right slope with a trial circle. */
export function randomCase(r: () => number, opts: GenerateOptions = {}): GeneratedCase {
  const shape = randomShape(r);
  const coordinates = shapeCoordinates(shape);
  const layers = opts.layers ?? (r() < 0.5 ? 1 : 2);
  const [cLo, cHi] = opts.c ?? [2, 20];
  const [pLo, pHi] = opts.phi ?? [15, 35];
  const mat = (name: string) => {
    const gamma = uniform(r, 16, 21);
    const c = uniform(r, cLo, cHi);
    const phi = uniform(r, pLo, pHi);
    return { name, model: mohrCoulomb(gamma, c, phi) };
  };
  const materials = [mat("Upper")];
  const def: SlopeDefinition = { orientation: "ltr", coordinates, materials };
  const xEnd = coordinates[4][0];
  if (layers === 2) {
    materials.push(mat("Lower"));
    const y0 = uniform(r, -0.4, 0.6) * shape.H;
    const y1 = y0 + uniform(r, -0.3, 0.1) * shape.H;
    // Keep the boundary below the ground at the right edge.
    const yRight = Math.min(y1, -0.1 * shape.depth);
    def.materialBoundaries = [{ coordinates: [[0, y0], [xEnd, yRight]], materialName: "Lower" }];
    def.regionAssignments = [
      { point: [0.5, (y0 + shape.H) / 2], materialName: "Upper" },
      { point: [0.5, (y0 - shape.depth) / 2], materialName: "Lower" },
    ];
  }
  if (opts.water) {
    const wCrest = shape.H * uniform(r, -0.2, 0.7);
    const wToe = uniform(r, -0.5, 0) * shape.H * 0.3;
    def.waterTable = {
      mode: "custom",
      value: [
        [0, wCrest],
        [shape.crest, wCrest],
        [shape.crest + shape.run, wToe],
        [xEnd, wToe],
      ],
      followBoundary: true,
    };
  }
  return { def, circle: randomCircle(r, shape), shape };
}

/** Options for accurate, comparable FOS values on a fixed surface. */
export const PROPERTY_OPTIONS: Partial<AnalysisOptions> = {
  slices: 40,
  tolerance: 1e-7,
  maxIterations: 200,
  refinedIterations: 0,
  minSlipArea: 0,
  minSlipDepth: 0,
};

export type Method = AnalysisMethod | "Ordinary";

/** Definition analysed on the given circle only. */
export function onCircle(def: SlopeDefinition, c: Circle): SlopeDefinition {
  return { ...def, customSearchPlanes: [{ cx: c.cx, cy: c.cy, radius: c.radius }], customPlanesOnly: true };
}

/** Definition analysed on the given polyline only. */
export function onPolyline(def: SlopeDefinition, points: Pt[], axis?: Pt): SlopeDefinition {
  return { ...def, customSurfaces: [{ points, ...(axis ? { axis } : {}) }], customPlanesOnly: true };
}

/**
 * FOS of a definition (given in model space, either orientation) on its
 * custom surfaces, through the same canonical path as the application.
 */
export function fosOf(
  def: SlopeDefinition,
  method: Method,
  options: Partial<AnalysisOptions> = {},
): number | null {
  const canonical = toCanonicalSlopeDefinition(def);
  const slope = buildSlope(canonical);
  slope.updateAnalysisOptions({
    ...PROPERTY_OPTIONS,
    ...options,
    method: method === "Ordinary" ? "Bishop" : method,
  });
  if (method !== "Ordinary") return analyseSlope(slope);
  const plane = slope.individualPlanes[0];
  if (!plane) return null;
  const slices = getSlices(slope, plane.lc[0], plane.rc[0], plane.cx, plane.cy, plane.radius, plane.points);
  return slices.length > 0 ? analyseOrdinary(slope, slices) : null;
}

/** Mirror x about x = axis, reversing every x range. Independent of canonical.ts. */
export function mirrorDefinition(def: SlopeDefinition, axis: number): SlopeDefinition {
  const mx = (x: number) => 2 * axis - x;
  const mp = (p: Pt): Pt => [mx(p[0]), p[1]];
  const out: SlopeDefinition = {
    ...def,
    orientation: def.orientation === "rtl" ? "ltr" : "rtl",
    coordinates: def.coordinates.map(mp),
  };
  if (def.materialBoundaries) {
    out.materialBoundaries = def.materialBoundaries.map((b) => ({ ...b, coordinates: b.coordinates.map(mp) }));
  }
  if (def.regionAssignments) {
    out.regionAssignments = def.regionAssignments.map((a) => ({ ...a, point: mp(a.point) }));
  }
  if (def.waterTable?.mode === "custom") {
    out.waterTable = { ...def.waterTable, value: (def.waterTable.value as Pt[]).map(mp) };
  }
  if (def.waterTables) {
    out.waterTables = def.waterTables.map((w) => ({ ...w, coordinates: w.coordinates.map(mp) }));
  }
  if (def.udls) out.udls = def.udls.map((u) => ({ ...u, x1: mx(u.x2), x2: mx(u.x1) }));
  if (def.lineLoads) out.lineLoads = def.lineLoads.map((l) => ({ ...l, x: mx(l.x) }));
  if (def.reinforcements) out.reinforcements = def.reinforcements.map((q) => ({ ...q, x1: mx(q.x1), x2: mx(q.x2) }));
  if (def.piles) out.piles = def.piles.map((p) => ({ ...p, x1: mx(p.x1), x2: mx(p.x2) }));
  if (def.analysisLimits) {
    const l = def.analysisLimits;
    out.analysisLimits = {
      entryLeftX: mx(l.entryRightX),
      entryRightX: mx(l.entryLeftX),
      exitLeftX: mx(l.exitRightX),
      exitRightX: mx(l.exitLeftX),
    };
  }
  if (def.customSearchPlanes) out.customSearchPlanes = def.customSearchPlanes.map((c) => ({ ...c, cx: mx(c.cx) }));
  if (def.customSurfaces) {
    out.customSurfaces = def.customSurfaces.map((s) => ({
      points: s.points.map(mp).reverse(),
      ...(s.axis ? { axis: mp(s.axis) } : {}),
    }));
  }
  out.materials = def.materials.map((m) => {
    if (m.model?.kind !== "spatial-mohr-coulomb") return m;
    return {
      ...m,
      model: {
        ...m.model,
        dataPoints: m.model.dataPoints.map(
          ([x, y, c, phi, gamma]) => [mx(x), y, c, phi, gamma] as [number, number, number, number, number],
        ),
      },
    };
  });
  return out;
}

/**
 * Affine map of a Mohr-Coulomb definition: lengths ×k, then shifted by
 * (dx, dy); stresses ×s (cohesion, UDL, unit weight ×s/k, line loads per
 * metre ×s·k, element and pile forces ×s·k² with their spacing ×k).
 * Water keeps γw, so with water only s = k is consistent.
 */
export function transformDefinition(
  def: SlopeDefinition,
  t: { k?: number; s?: number; dx?: number; dy?: number },
): SlopeDefinition {
  const k = t.k ?? 1;
  const s = t.s ?? 1;
  const dx = t.dx ?? 0;
  const dy = t.dy ?? 0;
  const X = (x: number) => x * k + dx;
  const Y = (y: number) => y * k + dy;
  const P = (p: Pt): Pt => [X(p[0]), Y(p[1])];
  const scalePullout = (p: ReinforcementPullout): ReinforcementPullout =>
    p.kind === "bond"
      ? { kind: "bond", strength: p.strength * s * k, ...(p.bondedLength !== undefined ? { bondedLength: p.bondedLength * k } : {}) }
      : p.kind === "development"
        ? { kind: "development", length1: p.length1 * k, length2: p.length2 * k }
        : { ...p, adhesion: p.adhesion * s };
  const out: SlopeDefinition = { ...def, coordinates: def.coordinates.map(P) };
  out.materials = def.materials.map((m) => {
    const model = materialModelOf(m);
    if (model.kind !== "mohr-coulomb") throw new Error("transformDefinition: Mohr-Coulomb only");
    return {
      ...withMaterialModel(m),
      model: {
        ...model,
        unitWeight: (model.unitWeight * s) / k,
        cohesion: model.cohesion * s,
        ...(model.unitWeightSat !== undefined ? { unitWeightSat: (model.unitWeightSat * s) / k } : {}),
      },
    };
  });
  if (def.materialBoundaries) {
    out.materialBoundaries = def.materialBoundaries.map((b) => ({ ...b, coordinates: b.coordinates.map(P) }));
  }
  if (def.regionAssignments) out.regionAssignments = def.regionAssignments.map((a) => ({ ...a, point: P(a.point) }));
  if (def.waterTable) {
    const w = def.waterTable;
    out.waterTable =
      w.mode === "custom"
        ? { ...w, value: (w.value as Pt[]).map(P) }
        : w.mode === "height"
          ? { ...w, value: Y(w.value as number) }
          : { ...w, value: (w.value as number) * k };
  }
  if (def.waterTables) out.waterTables = def.waterTables.map((w) => ({ ...w, coordinates: w.coordinates.map(P) }));
  if (def.udls) out.udls = def.udls.map((u) => ({ magnitude: u.magnitude * s, x1: X(u.x1), x2: X(u.x2) }));
  if (def.lineLoads) out.lineLoads = def.lineLoads.map((l) => ({ magnitude: l.magnitude * s * k, x: X(l.x) }));
  if (def.reinforcements) {
    out.reinforcements = def.reinforcements.map((q) => ({
      ...q,
      x1: X(q.x1),
      y1: Y(q.y1),
      x2: X(q.x2),
      y2: Y(q.y2),
      // Capacities per element (spacing ×k): ×s·k².
      tensileCapacity: q.tensileCapacity * s * k * k,
      spacing: (q.spacing ?? 1) * k,
      ...(q.end1Capacity !== undefined ? { end1Capacity: q.end1Capacity * s * k * k } : {}),
      ...(q.end2Capacity !== undefined ? { end2Capacity: q.end2Capacity * s * k * k } : {}),
      ...(q.pullout ? { pullout: scalePullout(q.pullout) } : {}),
    }));
  }
  if (def.piles) {
    out.piles = def.piles.map((p) => ({
      ...p,
      x1: X(p.x1),
      y1: Y(p.y1),
      x2: X(p.x2),
      y2: Y(p.y2),
      spacing: (p.spacing ?? 1) * k,
      ...(p.diameter !== undefined ? { diameter: p.diameter * k } : {}),
      ...(p.force !== undefined ? { force: p.force * s * k * k } : {}),
      ...(p.shearCapacity !== undefined ? { shearCapacity: p.shearCapacity * s * k * k } : {}),
      ...(p.momentCapacity !== undefined ? { momentCapacity: p.momentCapacity * s * k * k * k } : {}),
    }));
  }
  if (def.analysisLimits) {
    const l = def.analysisLimits;
    out.analysisLimits = {
      entryLeftX: X(l.entryLeftX),
      entryRightX: X(l.entryRightX),
      exitLeftX: X(l.exitLeftX),
      exitRightX: X(l.exitRightX),
    };
  }
  if (def.customSearchPlanes) {
    out.customSearchPlanes = def.customSearchPlanes.map((c) => ({ cx: X(c.cx), cy: Y(c.cy), radius: c.radius * k }));
  }
  if (def.customSurfaces) {
    out.customSurfaces = def.customSurfaces.map((c) => ({
      points: c.points.map(P),
      ...(c.axis ? { axis: P(c.axis) } : {}),
    }));
  }
  return out;
}

/** Relative difference |a − b| / max(|a|, |b|, tiny). */
export function relDiff(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12);
}

/** Add random water, loads, reinforcement, piles to a generated case. */
export function decorate(r: () => number, g: GeneratedCase, features: Set<string>): SlopeDefinition {
  const { shape } = g;
  const def: SlopeDefinition = { ...g.def };
  const xToe = shape.crest + shape.run;
  const xEnd = xToe + shape.toe;
  if (features.has("water")) {
    const wCrest = shape.H * uniform(r, -0.2, 0.6);
    def.waterTable = {
      mode: "custom",
      value: [
        [0, wCrest],
        [shape.crest * 0.8, wCrest],
        [xToe, -0.2],
        [xEnd, -0.2],
      ],
      followBoundary: true,
    };
  }
  if (features.has("udl")) {
    const x1 = uniform(r, 0, shape.crest * 0.6);
    def.udls = [{ magnitude: uniform(r, 5, 40), x1, x2: x1 + uniform(r, 1, shape.crest * 0.4) }];
  }
  if (features.has("lineLoad")) {
    def.lineLoads = [{ magnitude: uniform(r, 10, 80), x: uniform(r, 0.3, 0.95) * shape.crest }];
  }
  if (features.has("nail")) {
    // A nail from the face into the slope (downward to the left).
    const t = uniform(r, 0.3, 0.7);
    const x1 = shape.crest + shape.run * t;
    const y1 = shape.H * (1 - t);
    def.reinforcements = [
      {
        x1,
        y1,
        x2: x1 - uniform(r, 6, 12),
        y2: y1 - uniform(r, 1, 4),
        tensileCapacity: uniform(r, 50, 200),
        spacing: uniform(r, 1, 2),
        pullout: { kind: "bond", strength: uniform(r, 20, 80) },
        direction: r() < 0.5 ? "axial" : "tangent",
        application: r() < 0.5 ? "active" : "passive",
      },
    ];
  }
  if (features.has("pile")) {
    const x = shape.crest + shape.run * uniform(r, 0.2, 0.6);
    const yTop = shape.H * (1 - (x - shape.crest) / shape.run);
    def.piles = [
      {
        x1: x,
        y1: yTop,
        x2: x,
        y2: -shape.depth + 0.1,
        force: uniform(r, 20, 100),
        angle: uniform(r, -20, 20),
        direction: (["angle", "tangent", "perpendicular"] as const)[Math.floor(r() * 3)],
        application: r() < 0.5 ? "active" : "passive",
      },
    ];
  }
  return def;
}

