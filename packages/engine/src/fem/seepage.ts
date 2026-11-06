/**
 * Steady seepage by finite elements on the slope's mesh, for pore pressures
 * from flow instead of a drawn water line.
 *
 * Implemented in packages/engine-rs/crates/cslope-engine/src/fem/seepage.rs,
 * where the method, its sources and the implementation choices are
 * documented; called through WebAssembly (facade/internal.ts).
 */

export interface SeepageMesh {
  x: Float64Array;
  y: Float64Array;
  nodeCount: number;
  el: Int32Array;
  elementCount: number;
  gp: Float64Array;
  /** Surface edges, 3 nodes each (end, middle, end). */
  surfaceEdges: Int32Array;
  /** Nodes on the vertical sides of the model. */
  sideNodes: Int32Array;
  /** Permeability per element (m/s). */
  permeability: Float64Array;
  /** van Genuchten α (1/m) and n per element. */
  vgAlpha: Float64Array;
  vgN: Float64Array;
}

export interface SeepageResult {
  /** Total head per node (m). */
  head: Float64Array;
  iterations: number;
  converged: boolean;
  /** Nodes on a seepage face at the end. */
  seepageFaceNodes: number;
  /** False when no head is prescribed anywhere: no flow is computed and `head` is the water table. */
  flow: boolean;
}
