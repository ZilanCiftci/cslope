import { DEFAULT_RESULT_VIEW_SETTINGS } from "../defaults";
import { nextId } from "../helpers";
import type { SliceCreator } from "../helpers";
import type { ModelEntry, ResultViewSlice } from "../types";

type ResultViewState = ResultViewSlice & {
  activeModelId: string;
  models: ModelEntry[];
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

export const createResultViewSlice: SliceCreator<ResultViewSlice> = (set) => ({
  resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS },
  selectedAnnotationIds: [],
  selectedResultObject: null,

  setResultViewSettings: (patch) =>
    set((s) => syncActiveModel(s, { ...s.resultViewSettings, ...patch })),

  addAnnotation: (type) => {
    const anno = {
      id: nextId("anno"),
      type,
      x: type === "material-table" ? 0.95 : 0.5,
      y: type === "material-table" ? 0.05 : 0.5,
      anchor: type === "material-table" ? "top-right" : undefined,
      text: type === "text" ? "Annotation" : undefined,
      fontSize: type === "material-table" ? 6 : 12,
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

  updateAnnotation: (id, patch) =>
    set((s) =>
      syncActiveModel(s, {
        ...s.resultViewSettings,
        annotations: s.resultViewSettings.annotations.map((a) =>
          a.id === id ? { ...a, ...patch } : a,
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

  alignAnnotations: (align) =>
    set((s) => {
      const sel = s.selectedAnnotationIds;
      if (sel.length < 2) return s;
      const annos = s.resultViewSettings.annotations.filter((a) =>
        sel.includes(a.id),
      );
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
          if (!sel.includes(a.id)) return a;
          return {
            ...a,
            ...(targetX !== undefined ? { x: targetX } : {}),
            ...(targetY !== undefined ? { y: targetY } : {}),
          };
        }),
      });
    }),
});
