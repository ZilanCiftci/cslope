/**
 * 3D effects of a temporary slope after SGI's guidance (Vägledning 8,
 * Temporära slänter, 2024, section 2.1): the critical stretch of length L
 * is bounded by two plane end faces, whose undrained shear strength adds
 * resisting moment to the 2D slip surface.
 *
 *   F_P = (M_R L + 2 Σ A C c_u) / (M_E L) = F_2D + 2 Σ A C c_u / (M_E L)          (2-2)
 *   F_3D = F_2D + 0.75 (F_P − F_2D)                     infinitely overstrong     (2-3)
 *   F_3D = F_2D + (1 − F_2D,krit,min / F_2D,överstark,min) 0.75 (F_P − F_2D)  finite (2-4)
 *
 * M_E is the driving moment of the surface about its centre, M_R = F_2D M_E,
 * and Σ A C c_u the end face's moment: its area of cohesive soil times the
 * lever arm and the undrained shear strength, here ∫ c_u r dA over the face
 * (r the distance to the centre), so that c_u varying with depth and a
 * layered face need no sectors. Only cohesive soil counts in the end faces:
 * the undrained materials (φ = 0) and the undrained branch c_u of a
 * combined material (clay in a combined analysis), not friction soil, and not the materials
 * given in `excludeMaterials` (a fissured dry crust, for example). The 3D
 * factor is the smallest over the analysed circular surfaces, as the
 * surface of the smallest F_3D is generally shallower than the critical 2D
 * one (guidance, section 2.1.2). The sliding mass is the soil inside the
 * circle between its entry (or its tension crack) and its exit, as the
 * slices take it. M_E is the soil's (total) weight and the loads: forces of
 * reinforcement, piles and water in a crack or above the ground are not in
 * it, and the result warns when the model has them.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
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
