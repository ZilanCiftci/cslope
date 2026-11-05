import { useAppStore } from "../../store/app-store";
import { downloadFile, safeFileName } from "../../utils/download";
import { modelToGsz } from "./gsz/gsz-write";

/**
 * Export the active model as a .gsz project file. Returns a summary for the
 * user with what the format does not carry, or null when it carries
 * everything (nothing to say: the save dialog is the feedback).
 */
export function exportGsz(): string | null {
  const store = useAppStore.getState();
  store.saveCurrentModel();
  const s = useAppStore.getState();
  const model = s.models.find((m) => m.id === s.activeModelId);
  if (!model) throw new Error("No model to export.");
  const { bytes, notes } = modelToGsz(model);
  const fileName = safeFileName(model.name || "cslope", "gsz");
  downloadFile(fileName, bytes as BlobPart, "application/zip");
  if (notes.length === 0) return null;
  // The download reports neither its end nor a cancelled save dialog, so
  // the summary only says what the file leaves out.
  return `${fileName} leaves out:\n  – ${notes.join("\n  – ")}\n\nCheck the model in the receiving program before use.`;
}
