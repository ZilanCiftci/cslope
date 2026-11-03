import { addImportedModels, importEach } from "./importedModels";
import { readSli } from "./sli/sli-read";
import { sliToDefinition, type SliImport } from "./sli/sli-to-definition";

/** The models of a .sli, .slim or .slmd file (one per scenario) as slope definitions (no store). */
export async function sliImports(bytes: Uint8Array, fileName: string): Promise<SliImport[]> {
  const file = await readSli(bytes);
  if (file.scenarios.length === 0) throw new Error("The file has no model.");
  return importEach(file.scenarios.length, (i) => sliToDefinition(file, i, fileName));
}

/**
 * Import a .sli, .slim or .slmd model file: each scenario becomes a model.
 * Returns a summary for the user, with what did not carry over.
 */
export async function importSli(bytes: Uint8Array, fileName: string): Promise<string> {
  return addImportedModels(await sliImports(bytes, fileName), fileName, "surface");
}
