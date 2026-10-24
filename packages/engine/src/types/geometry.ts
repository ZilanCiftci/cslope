/**
 * Geometry type definitions for slope stability analysis.
 */

import type { Material } from "./material";
import type { ReinforcementForce } from "./reinforcement";

/**
 * Represents a polygon region with an associated material.
 * Used for material layers in the slope model.
 */
export interface GeometryWithMaterial {
  /** X-coordinates of polygon vertices. */
  px: number[];
  /** Y-coordinates of polygon vertices. */
  py: number[];
  /** Associated material. */
  material: Material;
  /** Cached minimum X bound (undefined for clipped fragments). */
  xMin?: number;
  /** Cached maximum X bound (undefined for clipped fragments). */
  xMax?: number;
  /** Cached maximum Y bound (undefined for clipped fragments). */
  yMax?: number;
}

/**
 * Represents a slip surface (circular arc discretized as polyline).
 */
export interface SlipSurface {
  /** Coordinate pairs [[x0,y0], [x1,y1], ...]. */
  geometry: [number, number][];
  /** X-coordinates of the surface. */
  px: number[];
  /** Y-coordinates of the surface. */
  py: number[];
  /** Leftmost X. */
  xLeft: number;
  /** Rightmost X. */
  xRight: number;
  /** Lowest Y. */
  yBottom: number;
  /** Highest Y. */
  yTop: number;
}

/**
 * Represents a single vertical slice through the slope.
 *
 * In TypeScript we use a plain interface rather than a class with
 * heavy mutable state; the solver functions will operate on these
 * immutably where possible.
 */
export interface Slice {
  /** Center X of slice. */
  x: number;
  /** Left X boundary. */
  xLeft: number;
  /** Right X boundary. */
  xRight: number;
  /** Top Y at left edge. */
  y0Top: number;
  /** Top Y at right edge. */
  y1Top: number;
  /** Mean top Y. */
  yTop: number;
  /** Bottom Y at left edge (on circle). */
  y0Bottom: number;
  /** Bottom Y at right edge (on circle). */
  y1Bottom: number;
  /** Mean bottom Y. */
  yBottom: number;
  /** Slice width (m). */
  width: number;
  /** Slice height (m). */
  height: number;
  /** Slice area (m²). */
  area: number;
  /** Base inclination angle (rad). */
  alpha: number;
  /** Arc length of slice base (m). */
  baseLength: number;
  /** Slice weight (kN). */
  weight: number;
  /** Distance from circle center to slice midpoint. */
  dx: number;
  /** Height from center of rotation to midpoint. */
  e: number;
  /**
   * Moment arm of the base shear about the centre (m): the radius on a
   * circle, the perpendicular distance to the base on a non-circular
   * surface.
   */
  R: number;
  /**
   * Moment arm of the base normal force about the axis point (m),
   * positive where the normal force drives; 0 on a circle.
   */
  normalArm?: number;
  /** UDL force on slice (kN). */
  udl: number;
  /** Line load force on slice (kN). */
  ll: number;
  /** Whether the slice is geometrically valid. */
  isValid: boolean;
  /** Base material at the slice bottom. */
  baseMaterial: Material | null;
  /** Effective cohesion at base (kPa). */
  cohesion: number;
  /** Undrained cohesion at base (kPa). */
  cohesionUndrained: number;
  /**
   * Part of the characteristic `cohesion` that is undrained shear strength
   * (lime-cement columns in their drained limit: (1 − a)·cu,soil), which
   * takes γcu when design values are formed. Not set: 0.
   */
  cohesionUndrainedPart?: number;
  /** Friction angle at base (deg). */
  frictionAngle: number;
  /** Friction angle at base (rad). */
  phi: number;
  /**
   * Pore water pressure at the base centre (kPa), not a force: the force on
   * the base is U · baseLength.
   */
  U: number;
  /** Weight of free water standing on the slice top (kN). */
  waterLoad?: number;
  /**
   * Horizontal external force on the slice (kN), positive in the sliding
   * direction (+x in canonical coordinates): water pressure on an inclined
   * ground surface or in a tension crack.
   */
  hForce?: number;
  /**
   * Driving moment about the circle centre (kN·m) of the external water
   * forces that is not already included as (weight + loads) × dx.
   */
  extraMoment?: number;
  /**
   * Reinforcement forces on the slice, [downward, horizontal (+x), extra
   * moment] per metre, like the loads above: the moment beyond
   * downward·dx. Active forces are applied as they are, passive ones
   * divided by the trial FOS.
   */
  reinforcementActive?: [number, number, number];
  reinforcementPassive?: [number, number, number];
  /** The individual reinforcement forces acting on the slice. */
  reinforcementForces?: ReinforcementForce[];
  /** Combined method: the undrained strength governed in the last solve. */
  undrainedGoverns?: boolean;
  /**
   * When `true`, the solver uses Combined method (min of drained/undrained).
   */
  isCombined?: boolean;
  /**
   * When `true`, any slip surface passing through this slice should
   * be treated as infinitely stable and excluded from the search.
   */
  skipSurface?: boolean;
  /**
   * When `true`, the slip surface has entered impenetrable material
   * and the entire surface must be rejected.
   */
  impenetrable?: boolean;
}

/**
 * Mutable solver state for a slice during FOS iteration.
 * Kept separate from the immutable Slice geometry.
 */
export interface SliceSolverState {
  /** Factor of safety (current iteration). */
  FS: number;
  /** m-alpha coefficient. */
  malpha: number;
  /** Base normal force (kN). */
  N: number;
  /** Left horizontal interslice force. */
  eLeft: number;
  /** Right horizontal interslice force. */
  eRight: number;
  /** Left vertical interslice force. */
  xLeft: number;
  /** Right vertical interslice force. */
  xRight: number;
  /** Lambda for Morgenstern-Price. */
  lambda: number;
  /** Interslice function value. */
  func: number;
  /** Cached cohesion term for N calculation. */
  cohesionTerm: number;
}
