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
 * secant method on log λ with trials tol/2 below its root, returning the
 * largest evaluated F with λ(F) ≥ 1 once it lies within 0.002 of the root
 * (only such an F is a lower bound); the load factor on every load, weight
 * included, as the strength reduction applies; a line load spread over the
 * two surface edges at its point; the stresses scaled by γ H (the largest
 * unit weight times the model's height) for Clarabel.
 */

import { WATER_UNIT_WEIGHT } from "../types/constants";
import type { Slope } from "../model/slope";
import { buildFeModel, polylineY, type FeModelOptions } from "./model";
import { meanUnitWeight, porePressureAt, strengthAt, surfaceLineLoads } from "./limit-common";
import {
  affine, loadClarabel, ProgramBuilder, solveClarabel, solveHighs,
  type ConicProgram, type ConicSolution, type HighsSolver,
} from "./conic";

/** Sectors per element at a corner of the ground surface (see lowerBoundProblem). */
const FAN_SECTORS = 4;

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
   */
  mesh: { x: Float64Array; y: Float64Array; el: Int32Array; parent: Int32Array };
}

/** Assemble the lower bound problem of a slope (the parts that do not depend on F). */
export function lowerBoundProblem(slope: Slope, options: LowerBoundOptions = {}): LbProblem {
  const model = buildFeModel(slope, options);
  const { materials } = model;
  // The elements: the model's triangles (corner nodes), except that one with
  // two edges carrying a traction condition (the free ground surface, or a
  // vertical side, which carries no shear) is split at its centroid into
  // three. A linear stress field with both conditions leaves too little
  // freedom: with no cohesion, a surface edge holds no stress at its nodes,
  // and in an element that also has a side edge equilibrium then demands
  // uniaxial vertical compression under an inclined surface, which a
  // frictional soil cannot carry, or zero stress with two surface edges.
  const keyOf = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const surfaceKey = new Set<string>();
  for (let s = 0; s < model.surfaceEdges.length; s += 3) surfaceKey.add(keyOf(model.surfaceEdges[s], model.surfaceEdges[s + 2]));
  const edgeUse = new Map<string, number>();
  for (let e = 0; e < model.elementCount; e++) {
    for (let k = 0; k < 3; k++) {
      const key = keyOf(model.el[6 * e + k], model.el[6 * e + ((k + 1) % 3)]);
      edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
    }
  }
  const xs = Array.from(model.x), ys = Array.from(model.y);
  const elList: number[] = [], matList: number[] = [], elasticList: number[] = [], parentList: number[] = [];
  for (let e = 0; e < model.elementCount; e++) {
    const cn = [model.el[6 * e], model.el[6 * e + 1], model.el[6 * e + 2]];
    let traction = 0;
    for (let k = 0; k < 3; k++) {
      const a = cn[k], b = cn[(k + 1) % 3], key = keyOf(a, b);
      const side = edgeUse.get(key) === 1 && Math.abs(xs[b] - xs[a]) <= 1e-3 * Math.abs(ys[b] - ys[a]);
      if (surfaceKey.has(key) || side) traction++;
    }
    const tris = [cn];
    if (traction >= 2) {
      const g = xs.length;
      xs.push((xs[cn[0]] + xs[cn[1]] + xs[cn[2]]) / 3);
      ys.push((ys[cn[0]] + ys[cn[1]] + ys[cn[2]]) / 3);
      tris[0] = [cn[0], cn[1], g];
      tris.push([cn[1], cn[2], g], [cn[2], cn[0], g]);
    }
    for (const t of tris) { elList.push(...t); matList.push(model.elMaterial[e]); elasticList.push(model.elElastic[e]); parentList.push(e); }
  }
  // Fans at the corners of the ground surface (crest, toe, and its ends at
  // the sides): the stress there is singular in direction, and a lower
  // bound needs several stress sectors meeting at the corner (Sloan 1988,
  // fans of discontinuities at singular points). Each element at a corner
  // is divided into FAN_SECTORS sectors from the corner by points halfway
  // towards the opposite edge, so that no new node lies on an edge shared
  // with another element.
  const surfNbr = new Map<number, number[]>();
  for (let s = 0; s < model.surfaceEdges.length; s += 3) {
    const a = model.surfaceEdges[s], b = model.surfaceEdges[s + 2];
    surfNbr.set(a, [...(surfNbr.get(a) ?? []), b]);
    surfNbr.set(b, [...(surfNbr.get(b) ?? []), a]);
  }
  const corner = new Set<number>();
  for (const [v, nb] of surfNbr) {
    if (nb.length !== 2) { corner.add(v); continue; }
    const ax = xs[nb[0]] - xs[v], ay = ys[nb[0]] - ys[v], bx = xs[nb[1]] - xs[v], by = ys[nb[1]] - ys[v];
    // any kink: even a slight one leaves two elements with one stress
    // field each to meet there (not only a round-off one, 10⁻⁹ rad)
    if (Math.abs(ax * by - ay * bx) > 1e-9 * Math.sqrt((ax * ax + ay * ay) * (bx * bx + by * by))) corner.add(v);
  }
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
        pts.push(xs.length);
        xs.push((xs[v] + qx) / 2);
        ys.push((ys[v] + qy) / 2);
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
  const warnings: string[] = [];
  let xLo = Infinity, xHi = -Infinity, yHi = -Infinity;
  for (let n = 0; n < x.length; n++) { xLo = Math.min(xLo, x[n]); xHi = Math.max(xHi, x[n]); yHi = Math.max(yHi, y[n]); }
  const surface = slope.surfaceLineXY ?? { x: [xLo, xHi], y: [yHi, yHi] };
  const waterLines = materials.map((m) => slope.getWaterLineForMaterial(m));
  // (the bars also hold the piles' springs, source −1)
  if (model.bars.source.some((k) => k >= 0)) warnings.push("Reinforcement is not included in the lower bound analysis.");
  if (slope.piles.length > 0) warnings.push("Piles are not included in the lower bound analysis.");
  const head = model.seepage?.flow ? model.seepage.head : undefined;

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
  const surfaceSet = new Set<number>();
  for (let s = 0; s < model.surfaceEdges.length; s += 3) {
    const a = model.surfaceEdges[s], b = model.surfaceEdges[s + 2];
    surfaceSet.add(a < b ? a * nc + b : b * nc + a);
  }
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
  // Line loads as strip loads (limit-common.ts); variable loads take γQ.
  const loadFactor = slope.partialFactors?.variableLoad ?? 1;
  const lineQ = surfaceLineLoads(slope, model, (a, b) => (a < b ? a * nc + b : b * nc + a), warnings);
  // On the ground surface the traction is prescribed.
  for (const [key, [e, k]] of edgeOwner) {
    if (!surfaceSet.has(key)) continue;
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
      let q = lineQ.get(`${key}:${node}`) ?? 0;
      const mx = (x[a] + x[b]) / 2;
      for (const udl of slope.udls) if (mx >= udl.x1 && mx <= udl.x2) q += udl.magnitude * loadFactor;
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
        const cF = nC[i] / F, phiF = Math.atan(Math.tan(nPhi[i]) / F);
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
    mesh: { x, y, el, parent: Int32Array.from(fanParent) },
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
    let best = l1 >= 1 ? F0 : 0;
    const certify = (f: number, l: number) => { if (l >= 1 && f > best) best = f; };
    // Secant on g(F) = log λ(F), decreasing, root where λ = 1. The next
    // trial is placed tol/2 below the secant's root, so that it lands on
    // the admissible side; the search stops when a certified F lies within
    // tol of the root estimate.
    let fa = F0, ga = Math.log(l1);
    let fb = F0 * (l1 > 1 ? Math.min(l1, 1.5) : Math.max(l1, 0.67));
    let lb = lambdaAt(fb);
    certify(fb, lb);
    let reached = false, root = NaN;
    for (let it = 0; it < 15 && Number.isFinite(lb) && lb > 0; it++) {
      const gb = Math.log(lb);
      if (Math.abs(gb - ga) < 1e-14) { reached = best > 0 && Math.abs(fb - best) <= tol; break; }
      root = Math.max(0.05, fb - (gb * (fb - fa)) / (gb - ga));
      if (best > 0 && best >= root - tol) { reached = true; break; }
      fa = fb; ga = gb;
      fb = Math.max(0.05, root - tol / 2);
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
