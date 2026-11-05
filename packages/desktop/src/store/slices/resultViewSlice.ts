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
    const anno = {
      id: nextId("anno"),
      type,
      // The table and the color bar start at the right edge of the plot
      // frame (PLOT_MARGINS from the paper edge), just inside it so the
      // frame line does not run through them; text and plots in the
      // middle, where they are seen.
      x: bar ? bar.x : type === "material-table" ? RIGHT_INSIDE_FRAME : 0.5,
      y: bar ? bar.y : type === "material-table" ? TOP_INSIDE_FRAME : 0.5,
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
