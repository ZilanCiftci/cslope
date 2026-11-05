import { DEFAULT_RESULT_VIEW_SETTINGS } from "../defaults";
import { customPlanesInResultOrder, nextId } from "../helpers";
import type { SliceCreator } from "../helpers";
import type { CustomSearchPlane, ModelEntry, ReferenceAnnotation, ResultViewSlice } from "../types";
import { isPaperAnnotation, referenceFromCustomPlane } from "../../features/annotations/reference";
import { NEW_MATERIAL_TABLE_FONT_SIZE } from "../../features/annotations/materialTableLayout";
import {
  colorBarDefaultPosition,
  RIGHT_INSIDE_FRAME,
  TOP_INSIDE_FRAME,
} from "../../features/annotations/colorBarPlacement";

type ResultViewState = ResultViewSlice & {
  activeModelId: string;
  models: ModelEntry[];
  customSearchPlanes: CustomSearchPlane[];
};

const syncActiveModel = (
  state: ResultViewState,
  resultViewSettings: ResultViewSlice["resultViewSettings"],
) => ({
  resultViewSettings,
  models: state.models.map((m) =>
    m.id === state.activeModelId ? { ...m, resultViewSettings } : m,
  ),
});

/** Rough size of a new text annotation (fraction of the paper), to keep others clear of it. */
const TEXT_BOX = { w: 0.12, h: 0.035 };
/** Space between a new annotation and the one it is placed by (fraction of the paper). */
const GAP = 0.02;

type Placed = { type: string; x?: number; y?: number; width?: number; height?: number; anchor?: string };

/** The box of a text or plot annotation (top-left anchored), or null for the others. */
function boxOf(a: Placed): { x: number; y: number; w: number; h: number } | null {
  if ((a.type !== "text" && a.type !== "plot") || (a.anchor && a.anchor !== "top-left")) return null;
  const size = a.type === "plot" ? { w: a.width ?? 0.24, h: a.height ?? 0.18 } : TEXT_BOX;
  return { x: a.x ?? 0, y: a.y ?? 0, ...size };
}

/**
 * Where a new text or plot goes: the middle of the sheet, else right below
 * one of the texts and plots there (the last first), else to the right of
 * one: the first place where it overlaps none of them and stays on the
 * paper. Several added one after another so do not land on each other.
 */
export function freeAnnotationPosition(annotations: readonly Placed[], type: "text" | "plot"): { x: number; y: number } {
  const size = type === "plot" ? { w: 0.24, h: 0.18 } : TEXT_BOX;
  const boxes = annotations.map(boxOf).filter((b): b is NonNullable<typeof b> => b !== null);
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const candidates = [
    { x: 0.5, y: 0.5 },
    ...[...boxes].reverse().map((b) => ({ x: b.x, y: b.y + b.h + GAP })),
    ...[...boxes].reverse().map((b) => ({ x: b.x + b.w + GAP, y: b.y })),
  ];
  const free = candidates.find(
    (c) =>
      c.x + size.w <= 0.97 &&
      c.y + size.h <= 0.97 &&
      boxes.every((b) => c.x >= b.x + b.w || c.x + size.w <= b.x || c.y >= b.y + b.h || c.y + size.h <= b.y),
  );
  return free ? { x: r(free.x), y: r(free.y) } : { x: 0.5, y: 0.5 };
}

export const createResultViewSlice: SliceCreator<ResultViewSlice> = (set, get) => ({
  resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS },
  selectedAnnotationIds: [],
  selectedResultObject: null,
  paperPropertiesFocusPending: false,

  setResultViewSettings: (patch) =>
    set((s) => syncActiveModel(s, { ...s.resultViewSettings, ...patch })),

  addAnnotation: (type) => {
    const state = get();
    // The color bar right below the material table as it is drawn (its
    // height for these materials, columns, text size and paper), at the
    // right edge of the plot frame.
    const bar =
      type === "color-bar"
        ? colorBarDefaultPosition(
            state.resultViewSettings.annotations,
            state.materials,
            state.piezometricLine,
            state.resultViewSettings.paperFrame,
          )
        : null;
    // Text and plots start in the middle, or by the ones there, so a new
    // one is not hidden under the last.
    const free = type === "text" || type === "plot" ? freeAnnotationPosition(state.resultViewSettings.annotations, type) : { x: 0.5, y: 0.5 };
    const anno = {
      id: nextId("anno"),
      type,
      // The table and the color bar start at the right edge of the plot
      // frame (PLOT_MARGINS from the paper edge), just inside it so the
      // frame line does not run through them; text and plots in the
      // middle, where they are seen.
      x: bar ? bar.x : type === "material-table" ? RIGHT_INSIDE_FRAME : free.x,
      y: bar ? bar.y : type === "material-table" ? TOP_INSIDE_FRAME : free.y,
      anchor: type === "material-table" || type === "color-bar" ? "top-right" : undefined,
      text: type === "text" ? "Annotation" : undefined,
      fontSize: type === "material-table" ? NEW_MATERIAL_TABLE_FONT_SIZE : 12,
      width: type === "plot" ? 0.24 : undefined,
      height: type === "plot" ? 0.18 : undefined,
      plotAxisX: type === "plot" ? "slice" : undefined,
      plotAxisY: type === "plot" ? "shearStrength" : undefined,
      tableColumns:
        type === "material-table"
          ? ["model", "unitWeight", "cohesion", "frictionAngle"]
          : undefined,
    } as ResultViewSlice["resultViewSettings"]["annotations"][number];
    set((s) =>
      syncActiveModel(s, {
        ...s.resultViewSettings,
        annotations: [...s.resultViewSettings.annotations, anno],
      }),
    );
  },

  addReferenceAnnotation: (spec) => {
    const anno = { ...spec, id: nextId("anno"), type: "reference" } as ReferenceAnnotation;
    set((s) => ({
      ...syncActiveModel(s, {
        ...s.resultViewSettings,
        annotations: [...s.resultViewSettings.annotations, anno],
      }),
      selectedAnnotationIds: [anno.id],
      selectedResultObject: null,
    }));
    return anno.id;
  },

  addReferenceFromCustomPlane: (planeId) => {
    // Numbered as the result numbers its custom surfaces.
    const planes = customPlanesInResultOrder(get().customSearchPlanes);
    const index = planes.findIndex((p) => p.id === planeId);
    if (index < 0) return null;
    const spec = referenceFromCustomPlane(planes[index], index);
    if (!spec) return null;
    return get().addReferenceAnnotation(spec);
  },

  updateAnnotation: (id, patch) =>
    set((s) =>
      syncActiveModel(s, {
        ...s.resultViewSettings,
        annotations: s.resultViewSettings.annotations.map((a) =>
          a.id === id ? ({ ...a, ...patch } as typeof a) : a,
        ),
      }),
    ),

  removeAnnotation: (id) =>
    set((s) => ({
      ...syncActiveModel(s, {
        ...s.resultViewSettings,
        annotations: s.resultViewSettings.annotations.filter(
          (a) => a.id !== id,
        ),
        // (its place in the layers' order goes with it)
        ...(s.resultViewSettings.layerOrder?.includes(id)
          ? { layerOrder: s.resultViewSettings.layerOrder.filter((k) => k !== id) }
          : {}),
      }),
      selectedAnnotationIds: s.selectedAnnotationIds.filter((i) => i !== id),
    })),

  setSelectedAnnotations: (ids) =>
    set({ selectedAnnotationIds: ids, selectedResultObject: null }),

  toggleAnnotationSelection: (id, additive) =>
    set((s) => {
      if (additive) {
        const has = s.selectedAnnotationIds.includes(id);
        return {
          selectedAnnotationIds: has
            ? s.selectedAnnotationIds.filter((i) => i !== id)
            : [...s.selectedAnnotationIds, id],
          selectedResultObject: null,
        };
      }
      return { selectedAnnotationIds: [id], selectedResultObject: null };
    }),

  setSelectedResultObject: (target) =>
    set({ selectedResultObject: target, selectedAnnotationIds: [] }),

  showPaperProperties: () =>
    set({
      mode: "result",
      sidebarOpen: true,
      selectedResultObject: "paper-frame",
      selectedAnnotationIds: [],
      paperPropertiesFocusPending: true,
    }),

  clearPaperPropertiesFocus: () => set({ paperPropertiesFocusPending: false }),

  alignAnnotations: (align) =>
    set((s) => {
      const sel = s.selectedAnnotationIds;
      if (sel.length < 2) return s;
      // Reference annotations lie in model coordinates: not aligned.
      const annos = s.resultViewSettings.annotations
        .filter(isPaperAnnotation)
        .filter((a) => sel.includes(a.id));
      if (annos.length < 2) return s;

      let targetX: number | undefined;
      let targetY: number | undefined;

      switch (align) {
        case "left":
          targetX = Math.min(...annos.map((a) => a.x));
          break;
        case "right":
          targetX = Math.max(...annos.map((a) => a.x));
          break;
        case "center-h": {
          const sum = annos.reduce((sumVal, a) => sumVal + a.x, 0);
          targetX = sum / annos.length;
          break;
        }
        case "top":
          targetY = Math.min(...annos.map((a) => a.y));
          break;
        case "bottom":
          targetY = Math.max(...annos.map((a) => a.y));
          break;
        case "center-v": {
          const sum = annos.reduce((sumVal, a) => sumVal + a.y, 0);
          targetY = sum / annos.length;
          break;
        }
      }

      return syncActiveModel(s, {
        ...s.resultViewSettings,
        annotations: s.resultViewSettings.annotations.map((a) => {
          if (!sel.includes(a.id) || !isPaperAnnotation(a)) return a;
          return {
            ...a,
            ...(targetX !== undefined ? { x: targetX } : {}),
            ...(targetY !== undefined ? { y: targetY } : {}),
          };
        }),
      });
    }),
});
