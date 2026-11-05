/**
 * Saving the anonymized copy of the open project (File › Save as
 * anonymized…): from a snapshot of the project, never through Save or
 * Save As, so the open project keeps its file and its unsaved state.
 */
import { useAppStore } from "../../store/app-store";
import { serializeProject, type ProjectFile } from "../../store/persistence";
import { isElectron } from "../../utils/is-electron";
import { triggerBrowserDownload } from "./actions";
import { ANONYMIZED_SUFFIX, anonymizedFileName, writeAnonymizedArchive, type AnonymizeOptions } from "./anonymize";
import { ensureCslpName, openedProjectAssets } from "./cslp";

/** The project as it would be saved now (the latest edits in its models). */
export function projectSnapshot(): ProjectFile {
  useAppStore.getState().saveCurrentModel();
  return serializeProject(useAppStore.getState());
}

/**
 * Write the anonymized copy of the project and save it: in the desktop app
 * through a save dialog (next to the open file), in a browser as a
 * download. Returns the name saved under, or null when cancelled.
 */
export async function saveAnonymizedCopy(options: AnonymizeOptions, fileName: string, snapshot = projectSnapshot()): Promise<string | null> {
  const { bytes } = await writeAnonymizedArchive(snapshot, options, openedProjectAssets());
  if (isElectron) return window.cslope.saveCopy(bytes, ANONYMIZED_SUFFIX);
  const name = window.prompt("Save anonymized copy as", anonymizedFileName(fileName));
  if (!name?.trim()) return null;
  const finalName = ensureCslpName(name);
  triggerBrowserDownload(bytes, finalName);
  return finalName;
}
