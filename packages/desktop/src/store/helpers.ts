import type { StateCreator } from "zustand";
import type { AnalysisResponse, SlopeDefinition } from "../worker/messages";
import { toCanonicalSlopeDefinition } from "@cslope/engine";
import type { AppState, ModelEntry, ModelsSlice } from "./types";
import { DEFAULT_ANALYSIS_LIMITS, DEFAULT_PIEZO_LINE } from "./defaults";
import { flatFieldsFromModel } from "../features/properties/sections/material-forms/model-defaults";

export type SliceCreator<T> = StateCreator<AppState, [], [], T>;

let idCounter = 100;
export function nextId(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `${prefix}-${cryptoApi.randomUUID()}`;
  }
  return `${prefix}-${++idCounter}`;
}

/**
 * Build a `SlopeDefinition` DTO from a `ModelEntry`.
 *
 * This is the **single source of truth** for converting stored model
 * data into the DTO consumed by the analysis worker.  Both the
 * single-run (`runAnalysis`) and batch-run (`runAllAnalyses`) paths
 * use this function, ensuring feature parity.
 */
export function buildSlopeDTOFromModel(model: ModelEntry): SlopeDefinition {
  const materials = model.materials ?? [];
  const analysisLimits = model.analysisLimits ?? { ...DEFAULT_ANALYSIS_LIMITS };
  const piezometricLine = model.piezometricLine ?? { ...DEFAULT_PIEZO_LINE };

  const slope: SlopeDefinition = {
    orientation: model.orientation ?? "ltr",
    coordinates: model.coordinates,
    materials: materials.map((m) => {
      const flat = flatFieldsFromModel(m.model);
      return {
        name: m.name,
        unitWeight: flat.unitWeight,
        frictionAngle: flat.frictionAngle,
        cohesion: flat.cohesion,
        color: m.color,
        depthRange: m.depthRange,
        model: m.model,
      };
    }),
  };

  if (model.materialBoundaries?.length > 0) {
    // Pass boundaries as coordinates-only (materialName not used with regionAssignments)
    slope.materialBoundaries = model.materialBoundaries.map((b) => ({
      coordinates: b.coordinates,
      materialName: "",
    }));

    // Point-based region assignments
    if (model.regionMaterials.length > 0) {
      slope.regionAssignments = model.regionMaterials
        .map((a) => {
          const mat = materials.find((m) => m.id === a.materialId);
          return mat ? { point: a.point, materialName: mat.name } : null;
        })
        .filter(
          (a): a is { point: [number, number]; materialName: string } =>
            a !== null,
        );
    }
  }

  if (analysisLimits.enabled) {
    slope.analysisLimits = {
      entryLeftX: analysisLimits.entryLeftX,
      entryRightX: analysisLimits.entryRightX,
      exitLeftX: analysisLimits.exitLeftX,
      exitRightX: analysisLimits.exitRightX,
    };
  }

  if (piezometricLine.lines.length > 0) {
    const firstLine = piezometricLine.lines[0];
    if (firstLine.coordinates.length >= 2) {
      slope.waterTable = {
        mode: "custom",
        value: firstLine.coordinates,
      };
    }
  }

  if (model.udls?.length > 0) {
    slope.udls = model.udls.map((u) => ({
      magnitude: u.magnitude,
      x1: u.x1,
      x2: u.x2,
    }));
  }

  if (model.lineLoads?.length > 0) {
    slope.lineLoads = model.lineLoads.map((l) => ({
      magnitude: l.magnitude,
      x: l.x,
    }));
  }

  if (model.customSearchPlanes?.length > 0) {
    slope.customSearchPlanes = model.customSearchPlanes.map((p) => ({
      cx: p.cx,
      cy: p.cy,
      radius: p.radius,
    }));
    slope.customPlanesOnly = model.customPlanesOnly ?? false;
  }

  return toCanonicalSlopeDefinition(slope);
}

/**
 * Build a `SlopeDefinition` from the flat (denormalised) app state.
 *
 * This is a convenience wrapper around `buildSlopeDTOFromModel` that
 * assembles a model-shaped object from the active state fields.
 */
export function buildSlopeDTO(state: AppState): SlopeDefinition {
  return buildSlopeDTOFromModel({
    id: state.activeModelId,
    name: "",
    orientation: state.orientation,
    coordinates: state.coordinates,
    coordinateExpressions: state.coordinateExpressions,
    parameters: state.parameters,
    materials: state.materials,
    materialBoundaries: state.materialBoundaries,
    regionMaterials: state.regionMaterials,
    piezometricLine: state.piezometricLine,
    udls: state.udls,
    lineLoads: state.lineLoads,
    customSearchPlanes: state.customSearchPlanes,
    customPlanesOnly: state.customPlanesOnly,
    options: state.options,
    analysisLimits: state.analysisLimits,
  });
}

export const RUN_RESET = {
  runState: "idle" as const,
  progress: 0,
  result: null,
  errorMessage: null,
};

export function getAnalysisInputSignature(state: AppState): string {
  return JSON.stringify({
    orientation: state.orientation,
    coordinates: state.coordinates,
    coordinateExpressions: state.coordinateExpressions,
    parameters: state.parameters,
    materials: state.materials,
    materialBoundaries: state.materialBoundaries,
    regionMaterials: state.regionMaterials,
    piezometricLine: state.piezometricLine,
    udls: state.udls,
    lineLoads: state.lineLoads,
    customSearchPlanes: state.customSearchPlanes,
    customPlanesOnly: state.customPlanesOnly,
    analysisLimits: state.analysisLimits,
    options: state.options,
  });
}

export type WorkerMessageHandler = (
  event: MessageEvent<AnalysisResponse>,
) => void;

export type ModelsSliceWithHelpers = ModelsSlice & {
  _hydrateModels: () => void;
};
