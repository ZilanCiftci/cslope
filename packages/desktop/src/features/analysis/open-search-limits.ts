import { useAppStore } from "../../store/app-store";
import { isElectron } from "../../utils/is-electron";

/**
 * "Search limits" after a run that found no surface: the limits are what
 * the message is about, so they are selected on the canvas and their window
 * opens. The error banner and the result summary offer it.
 */
export function openSearchLimits(): void {
  const st = useAppStore.getState();
  if (st.analysisLimits.enabled) st.selectCanvasObject({ type: "searchLimits" });
  if (isElectron) window.cslope.openSearchLimitsDialog();
}
