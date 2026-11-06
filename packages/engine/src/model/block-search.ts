/**
 * Block search: non-circular trial surfaces through block search objects.
 *
 * Implemented in packages/engine-rs/crates/cslope-engine/src/model/block_search.rs,
 * where the method, its sources and the implementation choices are
 * documented; called through WebAssembly (facade/internal.ts).
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
