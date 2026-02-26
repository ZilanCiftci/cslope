import type { SliceCreator } from "../helpers";
import type { ModelEntry, ViewportSlice } from "../types";

type ViewportState = ViewportSlice & {
  activeModelId: string;
  models: ModelEntry[];
};

const syncActiveModel = (
  state: ViewportState,
  patch: Partial<ViewportSlice>,
) => ({
  ...patch,
  models: state.models.map((m) =>
    m.id === state.activeModelId
      ? {
          ...m,
          editViewOffset: patch.editViewOffset ?? state.editViewOffset,
          editViewScale: patch.editViewScale ?? state.editViewScale,
          resultViewOffset: patch.resultViewOffset ?? state.resultViewOffset,
          resultViewScale: patch.resultViewScale ?? state.resultViewScale,
        }
      : m,
  ),
});

export const createViewportSlice: SliceCreator<ViewportSlice> = (set) => ({
  editViewOffset: [0, 0],
  editViewScale: 0,
  resultViewOffset: [0, 0],
  resultViewScale: 0,

  setEditViewOffset: (offset) =>
    set((s) => syncActiveModel(s, { editViewOffset: offset })),
  setEditViewScale: (scale) =>
    set((s) => syncActiveModel(s, { editViewScale: scale })),
  setResultViewOffset: (offset) =>
    set((s) => syncActiveModel(s, { resultViewOffset: offset })),
  setResultViewScale: (scale) =>
    set((s) => syncActiveModel(s, { resultViewScale: scale })),
});
