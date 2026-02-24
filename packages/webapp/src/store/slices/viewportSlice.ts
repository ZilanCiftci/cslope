import type { SliceCreator } from "../helpers";
import type { ViewportSlice } from "../types";

export const createViewportSlice: SliceCreator<ViewportSlice> = (set) => ({
  editViewOffset: [0, 0],
  editViewScale: 0,
  resultViewOffset: [0, 0],
  resultViewScale: 0,

  setEditViewOffset: (offset) => set({ editViewOffset: offset }),
  setEditViewScale: (scale) => set({ editViewScale: scale }),
  setResultViewOffset: (offset) => set({ resultViewOffset: offset }),
  setResultViewScale: (scale) => set({ resultViewScale: scale }),
});
