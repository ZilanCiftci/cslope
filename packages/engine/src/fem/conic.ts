/**
 * The programs of the limit analysis bounds (lower-bound.ts, upper-bound.ts)
 * as second-order cone programs, and their two solvers.
 *
 * A program has linear equalities, nonnegative and free variables, a linear
 * objective and three-dimensional second-order cones t ≥ ‖(u₁, u₂)‖ on affine
 * expressions t, u₁, u₂ of the variables: in plane strain the Mohr–Coulomb
 * criterion is such a cone in the stresses and its flow rule one in the
 * strain rates (Makrodimopoulos & Martin 2006, IJNME 66(4), 604–634, and
 * 2007, IJNAMG 31(6), 835–865; Krabbenhøft, Lyamin & Sloan 2007, Int. J.
 * Solids Struct. 44(5), 1533–1549).
 *
 * - Clarabel (Goulart & Chen 2024, arXiv:2405.12762), an interior point
 *   method for conic programs, solves the cones exactly; it is built for
 *   WebAssembly from Rust (packages/engine/clarabel). The variables are
 *   scaled by `scale` (their expected magnitude) and the objective by its
 *   largest coefficient before solving: the solver's tolerances are
 *   absolute, and in imperial units (γ = 120 pcf, c = 600 psf) the
 *   unscaled programs reported "solved" at a wrong optimum (a prototype on
 *   V046a gave 0.864 for both bounds against 1.32–1.34 scaled).
 * - HiGHS solves the linear program in which each cone is replaced by the
 *   polygon inscribed in it with p sides (Sloan 1988; Sloan & Kleeman 1995):
 *   "facets" by its p sides (u·n_j ≤ t cos(π/p), normals at 2πj/p: the
 *   lower bound's yield polygon inscribed in the circle), "vertices" by p
 *   multipliers λ_j ≥ 0 with t = Σλ_j and u = Σλ_j (cos 2πj/p, sin 2πj/p)
 *   (the upper bound's flow rule on the polygon circumscribing the
 *   criterion). Either polygon lies inside the cone, so the bound stays a
 *   bound.
 */

export interface Affine {
  cols: number[];
  vals: number[];
  /** Constant term. */
  c: number;
}

export interface ConicProgram {
  /** Column names (for the LP text and the solution by name). */
  names: string[];
  /** Nonnegative columns (the others are free). */
  nonneg: Uint8Array;
  /** Expected magnitude of each column (scaling for Clarabel); 1 by default. */
  scale: Float64Array;
  sense: "min" | "max";
  /** Objective coefficients by column. */
  objective: Float64Array;
  /** Equalities Σ vals·x[cols] = rhs. */
  eqCols: number[][];
  eqVals: number[][];
  eqRhs: number[];
  /** Cones (t, u₁, u₂): t ≥ ‖(u₁, u₂)‖, with their polygon for HiGHS. */
  cones: { t: Affine; u1: Affine; u2: Affine; polygon: "facets" | "vertices" }[];
}

/** Build a program: columns by name, equalities, cones. */
export class ProgramBuilder {
  names: string[] = [];
  private nonnegList: number[] = [];
  private scaleList: number[] = [];
  private index = new Map<string, number>();
  objective = new Map<number, number>();
  eqCols: number[][] = [];
  eqVals: number[][] = [];
  eqRhs: number[] = [];
  cones: ConicProgram["cones"] = [];
  sense: "min" | "max" = "min";

  /** The column of `name`, added (free, or nonnegative) on first use. */
  col(name: string, nonneg = false, scale = 1): number {
    let j = this.index.get(name);
    if (j === undefined) {
      j = this.names.length;
      this.names.push(name);
      this.nonnegList.push(nonneg ? 1 : 0);
      this.scaleList.push(scale);
      this.index.set(name, j);
    }
    return j;
  }

  has(name: string): boolean {
    return this.index.has(name);
  }

  /** Σ terms = rhs (terms as [column, coefficient], zero coefficients dropped). */
  eq(terms: [number, number][], rhs = 0): number {
    const cols: number[] = [], vals: number[] = [];
    for (const [j, a] of terms) if (a !== 0) { cols.push(j); vals.push(a); }
    this.eqCols.push(cols); this.eqVals.push(vals); this.eqRhs.push(rhs);
    return this.eqRhs.length - 1;
  }

  cone(t: Affine, u1: Affine, u2: Affine, polygon: "facets" | "vertices"): void {
    this.cones.push({ t, u1, u2, polygon });
  }

  addObjective(j: number, a: number): void {
    if (a !== 0) this.objective.set(j, (this.objective.get(j) ?? 0) + a);
  }

  build(): ConicProgram {
    const n = this.names.length;
    const objective = new Float64Array(n);
    for (const [j, a] of this.objective) objective[j] = a;
    return {
      names: this.names, nonneg: Uint8Array.from(this.nonnegList), scale: Float64Array.from(this.scaleList),
      sense: this.sense, objective, eqCols: this.eqCols, eqVals: this.eqVals, eqRhs: this.eqRhs, cones: this.cones,
    };
  }
}

/** An affine expression from terms and a constant (zero coefficients dropped). */
export function affine(terms: [number, number][], c = 0): Affine {
  const cols: number[] = [], vals: number[] = [];
  for (const [j, a] of terms) if (a !== 0) { cols.push(j); vals.push(a); }
  return { cols, vals, c };
}

export type ConicStatus = "optimal" | "infeasible" | "unbounded" | "time-limit" | "failed";

export interface ConicSolution {
  status: ConicStatus;
  /** The solver's own status text. */
  detail: string;
  objective: number;
  x: Float64Array;
  /** Clarabel's dual variables of the scaled rows (equalities, nonnegative columns, cones), for diagnosis. */
  z?: Float64Array;
}

// ── HiGHS: the linear program on the polygons ─────────────────────

const fmt = (a: number) => (a === 0 ? "0" : a.toPrecision(15));
const term = (a: number, name: string) => (a === 0 ? "" : ` ${a < 0 ? "-" : "+"} ${fmt(Math.abs(a))} ${name}`);

/** The program as an LP in CPLEX LP format, each cone replaced by its inscribed p-gon (see the header). */
export function toLpText(prog: ConicProgram, sides: number): string {
  const { names } = prog;
  const out: string[] = [prog.sense === "max" ? "Maximize" : "Minimize"];
  let obj = " obj:";
  for (let j = 0; j < names.length; j++) obj += term(prog.objective[j], names[j]);
  out.push(obj === " obj:" ? ` obj: 0 ${names[0]}` : obj, "Subject To");
  let r = 0;
  const lin = (cols: number[], vals: number[]) => { let s = ""; for (let i = 0; i < cols.length; i++) s += term(vals[i], names[cols[i]]); return s; };
  for (let i = 0; i < prog.eqRhs.length; i++) {
    const s = lin(prog.eqCols[i], prog.eqVals[i]);
    if (s) out.push(` r${r++}:${s} = ${fmt(prog.eqRhs[i])}`);
  }
  const cp = Math.cos(Math.PI / sides);
  const extra: string[] = [];
  prog.cones.forEach((k, q) => {
    if (k.polygon === "facets") {
      for (let j = 0; j < sides; j++) {
        const th = (2 * Math.PI * j) / sides, ct = Math.cos(th), st = Math.sin(th);
        // ct u1 + st u2 − cp t ≤ 0, constants to the right
        const coef = new Map<number, number>();
        const add = (a: Affine, w: number) => { for (let i = 0; i < a.cols.length; i++) coef.set(a.cols[i], (coef.get(a.cols[i]) ?? 0) + w * a.vals[i]); };
        add(k.u1, ct); add(k.u2, st); add(k.t, -cp);
        let s = "";
        for (const [jj, a] of coef) s += term(a, names[jj]);
        const rhs = -(ct * k.u1.c + st * k.u2.c - cp * k.t.c);
        if (s) out.push(` r${r++}:${s} <= ${fmt(rhs)}`);
      }
    } else {
      // t = Σ λ_j, u = Σ λ_j (cos θ_j, sin θ_j), λ_j ≥ 0
      const lam = Array.from({ length: sides }, (_, j) => `k${q}_${j}`);
      extra.push(...lam);
      const rows: [Affine, (j: number) => number][] = [[k.t, () => 1], [k.u1, (j) => Math.cos((2 * Math.PI * j) / sides)], [k.u2, (j) => Math.sin((2 * Math.PI * j) / sides)]];
      for (const [a, w] of rows) {
        let s = lin(a.cols, a.vals);
        for (let j = 0; j < sides; j++) s += term(-w(j), lam[j]);
        out.push(` r${r++}:${s} = ${fmt(-a.c)}`);
      }
    }
  });
  out.push("Bounds");
  for (let j = 0; j < names.length; j++) if (!prog.nonneg[j]) out.push(` ${names[j]} free`);
  out.push("End");
  return out.join("\n");
}

/** HiGHS as loaded by highs-js (the subset used here). */
export interface HighsSolver {
  solve(lp: string, options?: Record<string, unknown>): {
    Status: string;
    ObjectiveValue: number;
    Columns?: Record<string, { Primal: number }>;
  };
}

/** Solve the polygon LP by HiGHS: interior point, simplex as the fallback. */
export function solveHighs(prog: ConicProgram, highs: HighsSolver, sides: number, timeLimit: number): ConicSolution {
  const lp = toLpText(prog, sides);
  let r = highs.solve(lp, { solver: "ipm", time_limit: timeLimit });
  // Interior point (with presolve and crossover) is about four times faster
  // than simplex on these programs (measured on V077); without presolve it
  // can misreport the status, so simplex is the fallback.
  if (r.Status !== "Optimal" && r.Status !== "Infeasible" && r.Status !== "Unbounded" && r.Status !== "Time limit reached") {
    r = highs.solve(lp, { solver: "simplex", time_limit: timeLimit });
  }
  const x = new Float64Array(prog.names.length);
  if (r.Columns) for (let j = 0; j < x.length; j++) x[j] = r.Columns[prog.names[j]]?.Primal ?? 0;
  const status: ConicStatus = r.Status === "Optimal" ? "optimal" : r.Status === "Infeasible" ? "infeasible" : r.Status === "Unbounded" ? "unbounded" : r.Status === "Time limit reached" ? "time-limit" : "failed";
  return { status, detail: r.Status, objective: r.ObjectiveValue, x };
}

// ── Clarabel: the cones exactly ─────────────────────────────────

interface ClarabelExports {
  memory: WebAssembly.Memory;
  alloc_f64(n: number): number;
  alloc_u32(n: number): number;
  free_f64(p: number, n: number): void;
  free_u32(p: number, n: number): void;
  solve(
    n: number, m: number, q: number, colptr: number, rowval: number, nzval: number, nnz: number,
    b: number, cones: number, ncones: number, maxIter: number, timeLimit: number, staticReg: number, out: number,
  ): number;
}

export interface ClarabelSolver {
  exports: ClarabelExports;
}

let clarabelPromise: Promise<ClarabelSolver> | null = null;

/**
 * Load the Clarabel module on first use: from `wasmBinary` (the app, which
 * cannot fetch a file), else from clarabel.wasm beside this file (Node, Bun).
 */
export function loadClarabel(wasmBinary?: ArrayBuffer): Promise<ClarabelSolver> {
  clarabelPromise ??= (async () => {
    let bin = wasmBinary;
    if (!bin) {
      const fs = "node:fs/promises";
      const { readFile } = (await import(/* @vite-ignore */ fs)) as { readFile(url: URL): Promise<Uint8Array> };
      // (a variable, so that a bundler does not emit the file: an app passes the binary)
      const file = "./clarabel.wasm";
      const buf = await readFile(new URL(file, import.meta.url));
      bin = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    }
    const mod = await WebAssembly.compile(bin);
    // The Rust build links wasm-bindgen's clock (web-time) for Clarabel's time
    // limit: `now` reads performance.now(); the other imports are never used.
    const imports: Record<string, Record<string, (...a: unknown[]) => unknown>> = {};
    for (const i of WebAssembly.Module.imports(mod)) {
      imports[i.module] ??= {};
      imports[i.module][i.name] = i.name.includes("_now_") ? () => performance.now() : () => 0;
    }
    const inst = await WebAssembly.instantiate(mod, imports as WebAssembly.Imports);
    return { exports: inst.exports as unknown as ClarabelExports };
  })().catch((err: unknown) => {
    clarabelPromise = null;
    throw err;
  });
  return clarabelPromise;
}

// Clarabel's SolverStatus (clarabel 0.11, src/solver/core/solver.rs)
const CLARABEL_STATUS = [
  "Unsolved", "Solved", "PrimalInfeasible", "DualInfeasible", "AlmostSolved", "AlmostPrimalInfeasible",
  "AlmostDualInfeasible", "MaxIterations", "MaxTime", "NumericalError", "InsufficientProgress", "CallbackTerminated",
];

/** Solve the program by Clarabel, scaled (see the header). */
export function solveClarabel(prog: ConicProgram, solver: ClarabelSolver, timeLimit: number): ConicSolution {
  const ex = solver.exports;
  const n = prog.names.length, s = prog.scale;
  // objective, minimised, in scaled columns
  const sign = prog.sense === "max" ? -1 : 1;
  let qMax = 0;
  for (let j = 0; j < n; j++) qMax = Math.max(qMax, Math.abs(prog.objective[j] * s[j]));
  const qs = qMax > 0 ? qMax : 1;
  // rows: equalities (zero cone), nonnegative columns, cones (3 rows each); s = b − A x
  const rowsOf: number[][] = Array.from({ length: n }, () => []), valsOf: number[][] = Array.from({ length: n }, () => []);
  const b: number[] = [];
  let m = 0;
  const neq = prog.eqRhs.length;
  for (let i = 0; i < neq; i++) {
    const cols = prog.eqCols[i], vals = prog.eqVals[i];
    // each equality divided by its largest scaled coefficient
    let rmax = 0;
    for (let k = 0; k < cols.length; k++) rmax = Math.max(rmax, Math.abs(vals[k] * s[cols[k]]));
    const w = rmax > 0 ? 1 / rmax : 1;
    for (let k = 0; k < cols.length; k++) { rowsOf[cols[k]].push(m); valsOf[cols[k]].push(vals[k] * s[cols[k]] * w); }
    b.push(prog.eqRhs[i] * w);
    m++;
  }
  let nn = 0;
  for (let j = 0; j < n; j++) if (prog.nonneg[j]) { rowsOf[j].push(m); valsOf[j].push(-1); b.push(0); m++; nn++; }
  for (const k of prog.cones) {
    // the cone scaled as a whole by its largest coefficient
    let cmax = 0;
    for (const a of [k.t, k.u1, k.u2]) { cmax = Math.max(cmax, Math.abs(a.c)); for (let i = 0; i < a.cols.length; i++) cmax = Math.max(cmax, Math.abs(a.vals[i] * s[a.cols[i]])); }
    const w = cmax > 0 ? 1 / cmax : 1;
    for (const a of [k.t, k.u1, k.u2]) {
      for (let i = 0; i < a.cols.length; i++) { rowsOf[a.cols[i]].push(m); valsOf[a.cols[i]].push(-a.vals[i] * s[a.cols[i]] * w); }
      b.push(a.c * w);
      m++;
    }
  }
  // compressed sparse columns (rows ascending within a column)
  const colptr = new Uint32Array(n + 1);
  let nnz = 0;
  for (let j = 0; j < n; j++) { colptr[j] = nnz; nnz += rowsOf[j].length; }
  colptr[n] = nnz;
  const rowval = new Uint32Array(nnz), nzval = new Float64Array(nnz);
  for (let j = 0; j < n; j++) {
    const order = rowsOf[j].map((_, i) => i).sort((p, q) => rowsOf[j][p] - rowsOf[j][q]);
    let at = colptr[j];
    for (const i of order) { rowval[at] = rowsOf[j][i]; nzval[at] = valsOf[j][i]; at++; }
  }
  const q = new Float64Array(n);
  for (let j = 0; j < n; j++) q[j] = (sign * prog.objective[j] * s[j]) / qs;
  const coneList: number[] = [];
  if (neq) coneList.push(0, neq);
  if (nn) coneList.push(1, nn);
  for (let i = 0; i < prog.cones.length; i++) coneList.push(2, 3);

  const ptrs: [number, number, "f" | "u"][] = [];
  const putF = (a: ArrayLike<number>) => { const p = ex.alloc_f64(Math.max(1, a.length)); new Float64Array(ex.memory.buffer, p, a.length).set(a); ptrs.push([p, Math.max(1, a.length), "f"]); return p; };
  const putU = (a: ArrayLike<number>) => { const p = ex.alloc_u32(Math.max(1, a.length)); new Uint32Array(ex.memory.buffer, p, a.length).set(a); ptrs.push([p, Math.max(1, a.length), "u"]); return p; };
  try {
    const pq = putF(q), pc = putU(colptr), pr = putU(rowval), pv = putF(nzval), pb = putF(b), pk = putU(coneList);
    const po = putF(new Float64Array(n + 2 + m));
    const limit = Number.isFinite(timeLimit) ? Math.max(0.1, timeLimit) : 0;
    let code = ex.solve(n, m, pq, pc, pr, pv, nnz, pb, pk, coneList.length / 2, 400, limit, 1e-8, po);
    // A numerical failure is solved again with more static regularisation
    // (Clarabel's default 1e-8; 1e-6 solved V067's lower bound, whose rigid
    // elements leave free stresses, where 1e-8 ended in NumericalError).
    if (code === 9 || code === 10) code = ex.solve(n, m, pq, pc, pr, pv, nnz, pb, pk, coneList.length / 2, 400, limit, 1e-6, po);
    const o = new Float64Array(ex.memory.buffer, po, n + 2 + m);
    const x = new Float64Array(n);
    for (let j = 0; j < n; j++) x[j] = o[j] * s[j];
    const detail = code === 99 ? "SetupError" : CLARABEL_STATUS[code] ?? `status ${code}`;
    const status: ConicStatus =
      detail === "Solved" || detail === "AlmostSolved" ? "optimal"
        : detail === "PrimalInfeasible" || detail === "AlmostPrimalInfeasible" ? "infeasible"
          : detail === "DualInfeasible" || detail === "AlmostDualInfeasible" ? "unbounded"
            : detail === "MaxTime" ? "time-limit" : "failed";
    return { status, detail, objective: sign * o[n] * qs, x, z: Float64Array.from(o.subarray(n + 2)) };
  } finally {
    for (const [p, len, kind] of ptrs) { if (kind === "f") ex.free_f64(p, len); else ex.free_u32(p, len); }
  }
}
