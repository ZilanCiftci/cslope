import type { SliceCreator } from "../helpers";
import type { AppState, CanvasSelection, CanvasSelectionSlice, ModelLocks } from "../types";
import {
  groupIds,
  sameSelection,
  withGroupLocked,
  withObjectLocked,
  withoutGeometryLocks,
} from "../canvas-selection";

type Temporal = { getState: () => { isTracking: boolean; pause: () => void; resume: () => void } };

/** Runs `fn` without recording an undo step (a selection is no edit). */
function untracked(api: unknown, fn: () => void): void {
  const temporal = (api as { temporal?: Temporal }).temporal?.getState();
  const tracking = temporal?.isTracking ?? false;
  if (tracking) temporal?.pause();
  try {
    fn();
  } finally {
    if (tracking) temporal?.resume();
  }
}

/**
 * The older selection fields that follow the canvas selection: the
 * exterior point (the exterior table's row), the custom plane, and the
 * boundary whose points the boundaries window shows (kept when another
 * kind of object is selected).
 */
export function selectionMirror(
  sel: CanvasSelection | null,
  s: Pick<AppState, "selectedMaterialBoundaryId">,
): Pick<AppState, "selectedPointIndex" | "selectedCustomPlaneId" | "selectedMaterialBoundaryId"> {
  return {
    selectedPointIndex: sel?.object.type === "exterior" && typeof sel.point === "number" ? sel.point : null,
    selectedCustomPlaneId: sel?.object.type === "customPlane" ? sel.object.id : null,
    selectedMaterialBoundaryId: sel?.object.type === "boundary" ? sel.object.id : s.selectedMaterialBoundaryId,
  };
}

export const createCanvasSelectionSlice: SliceCreator<CanvasSelectionSlice> = (set, get, api) => {
  const setLocks = (locks: ModelLocks) =>
    set((s) => ({
      locks,
      models: s.models.map((m) => {
        if (m.id !== s.activeModelId) return m;
        const next = { ...m };
        if (Object.keys(locks).length > 0) next.locks = locks;
        else delete next.locks;
        return next;
      }),
    }));

  return {
    canvasSelection: null,
    canvasSelectionCycle: null,
    locks: {},

    selectCanvasObject: (object, point = null, cycle = null) => {
      const s = get();
      const sel: CanvasSelection | null = object ? { object, point } : null;
      const sameCycle =
        s.canvasSelectionCycle === cycle ||
        (!!cycle &&
          !!s.canvasSelectionCycle &&
          cycle.position === s.canvasSelectionCycle.position &&
          cycle.count === s.canvasSelectionCycle.count);
      if (sameSelection(s.canvasSelection, sel) && sameCycle) return;
      set({ canvasSelection: sel, canvasSelectionCycle: cycle, ...selectionMirror(sel, s) });
      // A water line's points are edited on the active line (its table in
      // the window, the drag): make the selected one active.
      if (object?.type === "waterLine" && s.piezometricLine.activeLineId !== object.id) {
        untracked(api, () => get().setActivePiezoLine(object.id));
      }
    },

    selectCanvasPoint: (point) => {
      const sel = get().canvasSelection;
      if (!sel) return;
      get().selectCanvasObject(sel.object, point, get().canvasSelectionCycle);
    },

    clearCanvasSelection: () => get().selectCanvasObject(null),

    setObjectLocked: (object, locked) => setLocks(withObjectLocked(get().locks, object, locked)),

    lockAllOfGroup: (group) => {
      const s = get();
      if (group !== "exterior" && group !== "searchLimits" && groupIds(s, group).length === 0) return;
      setLocks(withGroupLocked(s.locks, s, group));
    },

    unlockAll: () => setLocks({}),

    setModelLocks: (locks) => setLocks(locks),

    unlockGeometry: () => setLocks(withoutGeometryLocks(get().locks)),
  };
};
