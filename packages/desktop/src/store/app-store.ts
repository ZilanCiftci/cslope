import { create } from "zustand";
import { temporal } from "zundo";
import type { AppState } from "./types";
import { createAnalysisSlice } from "./slices/analysisSlice";
import { createCanvasToolbarSlice } from "./slices/canvasToolbarSlice";
import { createGeometrySlice } from "./slices/geometrySlice";
import { createLayoutSlice } from "./slices/layoutSlice";
import { createLoadsSlice } from "./slices/loadsSlice";
import { createModelsSlice } from "./slices/modelsSlice";
import { createResultViewSlice } from "./slices/resultViewSlice";
import { createViewportSlice } from "./slices/viewportSlice";
export * from "./types";
export * from "./defaults";
export * from "./helpers";

/**
 * Fields tracked by undo/redo — geometry, materials, loads, analysis options.
 * Excludes layout, viewport, analysis status, selection state, and model list.
 */
type UndoableState = Pick<
  AppState,
  | "orientation"
  | "coordinates"
  | "materials"
  | "materialBoundaries"
  | "regionMaterials"
  | "piezometricLine"
  | "udls"
  | "lineLoads"
  | "analysisLimits"
  | "options"
>;

export const useAppStore = create<AppState>()(
  temporal(
    (...args) => ({
      ...createLayoutSlice(...args),
      ...createModelsSlice(...args),
      ...createGeometrySlice(...args),
      ...createLoadsSlice(...args),
      ...createAnalysisSlice(...args),
      ...createViewportSlice(...args),
      ...createResultViewSlice(...args),
      ...createCanvasToolbarSlice(...args),
    }),
    {
      partialize: (state): UndoableState => ({
        orientation: state.orientation,
        coordinates: state.coordinates,
        materials: state.materials,
        materialBoundaries: state.materialBoundaries,
        regionMaterials: state.regionMaterials,
        piezometricLine: state.piezometricLine,
        udls: state.udls,
        lineLoads: state.lineLoads,
        analysisLimits: state.analysisLimits,
        options: state.options,
      }),
      limit: 50,
      equality: (pastState, currentState) =>
        JSON.stringify(pastState) === JSON.stringify(currentState),
    },
  ),
);
