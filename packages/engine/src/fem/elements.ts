/**
 * Six-node (quadratic) triangles in plane strain.
 *
 * Implemented in packages/engine-rs/crates/cslope-engine/src/fem/elements.rs,
 * where the method, its sources and the implementation choices are
 * documented; called through WebAssembly (facade/internal.ts).
 */

/** Gauss points of the three-point rule: ξ, η and weight (reference area 1/2). */
export const GAUSS_T6: readonly (readonly [number, number, number])[] = [
  [1 / 6, 1 / 6, 1 / 6],
  [2 / 3, 1 / 6, 1 / 6],
  [1 / 6, 2 / 3, 1 / 6],
];

/** Per Gauss point record: dN/dx (6), dN/dy (6), weight × det J. */
export const GP_STRIDE = 13;
