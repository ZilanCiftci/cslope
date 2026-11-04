/**
 * Saving from Electron and asking the user about unsaved changes before
 * the project is replaced or the window is closed.
 */
import {
  isProjectDirty,
  markProjectClean,
  useAppStore,
} from "../../store/app-store";
import { isElectron } from "../../utils/is-electron";
import { buildProjectArchive, ensureCslpName } from "./cslp";

/** The file name a new project file is offered under: the active model's name, .cslp. */
export function suggestedProjectFileName(state = useAppStore.getState()): string {
  const active = state.models.find((m) => m.id === state.activeModelId);
  const name = (active?.name ?? "").replace(/[\\/:*?"<>|]+/g, "_").trim();
  return ensureCslpName(name || "cslope-project");
}

/**
 * Save the current project through Electron (Save As when `saveAs` or
 * when the project has no file yet).  Returns true when the file was
 * written; reports write errors to the user.
 */
export async function saveProjectInElectron(saveAs = false): Promise<boolean> {
  useAppStore.getState().saveCurrentModel();
  const state = useAppStore.getState();
  try {
    const data = await buildProjectArchive(state);
    const name = suggestedProjectFileName(state);
    const saved = saveAs
      ? await window.cslope.saveFileAs(data, name)
      : await window.cslope.saveFile(data, name);
    if (saved) markProjectClean(state);
    return saved;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    window.alert(`Unable to save project: ${msg}`);
    return false;
  }
}

/**
 * Resolve whether it is OK to discard the current project.  Asks only
 * when there are unsaved changes: Save (then continue if saved), Don't
 * Save (continue) or Cancel (stop).  In a browser only discard/cancel.
 */
export async function confirmUnsavedChanges(): Promise<boolean> {
  if (!isProjectDirty(useAppStore.getState())) return true;
  if (!isElectron) {
    return window.confirm(
      "You have unsaved changes. Discard them and continue?",
    );
  }
  const choice = await window.cslope.askUnsavedChanges();
  if (choice === "discard") return true;
  if (choice === "cancel") return false;
  return saveProjectInElectron();
}

/**
 * Run `action` once unsaved changes are dealt with.  Synchronous when the
 * project is clean, so callers behave as before in that case.
 */
export function withUnsavedChangesCheck(action: () => void): void | Promise<void> {
  if (!isProjectDirty(useAppStore.getState())) {
    action();
    return;
  }
  return confirmUnsavedChanges().then((ok) => {
    if (ok) action();
  });
}
