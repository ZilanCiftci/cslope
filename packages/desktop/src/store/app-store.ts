import { create } from "zustand";
import { temporal } from "zundo";
import type { AppState } from "./types";
import { markProjectClean, withoutPaperViewport } from "./unsaved";
import { modelViewLock, viewLockContains } from "../features/view/viewLock";
import { paperContentOf } from "../features/view/extents";
import { createAnalysisSlice } from "./slices/analysisSlice";
import { createCanvasToolbarSlice } from "./slices/canvasToolbarSlice";
import { createGeometrySlice } from "./slices/geometrySlice";
import { createLayoutSlice } from "./slices/layoutSlice";
import { createLoadsSlice } from "./slices/loadsSlice";
import {
  createModelsSlice,
  INITIAL_MODEL,
  mapModelToState,
} from "./slices/modelsSlice";
import { createParametersSlice } from "./slices/parametersSlice";
import { createResultViewSlice } from "./slices/resultViewSlice";
import { createViewportSlice } from "./slices/viewportSlice";
export * from "./types";
export * from "./defaults";
export * from "./helpers";
export * from "./selectors";
export { isProjectDirty, markProjectClean } from "./unsaved";

/**
 * Fields tracked by undo/redo — geometry, materials, loads, analysis options.
 * Excludes layout, viewport, analysis status, selection state, and model list.
 */
type UndoableState = Pick<
  AppState,
  | "orientation"
  | "coordinates"
  | "coordinateExpressions"
  | "parameters"
  | "materials"
  | "materialBoundaries"
  | "regionMaterials"
  | "piezometricLine"
  | "udls"
  | "lineLoads"
  | "reinforcements"
  | "piles"
  | "customSearchPlanes"
  | "customPlanesOnly"
  | "analysisLimits"
  | "options"
  | "resultViewSettings"
>;

export const useAppStore = create<AppState>()(
  temporal(
    (...args) => ({
      ...createLayoutSlice(...args),
      ...createModelsSlice(...args),
      ...createGeometrySlice(...args),
      ...createParametersSlice(...args),
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
        coordinateExpressions: state.coordinateExpressions,
        parameters: state.parameters,
        materials: state.materials,
        materialBoundaries: state.materialBoundaries,
        regionMaterials: state.regionMaterials,
        piezometricLine: state.piezometricLine,
        udls: state.udls,
        lineLoads: state.lineLoads,
        reinforcements: state.reinforcements,
        piles: state.piles,
        customSearchPlanes: state.customSearchPlanes,
        customPlanesOnly: state.customPlanesOnly,
        analysisLimits: state.analysisLimits,
        options: state.options,
        resultViewSettings: state.resultViewSettings,
      }),
      limit: 50,
      // Panning and zooming the result paper is no edit: a pan would
      // otherwise push one step per pointer move and evict real edits.
      equality: (pastState, currentState) =>
        JSON.stringify({ ...pastState, resultViewSettings: withoutPaperViewport(pastState.resultViewSettings) }) ===
        JSON.stringify({ ...currentState, resultViewSettings: withoutPaperViewport(currentState.resultViewSettings) }),
    },
  ),
);

// Show the starter model the explorer lists (the slices' own defaults are
// a generic model, so the screen and Save showed different data under the
// starter's name).
useAppStore.setState(mapModelToState(INITIAL_MODEL));
useAppStore.temporal.getState().clear();

// The project the app starts with counts as saved.
markProjectClean(useAppStore.getState());

// A locked result view that showed the whole model keeps doing so when the
// geometry grows (otherwise the result view and the PDF/PNG exports stayed
// clipped to the old extent). A deliberate zoom to part of the model is
// left alone.
useAppStore.subscribe((state, prev) => {
  if (
    state.coordinates === prev.coordinates ||
    state.activeModelId !== prev.activeModelId ||
    state.coordinates.length < 3
  ) {
    return;
  }
  const lock = state.resultViewSettings.viewLock;
  if (!lock) return;
  if (
    viewLockContains(lock, prev.coordinates) &&
    !viewLockContains(lock, state.coordinates)
  ) {
    // Part of the edit that grew the model, not an undo step of its own
    // (which would also clear the redo stack when a redo grows it again).
    const history = useAppStore.temporal.getState();
    const tracking = history.isTracking;
    history.pause();
    try {
      // The frame the model started with and "Use model bounds" gives.
      state.setResultViewSettings({
        viewLock: modelViewLock(paperContentOf(state), state.resultViewSettings),
      });
    } finally {
      if (tracking) history.resume();
    }
  }
});
