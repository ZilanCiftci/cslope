/**
 * Finite element model of a slope: T6 mesh, materials, supports and loads.
 *
 * Method and sources:
 * - The domain is the slope's external boundary, meshed with the material
 *   boundaries as constraints so that every element lies in one material
 *   (mesh.ts), with six-node triangles (elements.ts).
 * - Supports as in Griffiths & Lane (1999, Géotechnique 49(3), 387–403):
 *   the base is fixed, the vertical sides are on rollers, and the ground
 *   surface is free.
 * - Gravity is applied in one increment with the total unit weight
 *   (Griffiths & Lane 1999); E = 10⁵ kPa and ν = 0.3 are their nominal
 *   values, which barely affect F.
 * - Effective stress: the pore pressures enter as the equivalent nodal load
 *   ∫ Bᵀ m u dA, m = (1, 1, 0) in the plane, so that the yield
 *   criterion sees the effective stress (Terzaghi's principle; Potts &
 *   Zdravković, Finite Element Analysis in Geotechnical Engineering:
 *   Theory, Thomas Telford 1999). Pore pressure is hydrostatic below the water line of each
 *   element's material, u = γw (y_w − y) ≥ 0, or comes from seepage.ts.
 * - Strength at each Gauss point as the slices take it: depth from the top
 *   of the material's layer where the model needs it, design values with
 *   the partial factors (EN 1997-1 Annex A, `designStrength`), and for a
 *   combined material the lesser of the drained and the undrained strength,
 *   a Tresca cap (σ₁ − σ₃)/2 ≤ cu on Mohr–Coulomb. Variable loads take γQ.
 *   A material with φb adds the suction strength min(s, s_max)·tan φb to
 *   c′, with the matric suction s = γw (y − y_w) above its water line
 *   (vertical head), or from the negative pore pressure of the seepage.
 * - Surface loads: ponded water as a normal pressure, strip loads (kPa per
 *   horizontal metre) and line loads (kN/m) as vertical tractions,
 *   integrated with the quadratic edge shape functions.
 * - Reinforcement: three-node bar (truss) elements along the element edges
 *   on each reinforcement line, sharing the soil's nodes (perfect bond),
 *   elastic–perfectly plastic in tension (bars.ts).
 * - Equations in nested dissection order, factorised by sparse Cholesky
 *   (sparse.ts).
 *
 * Implementation choices (not from the literature), with their reasons:
 * - Element size: a twentieth of the model height by default, and at most
 *   half the local thickness of a thin layer (polygonThicknessSamples), so that every
 *   layer is crossed by at least two elements.
 * - Boundary edges: an edge whose midpoint lies on the ground surface is
 *   free; a non-surface edge with |Δx| ≤ 10⁻³ |Δy| is a vertical side
 *   (roller); every other non-surface edge is fixed.
 * - High-strength and impenetrable materials are elastic, 100 times as
 *   stiff as the stiffest soil, and 10⁻⁴ as permeable as the least
 *   permeable soil, unless parameters are given for them by name: stiff
 *   enough not to deform the soil around them, soft enough not to spoil
 *   the conditioning of the stiffness matrix.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts and fem/_handles.ts).
 */
import { testCall } from "../facade/internal";
import type { Slope } from "../model/slope";
import { dataOptions,feModelOf,modelChanged,modelHandle,sizeFieldHandle,slopeRef } from "../facade/fem/_handles";
import type { Material } from "../types/material";
import type { TriMesh } from "./mesh";
import { SparseCholesky } from "./sparse";
import type { SeepageResult } from "./seepage";
import type { FePiles } from "./piles";
import type { HoekBrownParameters } from "../types/hoek-brown";

/** Elastic and flow parameters of a material in the finite element analysis. */
export interface FeMaterialParameters {
  /** Young's modulus E (kPa); default 1·10⁵. */
  youngsModulus?: number;
  /** Poisson's ratio ν; default 0.3. */
  poissonsRatio?: number;
  /** Dilation angle ψ (°); default 0. */
  dilationAngle?: number;
  /**
   * Permeability k (m/s) for steady seepage; default 10⁻⁶ for a soil and
   * 10⁻⁴ of the least permeable soil for a rigid material (only ratios matter).
   */
  permeability?: number;
  /** van Genuchten α (1/m) for the unsaturated permeability; default 3.6 (loam, Carsel & Parrish 1988). */
  vanGenuchtenAlpha?: number;
  /** van Genuchten n; default 1.56 (loam, Carsel & Parrish 1988). */
  vanGenuchtenN?: number;
}

export interface FeModelOptions {
  /** Target element size (m); default: domain height / 20. */
  elementSize?: number;
  /** Size field overriding `elementSize`, e.g. from error estimation; `min`, when given, is its smallest value. */
  sizeField?: ((x: number, y: number) => number) & { min?: number };
  /** Parameters per material name; "*" for every material not named. */
  materialParameters?: Readonly<Record<string, FeMaterialParameters>>;
  /** Smallest triangle angle (°); default 25. */
  minAngle?: number;
  /** Vertex cap of the mesh; default 60 000. */
  maxVertices?: number;
  /**
   * Axial stiffness EA of reinforcement (kN per metre of slope). It sets how
   * much the soil must strain before the reinforcement carries its capacity:
   * the default, 10⁶, mobilises the full capacity before the soil fails, as
   * limit equilibrium assumes; a product's own stiffness (a geosynthetic's J,
   * often 500–5000 kN/m) gives strain compatibility, and with it a factor
   * that can be much lower.
   */
  reinforcementStiffness?: number;
  /**
   * Divide the capacity of passive reinforcement by F, as the limit
   * equilibrium solvers do (default true); false reduces only the soil's
   * strength, as a strength reduction program usually does.
   */
  reduceReinforcement?: boolean;
  /**
   * Pore pressures: "water-table" (default), hydrostatic below each
   * material's water line; "seepage", from steady seepage on the mesh
   * (seepage.ts) with the water table as reservoir and tail water where it
   * lies at or above the ground.
   */
  porePressure?: "water-table" | "seepage";
  /**
   * Materials not yet built (staged construction, initial-stress.ts): their
   * elements are weightless and elastic with SOFT_FACTOR of the softest
   * soil's stiffness, carry no pore pressure term and no surface load, so
   * that they follow the active soil without loading or stiffening it.
   */
  inactiveMaterials?: readonly string[];
  /** Leave the reinforcement out (the construction stages before the last, initial-stress.ts). */
  withoutReinforcement?: boolean;
}

export const DEFAULT_REINFORCEMENT_STIFFNESS = 1e6;

export const DEFAULT_YOUNGS_MODULUS = 1e5;
export const DEFAULT_PERMEABILITY = 1e-6;
export const DEFAULT_POISSONS_RATIO = 0.3;

/** How a material behaves in the finite element analysis. */
export type FeBehaviour = "plastic" | "elastic";

export interface FeModel {
  /** Node coordinates (corner nodes first, then midside nodes). */
  x: Float64Array;
  y: Float64Array;
  nodeCount: number;
  /** Corner node count (the vertices of the triangulation). */
  cornerCount: number;
  /** Element connectivity, 6 nodes per element. */
  el: Int32Array;
  elementCount: number;
  /** Materials used by the elements and the index of each element's. */
  materials: Material[];
  elMaterial: Int32Array;
  /** Per element: E, ν, ψ (rad) and behaviour. */
  elE: Float64Array;
  elNu: Float64Array;
  elPsi: Float64Array;
  elElastic: Uint8Array;
  /** Gauss point data (see `gaussData`) and coordinates, 3 per element. */
  gp: Float64Array;
  gpX: Float64Array;
  gpY: Float64Array;
  /** Strength at each Gauss point: c (kPa) and φ (rad). */
  gpC: Float64Array;
  /**
   * Undrained strength cap per Gauss point (kPa) of a combined material,
   * whose strength is the lesser of the drained and the undrained one
   * (a Tresca limit on the Mohr–Coulomb one); Infinity elsewhere.
   */
  gpCu: Float64Array;
  gpPhi: Float64Array;
  /** Pore pressure at each Gauss point (kPa, compression positive). */
  gpU: Float64Array;
  /** Equation number of each dof (2 per node, x then y), −1 if fixed. */
  eq: Int32Array;
  eqCount: number;
  /** Factorised stiffness matrix. */
  K: SparseCholesky;
  /**
   * External load vector per equation (gravity, surface loads, pore pressure
   * term), less the internal forces ∫ Bᵀ σ₀ of the initial stresses when
   * there are any (`withInitialStress`).
   */
  f: Float64Array;
  /** Initial effective stress per Gauss point (σx, σy, τxy, σz), added to D(ε − εp); null: none. */
  stress0: Float64Array | null;
  /** Norm of the external loads, the scale of the convergence tests (‖f‖ without initial stresses). */
  loadNorm: number;
  /** Per element: 1 where the material is not yet built (`inactiveMaterials`). */
  elInactive: Uint8Array;
  /** Surface edges (3 nodes each: end, midside, end), for plotting and loads. */
  surfaceEdges: Int32Array;
  /** The triangulation the mesh was made from. */
  triangulation: TriMesh;
  /** The target element size the mesh was made with (m). */
  sizeField: ((x: number, y: number) => number) & { min?: number };
  /** The seepage solution, when the pore pressures come from it. */
  seepage?: SeepageResult;
  /** Hoek–Brown rock: its parameters per Gauss point (index), whose c and φ follow the stress (`setHoekBrownStrength`). */
  gpHoekBrown: Map<number, HoekBrownParameters>;
  /** The partial factors of the strength (design values). */
  partialFactors: Slope["partialFactors"];
  /** gpC and gpPhi as built (from the elastic stress), to go back to. */
  gpC0: Float64Array;
  gpPhi0: Float64Array;
  /** Pile rows as beams on springs to the soil (piles.ts). */
  piles: FePiles;
  /** Notes on what the model leaves out. */
  warnings: string[];
  /**
   * Reinforcement as three-node bars along element edges (bonded to the
   * soil): nodes (end, middle, end) per bar, and per bar Gauss point (two
   * per bar) the strain–displacement row (6 numbers: x and y of each node),
   * the weight × length, the tensile capacity per metre of slope (from the
   * capacity envelope, so pullout is included) and whether it is passive
   * (divided by F, as the limit equilibrium solvers do).
   */
  bars: FeBars;
}

export interface FeBars {
  count: number;
  nodes: Int32Array;
  /** Reinforcement index of each bar. */
  source: Int32Array;
  /** Per Gauss point (2 per bar): B (6), weight (1). */
  gp: Float64Array;
  capacity: Float64Array;
  passive: Uint8Array;
  /** EA per bar (kN per metre of slope). */
  stiffness: Float64Array;
  /** Initial plastic strain per bar Gauss point: −P/EA in a prestressed free length (force P), 0 elsewhere. */
  ep0: Float64Array;
  /** Per bar: 1 for a pile spring, which acts in tension and compression (|N| ≤ capacity). */
  bothWays: Uint8Array;
  /**
   * Per bar Gauss point: 0 for the capacity in `capacity` (divided by F if
   * passive), 1 or 2 for a pile spring's lateral or axial limit from
   * capC, capSv and capTan (piles.ts, springCapacity).
   */
  capKind: Uint8Array;
  capC: Float64Array;
  capSv: Float64Array;
  capTan: Float64Array;
}

/** Per bar Gauss point record: B (6 numbers), weight × length. */
export const BAR_GP_STRIDE = 7;

/** Build the finite element model of a slope and factorise its stiffness. */
export function buildFeModel(slope: Slope, options: FeModelOptions = {}): FeModel {
  return feModelOf(testCall<number>("fem/model::buildFeModel", [slopeRef(slope), dataOptions(options), sizeFieldHandle(options.sizeField)]));
}

/**
 * Inputs of the limit equilibrium analysis that the finite element
 * analyses do not take: one warning for each in the slope, so that the
 * result is not read as including them. Pore pressures come from the
 * materials' water lines (or the seepage), strengths from the materials'
 * own models.
 */
export function ignoredInputWarnings(slope: Slope): string[] {
  return testCall("fem/model::ignoredInputWarnings", [slopeRef(slope)]);
}

/** Elastic solution: displacements per equation and effective stresses (σx, σy, τxy, σz) per Gauss point (of the loads alone: initial stresses are not added). */
export function solveElastic(model: FeModel): { u: Float64Array; stress: Float64Array } {
  return testCall("fem/model::solveElastic", [modelHandle(model)]);
}

/**
 * The model with initial effective stresses σ₀ per Gauss point (σx, σy,
 * τxy, σz): the stress is σ₀ + D(ε − εp), and the load vector becomes
 * f − ∫ Bᵀ σ₀, the out-of-balance force that the solvers equilibrate
 * (zero for initial stresses in equilibrium with the loads). The
 * displacements are counted from the initial state.
 */
export function withInitialStress(model: FeModel, stress0: Float64Array): FeModel {
  return feModelOf(testCall<number>("fem/model::withInitialStress", [modelHandle(model), stress0]));
}

/**
 * Strains of every Gauss point from a displacement vector (per equation):
 * εx, εy, γxy, εz (= 0 in plane strain), 4 per Gauss point.
 */
export function gaussStrains(model: FeModel, u: Float64Array, out: Float64Array): void {
  out.set(testCall<Float64Array>("fem/model::gaussStrains", [modelHandle(model), u]));
}

/**
 * Hoek–Brown rock: c and φ at each of its Gauss points set to the
 * instantaneous parameters at the stresses given (a trial's starting
 * state, srm.ts), or back to those of the elastic stress (null): the
 * tangent follows the stress as the strength reduction proceeds (Hammah,
 * Yacoub, Corkum & Curran 2005, Proc. 40th US Rock Mech. Symp., ARMA
 * 05-810).
 */
export function setHoekBrownStrength(model: FeModel, stress: Float64Array | null): void {
  testCall("fem/model::setHoekBrownStrength", [modelHandle(model), stress]);
  modelChanged(model);
}

/**
 * Local thickness of a material polygon: from points at a quarter, half and
 * three quarters of each edge a ray is cast along the inward normal to the
 * polygon's opposite side; each sample is that point and the distance.
 * Edges that occur twice in opposite directions (the zero-width bridge
 * that joins a lens to its surrounding ring, geometry-ops.ts) are neither
 * sources nor targets. Used for the thin-layer element size (an
 * implementation choice; 2·area / perimeter overestimates a bent layer and
 * one value for the whole polygon refines a thick body with a thin tail).
 */
export function polygonThicknessSamples(px: readonly number[], py: readonly number[]): { x: number; y: number; t: number }[] {
  return testCall("fem/model::polygonThicknessSamples", [px, py]);
}
