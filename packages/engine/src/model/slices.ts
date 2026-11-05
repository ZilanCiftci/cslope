/**
 * Slice creation and generation for slope stability analysis.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import type { Slice } from "../types/geometry";
import type { Slope } from "./slope";
import { wasm } from "../facade/internal";
import { facadeSlope, h } from "../facade/wire";
import type { SlicesWire } from "../facade/slice-codec";
import type { Pt } from "./surface";

// ── Water at a slice ──────────────────────────────────────────────

/**
 * A water line that does not reach a slice. Water lines are continued
 * horizontally to the model edges (as is common practice), so this does not
 * happen for a line set on the slope; should it, the surface is invalid (as
 * commercial programs give no FOS where the water table does not span the slip surface) instead of
 * silently getting no pore pressure there.
 */
export const WATER_LINE_GAP = "The water table does not span the slip surface.";

/**
 * Factor h on the vertical head over a slice base, u = γw·(yw − yb)·h:
 * cos²θ with θ the inclination of the water line across the slice (the
 * equipotentials of seepage parallel to a straight phreatic surface are
 * normal to it, Duncan & Wright 2014, ch. 6), or 1 with vertical head.
 * Also 1 where the line has a vertical segment inside the slice: a step in
 * the line is a wall or a sheet pile between two water levels, not a
 * seepage gradient, and the secant across it is no flow line. (Water-line
 * vertices are slice edges, so this is only a safeguard.)
 */
export function headFactor(line: { x: number[]; y: number[] }, wyLeft: number, wyRight: number, xLeft: number, xRight: number, verticalHead: boolean): number {
  return wasm().head_factor(line, wyLeft, wyRight, xLeft, xRight, verticalHead);
}

/**
 * Divide a circular failure surface into vertical slices.
 *
 * @param slope The Slope model.
 * @param x0 Left entry point x.
 * @param x1 Right exit point x.
 * @param cx Circle center x.
 * @param cy Circle center y.
 * @param radius Circle radius.
 * @returns Array of valid Slice objects.
 */
export function getSlices(slope: Slope, entryX: number, x1: number, cx: number, cy: number, radius: number, points?: readonly Pt[]): Slice[] {
  return facadeSlope(slope)._slices(wasm().get_slices(h(slope), entryX, x1, cx, cy, radius, points) as SlicesWire);
}

/**
 * Rankine depth of a tension crack at x: where the active earth pressure
 * of the soil just below the ground, σa = (γz + q)·Ka − 2c√Ka, is zero.
 * z = 2c/(γ√Ka) − q/γ, Ka = tan²(45° − φ/2); for undrained strength
 * (φ = 0) z = 2cu/γ − q/γ. Strength as in the analysis (design values with
 * partial factors), q the (factored) distributed load and any free water
 * standing on the ground at x. A combined material uses its drained c′,
 * which is what governs near the surface.
 */
export function rankineCrackDepth(slope: Slope, x: number): number {
  return wasm().rankine_crack_depth(h(slope), x);
}

/**
 * x of a tension crack at a limiting base inclination: the first point
 * from the entry where the slip surface is no steeper than `angle` (rad,
 * measured from the horizontal, descending in the sliding direction +x);
 * `xEntry` itself when the surface starts no steeper; null when the
 * surface never flattens to it before the exit.
 */
export function findAngleCrackX(xEntry: number, xExit: number, baseY: (x: number) => number, angle: number): number | null {
  return (wasm().find_angle_crack_x(xEntry, xExit, baseY, angle) as number | undefined) ?? null;
}

/**
 * x of the tension crack: the first point from the entry where the slip
 * surface lies `depth` below the ground, or null if it never does.
 */
export function findCrackX(
  surf: { x: number[]; y: number[] },
  xEntry: number,
  xExit: number,
  baseY: (x: number) => number,
  depthAt: (x: number) => number,
): number | null {
  return (wasm().find_crack_x(surf, xEntry, xExit, baseY, depthAt) as number | undefined) ?? null;
}
