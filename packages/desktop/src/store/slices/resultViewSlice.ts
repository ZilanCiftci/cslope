import { DEFAULT_RESULT_VIEW_SETTINGS } from "../defaults";
import { nextId } from "../helpers";
import type { SliceCreator } from "../helpers";
import type { ResultViewSlice } from "../types";

export const createResultViewSlice: SliceCreator<ResultViewSlice> = (set) => ({
  resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS },
  selectedAnnotationIds: [],

  setResultViewSettings: (patch) =>
    set((s) => ({
      resultViewSettings: { ...s.resultViewSettings, ...patch },
    })),

  addAnnotation: (type) => {
    const anno = {
      id: nextId("anno"),
      type,
      x: 0.5,
      y: 0.5,
      text: type === "text" ? "Annotation" : undefined,
      fontSize: 12,
    } as ResultViewSlice["resultViewSettings"]["annotations"][number];
    set((s) => ({
      resultViewSettings: {
        ...s.resultViewSettings,
        annotations: [...s.resultViewSettings.annotations, anno],
      },
    }));
  },

  updateAnnotation: (id, patch) =>
    set((s) => ({
      resultViewSettings: {
        ...s.resultViewSettings,
        annotations: s.resultViewSettings.annotations.map((a) =>
          a.id === id ? { ...a, ...patch } : a,
        ),
      },
    })),

  removeAnnotation: (id) =>
    set((s) => ({
      resultViewSettings: {
        ...s.resultViewSettings,
        annotations: s.resultViewSettings.annotations.filter(
          (a) => a.id !== id,
        ),
      },
      selectedAnnotationIds: s.selectedAnnotationIds.filter((i) => i !== id),
    })),

  setSelectedAnnotations: (ids) => set({ selectedAnnotationIds: ids }),

  toggleAnnotationSelection: (id, additive) =>
    set((s) => {
      if (additive) {
        const has = s.selectedAnnotationIds.includes(id);
        return {
          selectedAnnotationIds: has
            ? s.selectedAnnotationIds.filter((i) => i !== id)
            : [...s.selectedAnnotationIds, id],
        };
      }
      return { selectedAnnotationIds: [id] };
    }),

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

      return {
        resultViewSettings: {
          ...s.resultViewSettings,
          annotations: s.resultViewSettings.annotations.map((a) => {
            if (!sel.includes(a.id)) return a;
            return {
              ...a,
              ...(targetX !== undefined ? { x: targetX } : {}),
              ...(targetY !== undefined ? { y: targetY } : {}),
            };
          }),
        },
      };
    }),
});
