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
