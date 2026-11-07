/**
 * Runs an analysis document with the engine in this thread, as the worker
 * does (engine/analysis.worker.ts): for the tests and scripts under Bun
 * and Node, where there is no worker. Starts the engine from disk on the
 * first call.
 */
import {
  DEFAULT_ANALYSIS_OPTIONS,
  initEngine,
  publicDefaultOptions,
  runAnalysis,
  summarizeResult,
  toCanonicalSlopeDefinition,
  validateDefinition,
  type AnalysisResult,
  type ResultSummary,
  type ValidationIssue,
} from "@cslope/engine";
import type { AnalysisDocument } from "../engine/document";

export async function runDocument(doc: AnalysisDocument): Promise<{ result: AnalysisResult; summary: ResultSummary; issues: ValidationIssue[] }> {
  await initEngine();
  const issues = validateDefinition(doc);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length) throw new Error(`The document has errors:\n${errors.map((e) => `${e.path}: ${e.message}`).join("\n")}`);
  const options = { ...DEFAULT_ANALYSIS_OPTIONS, ...publicDefaultOptions(), ...doc.options };
  const result = runAnalysis(toCanonicalSlopeDefinition(doc.definition), options);
  return { result, summary: summarizeResult(result, options), issues };
}
