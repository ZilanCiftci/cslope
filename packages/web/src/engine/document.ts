/**
 * The analysis document: the file Python's builder writes (`cslope.build`),
 * the command line runs and the engine validates (`validateDefinition`).
 * The templates produce one, the worker runs one.
 */
import type { AnalysisOptions, SlopeDefinition } from "@cslope/engine";

/** The `format` and `formatVersion` of an analysis document. */
export const DOCUMENT_FORMAT = "cslope-analysis";
export const DOCUMENT_FORMAT_VERSION = 1;

export interface AnalysisDocument {
  format: typeof DOCUMENT_FORMAT;
  formatVersion: typeof DOCUMENT_FORMAT_VERSION;
  definition: SlopeDefinition;
  /** The options of the run, over the public defaults (D-23). */
  options: Partial<AnalysisOptions>;
}

/** A document as indented JSON, with each point on one line (as Python's `cslope.build.dumps`). */
export function dumps(doc: unknown): string {
  const text = JSON.stringify(doc, null, 2);
  return text.replace(/\[\s*(-?[0-9][0-9.eE+-]*(?:,\s*-?[0-9][0-9.eE+-]*)*)\s*\]/g, (_, list: string) => `[${list.split(",").map((v) => v.trim()).join(", ")}]`) + "\n";
}
