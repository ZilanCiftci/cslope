import { create } from "zustand";
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

export const useAppStore = create<AppState>()((...args) => ({
  ...createLayoutSlice(...args),
  ...createModelsSlice(...args),
  ...createGeometrySlice(...args),
  ...createLoadsSlice(...args),
  ...createAnalysisSlice(...args),
  ...createViewportSlice(...args),
  ...createResultViewSlice(...args),
  ...createCanvasToolbarSlice(...args),
}));
