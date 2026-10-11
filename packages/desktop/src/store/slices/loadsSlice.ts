import { nextId } from "../helpers";
import type { SliceCreator } from "../helpers";
import type { LoadsSlice, ModelEntry, ModelOrientation } from "../types";
import { newReinforcement } from "../../utils/reinforcement";

type LoadsState = LoadsSlice & {
  activeModelId: string;
  models: ModelEntry[];
  coordinates: [number, number][];
  orientation: ModelOrientation;
};

const syncActiveModel = (state: LoadsState, patch: Partial<LoadsSlice>) => ({
  ...patch,
  models: state.models.map((m) =>
    m.id === state.activeModelId
      ? {
          ...m,
          udls: patch.udls ?? state.udls,
          lineLoads: patch.lineLoads ?? state.lineLoads,
          reinforcements: patch.reinforcements ?? state.reinforcements,
        }
      : m,
  ),
});

export const createLoadsSlice: SliceCreator<LoadsSlice> = (set, get) => ({
  udls: [],
  lineLoads: [],
  reinforcements: [],

  addUdl: () => {
    set((s) =>
      syncActiveModel(s, {
        udls: [
          ...s.udls,
          { id: nextId("udl"), magnitude: 10, x1: 0, x2: 5, expressions: {} },
        ],
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
        lineLoads: [
          ...s.lineLoads,
          { id: nextId("ll"), magnitude: 50, x: 10, expressions: {} },
        ],
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

  addReinforcement: (type = "anchor") => {
    set((s) =>
      syncActiveModel(s, {
        reinforcements: [
          ...s.reinforcements,
          newReinforcement(nextId("reinf"), type, s.coordinates, s.orientation),
        ],
      }),
    );
    get().invalidateAnalysis();
  },

  updateReinforcement: (id, patch) => {
    set((s) =>
      syncActiveModel(s, {
        reinforcements: s.reinforcements.map((r) =>
          r.id === id ? { ...r, ...patch } : r,
        ),
      }),
    );
    get().invalidateAnalysis();
  },

  removeReinforcement: (id) => {
    set((s) =>
      syncActiveModel(s, {
        reinforcements: s.reinforcements.filter((r) => r.id !== id),
      }),
    );
    get().invalidateAnalysis();
  },
});
