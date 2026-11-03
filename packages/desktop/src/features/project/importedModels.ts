import { buildSlope, toCanonicalSlopeDefinition, type AnalysisOptions, type SlopeDefinition } from "@cslope/engine";
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
 * The message for the user of an error while reading a file: the readers'
 * own errors as they are; an error of the runtime (where the file has a
 * value of another type than the format's) as damaged data of `what`.
 */
export function importErrorMessage(e: unknown, what = "The file"): string {
  if (e instanceof Error && e.constructor === Error && e.message.trim() !== "") return e.message;
  return `${what} has data that is not in the expected form (the file may be damaged, or from a version that is not supported).`;
}

/** A reader's error as an Error for the user (see importErrorMessage). */
export function importError(e: unknown, what = "The file"): Error {
  return e instanceof Error && e.constructor === Error && e.message.trim() !== "" ? e : new Error(importErrorMessage(e, what));
}

/**
 * Read the analyses of a file one by one: one that cannot be read (no
 * geometry, no materials, damaged data, a model the engine cannot build)
 * does not stop the others and is named in the first one's notes, by
 * `label` (e.g. `Analysis "Long term"`) when its message does not name it.
 */
export function importEach<T extends ImportedModel>(count: number, read: (i: number) => T, label?: (i: number) => string): T[] {
  const imports: T[] = [];
  const failed: string[] = [];
  for (let i = 0; i < count; i++) {
    let name: string | undefined;
    try {
      name = label?.(i);
      const imp = read(i);
      try {
        buildSlope(toCanonicalSlopeDefinition(imp.definition));
      } catch (e) {
        throw new Error(`The model cannot be built: ${importErrorMessage(e, "Its definition")}`);
      }
      imports.push(imp);
    } catch (e) {
      const m = importErrorMessage(e, name || "The model");
      failed.push(name && !m.includes(name) ? `${name}: ${m}` : m);
    }
  }
  if (imports.length === 0) throw new Error(failed[0]);
  if (failed.length > 0) imports[0].notes.push(...failed.map((m) => `Not imported: ${m}`));
  return imports;
}

/** "1 material", "2 materials". */
export function plural(n: number, word: string, plural = `${word}s`): string {
  return `${n} ${n === 1 ? word : plural}`;
}

/**
 * Add imported models to the project and show the first. Returns a summary
 * for the user, with what did not carry over; `surface` names the file's
 * critical surface. Each model keeps its notes (`importNotes`, shown in
 * its properties). The undo history belongs to one model and does not
 * hold the list of models, so the import is no undo step: the summary says
 * so.
 */
export function addImportedModels(imports: ImportedModel[], fileName: string, surface: string): string {
  const entries = imports.map((imp) => ({
    ...modelFromDefinition(imp.definition, { id: nextId("model"), name: imp.name, options: imp.options }),
    importNotes: [`Imported from ${fileName}.`, ...imp.notes],
  }));
  useAppStore.getState().saveCurrentModel();
  useAppStore.setState((s) => ({ models: [...s.models, ...entries] }));
  useAppStore.getState().switchModel(entries[0].id);
  useAppStore.setState({ _pendingFitToScreen: true });
  useAppStore.temporal.getState().clear();

  const lines = imports.map((imp) => {
    const ref = imp.reference
      ? ` The file's critical ${surface} (factor of safety ${imp.reference.fos.toFixed(3)}) is added as a custom surface.`
      : "";
    const notes = imp.notes.length > 0 ? `\n  – ${imp.notes.join("\n  – ")}` : "";
    return `"${imp.name}": ${plural(imp.definition.materials.length, "material")}, ${plural(imp.definition.materialBoundaries?.length ?? 0, "boundary", "boundaries")}.${ref}${notes}`;
  });
  return (
    `Imported ${plural(imports.length, "model")} from ${fileName}:\n${lines.join("\n")}\n\n` +
    "Check the materials and the water before running. These notes stay with each model (right-click it in the explorer, Properties). " +
    "The import cannot be undone; delete the imported models in the explorer to remove them."
  );
}
