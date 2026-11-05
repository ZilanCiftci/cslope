/**
 * Steady seepage by finite elements on the slope's mesh, for pore pressures
 * from flow instead of a drawn water line.
 *
 * Head h on the six-node triangles, ∇·(k ∇h) = 0 (Galerkin finite
 * elements). Boundary conditions:
 *  - on the ground surface where the water table is at or above the ground
 *    (a reservoir, ponded water, the water level at a downstream toe): the
 *    head of the water there, h = y_w, imposed by a large number on the
 *    diagonal (penalty), as Bathe & Khoshgoftaar (1979) impose prescribed
 *    heads;
 *  - elsewhere on the ground surface: a seepage face, h = y, at the nodes
 *    where water leaves the soil, and no flow at the others. The face is
 *    found by switching nodes between the two conditions until neither
 *    inequality is violated (h ≤ y on the no-flow part, outflow on the
 *    face): Neuman & Witherspoon 1970, Water Resour. Res. 6(3), 889–897;
 *    Cooley 1983, Water Resour. Res. 19(5), 1271–1285;
 *  - vertical sides of the model: the head of the water table, h = y_w,
 *    below it (far-field hydrostatic water, so that a water table drawn
 *    below the ground is held at the model's edges), no flow above it;
 *  - base: no flow.
 *
 * Free surface on a fixed mesh: the permeability depends on the pressure
 * head ψ = h − y (Bathe & Khoshgoftaar 1979, Int. J. Numer. Anal. Meth.
 * Geomech. 3(1), 13–22), full where ψ ≥ 0 and, above the phreatic surface,
 * k·k_r(ψ) with the relative permeability of van Genuchten (1980, Soil Sci.
 * Soc. Am. J. 44(5), 892–898) and Mualem (1976, Water Resour. Res. 12(3),
 * 513–522): S_e = [1 + (α|ψ|)ⁿ]^(−m), m = 1 − 1/n,
 * k_r = S_e^½ [1 − (1 − S_e^(1/m))^m]². The default α = 3.6 m⁻¹ and
 * n = 1.56 are the class averages for loam of Carsel & Parrish (1988,
 * Water Resour. Res. 24(5), 755–769). The nonlinear problem is solved by
 * Picard iteration on the permeability with Aitken's dynamic
 * under-relaxation (see below). Pore pressure is u = γw (h − y) ≥ 0;
 * suction is not used for strength (χ = 0).
 *
 * Implementation choices (not from the literature): k_r is bounded below
 * by 10⁻⁶ to keep the system well conditioned; at most 80 iterations;
 * convergence when the unrelaxed change of the heads is below 0.1 % of
 * the range of heads and elevations; a corner node of the seepage face is
 * judged by its flow with half of each adjacent face edge's midside flow
 * (lumped), because the consistent flows of a six-node edge can show
 * inflow at a corner under outflow from the whole edge.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import { testCall } from "../facade/internal";

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

/** Relative permeability of van Genuchten (1980) and Mualem (1976) at pressure head ψ (m). */
export function vanGenuchtenMualem(psi: number, alpha: number, n: number): number {
  return testCall("fem/seepage::vanGenuchtenMualem", [psi, alpha, n]);
}

/** Pore pressure (kPa) at a point from nodal heads interpolated in an element. */
export function porePressureFromHead(h: number, yy: number): number {
  return testCall("fem/seepage::porePressureFromHead", [h, yy]);
}
