/**
 * Saving from Electron and asking the user about unsaved changes before
 * the project is replaced or the window is closed.
 */
import {
  isProjectDirty,
  markProjectClean,
  useAppStore,
} from "../../store/app-store";
import type { AppState } from "../../store/types";
import { isElectron } from "../../utils/is-electron";
import { buildProjectArchive, ensureCslpName } from "./cslp";
import { projectThumbnail } from "./thumbnail";

/** The file name a new project file is offered under: the active model's name, .cslp. */
export function suggestedProjectFileName(state = useAppStore.getState()): string {
  const active = state.models.find((m) => m.id === state.activeModelId);
  const name = (active?.name ?? "").replace(/[\\/:*?"<>|]+/g, "_").trim();
  return ensureCslpName(name || "cslope-project");
}

/**
 * The `created` time a save of `state` writes in the manifest: the
 * project's, else now (its first save, or a project of an earlier version).
 */
export function createdForSave(state: AppState): string {
  return state.projectCreated ?? new Date().toISOString();
}

/**
 * Record a save of `state` that wrote `created`: the project is clean,
 * and keeps that `created` for the next saves.
 */
export function markProjectSaved(state: AppState, created: string): void {
  markProjectClean(state);
  if (useAppStore.getState().projectCreated === null) {
    useAppStore.setState({ projectCreated: created });
  }
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
    const created = createdForSave(state);
    const data = await buildProjectArchive(state, { thumbnail: projectThumbnail, created });
    const name = suggestedProjectFileName(state);
    const saved = saveAs
      ? await window.cslope.saveFileAs(data, name)
      : await window.cslope.saveFile(data, name);
    if (saved) markProjectSaved(state, created);
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
