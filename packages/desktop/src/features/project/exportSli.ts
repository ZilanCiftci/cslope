import { useAppStore } from "../../store/app-store";
import { downloadFile, safeFileName } from "../../utils/download";
import { modelToSlim } from "./sli/sli-write";

/**
 * Export the active model as a .slim model file (a .sli in a ZIP archive).
 * Returns a summary for the user with what the format does not carry, or
 * null when it carries everything (the save dialog is the feedback).
 */
export function exportSli(): string | null {
  const store = useAppStore.getState();
  store.saveCurrentModel();
  const s = useAppStore.getState();
  const model = s.models.find((m) => m.id === s.activeModelId);
  if (!model) throw new Error("No model to export.");
  const fileName = safeFileName(model.name || "cslope", "slim");
  const { bytes, notes } = modelToSlim(model, fileName.replace(/\.slim$/i, ""));
  downloadFile(fileName, bytes as BlobPart, "application/zip");
  if (notes.length === 0) return null;
  // The download reports neither its end nor a cancelled save dialog, so
  // the summary only says what the file leaves out.
  return `${fileName} leaves out:\n  – ${notes.join("\n  – ")}\n\nCheck the model in the receiving program before use.`;
}
