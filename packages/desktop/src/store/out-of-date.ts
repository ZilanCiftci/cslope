/**
 * Results that are out of date: a result read from a project file whose
 * `inputHash` (models/<id>/result.json, docs/file-format.md section 5) is
 * not the hash of its model's input as opened (the file was edited after
 * the run, by hand or by another program). Such a result stays viewable;
 * the Models panel marks it. Kept by the result object itself (it is not
 * part of the model and is never saved): a new run gives a new result, an
 * edit of the model drops it.
 */
import type { AnalysisResult } from "./types";

const outOfDate = new WeakSet<object>();

/** Mark a result read from a file as computed for other input. */
export function markResultOutOfDate(result: AnalysisResult): void {
  outOfDate.add(result);
}

/** Whether the result was computed for other input than its model's. */
export function isResultOutOfDate(result: AnalysisResult | null | undefined): boolean {
  return !!result && outOfDate.has(result);
}
