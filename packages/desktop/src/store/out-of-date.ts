/**
 * Results that are out of date: a result read from a project file whose
 * `inputHash` (models/<id>/result.json, docs/file-format.md section 5) is
 * not the hash of its model's input as opened (the file was edited after
 * the run, by hand or by another program). Such a result stays viewable;
 * the Models panel marks it, and the result summary, the PDF and the slice
 * data say so. Kept by the result object itself (it is not part of the
 * model and is never saved): a new run gives a new result, an edit of the
 * model drops it.
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

/** The line at the top of the result summary and in the exports of such a result. */
export const RESULT_OUT_OF_DATE_NOTE = "Out of date: this result was computed for different input. Run the analysis again.";

/** The tooltip of the Models panel's out-of-date mark (its label is "Result out of date"). */
export const RESULT_OUT_OF_DATE_TOOLTIP =
  "This result was computed for a different version of the model (the file was changed outside cSlope). Run the analysis again to update it.";
