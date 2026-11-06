/**
 * Pile rows in the strength reduction: an embedded beam row.
 *
 * Implemented in packages/engine-rs/crates/cslope-engine/src/fem/piles.rs,
 * where the method, its sources and the implementation choices are
 * documented; called through WebAssembly (facade/internal.ts).
 */

/** Young's modulus of a pile without given stiffness (kPa): concrete. */
export const PILE_DEFAULT_E = 3e7;
/** Capacity of a spring that does not yield (kN). */
export const NO_YIELD = 1e12;

export interface FePiles {
  /** Beam elements: two global nodes each. */
  count: number;
  nodes: Int32Array;
  /** Per beam: direction cosines, length, EA and EI per metre of slope, source pile. */
  c: Float64Array;
  s: Float64Array;
  length: Float64Array;
  ea: Float64Array;
  ei: Float64Array;
  source: Int32Array;
  /** Rotation equation of each global node (−1: none, a soil node or fixed). */
  rotEq: Int32Array;
}

/** Spring bars to append to the reinforcement bars (bars.ts layout). */
export interface PileSprings {
  nodes: number[];
  gp: number[];
  stiffness: number[];
  /** Per Gauss point: capacity kind (1 lateral, 2 axial; 0 fixed) and its terms. */
  kind: number[];
  capC: number[];
  capSv: number[];
  capTan: number[];
  fixedCap: number[];
}

export const EMPTY_PILES: FePiles = {
  count: 0, nodes: new Int32Array(0), c: new Float64Array(0), s: new Float64Array(0), length: new Float64Array(0),
  ea: new Float64Array(0), ei: new Float64Array(0), source: new Int32Array(0), rotEq: new Int32Array(0),
};
