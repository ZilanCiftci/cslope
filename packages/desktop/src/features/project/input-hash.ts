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
 *
 * The model is taken as a reader reads it back from the file
 * (`parseProjectData` of its saved JSON): the app holds values the load
 * normalizes away (an option at its default, such as `bothDirections:
 * false`), and a result's hash must be the same when it is computed at the
 * end of a run and when the file is opened again.
 */
import { buildSlopeDTOFromModel } from "../../store/helpers";
import { parseProjectData, PROJECT_FILE_VERSION, RUN_FIELDS } from "../../store/persistence";
import type { ModelEntry } from "../../store/types";
import { canonicalJson } from "../../utils/canonical-json";

/** The text that is hashed: the model's analysis input as canonical JSON. */
export function analysisInputJson(model: ModelEntry): string {
  const read = readBack(model);
  return canonicalJson({ definition: buildSlopeDTOFromModel(read), options: read.options });
}

/** The model as it reads back from its model.json (the model itself when it cannot be read). */
function readBack(model: ModelEntry): ModelEntry {
  // (the run fields and drawings left out before the copy: a result is large)
  const rest: Record<string, unknown> = { ...model };
  for (const f of RUN_FIELDS) delete rest[f];
  delete rest.backgrounds;
  const saved: Record<string, unknown> = JSON.parse(JSON.stringify(rest));
  try {
    return parseProjectData({ version: PROJECT_FILE_VERSION, models: [saved] }).models[0];
  } catch {
    return model;
  }
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
