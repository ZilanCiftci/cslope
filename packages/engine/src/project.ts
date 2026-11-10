/**
 * The project writer (crate cslope-project-wasm, issue #107): a cSlope
 * project (`.cslp`) of one model made from a definition, with the result
 * of its last analysis, written as the app and the Python package write
 * one (docs/file-format.md). The browser page's "Download .cslp".
 *
 * A WebAssembly module of its own, apart from the engine (which would
 * outgrow its size budget with it), started on demand:
 *
 *   await initProjectWriter(url);   // a browser: fetched when first needed
 *   await initProjectWriter();      // Node/Bun: src/wasm-project from disk
 *   projectFromDefinition(definition, result, { name, modified, ... });
 *
 * Imported from "@cslope/engine/project", not from the package's main
 * entry, so that the engine's users do not carry it.
 */
import * as glue from "./wasm-project/cslope_project_wasm.js";
import type { AnalysisOptions, AnalysisResult } from "./types/analysis";
import type { SlopeDefinition } from "./types/slope-definition";

/** Who makes the project and what its model is called. */
export interface ProjectFromDefinitionOptions {
  /** The model's id, a folder name ([A-Za-z0-9_-]+; default "model-1"). */
  id?: string;
  /** The model's name. */
  name: string;
  /** The analysis options over the app's defaults: those the result was computed with. */
  options?: Partial<AnalysisOptions>;
  /** The model's date, YYYY-MM-DD (default the date of `modified`). */
  date?: string;
  /** When the file is saved, ISO 8601 (`Date.toISOString()`): the manifest's time and every entry's time stamp. */
  modified: string;
  /** The manifest's `appVersion` and `generator`. */
  appVersion: string;
  generator: string;
  /** The engine that computed the result (its version and the source hash of its build). */
  engine?: { version: string; sourceHash: string };
}

/** The project's bytes, and whether the result is in it. */
export interface ProjectFile {
  bytes: Uint8Array;
  /** False without a result, or when the model would not read back as the definition (the result is then left out). */
  resultSaved: boolean;
}

const NOT_READY = "The cSlope project writer is not started: call initProjectWriter() first.";

let ready = false;

/** The bytes as a Uint8Array of this realm (jsdom replaces the typed arrays; WebAssembly refuses another realm's). */
function ownBytes(source: BufferSource): Uint8Array<ArrayBuffer> {
  const view = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
  const copy = new Uint8Array(view.length);
  copy.set(view);
  return copy;
}

function isModule(source: unknown): source is WebAssembly.Module {
  return Object.prototype.toString.call(source) === "[object WebAssembly.Module]";
}

/**
 * Starts the project writer: from a URL (fetched), the bytes or a compiled
 * module; without a source from `src/wasm-project` on disk (Node and Bun
 * scripts). A second call is a no-op.
 */
export async function initProjectWriter(source?: string | URL | BufferSource | WebAssembly.Module): Promise<void> {
  if (ready) return;
  let input: Response | Promise<Response> | BufferSource | WebAssembly.Module;
  if (source === undefined) {
    // node:fs by a variable name, so that bundlers for the browser leave it
    // alone; the file name too, or Vite would emit the file as an asset
    const fs = "node:fs/promises";
    const file = "./wasm-project/cslope_project_wasm_bg.wasm";
    const { readFile } = (await import(/* @vite-ignore */ fs)) as { readFile: (path: URL) => Promise<Uint8Array<ArrayBuffer>> };
    input = ownBytes(await readFile(new URL(file, import.meta.url)));
  } else if (typeof source === "string" || source instanceof URL) {
    input = fetch(source).then((response) => {
      if (!response.ok) throw new Error(`The project writer could not be downloaded (${response.status} for ${String(source)}).`);
      return response;
    });
  } else {
    input = isModule(source) ? source : ownBytes(source);
  }
  await glue.default({ module_or_path: input });
  ready = true;
}

export function isProjectWriterReady(): boolean {
  return ready;
}

/**
 * The `.cslp` project of one model made from `definition` (in model
 * coordinates, as the app's `modelFromDefinition` makes it) with `result`:
 * the result of an analysis of that definition with `options.options`
 * over the app's defaults, or null (none; leave out a result of other
 * input). The result is stamped with the input it was computed for, so
 * the app opens it current. The same arguments give the same bytes.
 * Throws an Error with the reason when the definition cannot be made a
 * model.
 */
export function projectFromDefinition(definition: SlopeDefinition, result: AnalysisResult | null, options: ProjectFromDefinitionOptions): ProjectFile {
  if (!ready) throw new Error(NOT_READY);
  try {
    // (as JSON, as the app writes its files: a number that is not finite is null)
    return glue.project_from_definition(JSON.stringify(definition), JSON.stringify(result ?? null), JSON.stringify(options)) as ProjectFile;
  } catch (e) {
    // A trap (a panic in Rust) leaves the instance unusable: the next start makes a new one.
    if (e instanceof WebAssembly.RuntimeError) {
      glue.__wbg_reset();
      ready = false;
    }
    throw e;
  }
}
