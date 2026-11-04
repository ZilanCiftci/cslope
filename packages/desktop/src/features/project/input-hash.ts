/**
 * The hash of a model's analysis input, saved with its result
 * (models/<id>/result.json, `inputHash`): a reader can tell whether a
 * result still belongs to the model it is stored with, however the file
 * was edited since.
 *
 * Definition (docs/file-format.md): the SHA-256, as 64 lowercase hex
 * digits, of the canonical JSON (utils/canonical-json.ts: sorted keys,
 * 2-space indentation, LF, a final LF) of
 *
 *   { "definition": <buildSlopeDTOFromModel(model)>, "options": <model.options> }
 *
 * that is, of what the app sends to the engine for the model: the engine's
 * SlopeDefinition in canonical orientation (the geometry, materials,
 * water, loads, reinforcement, piles, boundaries and region assignments,
 * search limits, an earlier stage) and the analysis options. Nothing else
 * of the model (its name, views, annotations, result settings) is in it.
 */
import { buildSlopeDTOFromModel } from "../../store/helpers";
import type { ModelEntry } from "../../store/types";
import { canonicalJson } from "../../utils/canonical-json";

/** The text that is hashed: the model's analysis input as canonical JSON. */
export function analysisInputJson(model: ModelEntry): string {
  return canonicalJson({ definition: buildSlopeDTOFromModel(model), options: model.options });
}

/** The model's input hash (SHA-256 of analysisInputJson, lowercase hex). */
export async function analysisInputHash(model: ModelEntry): Promise<string> {
  return sha256Hex(new TextEncoder().encode(analysisInputJson(model)));
}

/** SHA-256 of bytes as 64 lowercase hex digits (the platform's crypto). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
