import type { AnalysisOptions, SlopeDefinition } from "@cslope/engine";
import { useAppStore } from "../../store/app-store";
import { modelFromDefinition } from "../../store/definition-model";
import { nextId } from "../../store/helpers";

/** A model read from another program's project file. */
export interface ImportedModel {
  name: string;
  definition: SlopeDefinition;
  options: Partial<AnalysisOptions>;
  notes: string[];
  reference?: { fos: number };
}

/**
 * Read the analyses of a file one by one: one that cannot be read (no
 * geometry, no materials) does not stop the others and is named in the
 * first one's notes.
 */
export function importEach<T extends ImportedModel>(count: number, read: (i: number) => T): T[] {
  const imports: T[] = [];
  const failed: string[] = [];
  for (let i = 0; i < count; i++) {
    try {
      imports.push(read(i));
    } catch (e) {
      failed.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (imports.length === 0) throw new Error(failed[0]);
  if (failed.length > 0) imports[0].notes.push(...failed.map((m) => `Not imported: ${m}`));
  return imports;
}

/**
 * Add imported models to the project (as one step, not a series of edits
 * to undo) and show the first. Returns a summary for the user, with what
 * did not carry over; `surface` names the file's critical surface.
 */
export function addImportedModels(imports: ImportedModel[], fileName: string, surface: string): string {
  const entries = imports.map((imp) => modelFromDefinition(imp.definition, { id: nextId("model"), name: imp.name, options: imp.options }));
  useAppStore.getState().saveCurrentModel();
  useAppStore.setState((s) => ({ models: [...s.models, ...entries] }));
  useAppStore.getState().switchModel(entries[0].id);
  useAppStore.setState({ _pendingFitToScreen: true });
  useAppStore.temporal.getState().clear();

  const lines = imports.map((imp) => {
    const ref = imp.reference ? ` The file's critical ${surface} (F = ${imp.reference.fos.toFixed(3)}) is added as a custom surface.` : "";
    const notes = imp.notes.length > 0 ? `\n  – ${imp.notes.join("\n  – ")}` : "";
    return `"${imp.name}": ${imp.definition.materials.length} materials, ${imp.definition.materialBoundaries?.length ?? 0} boundaries.${ref}${notes}`;
  });
  return `Imported ${imports.length} model${imports.length === 1 ? "" : "s"} from ${fileName}:\n${lines.join("\n")}\n\nCheck the materials and the water before running.`;
}
