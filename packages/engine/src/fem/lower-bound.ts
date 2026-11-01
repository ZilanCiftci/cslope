/**
 * Lower bound limit analysis by finite elements and conic programming
 * (Sloan 1988, IJNAMG 12, 61–77; Lyamin & Sloan 2002, IJNME 55, 573–611;
 * Makrodimopoulos & Martin 2006, IJNME 66(4), 604–634).
 *
 * The stresses vary linearly over three-node triangles whose nodes are not
 * shared, so that every interior edge can carry a statically admissible
 * stress discontinuity (continuous normal and shear traction). Each
 * element is in equilibrium with its weight and the pore pressure
 * gradient, the ground surface carries its loads, and every node meets the
 * Mohr–Coulomb criterion, in plane strain the second-order cone
 * 2c cos φ − sin φ (σ′x + σ′y) ≥ ‖(σ′x − σ′y, 2τxy)‖, so that the stress
 * field is admissible and the load factor a strict lower bound for the
 * mesh. Stresses are effective, tension positive; σ = σ′ − u m. The cones
 * are solved exactly by Clarabel, or as the p-sided polygon inscribed in
 * the criterion (Sloan 1988) by HiGHS (Huangfu & Hall 2018, Math. Program.
 * Comput. 10(1), 119–142), see conic.ts. On V044–V046a (2100–2800
 * elements, the verification meshes) HiGHS reached its time limit of 300 s
 * per program, where Clarabel solves each in a few seconds.
 *
 * The program maximises a load factor λ on every load (weight, pore
 * pressure and surface loads). The factor of safety on strength is the
 * reduction F at which λ(F) = 1: for φ = 0 everywhere λ(F) = λ(F0)·F0/F, so
 * F = λ(F0)·F0 from one program at the first reduction tried F0 (1 by
 * default); otherwise F is found by the secant method on
 * log λ (Kim, Salgado & Lee 2002, J. Geotech. Geoenviron. Eng. 128(7),
 * 546–557, fig. 3: iterate until the reference load is carried).
 *
 * Implementation choices (not from the literature): p = 24 sides; the
 * secant method on log λ with trials tol/2 below its root, safeguarded by
 * bisection of the bracket between the largest F that carries the loads
 * and the smallest that does not, returning the largest evaluated F with
 * λ(F) ≥ 1 once it lies within 0.002 of the root or of the bracket's other
 * end (only such an F is a lower bound); fans of elements spanning at
 * most 30° within an element size of each corner and load's end of the
 * ground surface (lowerBoundProblem); the load factor on every load, weight
 * included, as the strength reduction applies; a line load spread over the
 * two surface edges at its point; the stresses scaled by γ H (the largest
 * unit weight times the model's height) for Clarabel.
 */

import { WATER_UNIT_WEIGHT } from "../types/constants";
import type { Slope } from "../model/slope";
import { buildFeModel, polylineY, type FeModelOptions } from "./model";
import { meanUnitWeight, porePressureAt, reducedStrength, strengthAt, surfaceLineLoads } from "./limit-common";
import {
  affine, loadClarabel, ProgramBuilder, solveClarabel, solveHighs,
  type ConicProgram, type ConicSolution, type HighsSolver,
} from "./conic";

/** Sectors per element at a singular point of the ground surface (see lowerBoundProblem). */
const FAN_SECTORS = 4;
/** Largest angle an element near a singular point of the ground surface spans as seen from it (see lowerBoundProblem). */
const FAN_ANGLE = (30 * Math.PI) / 180;
/** Reach of the fans of elements around the singular points, in element sizes (the model's size field there; see lowerBoundProblem). */
const FAN_RADIUS = 1;
/** Rounds of bisection at most for the fans of elements (see lowerBoundProblem). */
const FAN_PASSES = 10;

export interface LowerBoundOptions extends FeModelOptions {
  /**
   * The solver: "clarabel" (default) the yield criterion exactly as a
   * second-order cone, "highs" the inscribed polygon as a linear program
   * (conic.ts; with the tension cut-off the polygon admits no stress at a
   * free surface, where the stress is uniaxial on the criterion, and λ is 0).
   */
  boundSolver?: "clarabel" | "highs";
  /** The Clarabel WebAssembly binary, where it cannot be read from beside the module (the app). */
  clarabelWasm?: ArrayBuffer;
  /**
   * The reduced strength: c/F and tan φ/F ("associated", default), or
   * Davis B's for the elements' dilation angles ("davis-b",
   * limit-common.ts), the associated material that stands for
   * non-associated flow.
   */
  strengthRule?: "associated" | "davis-b";
  /** Sides of the inscribed yield polygon (HiGHS); default 24. */
  sides?: number;
  /** Rankine tension cut-off σ₁′ ≤ 0; default false. */
  tensionCutoff?: boolean;
  /** Tolerance on F; default 0.002. */
  fTolerance?: number;
  /** Time limit per linear program (s); default 300. */
  timeLimit?: number;
  /** Time limit of the whole search (s): no linear program starts after it, and the bound stays the best certified so far; default none. */
  totalTimeLimit?: number;
  /** First reduction tried, e.g. a coarser mesh's bound; default 1. */
  startF?: number;
}

export interface LowerBoundResult {
  /** Lower bound on the factor of safety. */
  factorOfSafety: number;
  /** The load factors λ(F) of the linear programs solved. */
  trials: { F: number; lambda: number; seconds: number }[];
  elements: number;
  /** Size of the linear program: variables and constraints. */
  variables: number;
  constraints: number;
  warnings: string[];
}

/** HiGHS as loaded by highs-js (the subset used here). */
interface Highs {
  solve(lp: string, options?: Record<string, unknown>): {
    Status: string;
    ObjectiveValue: number;
  };
}

/** Options of the HiGHS module: where its WebAssembly file is, or the binary itself. */
export interface HighsModuleOptions {
  locateFile?: (file: string) => string;
  wasmBinary?: ArrayBuffer;
}

let highsPromise: Promise<Highs> | null = null;
/** Load HiGHS (WebAssembly) on first use; the options of the first call apply. */
export function loadHighs(options?: HighsModuleOptions | ((file: string) => string)): Promise<Highs> {
  const o = typeof options === "function" ? { locateFile: options } : options ?? {};
  const bin = o.wasmBinary;
  // The module reads no `wasmBinary` option; a given binary is instantiated
  // through its `instantiateWasm` hook instead, so that nothing is fetched.
  // The binary is compiled first, so that an invalid one rejects here
  // instead of leaving the hook's callback uncalled.
  highsPromise ??= Promise.all([import("highs"), bin ? WebAssembly.compile(bin) : null])
    .then(([m, compiled]) => {
      const loader = (m as unknown as { default: (o?: object) => Promise<Highs> }).default;
      const moduleArg = compiled
        ? {
            instantiateWasm: (imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance) => void) => {
              void WebAssembly.instantiate(compiled, imports).then(done);
              return {};
            },
          }
        : o.locateFile ? { locateFile: o.locateFile } : {};
      return loader(moduleArg);
    })
    .catch((err: unknown) => {
      highsPromise = null; // a later call may try again
      throw err;
    });
  return highsPromise;
}

/** A solve function for the bounds' programs: Clarabel or HiGHS as `options.boundSolver` says. */
export async function boundSolver(
  options: { boundSolver?: "clarabel" | "highs"; clarabelWasm?: ArrayBuffer },
  highs?: Highs,
  module?: HighsModuleOptions,
): Promise<(prog: ConicProgram, sides: number, timeLimit: number) => ConicSolution> {
  if ((options.boundSolver ?? "clarabel") === "highs") {
    const h = (highs ?? (await loadHighs(module))) as HighsSolver;
    return (prog, sides, timeLimit) => solveHighs(prog, h, sides, timeLimit);
  }
  const c = await loadClarabel(options.clarabelWasm);
  return (prog, _sides, timeLimit) => solveClarabel(prog, c, timeLimit);
}

export interface LbProblem {
  /** The program at a reduction F (conic.ts): maximise λ. */
  program(F: number): ConicProgram;
  /** Sides of the yield polygon when the program is solved as an LP by HiGHS. */
  sides: number;
  allUndrained: boolean;
  elements: number;
  variables: number;
  constraints: number;
  warnings: string[];
  /**
   * The lower bound mesh: corner coordinates and three nodes per element,
   * and the strength reduction model's element each lies in (`parent`; the
   * model's corner nodes keep their numbers). The stresses of element e at
   * its corner k are the program's columns 9e + 3k + 0, 1, 2: σ′x, σ′y, τxy.
   * `split`: the edges bisected for the fans ("a,b" with a < b) and the
   * node at their middle.
   */
  mesh: { x: Float64Array; y: Float64Array; el: Int32Array; parent: Int32Array; split: Map<string, number> };
}

/** Assemble the lower bound problem of a slope (the parts that do not depend on F). */
export function lowerBoundProblem(slope: Slope, options: LowerBoundOptions = {}): LbProblem {
  const model = buildFeModel(slope, options);
  const { materials } = model;
  const keyOf = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const xs = Array.from(model.x), ys = Array.from(model.y);
  // Seepage heads at the nodes, interpolated linearly to the nodes added below
  // (bisection, centroid splits, fans): the model has them at its own only.
  const head0 = model.seepage?.flow ? model.seepage.head : undefined;
  const hs: number[] = head0 ? Array.from(head0) : [];
  const addNode = (px: number, py: number, h: () => number) => {
    xs.push(px); ys.push(py);
    if (head0) hs.push(h());
    return xs.length - 1;
  };
  let tris: number[][] = [], meta: number[] = []; // corner nodes, the model's element
  for (let e = 0; e < model.elementCount; e++) { tris.push([model.el[6 * e], model.el[6 * e + 1], model.el[6 * e + 2]]); meta.push(e); }
  // The ground surface edges of the lower bound mesh, each with the model's
  // surface edge it lies on (whose line loads it carries): the model's,
  // bisected below.
  const surf: [number, number, number, number][] = [];
  for (let s = 0; s < model.surfaceEdges.length; s += 3) {
    const a = model.surfaceEdges[s], b = model.surfaceEdges[s + 2];
    surf.push([a, b, a, b]);
  }
  const surfaceKey = new Set<string>();
  for (const [a, b] of surf) surfaceKey.add(keyOf(a, b));
  // Corners of the ground surface (crest, toe, its ends at the sides): any
  // kink, even a slight one (not only a round-off one, 10⁻⁹ rad), and a
  // point where a material boundary meets it (on V052a's crest the stress
  // locked where the core, c′ = 85 kPa, meets a cohesionless transition).
  const surfNbr = new Map<number, number[]>();
  for (const [a, b] of surf) {
    surfNbr.set(a, [...(surfNbr.get(a) ?? []), b]);
    surfNbr.set(b, [...(surfNbr.get(b) ?? []), a]);
  }
  const corner = new Set<number>();
  // and where a material boundary meets the ground: the materials of the surface edges at each node
  const surfMats = new Map<number, Set<number>>();
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3];
      if (!surfaceKey.has(keyOf(a, b))) continue;
      for (const n of [a, b]) surfMats.set(n, (surfMats.get(n) ?? new Set()).add(model.elMaterial[meta[i]]));
    }
  });
  for (const [v, mats] of surfMats) if (mats.size > 1) corner.add(v);
  for (const [v, nb] of surfNbr) {
    if (nb.length !== 2) { corner.add(v); continue; }
    const ax = xs[nb[0]] - xs[v], ay = ys[nb[0]] - ys[v], bx = xs[nb[1]] - xs[v], by = ys[nb[1]] - ys[v];
    if (Math.abs(ax * by - ay * bx) > 1e-9 * Math.sqrt((ax * ax + ay * ay) * (bx * bx + by * by))) corner.add(v);
  }
  // Line loads as strip loads (limit-common.ts) on the model's surface
  // edges, keyed by node pairs; variable loads take γQ.
  const loadFactor = slope.partialFactors?.variableLoad ?? 1;
  const warnings: string[] = [];
  const nKey = xs.length; // key multiplier of the model's node pairs (the model's nodes keep their numbers)
  const lineQ = surfaceLineLoads(slope, model, (a, b) => (a < b ? a * nKey + b : b * nKey + a), warnings);
  /**
   * The vertical load per horizontal metre on surface edge `s` of `surf` at
   * its node `node`: the line loads' strip loads, linear along the model's
   * edge it lies on, and the strip loads covering the edge's middle.
   */
  const surfaceLoad = (s: number, node: number): number => {
    const [a, b, A, B] = surf[s];
    const key = A < B ? A * nKey + B : B * nKey + A;
    const qa = lineQ.get(`${key}:${A}`) ?? 0, qb = lineQ.get(`${key}:${B}`) ?? 0;
    const t = xs[B] === xs[A] ? 0 : (xs[node] - xs[A]) / (xs[B] - xs[A]);
    let q = qa + t * (qb - qa);
    const mx = (xs[a] + xs[b]) / 2;
    for (const udl of slope.udls) if (mx >= udl.x1 && mx <= udl.x2) q += udl.magnitude * loadFactor;
    return q;
  };
  // Singular points of the ground surface's tractions (Sloan 1988, fans of
  // discontinuities at singular points; Lyamin & Sloan 2002): besides the
  // corners, the nodes where the prescribed load jumps, the ends of the
  // strip loads (the edges of a footing in Prandtl's solution) and of the
  // line loads' strips. The stress there is not one value: each element at
  // the node has its own, and the jump in the load must be carried by the
  // discontinuities between them. With two elements at a load's end, one
  // on each side, the normal and shear traction continuous across their
  // common edge at that node demand q n_y = 0, so that unless that edge is
  // vertical no stress field carries any load (λ = 0 at every F: a strip
  // load ending on an embankment's flat crest, the edge from its end
  // inclined 3.4° from the vertical); with three, one sector between them,
  // the load was carried only at λ = 0.37 even as F fell to 0.05, the
  // tension apex c′ cot φ′ of the sectors not falling with F (a load
  // ending 5 cm from the crest corner of a fill of c′ = 2 kPa, φ′ = 33°,
  // with a 45° face below; the same with loads a few millimetres from such
  // corners).
  // A load ending at a corner was carried, as the corners had fans; the
  // loads' ends get the corners' fans of elements below.
  {
    const qs = new Map<number, number>();
    surf.forEach(([a, b], s) => {
      for (const n of [a, b]) {
        const q = surfaceLoad(s, n), q0 = qs.get(n);
        if (q0 === undefined) qs.set(n, q);
        else if (Math.abs(q - q0) > 1e-9 * (1 + Math.abs(q) + Math.abs(q0))) corner.add(n);
      }
    });
  }
  // Fans of elements at the singular points (Sloan 1988, fans of
  // discontinuities at singular points; Lyamin & Sloan 2002): the elements
  // within FAN_RADIUS element sizes of a corner or a load's end are bisected
  // until each spans at most FAN_ANGLE as seen from it, one at the point by
  // its edge opposite the point, any other by its edge that spans the
  // widest angle; the element on the edge's other side is bisected with
  // it, a surface edge into two on the same model edge. Bisection only adds
  // discontinuities, so that the stress fields of the coarser mesh stay
  // admissible and λ does not fall. Near a singular point the stress varies
  // with the angle around it (Prandtl's fan at a footing's edge, at the
  // crest of a loaded face), at every distance from it, so that a fan needs
  // elements around the point out to the size of the mechanism, not only at
  // the point: on a weightless 45° wedge of c′ = 10 kPa, φ′ = 30° loaded on
  // its crest to Prandtl's c′ N_c with a fan of π/4 (F = 1, elements of
  // 1 m), F was 0.89 with four elements at the corner (their opposite edges
  // bisected, as before) and four sectors in each (below), 0.89 with twelve
  // sectors, 0.93 with fans of elements of at most 30° within an element
  // size, 0.95 with 20° and 0.98 with 15° and no limit on the reach. On the
  // embankment above, the strip load at the crest corner, 2 mm and 5 cm
  // from it gave 0.91, 0.87 and no bound before, now 1.13, 1.13 and 1.10
  // (upper bound 1.21; with 20°, 1.14–1.15 at 1.3 times the elements).
  // Implementation choices: FAN_ANGLE, FAN_RADIUS and at most FAN_PASSES
  // rounds of bisection, from these trials. (At least four elements at a
  // crest or a peak are needed anyway: with two, each a single linear field
  // with no stress on its surface edge, no such pair carried the weight of a
  // cohesionless soil; on a peak of φ′ = 45° under 27° faces λ was 0.09 at
  // F = 1.2, where the slope stands.)
  const splitEdges = new Map<string, number>();
  const singular = [...corner];
  const reach = singular.map((v) => FAN_RADIUS * model.sizeField(xs[v], ys[v]));
  const spanAt = (v: number, a: number, b: number) => {
    const ax = xs[a] - xs[v], ay = ys[a] - ys[v], bx = xs[b] - xs[v], by = ys[b] - ys[v];
    return Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
  };
  for (let pass = 0; pass < FAN_PASSES; pass++) {
    const marked = new Set<string>();
    for (const t of tris) {
      singular.forEach((v, j) => {
        const k = t.indexOf(v);
        let widest = 0, ea = -1, eb = -1;
        if (k >= 0) {
          ea = t[(k + 1) % 3]; eb = t[(k + 2) % 3];
          widest = spanAt(v, ea, eb);
        } else {
          let near = Infinity;
          for (const n of t) near = Math.min(near, Math.hypot(xs[n] - xs[v], ys[n] - ys[v]));
          if (near > reach[j]) return;
          for (let i = 0; i < 3; i++) {
            const a = t[i], b = t[(i + 1) % 3], w = spanAt(v, a, b);
            if (w > widest) { widest = w; ea = a; eb = b; }
          }
        }
        if (widest > FAN_ANGLE) marked.add(keyOf(ea, eb));
      });
    }
    if (marked.size === 0) break;
    const mid = (a: number, b: number) => {
      const key = keyOf(a, b);
      let m = splitEdges.get(key);
      if (m === undefined) { m = addNode((xs[a] + xs[b]) / 2, (ys[a] + ys[b]) / 2, () => (hs[a] + hs[b]) / 2); splitEdges.set(key, m); }
      return m;
    };
    // a bisected surface edge: its halves on the same model edge
    for (let i = surf.length - 1; i >= 0; i--) {
      const [a, b, A, B] = surf[i];
      if (!marked.has(keyOf(a, b))) continue;
      const m = mid(a, b);
      surf.splice(i, 1, [a, m, A, B], [m, b, A, B]);
      surfaceKey.delete(keyOf(a, b)); surfaceKey.add(keyOf(a, m)); surfaceKey.add(keyOf(m, b));
    }
    const out: number[][] = [], outMeta: number[] = [];
    const split = (t: number[], e: number) => {
      for (let k = 0; k < 3; k++) {
        const a = t[k], b = t[(k + 1) % 3], c = t[(k + 2) % 3];
        if (marked.has(keyOf(a, b))) { const m = mid(a, b); split([a, m, c], e); split([m, b, c], e); return; }
      }
      out.push(t); outMeta.push(e);
    };
    tris.forEach((t, i) => split(t, meta[i]));
    tris = out; meta = outMeta;
  }
  // The elements: those, except that one with two edges carrying a traction
  // condition (the free ground surface, or a vertical side, which carries no
  // shear) is split at its centroid into three. A linear stress field with
  // both conditions leaves too little freedom: with no cohesion, a surface
  // edge holds no stress at its nodes, and in an element that also has a
  // side edge equilibrium then demands uniaxial vertical compression under
  // an inclined surface, which a frictional soil cannot carry, or zero
  // stress with two surface edges.
  const edgeUse = new Map<string, number>();
  for (const t of tris) for (let k = 0; k < 3; k++) { const key = keyOf(t[k], t[(k + 1) % 3]); edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1); }
  const elList: number[] = [], matList: number[] = [], elasticList: number[] = [], parentList: number[] = [];
  tris.forEach((cn, i) => {
    const e = meta[i];
    let traction = 0;
    for (let k = 0; k < 3; k++) {
      const a = cn[k], b = cn[(k + 1) % 3], key = keyOf(a, b);
      const side = edgeUse.get(key) === 1 && Math.abs(xs[b] - xs[a]) <= 1e-3 * Math.abs(ys[b] - ys[a]);
      if (surfaceKey.has(key) || side) traction++;
    }
    const parts = [cn];
    if (traction >= 2) {
      const g = addNode((xs[cn[0]] + xs[cn[1]] + xs[cn[2]]) / 3, (ys[cn[0]] + ys[cn[1]] + ys[cn[2]]) / 3, () => (hs[cn[0]] + hs[cn[1]] + hs[cn[2]]) / 3);
      parts[0] = [cn[0], cn[1], g];
      parts.push([cn[1], cn[2], g], [cn[2], cn[0], g]);
    }
    for (const t of parts) { elList.push(...t); matList.push(model.elMaterial[e]); elasticList.push(model.elElastic[e]); parentList.push(e); }
  });
  // Fans at the singular points: the stress there is singular in direction,
  // and a lower bound needs several stress sectors meeting at the point
  // (Sloan 1988, fans of discontinuities at singular points). Each element
  // at a corner or a load's end is divided into FAN_SECTORS sectors from the
  // point by points halfway towards the opposite edge, so that no new node
  // lies on an edge shared with another element.
  const fanned: number[] = [], fanMat: number[] = [], fanElastic: number[] = [], fanParent: number[] = [];
  for (let t = 0; t < matList.length; t++) {
    const tri = [elList[3 * t], elList[3 * t + 1], elList[3 * t + 2]];
    const kv = tri.findIndex((n) => corner.has(n));
    const out: number[][] = [];
    if (kv < 0) out.push(tri);
    else {
      const v = tri[kv], a = tri[(kv + 1) % 3], b = tri[(kv + 2) % 3];
      const pts: number[] = [];
      for (let j = 1; j < FAN_SECTORS; j++) {
        const qx = xs[a] + (j / FAN_SECTORS) * (xs[b] - xs[a]), qy = ys[a] + (j / FAN_SECTORS) * (ys[b] - ys[a]);
        const w = j / FAN_SECTORS;
        pts.push(addNode((xs[v] + qx) / 2, (ys[v] + qy) / 2, () => (hs[v] + hs[a] + w * (hs[b] - hs[a])) / 2));
      }
      const ring = [a, ...pts, b];
      for (let j = 0; j + 1 < ring.length; j++) out.push([v, ring[j], ring[j + 1]]);
      // the strip between the opposite edge and the inner points
      out.push([a, b, pts[pts.length - 1]]);
      for (let j = pts.length - 1; j > 0; j--) out.push([a, pts[j], pts[j - 1]]);
    }
    for (const o of out) { fanned.push(...o); fanMat.push(matList[t]); fanElastic.push(elasticList[t]); fanParent.push(parentList[t]); }
  }
  const x = Float64Array.from(xs), y = Float64Array.from(ys);
  const el = Int32Array.from(fanned), elMaterial = Int32Array.from(fanMat), elElastic = Uint8Array.from(fanElastic);
  const ne = elMaterial.length;
  const p = options.sides ?? 24;
  const cutoff = options.tensionCutoff ?? false;
  let xLo = Infinity, xHi = -Infinity, yHi = -Infinity;
  for (let n = 0; n < x.length; n++) { xLo = Math.min(xLo, x[n]); xHi = Math.max(xHi, x[n]); yHi = Math.max(yHi, y[n]); }
  const surface = slope.surfaceLineXY ?? { x: [xLo, xHi], y: [yHi, yHi] };
  const waterLines = materials.map((m) => slope.getWaterLineForMaterial(m));
  // (the bars also hold the piles' springs, source −1)
  if (model.bars.source.some((k) => k >= 0)) warnings.push("Reinforcement is not included in the lower bound analysis.");
  if (slope.piles.length > 0) warnings.push("Piles are not included in the lower bound analysis.");
  const head = head0 ? Float64Array.from(hs) : undefined;

  // Nodal data per element corner: pore pressure and strength.
  const nU = new Float64Array(3 * ne);
  const nC = new Float64Array(3 * ne);
  const nPhi = new Float64Array(3 * ne);
  // Undrained cap of a combined material (Infinity where there is none).
  const nCu = new Float64Array(3 * ne).fill(Infinity);
  let allUndrained = true;
  for (let e = 0; e < ne; e++) {
    const m = materials[elMaterial[e]], wl = waterLines[elMaterial[e]];
    for (let k = 0; k < 3; k++) {
      const n = el[3 * e + k], i = 3 * e + k;
      nU[i] = porePressureAt(head, n, wl, x[n], y[n]);
      if (elElastic[e]) continue;
      // Strength just inside the element (a node on a boundary takes this element's material).
      const cx = (x[el[3 * e]] + x[el[3 * e + 1]] + x[el[3 * e + 2]]) / 3, cy = (y[el[3 * e]] + y[el[3 * e + 1]] + y[el[3 * e + 2]]) / 3;
      const px = x[n] + 1e-6 * (cx - x[n]), py = y[n] + 1e-6 * (cy - y[n]);
      const st = strengthAt(slope, m, surface, px, py);
      nC[i] = st.c;
      nPhi[i] = st.phi;
      nCu[i] = st.cu;
      if (nPhi[i] > 0) allUndrained = false;
    }
  }

  // Columns: the stresses s(9e + 3k + comp) (σ′x, σ′y, τxy at corner k of
  // element e), free, scaled by γ H; then the load factor λ ≥ 0.
  let gMax = 0, yLo = Infinity;
  for (const m of materials) gMax = Math.max(gMax, m.unitWeight ?? 0, (m.model as { unitWeightSat?: number }).unitWeightSat ?? 0);
  for (let n = 0; n < x.length; n++) yLo = Math.min(yLo, y[n]);
  const stressScale = Math.max(gMax, WATER_UNIT_WEIGHT) * Math.max(yHi - yLo, 1e-9);
  const pb = new ProgramBuilder();
  for (let i = 0; i < 9 * ne; i++) pb.col(`s${i}`, false, stressScale);
  const lam = pb.col("lam", true);
  pb.sense = "max";
  pb.addObjective(lam, 1);
  const v = (e: number, k: number, comp: number) => 9 * e + 3 * k + comp;
  const sn = (e: number, k: number, nx: number, ny: number, w = 1): [number, number][] =>
    [[v(e, k, 0), w * nx * nx], [v(e, k, 1), w * ny * ny], [v(e, k, 2), w * 2 * nx * ny]];
  const ts = (e: number, k: number, nx: number, ny: number, w = 1): [number, number][] =>
    [[v(e, k, 0), -w * nx * ny], [v(e, k, 1), w * nx * ny], [v(e, k, 2), w * (nx * nx - ny * ny)]];

  // F-independent rows: equilibrium, discontinuities, boundary tractions.
  for (let e = 0; e < ne; e++) {
    const n = [el[3 * e], el[3 * e + 1], el[3 * e + 2]];
    const b = [y[n[1]] - y[n[2]], y[n[2]] - y[n[0]], y[n[0]] - y[n[1]]];
    const c = [x[n[2]] - x[n[1]], x[n[0]] - x[n[2]], x[n[1]] - x[n[0]]];
    const area2 = b[0] * c[1] - b[1] * c[0];
    // Weight: the mean unit weight over the element (limit-common.ts).
    const gamma = meanUnitWeight(
      materials[elMaterial[e]], waterLines[elMaterial[e]], !!head,
      n.map((i) => x[i]), n.map((i) => y[i]), [nU[3 * e], nU[3 * e + 1], nU[3 * e + 2]],
    );
    let ux = 0, uy = 0;
    for (let k = 0; k < 3; k++) { ux += b[k] * nU[3 * e + k]; uy += c[k] * nU[3 * e + k]; }
    // Σ b σx + c τ − λ Σ b u = 0
    const r1: [number, number][] = [], r2: [number, number][] = [];
    for (let k = 0; k < 3; k++) {
      r1.push([v(e, k, 0), b[k]], [v(e, k, 2), c[k]]);
      r2.push([v(e, k, 2), b[k]], [v(e, k, 1), c[k]]);
    }
    pb.eq([...r1, [lam, -ux]]);
    pb.eq([...r2, [lam, -(uy + area2 * gamma)]]);
  }
  // Edges: find each edge's elements by corner pair.
  const nc = x.length; // key multiplier for node pairs
  const edgeOwner = new Map<number, [number, number]>();
  // the ground surface edges, by their index in `surf`
  const surfaceSet = new Map<number, number>();
  surf.forEach(([a, b], s) => surfaceSet.set(a < b ? a * nc + b : b * nc + a, s));
  for (let e = 0; e < ne; e++) {
    for (let k = 0; k < 3; k++) {
      const a = el[3 * e + k], b = el[3 * e + ((k + 1) % 3)];
      const key = a < b ? a * nc + b : b * nc + a;
      const len = Math.hypot(x[b] - x[a], y[b] - y[a]);
      const nx = (y[b] - y[a]) / len, ny = -(x[b] - x[a]) / len; // outward for this element
      const other = edgeOwner.get(key);
      if (other) {
        // continuity of total normal and shear traction at both ends
        const [e2, k2] = other;
        const a2 = el[3 * e2 + k2];
        for (const [kk, node] of [[k, a], [(k + 1) % 3, b]] as [number, number][]) {
          const kk2 = node === a2 ? k2 : (k2 + 1) % 3;
          const du = nU[3 * e + kk] - nU[3 * e2 + kk2];
          // σ′n(e) − λ u(e) = σ′n(e2) − λ u(e2)
          pb.eq([...sn(e, kk, nx, ny), ...sn(e2, kk2, nx, ny, -1), [lam, -du]]);
          pb.eq([...ts(e, kk, nx, ny), ...ts(e2, kk2, nx, ny, -1)]);
        }
        edgeOwner.delete(key);
      } else edgeOwner.set(key, [e, k]);
    }
  }
  // Remaining edges are on the boundary. The supports are those of the
  // strength reduction model (model.ts): a vertical side is a smooth roller,
  // so it carries no shear; the base is fixed and carries any traction.
  for (const [key, [e, k]] of edgeOwner) {
    if (surfaceSet.has(key)) continue;
    const a = el[3 * e + k], b = el[3 * e + ((k + 1) % 3)];
    if (Math.abs(x[b] - x[a]) > 1e-3 * Math.abs(y[b] - y[a])) continue;
    const len = Math.hypot(x[b] - x[a], y[b] - y[a]);
    const nx = (y[b] - y[a]) / len, ny = -(x[b] - x[a]) / len;
    for (const kk of [k, (k + 1) % 3]) pb.eq(ts(e, kk, nx, ny));
  }
  // On the ground surface the traction is prescribed.
  for (const [key, [e, k]] of edgeOwner) {
    const s = surfaceSet.get(key);
    if (s === undefined) continue;
    const a = el[3 * e + k], b = el[3 * e + ((k + 1) % 3)];
    // Ponded water: the line of the element's material, as model.ts; with
    // seepage the water table that drives the flow.
    const pondLine = head ? slope.waterRLXY : waterLines[elMaterial[e]];
    const len = Math.hypot(x[b] - x[a], y[b] - y[a]);
    const nx = (y[b] - y[a]) / len, ny = -(x[b] - x[a]) / len;
    for (const [kk, node] of [[k, a], [(k + 1) % 3, b]] as [number, number][]) {
      // loads: ponded water (normal pressure) and strip loads (vertical, per horizontal metre)
      let pw = 0;
      if (pondLine) {
        const yw = polylineY(pondLine, x[node]);
        pw = Number.isFinite(yw) ? WATER_UNIT_WEIGHT * Math.max(0, yw - y[node]) : 0;
      }
      // A strip load acts on the edges whose middle it covers: the node at its
      // end carries it on one side and not on the other (nodes are not shared).
      const q = surfaceLoad(s, node);
      // traction vector t = −pw n + (0, −q |n_y|); σn,total = t·n, τ = t·s with s = (−ny, nx)
      const tx = -pw * nx, ty = -pw * ny - q * Math.abs(ny);
      const tn = tx * nx + ty * ny, tt = -tx * ny + ty * nx;
      // σ′n − λ u = λ tn ; τ = λ ts
      pb.eq([...sn(e, kk, nx, ny), [lam, -(nU[3 * e + kk] + tn)]]);
      pb.eq([...ts(e, kk, nx, ny), [lam, -tt]]);
    }
  }
  const fixed = pb.build();

  // Yield cones per corner (F-dependent): 2c cos φ − sin φ (σx + σy) ≥ ‖(σx − σy, 2τ)‖;
  // the undrained cap 2cu ≥ ‖(σx − σy, 2τ)‖; the tension cut-off −(σx + σy)/2 ≥ ‖((σx − σy)/2, τ)‖.
  const yieldCones = (F: number): ConicProgram["cones"] => {
    const out: ConicProgram["cones"] = [];
    for (let e = 0; e < ne; e++) {
      if (elElastic[e]) continue;
      for (let k = 0; k < 3; k++) {
        const i = 3 * e + k, sx = v(e, k, 0), sy = v(e, k, 1), txy = v(e, k, 2);
        const { c: cF, phi: phiF } = reducedStrength(nC[i], nPhi[i], model.elPsi[fanParent[e]], F, options.strengthRule);
        const sp = Math.sin(phiF);
        const dev1 = affine([[sx, 1], [sy, -1]]), dev2 = affine([[txy, 2]]);
        out.push({ t: affine([[sx, -sp], [sy, -sp]], 2 * cF * Math.cos(phiF)), u1: dev1, u2: dev2, polygon: "facets" });
        if (Number.isFinite(nCu[i])) out.push({ t: affine([], (2 * nCu[i]) / F), u1: dev1, u2: dev2, polygon: "facets" });
        if (cutoff) out.push({ t: affine([[sx, -0.5], [sy, -0.5]]), u1: affine([[sx, 0.5], [sy, -0.5]]), u2: affine([[txy, 1]]), polygon: "facets" });
      }
    }
    return out;
  };
  let coneCount = 0;
  for (let e = 0; e < ne; e++) {
    if (elElastic[e]) continue;
    coneCount += 3 * (cutoff ? 2 : 1);
    for (let k = 0; k < 3; k++) if (Number.isFinite(nCu[3 * e + k])) coneCount++;
  }
  return {
    program: (F) => ({ ...fixed, cones: yieldCones(F) }),
    sides: p,
    allUndrained,
    elements: ne,
    variables: 9 * ne + 1,
    constraints: fixed.eqRhs.length + coneCount,
    warnings,
    mesh: { x, y, el, parent: Int32Array.from(fanParent), split: splitEdges },
  };
}

/** Lower bound on the factor of safety of a slope. */
export async function lowerBound(slope: Slope, options: LowerBoundOptions = {}, highs?: Highs, module?: HighsModuleOptions): Promise<LowerBoundResult> {
  const solve = await boundSolver(options, highs, module);
  const prob = lowerBoundProblem(slope, options);
  const trials: LowerBoundResult["trials"] = [];
  const warnings = [...prob.warnings];
  const searchStart = performance.now();
  let outOfTime = false;
  const lambdaAt = (F: number): number => {
    const t0 = performance.now();
    const remaining = (options.totalTimeLimit ?? Infinity) - (t0 - searchStart) / 1000;
    if (remaining <= 0) {
      if (!outOfTime) warnings.push(`The search stopped at its time limit of ${options.totalTimeLimit} s.`);
      outOfTime = true;
      return NaN;
    }
    const r = solve(prob.program(F), prob.sides, Math.min(options.timeLimit ?? 300, remaining));
    // Only an optimal program gives a load factor; any other status
    // (time limit, numerical trouble) gives none, and F is not bounded there.
    const lambda = r.status === "optimal" ? r.objective : r.status === "unbounded" ? Infinity : NaN;
    if (r.status !== "optimal" && r.status !== "unbounded") warnings.push(`The program at F = ${F.toFixed(3)} ended with status "${r.detail}".`);
    trials.push({ F, lambda, seconds: (performance.now() - t0) / 1000 });
    return lambda;
  };
  const tol = options.fTolerance ?? 0.002;
  const F0 = options.startF && options.startF > 0 ? options.startF : 1;
  const l1 = lambdaAt(F0);
  if (Number.isNaN(l1)) {
    return { factorOfSafety: NaN, trials, elements: prob.elements, variables: prob.variables, constraints: prob.constraints, warnings: [...warnings, `The program at F = ${F0.toFixed(3)} was not solved.`] };
  }
  const fail = (reason: string): LowerBoundResult =>
    ({ factorOfSafety: NaN, trials, elements: prob.elements, variables: prob.variables, constraints: prob.constraints, warnings: [...warnings, reason] });
  // A reduction F with λ(F) ≥ 1 carries the loads with the reduced
  // strength in an admissible stress field: F is a lower bound. The result
  // is the largest such F evaluated, never an extrapolation.
  let F: number;
  if (prob.allUndrained) {
    if (!(l1 > 0) || !Number.isFinite(l1)) return fail("The program has no admissible stress field.");
    F = l1 * F0; // λ(F) = λ(F0)·F0/F, so λ(λ(F0)·F0) = 1 exactly
  } else if (l1 === 0 || l1 === Infinity) {
    // Without cohesion every constraint is homogeneous in the stresses and
    // λ, so λ is 0 or unbounded: F is found by bisection on whether the
    // loads can be carried (λ(F) ≥ 1).
    const ok = (f: number) => { const l = lambdaAt(f); return Number.isNaN(l) ? null : l >= 1; };
    let lo = 0, hi = Infinity;
    if (l1 >= 1) lo = F0; else hi = F0;
    for (let k = 0; k < 20 && (lo === 0 || hi === Infinity); k++) {
      const f = lo === 0 ? hi / 1.5 : lo * 1.5;
      if (f < 0.05 || f > 100) break;
      const r = ok(f);
      if (r === null) break;
      if (r) lo = f; else hi = f;
    }
    while (lo > 0 && Number.isFinite(hi) && hi - lo > tol) {
      const f = (lo + hi) / 2, r = ok(f);
      if (r === null) break;
      if (r) lo = f; else hi = f;
    }
    if (!(lo > 0)) {
      return fail(
        "No reduction with an admissible stress field carrying the loads was found. Without cohesion the linear stress elements cannot carry the weight at the corners of the ground surface; the lower bound needs some cohesion there.",
      );
    }
    if (!Number.isFinite(hi) || hi - lo > tol) warnings.push(`The bisection stopped with F between ${lo.toFixed(3)} and ${Number.isFinite(hi) ? hi.toFixed(3) : "∞"}; F is the lower of the two.`);
    F = lo;
  } else {
    let best = l1 >= 1 ? F0 : 0, failed = l1 < 1 ? F0 : Infinity;
    const certify = (f: number, l: number) => {
      if (l >= 1) best = Math.max(best, f);
      else failed = Math.min(failed, f);
    };
    // Secant on g(F) = log λ(F), decreasing, root where λ = 1. The next
    // trial is placed tol/2 below the secant's root, so that it lands on
    // the admissible side; the search stops when a certified F lies within
    // tol of the root estimate, or of a reduction that fails. A trial off
    // the bracket between them, or after λ = 0 or ∞ (a cohesionless soil
    // at the ground surface makes λ jump there: on V012 from 1.6 to 0 at
    // its embankment's face, tan φ′/tan β = 0.80), bisects it.
    let fa = F0, la = l1;
    let fb = F0 * (l1 > 1 ? Math.min(l1, 1.5) : Math.max(l1, 0.67));
    let lb = lambdaAt(fb);
    certify(fb, lb);
    let reached = false, root = NaN;
    const near = (l: number) => l > 0.5 && l < 2;
    for (let it = 0; it < 25 && !Number.isNaN(lb); it++) {
      if (best > 0 && failed - best <= tol) { reached = true; break; }
      let next = NaN;
      if (la > 0 && lb > 0 && Number.isFinite(la) && Number.isFinite(lb) && Math.abs(Math.log(lb) - Math.log(la)) >= 1e-14) {
        root = Math.max(0.05, fb - (Math.log(lb) * (fb - fa)) / (Math.log(lb) - Math.log(la)));
        // (the secant's root decides only from trials near λ = 1, not across a jump)
        if (best > 0 && best >= root - tol && near(la) && near(lb)) { reached = true; break; }
        next = root - tol / 2;
      }
      if (!(next > best && next < failed && next >= 0.05)) next = best > 0 && Number.isFinite(failed) ? (best + failed) / 2 : best > 0 ? 1.5 * best : failed / 1.5;
      if (next < 0.05 || next > 100) break;
      fa = fb; la = lb;
      fb = next;
      lb = lambdaAt(fb);
      certify(fb, lb);
    }
    if (!(best > 0)) return fail("No reduction with an admissible stress field carrying the loads was found.");
    if (!reached) {
      warnings.push(`The search for λ = 1 stopped before converging${Number.isFinite(root) ? ` (estimated root F = ${root.toFixed(3)})` : ""}; F is the largest reduction found to carry the loads.`);
    }
    F = best;
  }
  return { factorOfSafety: F, trials, elements: prob.elements, variables: prob.variables, constraints: prob.constraints, warnings };
}
