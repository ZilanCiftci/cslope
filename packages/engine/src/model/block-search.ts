/**
 * Block search: non-circular trial surfaces through block search objects.
 *
 * Each surface passes through one point of every object, the points
 * ordered by x as the base of the sliding block. From the two ends of the
 * base straight segments rise to the ground: the upslope (active) one at
 * the active angle, the downslope (passive) one at the passive angle. By
 * default these are the Coulomb wedge angles 45° + φ/2 and 45° − φ/2 of
 * the soil the segment cuts (Wright 1988, fig. 6; the block surfaces of
 * Edris & Wright 1987), otherwise drawn from the user's ranges, as
 * commercial block searches do. An object of one point is a fixed point,
 * of two a line (points uniform along it), of three or more a window
 * (points uniform within the polygon).
 *
 * `iterations` surfaces are drawn, then `refinedIterations` more around the
 * best ones in neighbourhoods that shrink level by level (each new point
 * within a fraction of its object's size of the old one). The draws are
 * seeded, so a search is repeatable. Only admissible surfaces are
 * analysed: entry and exit within the search limits, at least the minimum
 * failure distance apart, below the ground, inside the model and concave
 * (the rule of every non-circular surface in cSlope).
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import type { SearchPlane, Slope } from "./slope";
import type { Evaluate, PlaneSteps } from "./steps";
import { wasm } from "../facade/internal";
import { bridge, engineSteps, facadeSlope, h } from "../facade/wire";
import { decodePlanes, encodePlanes, type PlanesWire } from "../facade/slice-codec";

/** Block surfaces carried on to the non-circular optimisation. */
export const BLOCK_SEEDS = 3;

/** The surfaces the block search returned (TypeScript keeps their genes by object). */
const blockSurfaces = new WeakSet<SearchPlane>();

function mark(planes: SearchPlane[]): SearchPlane[] {
  for (const p of planes) blockSurfaces.add(p);
  return planes;
}

/** The block surfaces drawn by `blockSearch` (its own planes only). */
export function isBlockSurface(plane: SearchPlane): boolean {
  return blockSurfaces.has(plane);
}

/**
 * Draw and evaluate the block surfaces of `slope`'s search objects.
 * Returns every evaluated surface (FOS null where invalid).
 */
export function blockSearch(slope: Slope, evaluate: Evaluate): SearchPlane[] {
  const s = facadeSlope(slope);
  return mark(s._planes(wasm().block_search_with(s._h, bridge(s, evaluate)) as PlanesWire));
}

/**
 * The block search as steps (model/steps.ts): the first draws, then each
 * refinement level as one batch. The draws do not depend on the factors
 * of safety, only the choice of the parents at the start of a level.
 */
export function blockSearchSteps(slope: Slope): PlaneSteps<SearchPlane[]> {
  function* run(): PlaneSteps<SearchPlane[]> {
    return yield* engineSteps(slope, wasm().block_search_steps_new(h(slope)) as number, (r) => mark(facadeSlope(slope)._planes(r.planes!)));
  }
  return run();
}

/** The `count` best evaluated surfaces with clearly different entry or exit points. */
export function bestDistinct(planes: readonly SearchPlane[], count: number, span: number): SearchPlane[] {
  // (TypeScript returns the given objects)
  const out = decodePlanes(wasm().best_distinct_planes(encodePlanes(planes.map((p) => ({ ...p, slices: null })), () => null), count, span) as PlanesWire);
  const used = new Set<SearchPlane>();
  return out.map((o) => {
    const p = planes.find((q) => !used.has(q) && q.cx === o.cx && q.cy === o.cy && q.radius === o.radius && q.lc[0] === o.lc[0] && q.rc[0] === o.rc[0])!;
    used.add(p);
    return p;
  });
}
