/**
 * Initial stresses of the finite element model: the K0 procedure and staged
 * construction.
 *
 * Implemented in packages/engine-rs/crates/cslope-engine/src/fem/initial_stress.rs,
 * where the method, its sources and the implementation choices are
 * documented; called through WebAssembly (facade/internal.ts).
 */
export interface InitialStressOptions {
  /** "gravity" (default): gravity applied in one increment from zero stress; "k0": the K0 procedure. */
  initialStress?: "gravity" | "k0";
  /** K0 of every soil; default 1 − sin φ′ per Gauss point (Jaky). */
  k0?: number;
  /** Ground level before excavation (m): the overburden of the K0 procedure counts from it where it is above the ground. */
  originalGroundLevel?: number;
  /** Construction stage per material name (default 0): materials of later stages are built later. */
  materialStages?: Readonly<Record<string, number>>;
}
