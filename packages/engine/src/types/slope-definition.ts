/**
 * Serialized slope definition DTO.
 *
 * This is the data-transfer shape used to pass a slope model between
 * the UI, the Web Worker, and the engine.
 */

import type { AnalysisLimits } from "./analysis";
import type { SlopeOrientation } from "../model/canonical";
import type { MaterialModel } from "./material-models";
import type { Pile, Reinforcement } from "./reinforcement";

/** A material of a slope definition. */
export interface SlopeMaterialDefinition {
  name: string;
  /**
   * The material: unit weight and strength. The only source of them; see
   * `materialModelOf` for definitions written before models existed.
   */
  model?: MaterialModel;
  /**
   * @deprecated Older definitions without `model` gave a Mohr-Coulomb
   * material in these flat fields. Read only when `model` is absent.
   */
  unitWeight?: number;
  /** @deprecated See `unitWeight`. */
  frictionAngle?: number;
  /** @deprecated See `unitWeight`. */
  cohesion?: number;
  /** @deprecated See `unitWeight`. */
  cohesionRefDepth?: number;
  /** @deprecated See `unitWeight`. */
  cohesionRateOfChange?: number;
  /** @deprecated See `unitWeight`. */
  cohesionUndrained?: number;
  /** Depth range [top, bottom] in m for this material. */
  depthRange?: [number, number];
  color?: string;
  /**
   * Id of an entry in `waterTables` that governs pore pressure in this
   * material.  When absent (or unknown) the default `waterTable` is used.
   */
  waterTableId?: string;
}

/**
 * The model of a definition's material: its `model`, or for an older
 * definition a Mohr-Coulomb model from the flat fields.
 */
export function materialModelOf(m: SlopeMaterialDefinition): MaterialModel {
  if (m.model) return m.model;
  if (typeof m.unitWeight !== "number") throw new Error(`Material "${m.name}" has no model.`);
  return {
    kind: "mohr-coulomb",
    unitWeight: m.unitWeight,
    cohesion: m.cohesion ?? 0,
    frictionAngle: m.frictionAngle ?? 0,
    ...(m.cohesionRefDepth !== undefined ? { cohesionRefDepth: m.cohesionRefDepth } : {}),
    ...(m.cohesionRateOfChange !== undefined ? { cohesionRateOfChange: m.cohesionRateOfChange } : {}),
    ...(m.cohesionUndrained !== undefined ? { cohesionUndrained: m.cohesionUndrained } : {}),
  };
}

/** The flat fields of older definitions (and their material type). */
const FLAT_FIELDS = ["unitWeight", "frictionAngle", "cohesion", "cohesionRefDepth", "cohesionRateOfChange", "cohesionUndrained", "materialType"];

/** A definition's material with its model and without the flat fields. */
export function withMaterialModel(m: SlopeMaterialDefinition): SlopeMaterialDefinition {
  const out: Record<string, unknown> = { ...m, model: materialModelOf(m) };
  for (const key of FLAT_FIELDS) delete out[key];
  return out as unknown as SlopeMaterialDefinition;
}

/** Slope definition sent from the UI to the engine / worker. */
export interface SlopeDefinition {
  /** Model orientation used for canonical mirroring. */
  orientation?: SlopeOrientation;
  /** Boundary coordinates [[x,y], ...]. */
  coordinates: [number, number][];
  /** Material assignments. */
  materials: SlopeMaterialDefinition[];
  /** Water table definition (optional). */
  waterTable?: {
    mode: "height" | "depth" | "custom";
    value: number | [number, number][];
    followBoundary?: boolean;
  };
  /**
   * Additional water tables (piezometric lines) that materials can refer
   * to with `waterTableId`.  Same clipping rule as `waterTable`.
   */
  waterTables?: Array<{
    id: string;
    coordinates: [number, number][];
    followBoundary?: boolean;
  }>;
  /** UDL loads. */
  udls?: Array<{ magnitude: number; x1: number; x2: number }>;
  /** Line loads (point loads). */
  lineLoads?: Array<{ magnitude: number; x: number }>;
  /** Reinforcement: anchors, tiebacks, soil nails, geosynthetics. */
  reinforcements?: Reinforcement[];
  /** Pile rows and sheet pile walls (shear). */
  piles?: Pile[];
  /** Material boundary polylines that divide the slope into layers. */
  materialBoundaries?: Array<{
    coordinates: [number, number][];
    materialName: string;
  }>;
  /** Material name for the top region (above all boundaries).
   *  Only needed when it differs from the first (default) material. */
  topRegionMaterialName?: string;
  /**
   * Point-based region material assignments.
   * Each entry maps a representative point to a material name.
   * The engine assigns the material to whichever region contains the point.
   */
  regionAssignments?: Array<{
    point: [number, number];
    materialName: string;
  }>;
  /** Search area limits for entry/exit ranges. */
  analysisLimits?: AnalysisLimits;
  /** User-specified circular search planes (cx, cy, radius). */
  customSearchPlanes?: Array<{ cx: number; cy: number; radius: number }>;
  /**
   * User-specified non-circular surfaces: polylines through the soil. They
   * are fitted to the ground (end segments extended to it) and analysed
   * with moments about a default axis point, or about `axis` when given
   * (the circle centre an optimised surface was derived from).
   */
  customSurfaces?: Array<{ points: [number, number][]; axis?: [number, number] }>;
  /** When true, only analyse custom search planes (skip random search). */
  customPlanesOnly?: boolean;
}
