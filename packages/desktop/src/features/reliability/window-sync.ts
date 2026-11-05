import type { RandomVariable, ReliabilityOptions, ReliabilityResult } from "@cslope/engine";
import { useAppStore } from "../../store/app-store";
import type { ModelEntry } from "../../store/types";
import { isElectron } from "../../utils/is-electron";
import { activeModelSnapshot, useToolWindowSync } from "../../utils/tool-window-sync";
import { useReliabilityStore } from "./store";

/** What the Probabilistic analysis window shows: the model and the run. */
export interface ReliabilityWindowState {
  /** The active model as it is now, with its name. */
  model: ModelEntry;
  /** Partial factors are on: the FOS are design values. */
  designValues: boolean;
  /** The model is analyzed in both directions (only its own one is used here). */
  bothDirections: boolean;
  running: boolean;
  progress: number;
  result: ReliabilityResult | null;
  /** Labels of the variables of the result, in order. */
  labels: string[];
  error: string | null;
}

/** What the Probabilistic analysis window asks of the main window. */
export type ReliabilityCommand =
  | {
      type: "run";
      variables: RandomVariable[];
      labels: string[];
      options: Omit<ReliabilityOptions, "onProgress">;
    }
  | { type: "cancel" };

export function reliabilityWindowState(): ReliabilityWindowState {
  const app = useAppStore.getState();
  const { running, progress, result, labels, error } = useReliabilityStore.getState();
  return {
    model: activeModelSnapshot(app),
    designValues: !!app.options.partialFactors,
    bothDirections: !!app.options.bothDirections,
    running,
    progress,
    result,
    labels,
    error,
  };
}

/** Main-window side of the Probabilistic analysis window. */
export function useReliabilityWindowSync(enabled: boolean): void {
  useToolWindowSync<ReliabilityWindowState, ReliabilityCommand>({
    enabled: enabled && isElectron,
    build: reliabilityWindowState,
    subscribeExtra: (l) => useReliabilityStore.subscribe(l),
    onRequestState: (l) => window.cslope.onReliabilityRequestState(l),
    sendState: (s) => window.cslope.sendReliabilityState(s),
    sendChanged: (s) => window.cslope.sendReliabilityChanged(s),
    onCommand: (l) => window.cslope.onReliabilityCommand(l),
    onClosed: (l) => window.cslope.onReliabilityClosed(l),
    handleCommand: (command) => {
      const store = useReliabilityStore.getState();
      if (command.type === "cancel") store.cancel();
      else void store.run(activeModelSnapshot(), command.variables, command.labels, command.options);
    },
    handleClosed: () => useReliabilityStore.getState().reset(),
  });
}
