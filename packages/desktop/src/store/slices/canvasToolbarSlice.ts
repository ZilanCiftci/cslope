import type { SliceCreator } from "../helpers";
import type { CanvasToolbarSlice } from "../types";

export const createCanvasToolbarSlice: SliceCreator<CanvasToolbarSlice> = (
  set,
) => ({
  canvasToolbar: null,
  setCanvasToolbar: (toolbar) => set({ canvasToolbar: toolbar }),
});
