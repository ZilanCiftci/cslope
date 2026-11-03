import { useAppStore } from "../../store/app-store";
import { downloadFile, safeFileName } from "../../utils/download";
import { modelToStix } from "./stix/stix-write";

/**
 * Export the active model as a .stix project file. Returns a summary for the
 * user with what the format does not carry.
 */
export function exportStix(): string {
  const store = useAppStore.getState();
  store.saveCurrentModel();
  const s = useAppStore.getState();
  const model = s.models.find((m) => m.id === s.activeModelId);
  if (!model) throw new Error("No model to export.");
  const { bytes, notes } = modelToStix(model);
  const fileName = safeFileName(model.name || "cslope", "stix");
  downloadFile(fileName, bytes as BlobPart, "application/zip");
  const list = notes.length > 0 ? `\n  – ${notes.join("\n  – ")}` : "";
  return `Exported "${model.name}" as ${fileName}.${list}\n\nOpen it in the receiving program and check it before use.`;
}
