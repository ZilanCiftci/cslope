/**
 * Data shared by the lower and upper bound limit analyses (lower-bound.ts,
 * upper-bound.ts): the strength, pore pressure and unit weight of the
 * strength reduction model (model.ts) at points of a limit analysis mesh,
 * and the line loads spread over the ground surface.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */

/** Centroids of the 16 sub-triangles of a 4 × 4 subdivision, in area coordinates (r, s). */
export const WEIGHT_POINTS: [number, number][] = [];
for (let i = 0; i < 4; i++) {
  for (let j = 0; i + j < 4; j++) {
    WEIGHT_POINTS.push([(i + 1 / 3) / 4, (j + 1 / 3) / 4]);
    if (i + j < 3) WEIGHT_POINTS.push([(i + 2 / 3) / 4, (j + 2 / 3) / 4]);
  }
}
