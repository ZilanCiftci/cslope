import { nextId } from "../helpers";
import type { SliceCreator } from "../helpers";
import type { LoadsSlice, ModelEntry } from "../types";

type LoadsState = LoadsSlice & { activeModelId: string; models: ModelEntry[] };

const syncActiveModel = (state: LoadsState, patch: Partial<LoadsSlice>) => ({
  ...patch,
  models: state.models.map((m) =>
    m.id === state.activeModelId
      ? {
          ...m,
          udls: patch.udls ?? state.udls,
          lineLoads: patch.lineLoads ?? state.lineLoads,
        }
      : m,
  ),
});

export const createLoadsSlice: SliceCreator<LoadsSlice> = (set, get) => ({
  udls: [],
  lineLoads: [],

  addUdl: () => {
    set((s) =>
      syncActiveModel(s, {
        udls: [...s.udls, { id: nextId("udl"), magnitude: 10, x1: 0, x2: 5 }],
      }),
    );
    get().invalidateAnalysis();
  },

  updateUdl: (id, patch) => {
    set((s) =>
      syncActiveModel(s, {
        udls: s.udls.map((u) => (u.id === id ? { ...u, ...patch } : u)),
      }),
    );
    get().invalidateAnalysis();
  },

  removeUdl: (id) => {
    set((s) =>
      syncActiveModel(s, {
        udls: s.udls.filter((u) => u.id !== id),
      }),
    );
    get().invalidateAnalysis();
  },

  addLineLoad: () => {
    set((s) =>
      syncActiveModel(s, {
        lineLoads: [...s.lineLoads, { id: nextId("ll"), magnitude: 50, x: 10 }],
      }),
    );
    get().invalidateAnalysis();
  },

  updateLineLoad: (id, patch) => {
    set((s) =>
      syncActiveModel(s, {
        lineLoads: s.lineLoads.map((l) =>
          l.id === id ? { ...l, ...patch } : l,
        ),
      }),
    );
    get().invalidateAnalysis();
  },

  removeLineLoad: (id) => {
    set((s) =>
      syncActiveModel(s, {
        lineLoads: s.lineLoads.filter((l) => l.id !== id),
      }),
    );
    get().invalidateAnalysis();
  },
});
