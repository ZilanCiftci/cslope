/**
 * Composite circular slip surfaces: a circle that reaches impenetrable
 * material (bedrock) follows its top instead of entering it, and, optionally
 * (compositeBase), the base of the model likewise, as commercial programs
 * and the literature treat a circle on a firm base (Duncan & Wright 2014,
 * ch. 6: composite surfaces; the "lera på fast botten" of Swedish practice).
 *
 * Implemented in packages/engine-rs/crates/cslope-engine/src/model/composite.rs,
 * where the method, its sources and the implementation choices are
 * documented; called through WebAssembly (facade/internal.ts).
 */
import type { GeometryWithMaterial } from "../types/geometry";
import { wasm } from "../facade/internal";
import { materialWire } from "../facade/materials";
import type { Material } from "../types/material";
import type { Pt } from "./surface";

/**
 * The floor of the model: the base of the model and the impenetrable
 * regions stacked on it (bedrock), as a polyline from left to right.
 * A vertical step (the side of a rock step) is two points with the same x.
 */
export interface CompositeFloor {
  pts: Pt[];
  /**
   * The x ranges where the floor is the bare base of the model (no
   * impenetrable material on it); empty when the base is followed
   * (compositeBase). A circle below the floor there is not analysed.
   */
  bare: [number, number][];
}

/**
 * The floor of a model (see CompositeFloor). Null when the boundary is
 * degenerate, or when there is nothing to follow (no impenetrable material
 * on the base and the base itself is not followed).
 */
export function compositeFloor(
  boundary: { x: readonly number[]; y: readonly number[] },
  geometries: readonly GeometryWithMaterial[],
  followBase = true,
): CompositeFloor | null {
  // the materials numbered by object, as the engine refers to them
  const materials: Material[] = [];
  const index = (m: Material) => {
    let i = materials.indexOf(m);
    if (i < 0) i = materials.push(m) - 1;
    return i;
  };
  const geos = geometries.map((g) => ({ ...g, material: index(g.material) }));
  return (wasm().composite_floor(boundary, geos, materials.map(materialWire), followBase) as CompositeFloor | null | undefined) ?? null;
}

/**
 * How far a circle may dip below the floor and still count as a circle
 * (tangent to it, to rounding): the same tolerance as the search's check
 * that a circle stays inside the model (search.ts), so that the circle the
 * search finds tangent to the base is analysed as a circle.
 */
export function floorDipTolerance(modelHeight: number): number {
  return wasm().floor_dip_tolerance(modelHeight);
}

/**
 * Whether the circle (its lower arc between x0 and x1) goes below the
 * floor by more than `tol` where the floor is the bare base of the model
 * (not followed: the circle leaves the model there).
 */
export function circleBelowBareBase(floor: CompositeFloor, cx: number, cy: number, radius: number, x0: number, x1: number, tol: number): boolean {
  return wasm().circle_below_bare_base(floor, cx, cy, radius, x0, x1, tol);
}

/** The floor's y at x from the given side of a step (NaN outside it). */
export function floorYAt(floor: CompositeFloor, x: number, side: "left" | "right" = "left"): number {
  return wasm().floor_y_at(floor, x, side);
}
