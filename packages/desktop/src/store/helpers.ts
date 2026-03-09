import type { StateCreator } from "zustand";
import type { AnalysisResponse, SlopeDefinition } from "../worker/messages";
import { toCanonicalSlopeDefinition } from "@cslope/engine";
import { computeRegions, findMaterialBelowBoundary } from "../utils/regions";
import type { AppState, ModelsSlice } from "./types";

export type SliceCreator<T> = StateCreator<AppState, [], [], T>;

let idCounter = 100;
export function nextId(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `${prefix}-${cryptoApi.randomUUID()}`;
  }
  return `${prefix}-${++idCounter}`;
}

export function buildSlopeDTO(state: AppState): SlopeDefinition {
  const activeModel = state.models.find(
    (model) => model.id === state.activeModelId,
  );
  const slope: SlopeDefinition = {
    orientation: activeModel?.orientation ?? state.orientation ?? "ltr",
    coordinates: state.coordinates,
    materials: state.materials.map((m) => ({
      name: m.name,
      unitWeight: m.unitWeight,
      frictionAngle: m.frictionAngle,
      cohesion: m.cohesion,
      color: m.color,
      depthRange: m.depthRange,
      model: m.model,
    })),
  };

  if (state.materialBoundaries.length > 0) {
    const defaultMatId = state.materials[0]?.id ?? "";
    const regions = computeRegions(
      state.coordinates,
      state.materialBoundaries,
      state.regionMaterials,
      defaultMatId,
    );

    slope.materialBoundaries = state.materialBoundaries.map((b) => {
      const matId = findMaterialBelowBoundary(b, regions, defaultMatId);
      const matName =
        state.materials.find((m) => m.id === matId)?.name ??
        state.materials[0].name;
      return {
        coordinates: b.coordinates,
        materialName: matName,
      };
    });

    const topRegion = regions.find((r) => r.regionKey === "top");
    if (topRegion && topRegion.materialId !== defaultMatId) {
      const topMatName = state.materials.find(
        (m) => m.id === topRegion.materialId,
      )?.name;
      if (topMatName) {
        slope.topRegionMaterialName = topMatName;
      }
    }
  }

  if (state.analysisLimits.enabled) {
    slope.analysisLimits = {
      entryLeftX: state.analysisLimits.entryLeftX,
      entryRightX: state.analysisLimits.entryRightX,
      exitLeftX: state.analysisLimits.exitLeftX,
      exitRightX: state.analysisLimits.exitRightX,
    };
  }

  if (state.piezometricLine.lines.length > 0) {
    const firstLine = state.piezometricLine.lines[0];
    if (firstLine.coordinates.length >= 2) {
      slope.waterTable = {
        mode: "custom",
        value: firstLine.coordinates,
      };
    }
  }

  if (state.udls.length > 0) {
    slope.udls = state.udls.map((u) => ({
      magnitude: u.magnitude,
      x1: u.x1,
      x2: u.x2,
    }));
  }

  if (state.lineLoads.length > 0) {
    slope.lineLoads = state.lineLoads.map((l) => ({
      magnitude: l.magnitude,
      x: l.x,
    }));
  }

  if (state.customSearchPlanes.length > 0) {
    slope.customSearchPlanes = state.customSearchPlanes.map((p) => ({
      cx: p.cx,
      cy: p.cy,
      radius: p.radius,
    }));
    slope.customPlanesOnly = state.customPlanesOnly;
  }

  return toCanonicalSlopeDefinition(slope);
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
