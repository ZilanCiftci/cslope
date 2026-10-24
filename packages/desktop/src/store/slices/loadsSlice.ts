import { nextId } from "../helpers";
import type { SliceCreator } from "../helpers";
import type {
  LineLoadRow,
  LoadsSlice,
  ModelEntry,
  ModelOrientation,
  UdlRow,
} from "../types";
import { newPile, newReinforcement } from "../../utils/reinforcement";

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
          piles: patch.piles ?? state.piles,
        }
      : m,
  ),
});

/**
 * A new UDL: 10 kPa over 0 to 5 m; after existing ones, the same width and
 * magnitude as the last, just beyond it, so new rows do not stack.
 */
export function nextUdlPlacement(
  udls: Pick<UdlRow, "magnitude" | "x1" | "x2">[],
): Pick<UdlRow, "magnitude" | "x1" | "x2"> {
  const last = udls[udls.length - 1];
  if (!last) return { magnitude: 10, x1: 0, x2: 5 };
  const width = Math.abs(last.x2 - last.x1) || 5;
  const x1 = Math.max(last.x1, last.x2);
  return { magnitude: last.magnitude, x1, x2: x1 + width };
}

/** A new line load: 50 kN/m at 10 m; after existing ones, 5 m beyond the last. */
export function nextLineLoadPlacement(
  lineLoads: Pick<LineLoadRow, "magnitude" | "x">[],
): Pick<LineLoadRow, "magnitude" | "x"> {
  const last = lineLoads[lineLoads.length - 1];
  if (!last) return { magnitude: 50, x: 10 };
  return { magnitude: last.magnitude, x: last.x + 5 };
}

export const createLoadsSlice: SliceCreator<LoadsSlice> = (set, get) => ({
  udls: [],
  lineLoads: [],
  reinforcements: [],
  piles: [],

  addUdl: () => {
    set((s) =>
      syncActiveModel(s, {
        udls: [
          ...s.udls,
          { id: nextId("udl"), ...nextUdlPlacement(s.udls), expressions: {} },
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
          { id: nextId("ll"), ...nextLineLoadPlacement(s.lineLoads), expressions: {} },
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

  addPile: (type = "pile") => {
    set((s) =>
      syncActiveModel(s, {
        piles: [...s.piles, newPile(nextId("pile"), type, s.coordinates)],
      }),
    );
    get().invalidateAnalysis();
  },

  updatePile: (id, patch) => {
    set((s) =>
      syncActiveModel(s, {
        piles: s.piles.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      }),
    );
    get().invalidateAnalysis();
  },

  removePile: (id) => {
    set((s) =>
      syncActiveModel(s, {
        piles: s.piles.filter((p) => p.id !== id),
      }),
    );
    get().invalidateAnalysis();
  },
});
