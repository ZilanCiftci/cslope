/**
 * Reinforcement (support) definitions: anchors, grouted tiebacks, soil
 * nails and geosynthetics.
 *
 * Each element is a straight line from end 1 (the head, at the face) to
 * end 2 (the embedded end). Where a slip surface crosses it, a tensile
 * force is applied to the sliding mass at the crossing point. Its size is
 * the capacity envelope there (tensile capacity, pullout from either end,
 * end anchorage), its direction and whether it is divided by the factor of
 * safety follow common conventions:
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
 *   strip width / spacing for strips; FHWA's F*·α·σ′v·C·Rc). Rc only sets
 *   the width of soil contact: the tensile and end capacities are per
 *   element (per strip), so they are not multiplied by it. A
 *   geosynthetic "coverage" A (as commercial programs define it) scales all strengths given per metre of
 *   material width (T·A, (C + 2·L·τ)·A); there enter the tensile and end
 *   capacities × A with spacing 1 (per metre of slope), and coverage A;
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
  /**
   * Tensile capacity per element (kN), or per metre with spacing 1. Per
   * element means per strip or bar; a sheet with partial coverage (coverage
   * A) is entered as T·A per metre with spacing 1.
   */
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
  /**
   * Lock-off (prestress) load of a grouted anchor's free length, kN per
   * element: the finite element analysis prestresses the free length with
   * it (the limit equilibrium takes an active element's force as its
   * capacity). Default 0.
   */
  prestress?: number;
}

/**
 * Direction of a pile's force on the sliding mass, always against the
 * movement:
 * - "angle": tilted `angle` degrees above horizontal (0: horizontal);
 * - "tangent": along the slip surface where it crosses the pile (the usual
 *   default, "tangential");
 * - "perpendicular": perpendicular to the pile axis (horizontal for a
 *   vertical pile).
 */
export type PileForceDirection = "angle" | "tangent" | "perpendicular";

/**
 * Where an Ito & Matsui pile force acts: at the resultant of the soil
 * pressure on the pile above the slip surface ("centroid", the default),
 * or where the slip surface crosses the pile ("slip-surface", as Cai &
 * Ugai 2000, eq. 9, apply it). A given force acts at the crossing.
 */
export type PileForceLocation = "centroid" | "slip-surface";

/**
 * Pile row (or sheet pile wall) resisting the sliding mass in shear: where
 * a slip surface crosses the pile axis, a force acts against the sliding
 * direction (see `direction`; by default tilted `angle` degrees upwards,
 * 0: horizontal). Its size is
 * the given shear force per pile, or — without one, for a vertical pile —
 * the Ito & Matsui (1975) lateral force of the soil squeezing between the
 * piles above the slip surface; either is limited by the pile's shear and
 * bending capacity. Per metre of slope: divided by the spacing.
 */
export interface Pile {
  /** Pile head and tip. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Shear force per pile (kN); omit for Ito & Matsui (needs the diameter). */
  force?: number;
  /** Pile diameter / width (m), for Ito & Matsui. */
  diameter?: number;
  /** Centre-to-centre spacing (m). Default 1 (a wall per metre). */
  spacing?: number;
  /** Shear capacity per pile (kN). */
  shearCapacity?: number;
  /** Bending capacity per pile (kNm): force ≤ M / Lm, Lm the arm of the soil pressure. */
  momentCapacity?: number;
  /** Tilt of the force above horizontal (°), for direction "angle". Default 0. */
  angle?: number;
  /**
   * Direction of the force. Default "angle" (with `angle`), so that saved
   * models keep their result; the usual default elsewhere is "tangent".
   */
  direction?: PileForceDirection;
  /** Default "active". */
  application?: ReinforcementApplication;
  /** Where an Ito & Matsui force acts. Default "centroid". */
  location?: PileForceLocation;
  /**
   * A continuous wall (sheet piles): in the finite element analysis no soil
   * flows through it, and its default stiffness is that of a plate of
   * thickness `diameter` per metre. Default: a wall where spacing ≤ diameter.
   */
  wall?: boolean;
  /** Bending stiffness EI per pile (kNm²), for the finite element analysis; default a solid circle of `diameter` in concrete (E = 30 GPa), or a plate for a wall. */
  bendingStiffness?: number;
  /** Axial stiffness EA per pile (kN), for the finite element analysis; default as `bendingStiffness`. */
  axialStiffness?: number;
}

/** Applied reinforcement force, per metre of slope. */
export interface ReinforcementForce {
  /** Index of the element in the slope's reinforcement (or pile) list. */
  index: number;
  /** Set for a pile. */
  pile?: true;
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
