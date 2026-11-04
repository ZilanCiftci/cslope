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
 * traction boundaries, fans at corners and loads' ends) count in the element they lie in.
 * With a water table the two programs' terms for the saturated weight and
 * the pore pressure are not identical element by element (the lower
 * bound's sub-elements, whose new nodes take the pore pressure there),
 * and the contributions sum to the gap to a few per cent (3.8 % on a
 * 10 m slope of 2.5 m elements, with the fans of elements at its corners). An
 * edge the lower bound bisected (its fans of elements, possibly more than
 * once) is integrated over its parts. Where the lower bound program has no finite optimum (a cohesionless
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
 * the toe to 1156 elements, whose programs took 316 s), with an LP solver
 * on polygons replacing the cones; with Clarabel on the cones (conic.ts)
 * three levels on V013a's default mesh, 1366 to 2859 elements, take 56 s
 * and give 1.135–1.177.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts and fem/_handles.ts).
 */
import { testCall, wasm } from "../facade/internal";
import type { LowerBoundOptions } from "./lower-bound";
import type { UpperBoundOptions } from "./upper-bound";
import type { Slope } from "../model/slope";
import { dataOptions, sizeFieldHandle, sizeFieldOf, slopeRef } from "../facade/fem/_handles";

export interface BoundGap {
  /** Contribution of each element of the model's mesh to λ_U − λ_L. */
  eta: Float64Array;
  /** λ of the two programs at F. */
  lambdaLower: number;
  lambdaUpper: number;
  /** Whether the stress field entered (otherwise eta is the dissipation alone). */
  withStress: boolean;
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

/** The bound gap per element at F; the programs are solved by the engine's Clarabel (TypeScript's `solve` argument, from boundSolver, is not needed). */
export function boundGapIndicator(slope: Slope, options: LowerBoundOptions & UpperBoundOptions, F: number, solve?: unknown): BoundGap | null {
  void solve;
  return testCall("fem/bound-adapt::boundGapIndicator", [slopeRef(slope), dataOptions(options), F, sizeFieldHandle(options.sizeField)]);
}

/** The bounds on meshes refined where their gap lies (`options.onLevel` is called after each level). */
export async function adaptiveBounds(slope: Slope, options: AdaptiveBoundsOptions = {}): Promise<AdaptiveBoundsResult> {
  const r = wasm().adaptive_bounds(slopeRef(slope), dataOptions(options), sizeFieldHandle(options.sizeField), options.onLevel) as Omit<AdaptiveBoundsResult, "sizeField"> & {
    sizeField: number;
  };
  return { ...r, sizeField: sizeFieldOf(r.sizeField) };
}
