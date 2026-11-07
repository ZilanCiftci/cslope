/**
 * The analysis input each result was computed for, kept with the result in
 * memory (by the result object; never saved itself): the model's input as
 * canonical JSON when a run completes, or the `inputHash` of the
 * result.json it was read from. The project writer saves this hash with
 * the result (docs/file-format.md section 4.4), never one computed from the
 * model at save time, so a result that was out of date when opened stays
 * out of date when saved again.
 */
import { analysisInputJson, sha256Hex } from "../features/project/input-hash";
import type { AnalysisResult, ModelEntry } from "./types";

const inputs = new WeakMap<object, { json?: string; hash?: string }>();

/** A run of `model` (as it was run) gave `result`. */
export function rememberResultInput(result: AnalysisResult, model: ModelEntry): void {
  inputs.set(result, { json: analysisInputJson(model) });
}

/** `result` was read from a result.json with this `inputHash`. */
export function rememberResultHash(result: AnalysisResult, hash: string): void {
  inputs.set(result, { hash });
}

/** The hash of the input `result` was computed for, or undefined when it is not known. */
export async function resultInputHash(result: AnalysisResult | null | undefined): Promise<string | undefined> {
  const known = result ? inputs.get(result) : undefined;
  if (!known) return undefined;
  if (known.hash === undefined && known.json !== undefined) known.hash = await sha256Hex(new TextEncoder().encode(known.json));
  return known.hash;
}
