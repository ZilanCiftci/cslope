/**
 * 3D effects of a temporary slope after SGI's guidance (Vägledning 8,
 * Temporära slänter, 2024, section 2.1): the critical stretch of length L is
 * bounded by two plane end faces, whose undrained shear strength adds
 * resisting moment to the 2D slip surface.
 *
 * Implemented in packages/engine-rs/crates/cslope-engine/src/model/sgi3d.rs,
 * where the method, its sources and the implementation choices are
 * documented; called through WebAssembly (facade/internal.ts).
 */
import type { Sgi3dOptions, Sgi3dResult } from "../types/sgi3d";
import type { Slope } from "./slope";
import { wasm } from "../facade/internal";
import { h } from "../facade/wire";

/**
 * F_3D of an analysed slope (after `analyseSlope`): the smallest over its
 * circular surfaces with a factor of safety. Null when it has none.
 * Strengths and loads are design values when the slope has partial factors;
 * the end faces take the undrained strength without anisotropy (its
 * factor at α = 0, the direct shear strength).
 */
export function sgi3dFactorOfSafety(slope: Slope, options: Sgi3dOptions): Sgi3dResult | null {
  return (wasm().sgi3d_factor_of_safety(h(slope), options) as Sgi3dResult | null | undefined) ?? null;
}
