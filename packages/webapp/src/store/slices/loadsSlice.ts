import { nextId, RUN_RESET } from "../helpers";
import type { SliceCreator } from "../helpers";
import type { LoadsSlice } from "../types";

export const createLoadsSlice: SliceCreator<LoadsSlice> = (set) => ({
  udls: [],
  lineLoads: [],

  addUdl: () =>
    set((s) => ({
      udls: [...s.udls, { id: nextId("udl"), magnitude: 10, x1: 0, x2: 5 }],
      ...RUN_RESET,
    })),

  updateUdl: (id, patch) =>
    set((s) => ({
      udls: s.udls.map((u) => (u.id === id ? { ...u, ...patch } : u)),
      ...RUN_RESET,
    })),

  removeUdl: (id) =>
    set((s) => ({ udls: s.udls.filter((u) => u.id !== id), ...RUN_RESET })),

  addLineLoad: () =>
    set((s) => ({
      lineLoads: [...s.lineLoads, { id: nextId("ll"), magnitude: 50, x: 10 }],
      ...RUN_RESET,
    })),

  updateLineLoad: (id, patch) =>
    set((s) => ({
      lineLoads: s.lineLoads.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      ...RUN_RESET,
    })),

  removeLineLoad: (id) =>
    set((s) => ({
      lineLoads: s.lineLoads.filter((l) => l.id !== id),
      ...RUN_RESET,
    })),
});
