/**
 * The infinite-slope factor of safety of the ground surface where it lies in
 * a purely frictional soil (c′ = 0 at the surface, φ′ > 0).
 *
 * A slab of vanishing depth sliding parallel to a face inclined at β has
 * F = tan φ′ / tan β, whatever its depth, when the soil above the slip plane
 * is dry or submerged in still water (Duncan, Wright & Brandon 2014, Soil
 * Strength and Slope Stability, 2nd ed., § 6.2; a uniform surface load
 * changes the normal and shear stress alike). It is the limit of shallow
 * planar surfaces of the methods of slices and an upper bound of limit
 * analysis (with c = 0 the slab dissipates nothing). The searches miss it:
 * the methods of slices need ever finer trial surfaces to approach it (and
 * leave out those below a minimum slip area, when one is set), and
 * a finite element mesh cannot represent a slab thinner than its elements
 * (on V052a, rockfill φ′ = 45° on a 30.9° face, F = 1.67 against 1.78 by
 * strength reduction and 1.88 in another program's verification manual).
 *
 * Implementation choices (not from the literature): the faces are the
 * segments of the ground surface line, each sampled at nine points; a
 * sample counts when the material just below it is Mohr–Coulomb (constant
 * or spatial) with c′ = 0 and φ′ > 0 at the surface (design values, partial
 * factors applied) and its water line lies below the surface there (a water
 * line above the ground is clipped to it, so still water over a face cannot
 * be told from seepage out of it, under which the factor would be lower and
 * depend on the flow), and the material takes no strength from suction
 * (φb, which above the line acts as a cohesion). Faces steeper than 89.4° (dx < dy/100: steps and
 * walls) are skipped, as is a face that reinforcement or a pile reaches
 * (within 0.1 % of the model's extent), whose head or facing holds it. For
 * the methods of slices only faces dipping in the analysed direction and
 * within the search limits are checked (`slidingOnly`).
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import type { Slope } from "./slope";
import { wasm } from "../facade/internal";
import { h } from "../facade/wire";

export interface SurfaceSlide {
  /** tan φ′ / tan β of the face. */
  factorOfSafety: number;
  /** The face: its ends on the ground surface. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  material: string;
  /** Friction angle (design value) and the face's inclination, degrees. */
  frictionAngle: number;
  inclination: number;
}

/**
 * The face of the ground surface with the lowest infinite-slope factor, or
 * null when no face is in a frictional soil. Coordinates in model space (a
 * mirrored slope's x mirrored back). `slidingOnly`: only faces dipping
 * towards +x (the canonical sliding direction) between the entry and exit
 * limits, as the methods of slices search.
 */
export function frictionalSurfaceSlide(slope: Slope, slidingOnly = false): SurfaceSlide | null {
  return (wasm().frictional_surface_slide(h(slope), slidingOnly) as SurfaceSlide | null | undefined) ?? null;
}

/** The warning text when the face's factor is below an analysis' factor of safety `F`. */
export function surfaceSlideMessage(s: SurfaceSlide, F: number): string {
  return wasm().surface_slide_message(s, F);
}
