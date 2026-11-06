/**
 * The infinite-slope factor of safety of the ground surface where it lies in
 * a purely frictional soil (c′ = 0 at the surface, φ′ > 0).
 *
 * Implemented in packages/engine-rs/crates/cslope-engine/src/model/surface_slide.rs,
 * where the method, its sources and the implementation choices are
 * documented; called through WebAssembly (facade/internal.ts).
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
