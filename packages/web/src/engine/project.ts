/**
 * "Download .cslp": a cSlope project of the section, which the app opens
 * with the section and its result (issue #107). The engine's project
 * writer (`@cslope/engine/project`, a WebAssembly module of its own) makes
 * the app's model of the document's definition and writes the project as
 * the app does. It is loaded only when a project is first downloaded:
 * its code and its WebAssembly (about 0.4 MB compressed) are not part of
 * the page's first load.
 */
import type { AnalysisResult } from "@cslope/engine";
import type { ProjectFile } from "@cslope/engine/project";
import writerUrl from "@cslope/engine/project-wasm?url";
import type { AnalysisDocument } from "./document";

export type { ProjectFile };

/** The engine the page runs (its version and its build's source hash), recorded with the result; and the page's version. */
declare const __ENGINE_BUILD__: { version: string; sourceHash: string };
declare const __WEB_VERSION__: string;

/** Where the writer's WebAssembly comes from: its URL (the page), its bytes, or null: from disk (tests under Node). */
export type WriterSource = string | BufferSource | null;

/** The project file's name: the JSON download's, as .cslp ("cslope-excavation.cslp"). */
export const projectFileName = (jsonName: string) => jsonName.replace(/\.json$/, "") + ".cslp";

/** Today's date where the page is, YYYY-MM-DD (the model's date, as the app sets it). */
function localDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * The project of `doc` with `result`, the result of a run of this very
 * document (or null: none, or one of other input, which is out of date and
 * left out). The model is named `name`; its options are the document's.
 * The result is in the document's coordinates: the templates face left to
 * right, the canonical orientation the worker runs in.
 */
export async function writeProject(doc: AnalysisDocument, result: AnalysisResult | null, name: string, source: WriterSource = writerUrl, now = new Date()): Promise<ProjectFile> {
  const { initProjectWriter, projectFromDefinition } = await import("@cslope/engine/project");
  await initProjectWriter(source ?? undefined);
  const version = typeof __WEB_VERSION__ === "string" ? __WEB_VERSION__ : "";
  return projectFromDefinition(doc.definition, result, {
    name,
    options: doc.options,
    date: localDate(now),
    modified: now.toISOString(),
    appVersion: version,
    generator: `cSlope in the browser ${version}`.trim(),
    engine: typeof __ENGINE_BUILD__ === "object" ? __ENGINE_BUILD__ : { version: "", sourceHash: "" },
  });
}
