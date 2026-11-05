import { addImportedModels, importEach, importError } from "./importedModels";
import { readGsz } from "./gsz/gsz-read";
import { gszToDefinition, stabilityAnalyses, type GszImport } from "./gsz/gsz-to-definition";

/** The stability analyses of a .gsz file as slope definitions (no store). */
export async function gszImports(bytes: Uint8Array, fileName: string): Promise<GszImport[]> {
  const file = await readGsz(bytes).catch((e: unknown) => {
    throw importError(e, "The .gsz file");
  });
  const analyses = stabilityAnalyses(file);
  if (analyses.length === 0) throw new Error("The file has no slope stability analysis.");
  return importEach(analyses.length, (i) => gszToDefinition(file, analyses[i].id, fileName), (i) => `Analysis "${analyses[i].name}"`);
}

/**
 * Import a .gsz project file: each stability analysis becomes a model.
 * Returns a summary for the user, with what did not carry over.
 */
export async function importGsz(bytes: Uint8Array, fileName: string): Promise<string | null> {
  return addImportedModels(await gszImports(bytes, fileName), fileName, "circle");
}
