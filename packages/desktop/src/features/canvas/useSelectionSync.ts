import { useEffect } from "react";
import { setSelectionFollowsModel, useAppStore } from "../../store/app-store";
import { sameSelection } from "../../store/canvas-selection";
import { selectionMirror } from "../../store/slices/canvasSelectionSlice";
import type { CanvasObjectRef, CanvasSelection } from "../../store/types";
import { isElectron } from "../../utils/is-electron";

const OBJECT_TYPES = new Set<CanvasObjectRef["type"]>([
  "exterior",
  "searchLimits",
  "boundary",
  "waterLine",
  "udl",
  "lineLoad",
  "reinforcement",
  "pile",
  "customPlane",
]);

/** A selection received from another window, checked; null for anything else. */
export function parseSelection(raw: unknown): CanvasSelection | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { object?: unknown; point?: unknown };
  const o = r.object as { type?: unknown; id?: unknown } | null | undefined;
  if (!o || typeof o.type !== "string" || !OBJECT_TYPES.has(o.type as CanvasObjectRef["type"])) return null;
  const type = o.type as CanvasObjectRef["type"];
  let object: CanvasObjectRef;
  if (type === "exterior" || type === "searchLimits") object = { type };
  else if (typeof o.id === "string") object = { type, id: o.id };
  else return null;
  const point = typeof r.point === "number" || typeof r.point === "string" ? (r.point as CanvasSelection["point"]) : null;
  return { object, point };
}

/**
 * Keeps the canvas selection the same in the main window and the dialog
 * windows: the main window sends every change of it to the open windows
 * (their tables show it as the selected row) and takes the selection a
 * window's row sets. A dialog window asks for the selection when it opens
 * and sends the rows the user picks. Closing a window changes nothing.
 */
export function useSelectionSync(isDialogWindow: boolean): void {
  useEffect(() => {
    if (!isElectron) return;
    // A dialog holds a copy of part of the model: it must not drop a
    // selection of an object only the main window has.
    if (isDialogWindow) setSelectionFollowsModel(false);
    let applying = false;
    const unsubscribeChanged = window.cslope.onSelectionChanged((_event, raw) => {
      const sel = parseSelection(raw);
      const st = useAppStore.getState();
      if (sameSelection(st.canvasSelection, sel)) return;
      applying = true;
      try {
        if (isDialogWindow) {
          useAppStore.setState({ canvasSelection: sel, canvasSelectionCycle: null, ...selectionMirror(sel, st) });
        } else {
          st.selectCanvasObject(sel?.object ?? null, sel?.point ?? null);
        }
      } finally {
        applying = false;
      }
    });
    const unsubscribeRequest = isDialogWindow
      ? () => {}
      : window.cslope.onSelectionRequestState(() => window.cslope.sendSelectionChanged(useAppStore.getState().canvasSelection));
    // The main window tells every window (the one a row came from too: it
    // ignores its own selection); a window tells the main window what its
    // user picked, not what it was told.
    const unsubscribeStore = useAppStore.subscribe((s, prev) => {
      if (sameSelection(s.canvasSelection, prev.canvasSelection)) return;
      if (isDialogWindow && applying) return;
      window.cslope.sendSelectionChanged(s.canvasSelection);
    });
    if (isDialogWindow) window.cslope.requestSelectionState();
    return () => {
      if (isDialogWindow) setSelectionFollowsModel(true);
      unsubscribeChanged();
      unsubscribeRequest();
      unsubscribeStore();
    };
  }, [isDialogWindow]);
}
