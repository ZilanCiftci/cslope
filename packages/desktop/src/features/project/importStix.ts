import { addImportedModels, importEach, importError } from "./importedModels";
import { readStix } from "./stix/stix-read";
import { stixToDefinition, type StixImport } from "./stix/stix-to-definition";

/** The calculations of a .stix file as slope definitions (no store). */
export async function stixImports(bytes: Uint8Array, fileName: string): Promise<StixImport[]> {
  const file = await readStix(bytes).catch((e: unknown) => {
    throw importError(e, "The .stix file");
  });
  if (file.calculations.length === 0) throw new Error("The file has no calculation.");
  const label = (i: number) => `Calculation "${file.calculations[i].label}" of scenario "${file.calculations[i].scenario}"`;
  return importEach(file.calculations.length, (i) => stixToDefinition(file, i, fileName), label);
}

/**
 * Import a .stix project file: each calculation becomes a model.
 * Returns a summary for the user, with what did not carry over.
 */
export async function importStix(bytes: Uint8Array, fileName: string): Promise<string> {
  return addImportedModels(await stixImports(bytes, fileName), fileName, "slip plane");
}
