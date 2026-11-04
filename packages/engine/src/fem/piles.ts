/**
 * Pile rows in the strength reduction: an embedded beam row.
 *
 * Method: each pile is a line of two-node Euler–Bernoulli frame elements
 * (axial and bending stiffness per metre of slope, EA/s and EI/s for piles
 * at spacing s) on beam nodes with a rotation, placed at the soil nodes
 * along the pile (the mesh has the pile as a constraint line). Each beam
 * node is joined to its soil node by a lateral and an axial spring,
 * elastic–perfectly plastic, so that the soil can flow between the piles
 * (the embedded beam row: Sluis, Besseling & Stuurwold 2014, Numerical
 * Methods in Geotechnical Engineering, 431–436; the pile–soil springs of
 * the p–y method). The springs are bars of bars.ts that act in both
 * directions.
 *
 * Limits per pile and metre of pile, reduced with the soil's strength
 * (c/F, tan φ/F):
 * - lateral: p_u = 9 c d + 3 (Kp − Ka) σ′v d, the ultimate lateral
 *   resistance of Broms (1964, J. Soil Mech. Found. Div. 90(SM2), 27–63,
 *   and (SM3), 123–156) for cohesive and cohesionless soil, summed for c–φ
 *   soil, with the net passive pressure Kp − Ka (implementation choice:
 *   Broms' 3 Kp would leave 3 σ′v d of support at φ = 0 and as F grows); a
 *   continuous wall (`wall`, or spacing ≤ width) lets no soil through and
 *   its lateral springs do not yield;
 * - axial: skin friction t = π d (c + K0 σ′v tan φ), K0 = 1 − sin φ (two
 *   faces per metre of a wall).
 *
 * Implementation choices (not from the literature): the springs' stiffness
 * is 10 times the soil's Young's modulus per metre of tributary length
 * (stiff against the soil, soft enough for the conditioning); σ′v is the
 * unit weight of the soil at the node times its depth below the ground less
 * the pore pressure; the strength is that of the first element at the node
 * (rigid material: no yield); EI and EA of a solid circular section of
 * concrete (E = 30 GPa) unless given (for a wall a plate of thickness d per
 * metre); the piles stay elastic, their largest
 * moment and shear compared with the capacities afterwards; piles without a
 * diameter (a given force only) are left out.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import { testCall } from "../facade/internal";

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

/** Capacity of a pile spring at reduction F (kind 1 lateral, 2 axial). */
export function springCapacity(kind: number, capC: number, capSv: number, tanPhi: number, F: number): number {
  return testCall("fem/piles::springCapacity", [kind, capC, capSv, tanPhi, F]);
}

/** Global stiffness (6 × 6, dofs u1 v1 θ1 u2 v2 θ2) of a frame element into `k`. */
export function frameStiffness(c: number, s: number, L: number, EA: number, EI: number, k: Float64Array): void {
  k.set(testCall<Float64Array>("fem/piles::frameStiffness", [c, s, L, EA, EI]));
}
