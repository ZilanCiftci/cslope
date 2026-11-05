/**
 * "Pick lines from drawing": the drawing whose lines are being picked on
 * the edit canvas, the lines picked, and the commands that make model
 * objects of them ("Use as exterior boundary", "… material boundary",
 * "… water line"), each one undo step. The picked lines are not part of
 * the model (nor of its undo history): a view state.
 */
import { create } from "zustand";
import { inferOrientationFromCoordinates } from "@cslope/engine";
import { useAppStore } from "../../store/app-store";
import { asOneUndoStep } from "../../store/undo-step";
import { withObjectLocked } from "../../store/canvas-selection";
import type { BackgroundImage } from "../../store/types";
import { chainTolerance, exteriorFrom, pickedToModel, type PickedChain } from "./line-pick";
import { vectorsFor } from "./drawing-cache";
import type { Pt } from "./transform";

export interface LinePickState {
  /** The placement whose lines are picked (null: not picking). */
  placementId: string | null;
  chains: PickedChain[];
  /** What the last command said (an explanation when it could not be done). */
  message: string | null;
  start: (placementId: string) => void;
  stop: () => void;
  setChains: (chains: PickedChain[]) => void;
  setMessage: (message: string | null) => void;
}

export const useLinePick = create<LinePickState>((set) => ({
  placementId: null,
  chains: [],
  message: null,
  start: (placementId) => set({ placementId, chains: [], message: null }),
  stop: () => set({ placementId: null, chains: [], message: null }),
  setChains: (chains) => set({ chains, message: null }),
  setMessage: (message) => set({ message }),
}));

/** Start picking lines of a drawing (the canvas selection cleared, so clicks go to its lines). */
export function startLinePick(id: string): void {
  useAppStore.getState().clearCanvasSelection();
  useLinePick.getState().start(id);
}

/** Picked chains with `add` toggled in (Shift+click) or as the only one. */
export function withChain(chains: readonly PickedChain[], add: PickedChain, toggle: boolean): PickedChain[] {
  const key = (c: PickedChain) => [...c.paths].sort((a, b) => a - b).join(",");
  if (!toggle) return [add];
  const k = key(add);
  return chains.some((c) => key(c) === k) ? chains.filter((c) => key(c) !== k) : [...chains, add];
}

export type UseAs = "exterior" | "boundary" | "waterLine";

/** The picked lines in the model (joined, clipped to the crop). */
function pickedPolylines(placement: BackgroundImage, chains: readonly PickedChain[]) {
  const drawing = vectorsFor(placement.assetId, placement.page ?? 1);
  const tol = drawing ? chainTolerance(drawing) : 1e-9;
  return pickedToModel(chains, placement, tol);
}

/**
 * Make model objects of the picked lines; returns what to tell the user
 * (an error, or what was made). `closeTol`: ends this close (m) may be
 * joined to close an exterior boundary, after `confirmClose` says yes. A
 * locked exterior boundary is replaced only after `confirmUnlock` says
 * yes (it is unlocked in the same undo step); new material boundaries
 * and water lines replace nothing, whatever is locked.
 */
export function pickedLinesAs(
  as: UseAs,
  closeTol: number,
  confirmClose: (gap: number) => boolean = (gap) =>
    window.confirm(`The ends of the picked lines are ${gap.toFixed(3)} m apart. Close the outline between them?`),
  confirmUnlock: () => boolean = () => window.confirm("The exterior boundary is locked. Unlock it and replace it with the picked lines?"),
): { ok: boolean; message: string } {
  const pick = useLinePick.getState();
  const st = useAppStore.getState();
  const placement = st.backgrounds.find((b) => b.id === pick.placementId);
  if (!placement) return { ok: false, message: "The drawing is no longer in the model." };
  if (pick.chains.length === 0) return { ok: false, message: "Pick lines first: click a line of the drawing, Shift+click to add more." };
  const lines = pickedPolylines(placement, pick.chains);
  if (lines.length === 0) return { ok: false, message: "The picked lines are outside the drawing's crop." };
  if (as === "exterior") {
    const r = exteriorFrom(lines, closeTol);
    let coords: Pt[];
    if (r.ok) coords = r.coordinates;
    else if ("gap" in r) {
      if (!confirmClose(r.gap)) return { ok: false, message: "Not closed: the exterior boundary was not changed." };
      coords = r.coordinates;
    } else return { ok: false, message: r.error };
    const locked = !!st.locks.exterior;
    if (locked && !confirmUnlock()) return { ok: false, message: "The exterior boundary is locked: it was not changed." };
    asOneUndoStep(() => {
      const s = useAppStore.getState();
      if (locked) s.setModelLocks(withObjectLocked(s.locks, { type: "exterior" }, false));
      s.setCoordinates(coords.map(([x, y]): [number, number] => [x, y]));
      s.setOrientation(inferOrientationFromCoordinates(coords));
    });
    useLinePick.getState().setChains([]);
    return { ok: true, message: `Exterior boundary made of the picked lines: ${coords.length} points.` };
  }
  asOneUndoStep(() => {
    for (const l of lines) {
      const s = useAppStore.getState();
      if (as === "boundary") {
        // A closed boundary (a lens) repeats its first point at the end.
        s.addMaterialBoundary(l.closed ? [...l.points, l.points[0]] : l.points);
      } else {
        // A water line runs left to right.
        const pts = l.points[0][0] > l.points[l.points.length - 1][0] ? [...l.points].reverse() : l.points;
        s.addPiezoLine(pts);
      }
    }
  });
  useLinePick.getState().setChains([]);
  const n = lines.length;
  return {
    ok: true,
    message: as === "boundary" ? `${n} material boundar${n === 1 ? "y" : "ies"} made of the picked lines.` : `${n} water line${n === 1 ? "" : "s"} made of the picked lines.`,
  };
}
