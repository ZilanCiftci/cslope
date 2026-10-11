import type { StateCreator } from "zustand";
import { isClosedBoundary } from "../utils/regions";
import type { AnalysisResponse, SlopeDefinition } from "../worker/messages";
import { toCanonicalSlopeDefinition } from "@cslope/engine";
import type { AppState, ModelEntry, ModelsSlice } from "./types";
import { DEFAULT_ANALYSIS_LIMITS, DEFAULT_PIEZO_LINE } from "./defaults";
import { flatFieldsFromModel } from "../features/properties/sections/material-forms/model-defaults";
import { mainPiezoLine } from "../utils/piezo";

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

  // The engine looks materials up by name, but users can give two
  // materials the same name.  Give every material a unique engine name
  // (the display name, suffixed on collision) and refer to it by id.
  const engineNameById = new Map<string, string>();
  const usedNames = new Set<string>();
  for (const m of materials) {
    let name = m.name;
    for (let k = 2; usedNames.has(name); k++) name = `${m.name} (${k})`;
    usedNames.add(name);
    engineNameById.set(m.id, name);
  }

  const slope: SlopeDefinition = {
    orientation: model.orientation ?? "ltr",
    coordinates: model.coordinates,
    materials: materials.map((m) => {
      const flat = flatFieldsFromModel(m.model);
      return {
        name: engineNameById.get(m.id) ?? m.name,
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
    // Pass boundaries as coordinates-only (materialName not used with
    // regionAssignments), in the order the canvas applies them (by id,
    // open boundaries before closed ones) so both split the same way.
    const sorted = [...model.materialBoundaries].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    slope.materialBoundaries = [
      ...sorted.filter((b) => !isClosedBoundary(b.coordinates)),
      ...sorted.filter((b) => isClosedBoundary(b.coordinates)),
    ].map((b) => ({
      coordinates: b.coordinates,
      materialName: "",
    }));
  }

  // Point-based region assignments.  These apply even without interior
  // boundaries: the canvas lets the user assign a material to the single
  // region, and the analysis must use it too.
  if (model.regionMaterials?.length > 0) {
    slope.regionAssignments = model.regionMaterials
      .map((a) => {
        const name = engineNameById.get(a.materialId);
        return name ? { point: a.point, materialName: name } : null;
      })
      .filter(
        (a): a is { point: [number, number]; materialName: string } =>
          a !== null,
      );
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
    // Free water above the ground comes from the main line; a clipped
    // line never rises above the surface.
    const followBoundary = piezometricLine.freeWater === false;
    // A main line still being drawn (under two points) cannot carry the
    // water: the first complete line does.
    const mainLine =
      mainPiezoLine({
        lines: piezometricLine.lines.filter((l) => l.coordinates.length >= 2),
        mainLineId: piezometricLine.mainLineId,
      }) ?? piezometricLine.lines[0];
    if (mainLine.coordinates.length >= 2) {
      slope.waterTable = {
        mode: "custom",
        value: mainLine.coordinates,
        followBoundary,
      };
    }

    // Several lines: each material uses the line assigned to it (the
    // main line when none is assigned, as the UI shows).
    const usableLines = piezometricLine.lines.filter(
      (l) => l.coordinates.length >= 2,
    );
    if (piezometricLine.lines.length > 1 && usableLines.length > 0) {
      slope.waterTables = usableLines.map((l) => ({
        id: l.id,
        coordinates: l.coordinates,
        followBoundary,
      }));
      const usableIds = new Set(usableLines.map((l) => l.id));
      slope.materials = slope.materials.map((dtoMaterial, i) => {
        const lineId = piezometricLine.materialAssignment?.[materials[i].id];
        return lineId && usableIds.has(lineId)
          ? { ...dtoMaterial, waterTableId: lineId }
          : dtoMaterial;
      });
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
    const circles = model.customSearchPlanes.filter((p) => !p.points);
    // Polylines need two points; incomplete ones are still being entered.
    const polylines = model.customSearchPlanes.filter(
      (p) => p.points && p.points.length >= 2,
    );
    if (circles.length > 0) {
      slope.customSearchPlanes = circles.map((p) => ({
        cx: p.cx,
        cy: p.cy,
        radius: p.radius,
      }));
    }
    if (polylines.length > 0) {
      slope.customSurfaces = polylines.map((p) => ({ points: p.points! }));
    }
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
  // Only what reaches the engine: selecting or renaming a piezometric
  // line (activeLineId, name, colour) must not discard the result.
  const piezo = state.piezometricLine;
  return JSON.stringify({
    orientation: state.orientation,
    coordinates: state.coordinates,
    coordinateExpressions: state.coordinateExpressions,
    parameters: state.parameters,
    materials: state.materials,
    materialBoundaries: state.materialBoundaries,
    regionMaterials: state.regionMaterials,
    piezometricLine: {
      lines: piezo.lines.map((l) => ({
        id: l.id,
        coordinates: l.coordinates,
        coordinateExpressions: l.coordinateExpressions,
      })),
      materialAssignment: piezo.materialAssignment,
      freeWater: piezo.freeWater,
    },
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
