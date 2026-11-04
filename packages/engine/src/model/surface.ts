/**
 * Non-circular (polyline) slip surfaces.
 *
 * A polyline surface runs from the entry to the exit point with x strictly
 * increasing (canonical coordinates: the mass slides towards +x). Moment
 * equilibrium is taken about an axis point, which for a surface derived
 * from a circle is the circle centre.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import type { Slope } from "./slope";
import { wasm } from "../facade/internal";
import { h } from "../facade/wire";

export type Pt = [number, number];

/** y of the polyline at x (linear between vertices; NaN outside). */
export function polylineYAt(points: readonly Pt[], x: number): number {
  return wasm().polyline_y_at(points, x);
}

/**
 * x of every crossing between the polyline and the segments of a path
 * (closed: polygon, else polyline).
 */
export function polylineCrossingsX(points: readonly Pt[], px: readonly number[], py: readonly number[], closed: boolean): number[] {
  return Array.from(wasm().polyline_crossings_x(points, Float64Array.from(px), Float64Array.from(py), closed));
}

/**
 * Default axis point for moment equilibrium: the centre of the circle
 * through the entry, the exit and the deepest point of the surface below
 * their chord. For a planar surface (no depth below the chord) a point
 * above the chord midpoint at a distance of one chord length.
 */
export function defaultAxisPoint(points: readonly Pt[]): Pt {
  const p = wasm().default_axis_point(points);
  return [p[0], p[1]];
}

/**
 * Fit a user polyline to the ground: the surface starts where it first
 * passes from above to below the ground and ends where it comes out again.
 * End segments that stop below the ground are extended along their
 * direction until they reach it. Returns null if no sliding mass results.
 */
export function fitPolylineToGround(slope: Slope, input: readonly Pt[]): Pt[] | null {
  return (wasm().fit_polyline_to_ground(h(slope), input) as Pt[] | null | undefined) ?? null;
}

/**
 * Kinematic and geometric admissibility of a polyline surface: x strictly
 * increasing, interior vertices below the ground and inside the model,
 * no segment above the ground, and concave (the base inclination never increases towards the exit),
 * within `concavityTolDeg`.
 */
export function isAdmissiblePolyline(slope: Slope, points: readonly Pt[], concavityTolDeg = 1): boolean {
  return wasm().is_admissible_polyline(h(slope), points, concavityTolDeg);
}

/**
 * True when a corner of the model's external boundary (other than one on
 * the ground) lies strictly inside the sliding mass, between the slip
 * surface `baseY` and the ground from x0 to x1. Next to any boundary point
 * lies ground outside the model, so the mass then is not wholly inside it:
 * the surface leaves the model, typically below a re-entrant corner of its
 * base, where the vertices of a polyline and samples along a circle can
 * all lie inside. For a polyline this is exact: a straight segment between
 * two points inside the model leaves it only around a corner.
 */
export function boundaryCornerInMass(slope: Slope, x0: number, x1: number, baseY: (x: number) => number): boolean {
  return wasm().boundary_corner_in_mass(h(slope), x0, x1, baseY);
}

/**
 * True when a circular surface from x0 to x1 passes outside the model:
 * a boundary corner lies in the sliding mass (boundaryCornerInMass), or
 * a point of a boundary edge below the ground lies strictly inside the
 * circle. The second catches a circle that cuts a little below a sloping
 * base between the points sampled along it, where it touches no corner.
 * On a straight edge the points inside the circle, if any, include the
 * point nearest the centre, so that point decides.
 */
export function circleLeavesModel(slope: Slope, cx: number, cy: number, radius: number, x0: number, x1: number): boolean {
  return wasm().circle_leaves_model(h(slope), cx, cy, radius, x0, x1);
}

/** Points of a circular arc between entry and exit as a polyline. */
export function circleToPolyline(cx: number, cy: number, radius: number, lc: Pt, rc: Pt, vertices: number): Pt[] {
  return wasm().circle_to_polyline(cx, cy, radius, lc, rc, vertices) as Pt[];
}
