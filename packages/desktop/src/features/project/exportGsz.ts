import { useAppStore } from "../../store/app-store";
import { downloadFile, safeFileName } from "../../utils/download";
import { modelToGsz } from "./gsz/gsz-write";

/**
 * Export the active model as a .gsz project file. Returns a summary for the
 * user with what the format does not carry.
 */
export function exportGsz(): string {
  const store = useAppStore.getState();
  store.saveCurrentModel();
  const s = useAppStore.getState();
  const model = s.models.find((m) => m.id === s.activeModelId);
  if (!model) throw new Error("No model to export.");
  const { bytes, notes } = modelToGsz(model);
  const fileName = safeFileName(model.name || "cslope", "gsz");
  downloadFile(fileName, bytes as BlobPart, "application/zip");
  const list = notes.length > 0 ? `\n  – ${notes.join("\n  – ")}` : "";
  return `Exported "${model.name}" as ${fileName}.${list}\n\nOpen it in the receiving program and check it before use.`;
}
