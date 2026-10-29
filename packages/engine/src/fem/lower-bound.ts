/**
 * Lower bound limit analysis by finite elements and linear programming
 * (Sloan 1988, IJNAMG 12, 61–77; Lyamin & Sloan 2002, IJNME 55, 573–611).
 *
 * The stresses vary linearly over three-node triangles whose nodes are not
 * shared, so that every interior edge can carry a statically admissible
 * stress discontinuity (continuous normal and shear traction). Each
 * element is in equilibrium with its weight and the pore pressure
 * gradient, the ground surface carries its loads, and at every node the
 * Mohr–Coulomb criterion is replaced by the p-sided polygon inscribed in
 * it (Sloan 1988), so that the stress field is admissible and the load
 * factor a strict lower bound for the mesh. Stresses are effective,
 * tension positive; σ = σ′ − u m. The linear programs are solved by HiGHS
 * (Huangfu & Hall 2018, Math. Program. Comput. 10(1), 119–142).
 *
 * The linear program maximises a load factor λ on every load (weight, pore
 * pressure and surface loads). The factor of safety on strength is the
 * reduction F at which λ(F) = 1: for φ = 0 everywhere λ(F) = λ(1)/F, so
 * F = λ(1) from one program; otherwise F is found by the secant method on
 * log λ (Kim, Salgado & Lee 2002, J. Geotech. Geoenviron. Eng. 128(7),
 * 546–557, fig. 3: iterate until the reference load is carried).
 *
 * Implementation choices (not from the literature): p = 24 sides; the
 * secant method on log λ with trials tol/2 below its root, returning the
 * largest evaluated F with λ(F) ≥ 1 once it lies within 0.002 of the root
 * (only such an F is a lower bound); the load factor on every load, weight
 * included, as the strength reduction applies; a line load spread over the
 * two surface edges at its point; interior point first and simplex as the
 * fallback.
 */

import { WATER_UNIT_WEIGHT } from "../types/constants";
import type { Slope } from "../model/slope";
import { buildFeModel, polylineY, type FeModelOptions } from "./model";
import { meanUnitWeight, porePressureAt, strengthAt, surfaceLineLoads } from "./limit-common";

/** Sectors per element at a corner of the ground surface (see lowerBoundProblem). */
const FAN_SECTORS = 4;

export interface LowerBoundOptions extends FeModelOptions {
  /** Sides of the inscribed yield polygon; default 24. */
  sides?: number;
  /** Rankine tension cut-off σ₁′ ≤ 0; default false. */
  tensionCutoff?: boolean;
  /** Tolerance on F; default 0.002. */
  fTolerance?: number;
  /** Time limit per linear program (s); default 300. */
  timeLimit?: number;
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
  const moduleArg = bin
    ? {
        instantiateWasm: (imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance) => void) => {
          void WebAssembly.instantiate(bin, imports).then((r) => done(r.instance));
          return {};
        },
      }
    : o.locateFile ? { locateFile: o.locateFile } : {};
  highsPromise ??= import("highs").then((m) => {
    const loader = (m as unknown as { default: (o?: object) => Promise<Highs> }).default;
    return loader(moduleArg);
  });
  return highsPromise;
}

interface LbProblem {
  /** Linear program text (CPLEX LP format) for a given F. */
  build(F: number): string;
  allUndrained: boolean;
  elements: number;
  variables: number;
  constraints: number;
  warnings: string[];
  /** The lower bound mesh: corner coordinates and three nodes per element (for inspection). */
  mesh: { x: Float64Array; y: Float64Array; el: Int32Array };
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
  const elList: number[] = [], matList: number[] = [], elasticList: number[] = [];
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
    for (const t of tris) { elList.push(...t); matList.push(model.elMaterial[e]); elasticList.push(model.elElastic[e]); }
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
  const fanned: number[] = [], fanMat: number[] = [], fanElastic: number[] = [];
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
    for (const o of out) { fanned.push(...o); fanMat.push(matList[t]); fanElastic.push(elasticList[t]); }
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
  if (model.bars.count > 0) warnings.push("Reinforcement is not included in the lower bound analysis.");
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

  const v = (e: number, k: number, comp: number) => `s${9 * e + 3 * k + comp}`;
  const fmt = (a: number) => (a === 0 ? "0" : a.toPrecision(15));
  const term = (a: number, name: string) => (a === 0 ? "" : ` ${a < 0 ? "-" : "+"} ${fmt(Math.abs(a))} ${name}`);

  // F-independent rows: equilibrium, discontinuities, boundary tractions.
  const fixed: string[] = [];
  let row = 0;
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
    let r1 = "", r2 = "";
    for (let k = 0; k < 3; k++) {
      r1 += term(b[k], v(e, k, 0)) + term(c[k], v(e, k, 2));
      r2 += term(b[k], v(e, k, 2)) + term(c[k], v(e, k, 1));
    }
    fixed.push(` r${row++}:${r1}${term(-ux, "lam")} = 0`);
    fixed.push(` r${row++}:${r2}${term(-(uy + area2 * gamma), "lam")} = 0`);
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
      const snRow = (ee: number, kk: number) => term(nx * nx, v(ee, kk, 0)) + term(ny * ny, v(ee, kk, 1)) + term(2 * nx * ny, v(ee, kk, 2));
      const tRow = (ee: number, kk: number) => term(-nx * ny, v(ee, kk, 0)) + term(nx * ny, v(ee, kk, 1)) + term(nx * nx - ny * ny, v(ee, kk, 2));
      const other = edgeOwner.get(key);
      if (other) {
        // continuity of total normal and shear traction at both ends
        const [e2, k2] = other;
        const a2 = el[3 * e2 + k2];
        for (const [kk, node] of [[k, a], [(k + 1) % 3, b]] as [number, number][]) {
          const kk2 = node === a2 ? k2 : (k2 + 1) % 3;
          const du = nU[3 * e + kk] - nU[3 * e2 + kk2];
          // σ′n(e) − λ u(e) = σ′n(e2) − λ u(e2)
          const sn2 = term(-nx * nx, v(e2, kk2, 0)) + term(-ny * ny, v(e2, kk2, 1)) + term(-2 * nx * ny, v(e2, kk2, 2));
          const t2 = term(nx * ny, v(e2, kk2, 0)) + term(-nx * ny, v(e2, kk2, 1)) + term(-(nx * nx - ny * ny), v(e2, kk2, 2));
          fixed.push(` r${row++}:${snRow(e, kk)}${sn2}${term(-du, "lam")} = 0`);
          fixed.push(` r${row++}:${tRow(e, kk)}${t2} = 0`);
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
    for (const kk of [k, (k + 1) % 3]) {
      fixed.push(` r${row++}:${term(-nx * ny, v(e, kk, 0))}${term(nx * ny, v(e, kk, 1))}${term(nx * nx - ny * ny, v(e, kk, 2))} = 0`);
    }
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
      const tn = tx * nx + ty * ny, ts = -tx * ny + ty * nx;
      const sn = term(nx * nx, v(e, kk, 0)) + term(ny * ny, v(e, kk, 1)) + term(2 * nx * ny, v(e, kk, 2));
      const tt = term(-nx * ny, v(e, kk, 0)) + term(nx * ny, v(e, kk, 1)) + term(nx * nx - ny * ny, v(e, kk, 2));
      // σ′n − λ u = λ tn ; τ = λ ts
      fixed.push(` r${row++}:${sn}${term(-(nU[3 * e + kk] + tn), "lam")} = 0`);
      fixed.push(` r${row++}:${tt}${term(-ts, "lam")} = 0`);
    }
  }
  const fixedRows = row;

  // Yield polygon (inscribed): (σx − σy) cos θk + 2τ sin θk + cos(π/p) sin φ (σx + σy) ≤ 2 c cos φ cos(π/p)
  const cp = Math.cos(Math.PI / p);
  const yieldRows = (F: number): string[] => {
    const out: string[] = [];
    let r = fixedRows;
    for (let e = 0; e < ne; e++) {
      if (elElastic[e]) continue;
      for (let k = 0; k < 3; k++) {
        const i = 3 * e + k;
        const cF = nC[i] / F, phiF = Math.atan(Math.tan(nPhi[i]) / F);
        const sp = Math.sin(phiF), rhs = 2 * cF * Math.cos(phiF) * cp;
        for (let j = 0; j < p; j++) {
          const th = (2 * Math.PI * j) / p, ct = Math.cos(th), st = Math.sin(th);
          const ax = ct + cp * sp, ay = -ct + cp * sp, at = 2 * st;
          out.push(` r${r++}:${term(ax, v(e, k, 0))}${term(ay, v(e, k, 1))}${term(at, v(e, k, 2))} <= ${fmt(rhs)}`);
        }
        if (Number.isFinite(nCu[i])) {
          // the undrained cap: the inscribed Tresca polygon on cu/F
          const rhsU = (2 * nCu[i] * cp) / F;
          for (let j = 0; j < p; j++) {
            const th = (2 * Math.PI * j) / p, ct = Math.cos(th), st = Math.sin(th);
            out.push(` r${r++}:${term(ct, v(e, k, 0))}${term(-ct, v(e, k, 1))}${term(2 * st, v(e, k, 2))} <= ${fmt(rhsU)}`);
          }
        }
        if (cutoff) {
          // σ1 = (σx + σy)/2 + R ≤ 0, R inscribed: ((σx − σy)/2 cos θ + τ sin θ) ≤ −cos(π/p)(σx + σy)/2
          for (let j = 0; j < p; j++) {
            const th = (2 * Math.PI * j) / p, ct = Math.cos(th), st = Math.sin(th);
            out.push(` r${r++}:${term(ct / 2 + cp / 2, v(e, k, 0))}${term(-ct / 2 + cp / 2, v(e, k, 1))}${term(st, v(e, k, 2))} <= 0`);
          }
        }
      }
    }
    return out;
  };
  const nVars = 9 * ne + 1;
  const bounds = ["Bounds", " lam >= 0"];
  for (let i = 0; i < 9 * ne; i++) bounds.push(` s${i} free`);
  const fixedText = fixed.join("\n");
  const boundsText = bounds.join("\n");
  let yieldCount = 0;
  for (let e = 0; e < ne; e++) {
    if (elElastic[e]) continue;
    yieldCount += 3 * p * (cutoff ? 2 : 1);
    for (let k = 0; k < 3; k++) if (Number.isFinite(nCu[3 * e + k])) yieldCount += p;
  }
  return {
    build: (F) => ["Maximize", " obj: lam", "Subject To", fixedText, yieldRows(F).join("\n"), boundsText, "End"].join("\n"),
    allUndrained,
    elements: ne,
    variables: nVars,
    constraints: fixedRows + yieldCount,
    warnings,
    mesh: { x, y, el },
  };
}

/** Lower bound on the factor of safety of a slope. */
export async function lowerBound(slope: Slope, options: LowerBoundOptions = {}, highs?: Highs, module?: HighsModuleOptions): Promise<LowerBoundResult> {
  const solver = highs ?? (await loadHighs(module));
  const prob = lowerBoundProblem(slope, options);
  const trials: LowerBoundResult["trials"] = [];
  const warnings = [...prob.warnings];
  const lambdaAt = (F: number): number => {
    const t0 = performance.now();
    // Interior point (with presolve and crossover) is about four times faster
    // than simplex on these programs (measured on V077); without presolve it
    // can misreport the status, so simplex is the fallback.
    const lp = prob.build(F);
    const time_limit = options.timeLimit ?? 300;
    let r = solver.solve(lp, { solver: "ipm", time_limit });
    if (r.Status !== "Optimal" && r.Status !== "Time limit reached") r = solver.solve(lp, { solver: "simplex", time_limit });
    // Only an optimal program gives a load factor; any other status
    // (time limit, numerical trouble) gives none, and F is not bounded there.
    const lambda = r.Status === "Optimal" ? r.ObjectiveValue : r.Status === "Unbounded" ? Infinity : NaN;
    if (r.Status !== "Optimal") warnings.push(`The linear program at F = ${F.toFixed(3)} ended with status "${r.Status}".`);
    trials.push({ F, lambda, seconds: (performance.now() - t0) / 1000 });
    return lambda;
  };
  const tol = options.fTolerance ?? 0.002;
  const l1 = lambdaAt(1);
  if (Number.isNaN(l1)) {
    return { factorOfSafety: NaN, trials, elements: prob.elements, variables: prob.variables, constraints: prob.constraints, warnings: [...warnings, "The linear program at F = 1 was not solved."] };
  }
  const fail = (reason: string): LowerBoundResult =>
    ({ factorOfSafety: NaN, trials, elements: prob.elements, variables: prob.variables, constraints: prob.constraints, warnings: [...warnings, reason] });
  // A reduction F with λ(F) ≥ 1 carries the loads with the reduced
  // strength in an admissible stress field: F is a lower bound. The result
  // is the largest such F evaluated, never an extrapolation.
  let F: number;
  if (prob.allUndrained) {
    if (!(l1 > 0) || !Number.isFinite(l1)) return fail("The linear program has no admissible stress field.");
    F = l1; // λ(F) = λ(1)/F, so λ(λ(1)) = 1 exactly
  } else if (l1 === 0 || l1 === Infinity) {
    // Without cohesion every constraint is homogeneous in the stresses and
    // λ, so λ is 0 or unbounded: F is found by bisection on whether the
    // loads can be carried (λ(F) ≥ 1).
    const ok = (f: number) => { const l = lambdaAt(f); return Number.isNaN(l) ? null : l >= 1; };
    let lo = 0, hi = Infinity;
    if (l1 >= 1) lo = 1; else hi = 1;
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
    let best = l1 >= 1 ? 1 : 0;
    const certify = (f: number, l: number) => { if (l >= 1 && f > best) best = f; };
    // Secant on g(F) = log λ(F), decreasing, root where λ = 1. The next
    // trial is placed tol/2 below the secant's root, so that it lands on
    // the admissible side; the search stops when a certified F lies within
    // tol of the root estimate.
    let fa = 1, ga = Math.log(l1);
    let fb = l1 > 1 ? Math.min(l1, 1.5) : Math.max(l1, 0.67);
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
