/**
 * Reusable Zustand selectors and hooks.
 *
 * Extracts commonly-duplicated store access patterns into shared hooks,
 * reducing boilerplate and preventing drift between components.
 */

import { useAppStore } from "./app-store";
import { getAnalysisInputSignature, RUN_RESET } from "./helpers";
import type { AppState } from "./types";

// ── Active viewport resolution ─────────────────────────────────

/** Read the mode-dependent viewport (offset + scale) from current store state. */
export function getActiveViewport(state: AppState): {
  viewOffset: [number, number];
  viewScale: number;
} {
  const offset =
    state.mode === "result" ? state.resultViewOffset : state.editViewOffset;
  const scale =
    state.mode === "result" ? state.resultViewScale : state.editViewScale;
  return { viewOffset: offset, viewScale: scale };
}

// ── Canvas model state (used by both EditCanvas & ResultCanvas) ─

/**
 * A hook that subscribes to all model/view state fields needed by the
 * canvas render loop. Both EditCanvas and ResultCanvas share this set.
 */
export function useCanvasModelState() {
  const result = useAppStore((s) => s.result);
  const resultViewSettings = useAppStore((s) => s.resultViewSettings);
  const orientation = useAppStore((s) => s.orientation);
  const coordinates = useAppStore((s) => s.coordinates);
  const materials = useAppStore((s) => s.materials);
  const materialBoundaries = useAppStore((s) => s.materialBoundaries);
  const analysisLimits = useAppStore((s) => s.analysisLimits);
  const udls = useAppStore((s) => s.udls);
  const lineLoads = useAppStore((s) => s.lineLoads);
  const piezometricLine = useAppStore((s) => s.piezometricLine);
  const selectedPointIndex = useAppStore((s) => s.selectedPointIndex);
  const regionMaterials = useAppStore((s) => s.regionMaterials);
  const assigningMaterialId = useAppStore((s) => s.assigningMaterialId);
  const selectedRegionKey = useAppStore((s) => s.selectedRegionKey);
  const selectedAnnotationIds = useAppStore((s) => s.selectedAnnotationIds);
  const theme = useAppStore((s) => s.theme);
  const snapToGrid = useAppStore((s) => s.snapToGrid);
  const gridSnapSize = useAppStore((s) => s.gridSnapSize);
  const projectInfo = useAppStore((s) => s.projectInfo);

  return {
    result,
    resultViewSettings,
    orientation,
    coordinates,
    materials,
    materialBoundaries,
    analysisLimits,
    udls,
    lineLoads,
    piezometricLine,
    selectedPointIndex,
    regionMaterials,
    assigningMaterialId,
    selectedRegionKey,
    selectedAnnotationIds,
    theme,
    snapToGrid,
    gridSnapSize,
    projectInfo,
  };
}

// ── Canvas actions (stable refs, shared by EditCanvas & ResultCanvas) ─

/**
 * Returns stable action references that never change between renders.
 * This replaces the `useMemo(() => { const s = getState(); ... }, [])`
 * pattern duplicated in EditCanvas and ResultCanvas.
 */
export function useCanvasActions() {
  // Zustand guarantees action identities are stable across the store lifetime,
  // so reading them once from getState() at module level has no correctness risk.
  // We re-read on each call to stay safe if the store is replaced (e.g. tests).
  const state = useAppStore.getState();
  return {
    setAnalysisLimits: state.setAnalysisLimits,
    updateUdl: state.updateUdl,
    updateLineLoad: state.updateLineLoad,
    setPiezoCoordinate: state.setPiezoCoordinate,
    insertPiezoPointAt: state.insertPiezoPointAt,
    removePiezoPoint: state.removePiezoPoint,
    setCoordinate: state.setCoordinate,
    insertCoordinateAt: state.insertCoordinateAt,
    removeCoordinate: state.removeCoordinate,
    setSelectedPoint: state.setSelectedPoint,
    updateBoundaryPoint: state.updateBoundaryPoint,
    removeBoundaryPoint: state.removeBoundaryPoint,
    insertBoundaryPointAt: state.insertBoundaryPointAt,
    setRegionMaterial: state.setRegionMaterial,
    setAssigningMaterial: state.setAssigningMaterial,
    setSelectedRegionKey: state.setSelectedRegionKey,
    updateAnnotation: state.updateAnnotation,
    removeAnnotation: state.removeAnnotation,
    setSelectedAnnotations: state.setSelectedAnnotations,
    toggleAnnotationSelection: state.toggleAnnotationSelection,
    alignAnnotations: state.alignAnnotations,
    setCanvasToolbar: state.setCanvasToolbar,
    setCursorWorld: state.setCursorWorld,
  };
}

// ── Undo / redo with analysis signature diffing ─────────────────

/**
 * Undo the last temporal state, resetting analysis results if the
 * analysis-relevant inputs changed.
 */
export function performUndo(): void {
  const before = getAnalysisInputSignature(useAppStore.getState());
  useAppStore.temporal.getState().resume();
  useAppStore.temporal.getState().undo();
  const after = getAnalysisInputSignature(useAppStore.getState());
  if (before !== after) {
    useAppStore.setState(RUN_RESET);
  }
}

/**
 * Redo the next temporal state, resetting analysis results if the
 * analysis-relevant inputs changed.
 */
export function performRedo(): void {
  const before = getAnalysisInputSignature(useAppStore.getState());
  useAppStore.temporal.getState().resume();
  useAppStore.temporal.getState().redo();
  const after = getAnalysisInputSignature(useAppStore.getState());
  if (before !== after) {
    useAppStore.setState(RUN_RESET);
  }
}
