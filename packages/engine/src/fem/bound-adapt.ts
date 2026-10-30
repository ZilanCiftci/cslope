/**
 * Mesh refinement on the gap between the lower and the upper bound of limit
 * analysis.
 *
 * Method and sources:
 * - For a statically admissible stress field σ (in equilibrium with λ_L
 *   times the loads, inside the yield polygon) and a kinematically
 *   admissible velocity field u (load power P(u) = 1, dissipation D(u) =
 *   λ_U) on the same mesh, the virtual work equation gives
 *   λ_U − λ_L = Σ_e [D_e(u) − ∫_e σ:ε̇(u) dA] + Σ_edges [D_edge(u) −
 *   ∫ t·[u] ds], every term non-negative (the stress lies inside the
 *   polygon whose support function is the dissipation): the bound gap
 *   splits into element contributions, which are refined where they are
 *   largest (Ciria, Peraire & Bonet 2008, IJNME 75(8), 899–944; Muñoz,
 *   Bonet, Huerta & Peraire 2009, IJNME 77(4), 471–501; Lyamin, Sloan,
 *   Krabbenhøft & Hjiaj 2005, IJNME 63(14), 1961–1974, with the
 *   dissipation alone).
 * - The bounds are those of lower-bound.ts and upper-bound.ts on the mesh
 *   of the strength reduction model; marking by Dörfler's bulk criterion
 *   (adapt.ts).
 *
 * Implementation choices (not from the literature): the gap is split at
 * the upper bound's F (where λ_U ≤ 1 and λ_L < 1, both finite with
 * cohesion); an edge's contribution goes half to each element beside it,
 * a base edge's to its element; the lower bound's sub-elements (split at
 * traction boundaries, fans at corners) count in the element they lie in.
 * With a water table the two programs' terms for the saturated weight and
 * the pore pressure are not identical element by element (the lower
 * bound's sub-elements), and the contributions sum to the gap to about 1 %. Where the lower bound program has no finite optimum (a cohesionless
 * soil makes λ 0 or unbounded) the dissipation alone is the indicator.
 * The loop stops when the gap is below `gapTolerance` of the mean bound or
 * after `levels` refinements; each level's searches start from the last
 * level's bounds. θ = 0.6: on V013a (from 226 elements) three levels to
 * 620 elements bracket F in 1.124–1.213 (gap 7.6 %, 80 s), where a
 * uniform mesh of 1120 elements gives 1.120–1.247 (10.7 %, 133 s); θ = 0.3
 * refined too little (344 elements after three levels, gap 11 %). The meshes are not nested,
 * so a bound can be worse on a finer one: the best of the levels is kept.
 * Speed (implementation choices): the levels before the last search to a
 * tolerance of 0.02 on F (COARSE_TOLERANCE), the last to `fTolerance`;
 * each level's searches start at the last level's bounds; elements are not
 * refined below a quarter of the first mesh's smallest size
 * (MIN_SIZE_RATIO). Measured on V013a: three levels 80 s against 110 s
 * before, the same bounds; four levels 122 s against 473 s, 1.125–1.214
 * against 1.129–1.197 (without the size limit the fourth level refined
 * the toe to 1156 elements, whose programs took 316 s). These times are
 * HiGHS's on the polygon LPs; with Clarabel on the cones (conic.ts) three
 * levels on V013a's default mesh, 1366 to 2859 elements, take 56 s and
 * give 1.135–1.177.
 */

import { frictionalSurfaceSlide, surfaceSlideMessage } from "../model/surface-slide";
import type { Slope } from "../model/slope";
import { buildFeModel } from "./model";
import { dorflerMark, refinedSizeField } from "./adapt";
import { boundSolver, lowerBound, lowerBoundProblem, type HighsModuleOptions, type LowerBoundOptions } from "./lower-bound";
import { upperBound, upperBoundProblem, type UpperBoundOptions } from "./upper-bound";
import type { HighsSolver } from "./conic";

type Solve = Awaited<ReturnType<typeof boundSolver>>;

/** Tolerance on F of the levels before the last (they only steer the mesh). */
const COARSE_TOLERANCE = 0.02;
/** The refinement does not make elements smaller than the first mesh's smallest over this. */
const MIN_SIZE_RATIO = 4;

export interface BoundGap {
  /** Contribution of each element of the model's mesh to λ_U − λ_L. */
  eta: Float64Array;
  /** λ of the two programs at F. */
  lambdaLower: number;
  lambdaUpper: number;
  /** Whether the stress field entered (otherwise eta is the dissipation alone). */
  withStress: boolean;
}

/**
 * The bound gap at the reduction F split per element of the mesh that
 * `buildFeModel(slope, options)` makes (see the header); null when the
 * upper bound program has no optimum at F.
 */
export function boundGapIndicator(slope: Slope, options: LowerBoundOptions & UpperBoundOptions, F: number, solve: Solve): BoundGap | null {
  const tl = options.timeLimit ?? 300;
  const ub = upperBoundProblem(slope, options);
  // without cohesion nothing dissipates at the bounds' F: no gap to split
  if (!ub.cohesive) return { eta: new Float64Array(ub.elements), lambdaLower: NaN, lambdaUpper: 0, withStress: false };
  const ru = solve(ub.program(F), ub.sides, tl);
  if (ru.status !== "optimal") return null;
  const cu = ru.x;
  const eta = ub.elementDissipation(F, cu);
  const { x, y, el } = ub.mesh;
  const ne = eta.length;
  const lb = lowerBoundProblem(slope, options);
  const rl = solve(lb.program(F), lb.sides, tl);
  if (rl.status !== "optimal") return { eta, lambdaLower: NaN, lambdaUpper: ru.objective, withStress: false };
  const cl = rl.x;
  const vel = (e: number, k: number): [number, number] => [cu[2 * (3 * e + k)], cu[2 * (3 * e + k) + 1]];

  // strain rate of each upper bound element (constant), engineering shear
  const rate = new Float64Array(3 * ne);
  for (let e = 0; e < ne; e++) {
    const n = [el[3 * e], el[3 * e + 1], el[3 * e + 2]];
    const b = [y[n[1]] - y[n[2]], y[n[2]] - y[n[0]], y[n[0]] - y[n[1]]];
    const c = [x[n[2]] - x[n[1]], x[n[0]] - x[n[2]], x[n[1]] - x[n[0]]];
    const a2 = b[0] * c[1] - b[1] * c[0];
    let ex = 0, ey = 0, g = 0;
    for (let k = 0; k < 3; k++) {
      const [u, v] = vel(e, k);
      ex += b[k] * u; ey += c[k] * v; g += c[k] * u + b[k] * v;
    }
    rate[3 * e] = ex / a2; rate[3 * e + 1] = ey / a2; rate[3 * e + 2] = g / a2;
  }

  // ∫ σ:ε̇ over each element, from the lower bound's sub-elements in it
  const { x: lx, y: ly, el: lel, parent } = lb.mesh;
  const sig = (t: number, k: number, comp: number) => cl[9 * t + 3 * k + comp];
  const nt = parent.length;
  // the sub-element and its corner at each end of a model edge (a, b) on the side of element e
  const sideOf = new Map<string, [number, number, number]>();
  const nModel = x.length;
  for (let t = 0; t < nt; t++) {
    const e = parent[t];
    const n = [lel[3 * t], lel[3 * t + 1], lel[3 * t + 2]];
    const a2 = (lx[n[1]] - lx[n[0]]) * (ly[n[2]] - ly[n[0]]) - (lx[n[2]] - lx[n[0]]) * (ly[n[1]] - ly[n[0]]);
    const area = Math.abs(a2) / 2;
    let w = 0;
    for (let k = 0; k < 3; k++) w += sig(t, k, 0) * rate[3 * e] + sig(t, k, 1) * rate[3 * e + 1] + sig(t, k, 2) * rate[3 * e + 2];
    eta[e] -= (area * w) / 3;
    for (let k = 0; k < 3; k++) {
      const a = n[k], b = n[(k + 1) % 3];
      if (a < nModel && b < nModel) sideOf.set(`${e}:${a}:${b}`, [t, k, (k + 1) % 3]);
    }
  }

  // ∫ t·[u] over the edges, t = σn outward of e, [u] = u(other side) − u(e)
  const nc = nModel;
  const key = (a: number, b: number) => (a < b ? a * nc + b : b * nc + a);
  const owners = new Map<number, [number, number][]>();
  for (let e = 0; e < ne; e++) {
    for (let k = 0; k < 3; k++) {
      const kk = key(el[3 * e + k], el[3 * e + ((k + 1) % 3)]);
      const list = owners.get(kk) ?? [];
      list.push([e, k]);
      owners.set(kk, list);
    }
  }
  const surface = new Set<number>();
  const model = buildFeModel(slope, options);
  for (let s = 0; s < model.surfaceEdges.length; s += 3) surface.add(key(model.surfaceEdges[s], model.surfaceEdges[s + 2]));
  for (const [kk, list] of owners) {
    if (surface.has(kk)) continue;
    const [e, k] = list[0];
    const a = el[3 * e + k], b = el[3 * e + ((k + 1) % 3)];
    if (list.length === 1 && Math.abs(x[b] - x[a]) <= 1e-3 * Math.abs(y[b] - y[a])) continue; // smooth side
    const side = sideOf.get(`${e}:${a}:${b}`) ?? sideOf.get(`${e}:${b}:${a}`);
    if (!side) continue;
    const [t, ka0, kb0] = side;
    const ka = lel[3 * t + ka0] === a ? ka0 : kb0, kb = ka === ka0 ? kb0 : ka0;
    const L = Math.hypot(x[b] - x[a], y[b] - y[a]);
    // normal outward of e: away from its centroid
    let nx = (y[b] - y[a]) / L, ny = -(x[b] - x[a]) / L;
    const cx = (x[el[3 * e]] + x[el[3 * e + 1]] + x[el[3 * e + 2]]) / 3, cy = (y[el[3 * e]] + y[el[3 * e + 1]] + y[el[3 * e + 2]]) / 3;
    if (nx * ((x[a] + x[b]) / 2 - cx) + ny * ((y[a] + y[b]) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
    const trac = (kc: number): [number, number] => [sig(t, kc, 0) * nx + sig(t, kc, 2) * ny, sig(t, kc, 2) * nx + sig(t, kc, 1) * ny];
    const cornerOf = (ee: number, node: number) => { for (let q = 0; q < 3; q++) if (el[3 * ee + q] === node) return q; return -1; };
    const other = list.length > 1 ? list[1][0] : null;
    const jump = (node: number): [number, number] => {
      const [u, v] = vel(e, cornerOf(e, node));
      if (other === null) return [-u, -v];
      const [u2, v2] = vel(other, cornerOf(other, node));
      return [u2 - u, v2 - v];
    };
    const ta = trac(ka), tb = trac(kb), da = jump(a), db = jump(b);
    const dot = (p: [number, number], q: [number, number]) => p[0] * q[0] + p[1] * q[1];
    const work = (L / 6) * (2 * dot(ta, da) + dot(ta, db) + dot(tb, da) + 2 * dot(tb, db));
    if (other === null) eta[e] -= work;
    else { eta[e] -= work / 2; eta[other] -= work / 2; }
  }
  return { eta, lambdaLower: rl.objective, lambdaUpper: ru.objective, withStress: true };
}

export interface AdaptiveBoundsOptions extends LowerBoundOptions, UpperBoundOptions {
  /** Refinements at most; default 3. */
  levels?: number;
  /** Dörfler fraction of the gap marked per refinement; default 0.6. */
  theta?: number;
  /**
   * Time budget of the whole analysis, every level (s): each search and
   * linear program gets at most what is left of it, and a refinement is
   * not started when four times the last level's time is not left (the
   * gap's two programs and the searches on a larger mesh); default none.
   */
  refinementTimeLimit?: number;
  /** Stop when (upper − lower) / mean is below this; default 0.03. */
  gapTolerance?: number;
  /** Called after each level's bounds. */
  onLevel?: (level: AdaptiveBoundsLevel) => void;
}

export interface AdaptiveBoundsLevel {
  elements: number;
  lower: number;
  upper: number;
  seconds: number;
}

export interface AdaptiveBoundsResult {
  lower: number;
  upper: number;
  levels: AdaptiveBoundsLevel[];
  /** The size field of the last mesh. */
  sizeField: ((x: number, y: number) => number) & { min?: number };
  warnings: string[];
}

/** Lower and upper bounds on meshes refined where the bound gap lies (see the header). */
export async function adaptiveBounds(slope: Slope, options: AdaptiveBoundsOptions = {}, highs?: HighsSolver, module?: HighsModuleOptions): Promise<AdaptiveBoundsResult> {
  const solve = await boundSolver(options, highs, module);
  const levels = options.levels ?? 3, theta = options.theta ?? 0.6, tol = options.gapTolerance ?? 0.03;
  const start = performance.now();
  const budget = options.refinementTimeLimit ?? Infinity;
  const remaining = () => budget - (performance.now() - start) / 1000;
  // each search and program within what is left of the budget
  const limited = (o: AdaptiveBoundsOptions): AdaptiveBoundsOptions => ({
    ...o,
    totalTimeLimit: Math.min(o.totalTimeLimit ?? Infinity, Math.max(1, remaining())),
    timeLimit: Math.min(o.timeLimit ?? 300, Math.max(1, remaining())),
  });
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
  const warnings: string[] = [];
  const out: AdaptiveBoundsLevel[] = [];
  let opts: AdaptiveBoundsOptions = { ...options };
  let lower = NaN, upper = NaN;
  let sizeField: AdaptiveBoundsResult["sizeField"] = (opts.sizeField ?? (() => NaN)) as AdaptiveBoundsResult["sizeField"];
  // a face in frictional soil with a lower infinite-slope factor (not with seepage pore pressures)
  const slide = options.porePressure === "seepage" ? null : frictionalSurfaceSlide(slope);
  const result = () => {
    if (slide && slide.factorOfSafety < upper) warnings.push(surfaceSlideMessage(slide, upper));
    return { lower, upper, levels: out, sizeField, warnings };
  };
  // the smallest element size of the first mesh, a quarter of which bounds the refinement
  let h0 = Infinity;
  const coarseTol = Math.max(options.fTolerance ?? 0.002, COARSE_TOLERANCE);
  for (let level = 0; ; level++) {
    const t0 = performance.now();
    // the levels before the last steer the mesh: their searches to a coarser tolerance
    const levelOpts: AdaptiveBoundsOptions = level < levels ? { ...opts, fTolerance: coarseTol } : opts;
    // Each bound on its own: a failure of one (or of a refined mesh) keeps
    // what the other levels and bounds found.
    let ubF = NaN, lbF = NaN, elements = 0;
    try {
      const ubr = await upperBound(slope, limited({ ...levelOpts, startF: Number.isFinite(upper) && upper > 0 ? upper : opts.startF }), highs, module);
      for (const w of ubr.warnings) warnings.push(`Level ${level}, upper bound: ${w}`);
      ubF = ubr.factorOfSafety; elements = ubr.elements;
    } catch (err) {
      warnings.push(`Level ${level}, upper bound: ${message(err)}`);
    }
    try {
      const lbr = await lowerBound(slope, limited({ ...levelOpts, startF: Number.isFinite(lower) && lower > 0 ? lower : opts.startF }), highs, module);
      for (const w of lbr.warnings) warnings.push(`Level ${level}, lower bound: ${w}`);
      lbF = lbr.factorOfSafety; elements ||= lbr.elements;
    } catch (err) {
      warnings.push(`Level ${level}, lower bound: ${message(err)}`);
    }
    // the remeshed levels are not nested, and a bound on a finer mesh can
    // be worse: the best of the levels is kept
    if (Number.isFinite(ubF)) upper = Number.isFinite(upper) ? Math.min(upper, ubF) : ubF;
    if (Number.isFinite(lbF)) lower = Number.isFinite(lower) ? Math.max(lower, lbF) : lbF;
    out.push({ elements, lower: lbF, upper: ubF, seconds: (performance.now() - t0) / 1000 });
    options.onLevel?.(out[out.length - 1]);
    let model;
    try {
      model = buildFeModel(slope, opts);
    } catch (err) {
      warnings.push(`Level ${level}: ${message(err)}`);
      return result();
    }
    sizeField = model.sizeField;
    if (level === 0) {
      for (let e = 0; e < model.elementCount; e++) {
        const a = model.el[6 * e], b = model.el[6 * e + 1], c = model.el[6 * e + 2];
        h0 = Math.min(h0, model.sizeField((model.x[a] + model.x[b] + model.x[c]) / 3, (model.y[a] + model.y[b] + model.y[c]) / 3));
      }
    }
    const done = Number.isFinite(lower) && Number.isFinite(upper) && (upper - lower) <= tol * (upper + lower) / 2;
    if (done || level >= levels || !(ubF > 0) || !Number.isFinite(ubF)) return result();
    // the next level: the gap's two programs and the two searches on a
    // larger mesh, about four times this level's searches
    if (4 * out[out.length - 1].seconds > remaining()) {
      warnings.push(`The refinement stopped after ${level} of ${levels} levels at its time limit of ${options.refinementTimeLimit} s.`);
      return result();
    }
    let gap: BoundGap | null;
    try {
      gap = boundGapIndicator(slope, limited(opts), ubF, solve);
    } catch (err) {
      warnings.push(`Level ${level}, bound gap: ${message(err)}`);
      return result();
    }
    if (!gap) {
      warnings.push(`Level ${level}: the upper bound program at F = ${ubF.toFixed(3)} gave no mechanism to refine on.`);
      return result();
    }
    const eta = gap.eta.map((v) => Math.max(0, v));
    let total = 0;
    for (const v of eta) total += v;
    // a cohesionless soil dissipates nothing at the bounds' F (the
    // programs are homogeneous): there is no gap to refine on
    if (!(total > 0)) {
      warnings.push(`Level ${level}: the bound gap has no element contributions to refine on (no cohesion).`);
      return result();
    }
    if (!gap.withStress && level === 0) warnings.push("The lower bound program has no finite optimum at the upper bound's F: refined on the dissipation alone.");
    opts = { ...opts, sizeField: refinedSizeField(model, dorflerMark(eta, theta), Number.isFinite(h0) ? h0 / MIN_SIZE_RATIO : 0) };
  }
}
