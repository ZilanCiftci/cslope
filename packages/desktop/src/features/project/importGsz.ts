import { useAppStore } from "../../store/app-store";
import { modelFromDefinition } from "../../store/definition-model";
import { nextId } from "../../store/helpers";
import { readGsz } from "./gsz/gsz-read";
import { gszToDefinition, stabilityAnalyses, type GszImport } from "./gsz/gsz-to-definition";

/** The stability analyses of a .gsz file as slope definitions (no store). */
export async function gszImports(bytes: Uint8Array, fileName: string): Promise<GszImport[]> {
  const file = await readGsz(bytes);
  const analyses = stabilityAnalyses(file);
  if (analyses.length === 0) throw new Error("The file has no slope stability analysis.");
  // An analysis that cannot be read (no geometry, no materials) does not
  // stop the others; it is named in the first one's notes.
  const imports: GszImport[] = [];
  const failed: string[] = [];
  for (const a of analyses) {
    try {
      imports.push(gszToDefinition(file, a.id, fileName));
    } catch (e) {
      failed.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (imports.length === 0) throw new Error(failed[0]);
  if (failed.length > 0) imports[0].notes.push(...failed.map((m) => `Not imported: ${m}`));
  return imports;
}

/**
 * Import a .gsz project file: each stability analysis becomes a model.
 * Returns a summary for the user, with what did not carry over.
 */
export async function importGsz(bytes: Uint8Array, fileName: string): Promise<string> {
  const imports = await gszImports(bytes, fileName);
  const entries = imports.map((imp) => modelFromDefinition(imp.definition, { id: nextId("model"), name: imp.name, options: imp.options }));
  const store = useAppStore.getState();
  store.saveCurrentModel();
  useAppStore.setState((s) => ({ models: [...s.models, ...entries] }));
  useAppStore.getState().switchModel(entries[0].id);
  useAppStore.setState({ _pendingFitToScreen: true });
  // one import, not a series of edits to undo one by one
  useAppStore.temporal.getState().clear();

  const lines = imports.map((imp) => {
    const ref = imp.reference ? ` The file's critical circle (F = ${imp.reference.fos.toFixed(3)}) is added as a custom surface.` : "";
    const notes = imp.notes.length > 0 ? `\n  – ${imp.notes.join("\n  – ")}` : "";
    return `"${imp.name}": ${imp.definition.materials.length} materials, ${imp.definition.materialBoundaries?.length ?? 0} boundaries.${ref}${notes}`;
  });
  return `Imported ${imports.length} model${imports.length === 1 ? "" : "s"} from ${fileName}:\n${lines.join("\n")}\n\nCheck the materials and the water before running.`;
}
