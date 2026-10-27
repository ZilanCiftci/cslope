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
 * it (Sloan 1988, eq. 13), so that the stress field is admissible and the
 * load factor a strict lower bound for the mesh. Stresses are effective,
 * tension positive; σ = σ′ − u m.
 *
 * The linear program maximises a load factor λ on every load (weight, pore
 * pressure and surface loads). The factor of safety on strength is the
 * reduction F at which λ(F) = 1: for φ = 0 everywhere λ(F) = λ(1)/F, so
 * F = λ(1) from one program; otherwise F is found by the secant method on
 * log λ (Kim, Salgado & Lee 2002, fig. 3, iterate on the reference load).
 */

import { WATER_UNIT_WEIGHT } from "../types/constants";
import type { Slope } from "../model/slope";
import { needsLayerTop } from "../types/strength";
import { buildFeModel, polylineY, type FeModelOptions } from "./model";

export interface LowerBoundOptions extends FeModelOptions {
  /** Sides of the inscribed yield polygon; default 24. */
  sides?: number;
  /** Rankine tension cut-off σ₁′ ≤ 0; default false. */
  tensionCutoff?: boolean;
  /** Tolerance on F; default 0.002. */
  fTolerance?: number;
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

let highsPromise: Promise<Highs> | null = null;
/** Load HiGHS (WebAssembly) on first use. */
export function loadHighs(locateFile?: (file: string) => string): Promise<Highs> {
  highsPromise ??= import("highs").then((m) => {
    const loader = (m as unknown as { default: (o?: object) => Promise<Highs> }).default;
    return loader(locateFile ? { locateFile } : {});
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
}

/** Assemble the lower bound problem of a slope (the parts that do not depend on F). */
export function lowerBoundProblem(slope: Slope, options: LowerBoundOptions = {}): LbProblem {
  const model = buildFeModel(slope, options);
  const { x, y, el, elementCount: ne, materials, elMaterial, elElastic } = model;
  const p = options.sides ?? 24;
  const cutoff = options.tensionCutoff ?? false;
  const warnings: string[] = [];
  const surface = slope.surfaceLineXY ?? { x: [Math.min(...x), Math.max(...x)], y: [Math.max(...y), Math.max(...y)] };
  const waterLines = materials.map((m) => slope.getWaterLineForMaterial(m));
  if (slope.lineLoads.length) warnings.push("Line loads are not included in the lower bound analysis.");

  // Nodal data per element corner: pore pressure and strength.
  const nU = new Float64Array(3 * ne);
  const nC = new Float64Array(3 * ne);
  const nPhi = new Float64Array(3 * ne);
  let allUndrained = true;
  for (let e = 0; e < ne; e++) {
    const m = materials[elMaterial[e]], wl = waterLines[elMaterial[e]];
    for (let k = 0; k < 3; k++) {
      const n = el[6 * e + k], i = 3 * e + k;
      if (wl) {
        const yw = polylineY(wl, x[n]);
        nU[i] = Number.isFinite(yw) ? Math.max(0, WATER_UNIT_WEIGHT * (yw - y[n])) : 0;
      }
      if (elElastic[e]) continue;
      // Strength just inside the element (a node on a boundary takes this element's material).
      const cx = (x[el[6 * e]] + x[el[6 * e + 1]] + x[el[6 * e + 2]]) / 3, cy = (y[el[6 * e]] + y[el[6 * e + 1]] + y[el[6 * e + 2]]) / 3;
      const px = x[n] + 1e-6 * (cx - x[n]), py = y[n] + 1e-6 * (cy - y[n]);
      const yGround = polylineY(surface, px);
      const s = m.getStrength({ yBottom: py, x: px, yGround, alpha: 0, ...(needsLayerTop(m.model) ? { yLayerTop: yGround } : {}) });
      nC[i] = Math.max(0, s.cohesion);
      nPhi[i] = (s.frictionAngle * Math.PI) / 180;
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
    const n = [el[6 * e], el[6 * e + 1], el[6 * e + 2]];
    const b = [y[n[1]] - y[n[2]], y[n[2]] - y[n[0]], y[n[0]] - y[n[1]]];
    const c = [x[n[2]] - x[n[1]], x[n[0]] - x[n[2]], x[n[1]] - x[n[0]]];
    const area2 = b[0] * c[1] - b[1] * c[0];
    const gamma = materials[elMaterial[e]].unitWeight;
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
  const nc = model.cornerCount;
  const edgeOwner = new Map<number, [number, number]>();
  const surfaceSet = new Set<number>();
  for (let s = 0; s < model.surfaceEdges.length; s += 3) {
    const a = model.surfaceEdges[s], b = model.surfaceEdges[s + 2];
    surfaceSet.add(a < b ? a * nc + b : b * nc + a);
  }
  for (let e = 0; e < ne; e++) {
    for (let k = 0; k < 3; k++) {
      const a = el[6 * e + k], b = el[6 * e + ((k + 1) % 3)];
      const key = a < b ? a * nc + b : b * nc + a;
      const len = Math.hypot(x[b] - x[a], y[b] - y[a]);
      const nx = (y[b] - y[a]) / len, ny = -(x[b] - x[a]) / len; // outward for this element
      const snRow = (ee: number, kk: number) => term(nx * nx, v(ee, kk, 0)) + term(ny * ny, v(ee, kk, 1)) + term(2 * nx * ny, v(ee, kk, 2));
      const tRow = (ee: number, kk: number) => term(-nx * ny, v(ee, kk, 0)) + term(nx * ny, v(ee, kk, 1)) + term(nx * nx - ny * ny, v(ee, kk, 2));
      const other = edgeOwner.get(key);
      if (other) {
        // continuity of total normal and shear traction at both ends
        const [e2, k2] = other;
        const a2 = el[6 * e2 + k2];
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
  // Remaining edges are on the boundary; on the ground surface the traction is prescribed.
  for (const [key, [e, k]] of edgeOwner) {
    if (!surfaceSet.has(key)) continue;
    const a = el[6 * e + k], b = el[6 * e + ((k + 1) % 3)];
    const len = Math.hypot(x[b] - x[a], y[b] - y[a]);
    const nx = (y[b] - y[a]) / len, ny = -(x[b] - x[a]) / len;
    for (const [kk, node] of [[k, a], [(k + 1) % 3, b]] as [number, number][]) {
      // loads: ponded water (normal pressure) and strip loads (vertical, per horizontal metre)
      let pw = 0;
      if (slope.waterRLXY) {
        const yw = polylineY(slope.waterRLXY, x[node]);
        pw = Number.isFinite(yw) ? WATER_UNIT_WEIGHT * Math.max(0, yw - y[node]) : 0;
      }
      let q = 0;
      for (const udl of slope.udls) if (x[node] >= udl.x1 - 1e-9 && x[node] <= udl.x2 + 1e-9) q += udl.magnitude;
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
  for (let e = 0; e < ne; e++) if (!elElastic[e]) yieldCount += 3 * p * (cutoff ? 2 : 1);
  return {
    build: (F) => ["Maximize", " obj: lam", "Subject To", fixedText, yieldRows(F).join("\n"), boundsText, "End"].join("\n"),
    allUndrained,
    elements: ne,
    variables: nVars,
    constraints: fixedRows + yieldCount,
    warnings,
  };
}

/** Lower bound on the factor of safety of a slope. */
export async function lowerBound(slope: Slope, options: LowerBoundOptions = {}, highs?: Highs): Promise<LowerBoundResult> {
  const solver = highs ?? (await loadHighs());
  const prob = lowerBoundProblem(slope, options);
  const trials: LowerBoundResult["trials"] = [];
  const warnings = [...prob.warnings];
  const lambdaAt = (F: number): number => {
    const t0 = performance.now();
    // Interior point (with presolve and crossover) is about four times faster
    // than simplex on these programs (measured on V077); without presolve it
    // can misreport the status, so simplex is the fallback.
    const lp = prob.build(F);
    let r = solver.solve(lp, { solver: "ipm" });
    if (r.Status !== "Optimal") r = solver.solve(lp, { solver: "simplex" });
    const lambda = r.Status === "Optimal" ? r.ObjectiveValue : r.Status === "Unbounded" ? Infinity : 0;
    if (r.Status !== "Optimal") warnings.push(`The linear program at F = ${F.toFixed(3)} ended with status "${r.Status}".`);
    trials.push({ F, lambda, seconds: (performance.now() - t0) / 1000 });
    return lambda;
  };
  const tol = options.fTolerance ?? 0.002;
  let F: number;
  const l1 = lambdaAt(1);
  if (!(l1 > 0) || !Number.isFinite(l1)) {
    return { factorOfSafety: NaN, trials, elements: prob.elements, variables: prob.variables, constraints: prob.constraints, warnings: [...warnings, "The linear program has no admissible stress field."] };
  }
  if (prob.allUndrained) F = l1;
  else {
    // secant on g(F) = log λ(F), g decreasing, root where λ = 1
    let fa = 1, ga = Math.log(l1);
    let fb = l1 > 1 ? Math.min(l1, 1.5) : Math.max(l1, 0.67), gb = Math.log(lambdaAt(fb));
    F = fb;
    for (let it = 0; it < 15; it++) {
      if (Math.abs(gb - ga) < 1e-14) break;
      const fn = fb - (gb * (fb - fa)) / (gb - ga);
      F = Math.max(0.05, fn);
      if (Math.abs(F - fb) < tol) break;
      fa = fb; ga = gb;
      fb = F; gb = Math.log(lambdaAt(fb));
    }
  }
  return { factorOfSafety: F, trials, elements: prob.elements, variables: prob.variables, constraints: prob.constraints, warnings };
}
