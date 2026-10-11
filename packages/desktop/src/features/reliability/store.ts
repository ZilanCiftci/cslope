import { create } from "zustand";
import type { RandomVariable, ReliabilityOptions, ReliabilityResult } from "@cslope/engine";
import type { ModelEntry } from "../../store/types";
import { executeReliability, type ReliabilityHandle } from "../../store/slices/analysisSlice";

interface ReliabilityState {
  open: boolean;
  /** Bumped on every open; the panel takes a fresh model snapshot. */
  opened: number;
  running: boolean;
  progress: number;
  result: ReliabilityResult | null;
  /** Labels of the variables of the result, in order. */
  labels: string[];
  error: string | null;
  setOpen: (open: boolean) => void;
  run: (
    model: ModelEntry,
    variables: RandomVariable[],
    labels: string[],
    options: Omit<ReliabilityOptions, "onProgress">,
  ) => Promise<void>;
  cancel: () => void;
}

let generation = 0;
let activeHandle: ReliabilityHandle | null = null;

/** Probabilistic analysis panel state (not saved with the project). */
export const useReliabilityStore = create<ReliabilityState>((set, get) => ({
  open: false,
  opened: 0,
  running: false,
  progress: 0,
  result: null,
  labels: [],
  error: null,
  setOpen: (open) => {
    // A result belongs to the model snapshot of the panel it was run in;
    // opening (again) starts from the model as it is now.
    get().cancel();
    set({ open, ...(open ? { opened: get().opened + 1 } : {}), result: null, labels: [], error: null, progress: 0 });
  },
  run: async (model, variables, labels, options) => {
    get().cancel();
    const run = ++generation;
    set({ running: true, progress: 0, result: null, labels, error: null });
    try {
      activeHandle = executeReliability(model, variables, options, (progress) => {
        if (run === generation) set({ progress });
      });
      const result = await activeHandle.promise;
      if (run === generation) set({ result });
    } catch (err) {
      // A cancelled run has already moved on (generation bumped).
      if (run === generation) set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      if (run === generation) {
        activeHandle = null;
        set({ running: false });
      }
    }
  },
  cancel: () => {
    generation++;
    activeHandle?.cancel();
    activeHandle = null;
    set({ running: false });
  },
}));
