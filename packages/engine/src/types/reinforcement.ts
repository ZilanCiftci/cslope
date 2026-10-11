/**
 * Reinforcement (support) definitions: anchors, grouted tiebacks, soil
 * nails and geosynthetics.
 *
 * Each element is a straight line from end 1 (the head, at the face) to
 * end 2 (the embedded end). Where a slip surface crosses it, a tensile
 * force is applied to the sliding mass at the crossing point. Its size is
 * the capacity envelope there (tensile capacity, pullout from either end,
 * end anchorage), its direction and whether it is divided by the factor of
 * safety follow the Slide2 conventions:
 *
 * - direction "axial": along the element (rigid supports: nails,
 *   tiebacks, anchors); "tangent": along the slip surface (flexible
 *   geosynthetics); "bisector": halfway between the two.
 * - application "active": a known (allowable) force on the driving side,
 *   not divided by F; "passive": an ultimate capacity mobilised with the
 *   soil strength, divided by F.
 */

export type ReinforcementDirection = "axial" | "tangent" | "bisector";
export type ReinforcementApplication = "active" | "passive";

/**
 * Pullout resistance along the element (per element, per metre of its
 * length):
 * - "bond": a constant bond strength, over the whole element or only over
 *   the bonded length at end 2 (grouted tiebacks);
 * - "interface": r = 2·(a + σ′v·tan δ)·Rc per metre of slope, soil
 *   bearing on both faces of a sheet, with σ′v the effective vertical
 *   stress at the element (the weight of the soil column above it less the
 *   pore pressure) and Rc the coverage ratio (1 for a continuous sheet,
 *   strip width / spacing for strips; FHWA's F*·α·σ′v·C·Rc);
 * - "development": the tensile capacity develops linearly over the given
 *   length from each end (0: that end is fully anchored).
 */
export type ReinforcementPullout =
  | { kind: "bond"; strength: number; bondedLength?: number }
  | { kind: "interface"; adhesion: number; frictionAngle: number; coverage?: number }
  | { kind: "development"; length1: number; length2: number };

export interface Reinforcement {
  /** End 1 (head / face end). */
  x1: number;
  y1: number;
  /** End 2 (embedded end). */
  x2: number;
  y2: number;
  /** Tensile capacity per element (kN), or per metre with spacing 1. */
  tensileCapacity: number;
  /** Out-of-plane spacing (m); all capacities are divided by it. Default 1. */
  spacing?: number;
  /**
   * Pullout along the element. Without it both ends are fully anchored:
   * the tensile capacity is available wherever the element is crossed
   * (end-anchored bars).
   */
  pullout?: ReinforcementPullout;
  /** Anchorage capacity at end 1 (plate, facing connection), kN per element. Default 0. */
  end1Capacity?: number;
  /** Anchorage capacity at end 2, kN per element. Default 0. */
  end2Capacity?: number;
  /** Default "axial". */
  direction?: ReinforcementDirection;
  /** Default "active". */
  application?: ReinforcementApplication;
}

/** Applied reinforcement force, per metre of slope. */
export interface ReinforcementForce {
  /** Index of the element in the slope's reinforcement list. */
  index: number;
  /** Crossing point with the slip surface. */
  x: number;
  y: number;
  /** Force on the sliding mass (kN/m), +x in the sliding direction, +y up. */
  fx: number;
  fy: number;
  /** Magnitude (kN/m); divided by F in the solvers when passive. */
  force: number;
  passive: boolean;
}
