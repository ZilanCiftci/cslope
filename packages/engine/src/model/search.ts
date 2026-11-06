/**
 * Search plane generation for slope stability analysis.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import type { SearchPlane, Slope } from "./slope";
import { wasm } from "../facade/internal";
import { facadeSlope, h } from "../facade/wire";
import type { PlanesWire } from "../facade/slice-codec";

type Pt = [number, number];

/** A partial plane as the engine reads a plane. */
function asPlane(p: object): object {
  return { lc: [0, 0], rc: [0, 0], cx: 0, cy: 0, radius: 0, fos: null, ...p, slices: null };
}

export function planeKey(plane: Pick<SearchPlane, "cx" | "cy" | "radius" | "points">): string {
  return wasm().plane_key(asPlane(plane));
}

/**
 * Entry and exit of the slip surface on a circle: the first crossing of
 * the lower arc with the ground where the arc goes from air into soil,
 * and the next crossing where it comes out again.
 *
 * Taking simply the first two crossings by x is wrong when
 *  - a crossing lies on the upper half of the circle (e.g. on the crest
 *    behind a vertical face): the slices would hang from the lower arc
 *    metres below the ground, i.e. a free vertical crack, or
 *  - the arc only touches the ground at a vertex (typically the toe) and
 *    stays in the soil: the mass beyond it, and its resistance, was cut
 *    off.
 * Returns null when the circle has no such entry/exit pair.
 */
export function selectEntryExit(slope: Slope, cx: number, cy: number, radius: number): [Pt, Pt] | null {
  return (wasm().select_entry_exit(h(slope), cx, cy, radius) as [Pt, Pt] | null | undefined) ?? null;
}

/**
 * True when a circular plane from its entry to its exit stays inside the
 * model (a prescribed circle that leaves it, e.g. through its base, is not
 * analysed).
 */
export function isPlaneWithinExternalBoundary(slope: Slope, plane: Pick<SearchPlane, "lc" | "rc" | "cx" | "cy" | "radius">, asCircle = false): boolean {
  return wasm().is_plane_within_external_boundary(h(slope), asPlane(plane), asCircle);
}

/**
 * Generate circular failure planes through entry and exit points.
 */
export function generatePlanes(slope: Slope, lc: Pt, rc: Pt, numCircles = 5): SearchPlane[] {
  return facadeSlope(slope)._planes(wasm().generate_planes(h(slope), lc, rc, numCircles) as PlanesWire);
}

/**
 * Generate search planes based on predetermined entry/exit points.
 */
export function setEntryExitPlanes(slope: Slope): void {
  wasm().set_entry_exit_planes(h(slope));
}

/**
 * Add potential failure surfaces defined by entry and exit x-coordinates.
 */
export function addSingleEntryExitPlane(slope: Slope, lcX: number, rcX: number, numCircles = 5): void {
  wasm().add_single_entry_exit_plane(h(slope), lcX, rcX, numCircles);
}

/**
 * Add a specific circular failure surface to the analysis. A circle that
 * leaves the model is added all the same: whether it is analysed (along
 * the floor, as a composite surface) depends on the options at analysis
 * time, and evaluatePlanes rejects it otherwise.
 */
export function addSingleCircularPlane(slope: Slope, cx: number, cy: number, radius: number): void {
  wasm().add_single_circular_plane(h(slope), cx, cy, radius);
}
