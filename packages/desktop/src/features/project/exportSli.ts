import { useAppStore } from "../../store/app-store";
import { downloadFile, safeFileName } from "../../utils/download";
import { modelToSlim } from "./sli/sli-write";

/**
 * Export the active model as a .slim model file (a .sli in a ZIP archive).
 * Returns a summary for the user with what the format does not carry.
 */
export function exportSli(): string {
  const store = useAppStore.getState();
  store.saveCurrentModel();
  const s = useAppStore.getState();
  const model = s.models.find((m) => m.id === s.activeModelId);
  if (!model) throw new Error("No model to export.");
  const fileName = safeFileName(model.name || "cslope", "slim");
  const { bytes, notes } = modelToSlim(model, fileName.replace(/\.slim$/i, ""));
  downloadFile(fileName, bytes as BlobPart, "application/zip");
  const list = notes.length > 0 ? `\n  – ${notes.join("\n  – ")}` : "";
  return `Exported "${model.name}" as ${fileName}.${list}\n\nOpen it in the receiving program and check it before use.`;
}
