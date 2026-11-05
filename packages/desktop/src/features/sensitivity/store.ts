import { create } from "zustand";
import type { ModelEntry } from "../../store/types";
import { executeModelAnalysis, type AnalysisHandle } from "../../store/slices/analysisSlice";
import { coreCount, threadsPerRun } from "../../store/analysis-workers";
import {
  modelWithValue,
  type SensitivityPoint,
  type SensitivityVariable,
} from "./sensitivity";

interface SensitivityState {
  running: boolean;
  /** Label of the variable of the current/last run. */
  label: string;
  /** Key of the variable of the current/last run and its model value. */
  runKey: string;
  runValue: number | null;
  /** Results so far, sorted by value. */
  points: SensitivityPoint[];
  /** Number of values in the current run. */
  total: number;
  /** Stop a run and clear the results (the window closed, another model). */
  reset: () => void;
  run: (
    model: ModelEntry,
    variable: SensitivityVariable,
    info: { key: string; label: string; value: number },
    values: number[],
  ) => Promise<void>;
  cancel: () => void;
}

let generation = 0;
const activeHandles = new Set<AnalysisHandle>();

/** Analyses run at once (leaves a core for the interface). */
function poolSize(): number {
  return Math.max(1, Math.min(4, coreCount() - 1));
}

/**
 * Sensitivity analysis state (not saved with the project). It lives in the
 * main window, which runs the analyses; the Sensitivity window shows it.
 */
export const useSensitivityStore = create<SensitivityState>((set, get) => ({
  running: false,
  label: "",
  runKey: "",
  runValue: null,
  points: [],
  total: 0,
  reset: () => {
    get().cancel();
    set({ points: [], total: 0, label: "", runKey: "", runValue: null });
  },
  run: async (model, variable, info, values) => {
    get().cancel();
    const run = ++generation;
    set({
      running: true,
      label: info.label,
      runKey: info.key,
      runValue: info.value,
      points: [],
      total: values.length,
    });
    const queue = [...values];
    const runs = Math.min(poolSize(), values.length);
    // the cores left over go to the analyses' own evaluators
    const threads = threadsPerRun(runs);
    const worker = async () => {
      while (queue.length > 0) {
        if (run !== generation) return;
        const value = queue.shift()!;
        let point: SensitivityPoint;
        let handle: AnalysisHandle | null = null;
        try {
          handle = executeModelAnalysis(modelWithValue(model, variable, value), undefined, threads);
          activeHandles.add(handle);
          const result = await handle.promise;
          point = { value, fos: result.minFOS };
        } catch (err) {
          point = { value, fos: null, error: err instanceof Error ? err.message : String(err) };
        } finally {
          if (handle) activeHandles.delete(handle);
        }
        if (run !== generation) return; // cancelled meanwhile
        set((s) => ({
          points: [...s.points, point].sort((a, b) => a.value - b.value),
        }));
      }
    };
    await Promise.all(Array.from({ length: runs }, worker));
    if (run === generation) set({ running: false });
  },
  cancel: () => {
    generation++;
    for (const h of activeHandles) h.cancel();
    activeHandles.clear();
    set({ running: false });
  },
}));
