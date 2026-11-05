import { useAppStore } from "../../store/app-store";
import type { ModelEntry } from "../../store/types";
import { activeModelSnapshot, useToolWindowSync } from "../../utils/tool-window-sync";
import { isElectron } from "../../utils/is-electron";
import type { SensitivityPoint, SensitivityVariable } from "./sensitivity";
import { useSensitivityStore } from "./store";

/** What the Sensitivity window shows: the model and the run. */
export interface SensitivityWindowState {
  /** The active model as it is now, with its name. */
  model: ModelEntry;
  /** Partial factors are on: the FOS are design values. */
  designValues: boolean;
  running: boolean;
  /** Label of the variable of the current or last run. */
  label: string;
  /** The model's value of the variable of the run. */
  runValue: number | null;
  /** Results so far, sorted by value. */
  points: SensitivityPoint[];
  /** Number of values in the current run. */
  total: number;
}

/** What the Sensitivity window asks of the main window. */
export type SensitivityCommand =
  | {
      type: "run";
      variable: SensitivityVariable;
      info: { key: string; label: string; value: number };
      values: number[];
    }
  | { type: "cancel" };

export function sensitivityWindowState(): SensitivityWindowState {
  const app = useAppStore.getState();
  const { running, label, runValue, points, total } = useSensitivityStore.getState();
  return {
    model: activeModelSnapshot(app),
    designValues: !!app.options.partialFactors,
    running,
    label,
    runValue,
    points,
    total,
  };
}

/** Main-window side of the Sensitivity window. */
export function useSensitivityWindowSync(enabled: boolean): void {
  useToolWindowSync<SensitivityWindowState, SensitivityCommand>({
    enabled: enabled && isElectron,
    build: sensitivityWindowState,
    subscribeExtra: (l) => useSensitivityStore.subscribe(l),
    onRequestState: (l) => window.cslope.onSensitivityRequestState(l),
    sendState: (s) => window.cslope.sendSensitivityState(s),
    sendChanged: (s) => window.cslope.sendSensitivityChanged(s),
    onCommand: (l) => window.cslope.onSensitivityCommand(l),
    onClosed: (l) => window.cslope.onSensitivityClosed(l),
    handleCommand: (command) => {
      const store = useSensitivityStore.getState();
      if (command.type === "cancel") store.cancel();
      else void store.run(activeModelSnapshot(), command.variable, command.info, command.values);
    },
    handleClosed: () => useSensitivityStore.getState().reset(),
  });
}
