import { create } from "zustand";
import type { ModelEntry } from "../../store/types";
import { executeModelAnalysis, type AnalysisHandle } from "../../store/slices/analysisSlice";
import {
  modelWithValue,
  type SensitivityPoint,
  type SensitivityVariable,
} from "./sensitivity";

interface SensitivityState {
  open: boolean;
  running: boolean;
  /** Label of the variable of the current/last run. */
  label: string;
  points: SensitivityPoint[];
  /** Number of values in the current run. */
  total: number;
  setOpen: (open: boolean) => void;
  run: (
    model: ModelEntry,
    variable: SensitivityVariable,
    label: string,
    values: number[],
  ) => Promise<void>;
  cancel: () => void;
}

let generation = 0;
let activeHandle: AnalysisHandle | null = null;

/** Sensitivity panel state (not saved with the project). */
export const useSensitivityStore = create<SensitivityState>((set, get) => ({
  open: false,
  running: false,
  label: "",
  points: [],
  total: 0,
  setOpen: (open) => {
    if (!open) get().cancel();
    set({ open });
  },
  run: async (model, variable, label, values) => {
    get().cancel();
    const run = ++generation;
    set({ running: true, label, points: [], total: values.length });
    for (const value of values) {
      if (run !== generation) return;
      let point: SensitivityPoint;
      try {
        activeHandle = executeModelAnalysis(modelWithValue(model, variable, value));
        const result = await activeHandle.promise;
        point = { value, fos: result.minFOS };
      } catch (err) {
        if (run !== generation) return; // cancelled
        point = { value, fos: null, error: err instanceof Error ? err.message : String(err) };
      } finally {
        activeHandle = null;
      }
      if (run !== generation) return;
      set((s) => ({ points: [...s.points, point] }));
    }
    if (run === generation) set({ running: false });
  },
  cancel: () => {
    generation++;
    activeHandle?.cancel();
    activeHandle = null;
    set({ running: false });
  },
}));
