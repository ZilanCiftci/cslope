/**
 * The cSlope project file (.cslp): a ZIP archive (deflated) of
 *
 *   manifest.json  { format: "cslope-project", formatVersion, appVersion, created }
 *   project.json   the project without the outcome of its runs
 *   results.json   the outcomes by model id (only when a model has one)
 *
 * Projects saved before .cslp are a single JSON file (.json or .cslope);
 * they open as before. What a file is, is told by its content (a ZIP
 * archive or a JSON object), not by its extension.
 *
 * Reading goes through readZip (with its limits on what an archive may
 * unpack to) and then through the same validation as a JSON project
 * (parseProjectData: only known fields are kept).
 */
import {
  parseJson,
  parseProjectData,
  parseProjectFile,
  RUN_FIELDS,
  serializeProject,
  type ProjectFile,
} from "../../store/persistence";
import type { AppState } from "../../store/types";
import { APP_VERSION } from "../../utils/app-version";
import { isZip, readZip, writeZipDeflated } from "../../utils/zip";
import { MAX_FILE_BYTES } from "./file-limits";

/** The project file's extension. */
export const PROJECT_EXTENSION = ".cslp";
/** The manifest's `format`. */
export const CSLP_FORMAT = "cslope-project";
/** The archive layout this version writes (and the newest it reads). */
export const CSLP_FORMAT_VERSION = 1;

export interface CslpManifest {
  format: typeof CSLP_FORMAT;
  formatVersion: number;
  /** The cSlope version that saved the file. */
  appVersion: string;
  /** When the file was saved (ISO 8601). */
  created: string;
}

const MANIFEST = "manifest.json";
const PROJECT = "project.json";
const RESULTS = "results.json";

/** Run fields kept in results.json (the progress of a run is not saved). */
const SAVED_RUN_FIELDS = RUN_FIELDS.filter((f) => f !== "progress");

// ── File names ──────────────────────────────────────────────────────

/** The extensions a project file has had: .cslp, and .json and .cslope before it. */
const PROJECT_EXTENSIONS = /(\.(cslp|cslope|json))+$/i;

/**
 * `name` with .cslp as its only extension: a typed .cslp, .cslope or .json
 * (one or several, as a save dialog may append one to a typed name) is
 * replaced, so "x", "x.json", "x.cslope.cslp" and "x.cslp.cslp" all give
 * "x.cslp". Any other dot stays part of the name ("Slope 1.5 m.cslp").
 */
export function ensureCslpName(name: string): string {
  const base = name.trim().replace(PROJECT_EXTENSIONS, "").trim();
  return `${base || "cslope-project"}${PROJECT_EXTENSION}`;
}

/** The name of a project file without its extension, for display. */
export function stripProjectExt(name: string): string {
  return name.replace(PROJECT_EXTENSIONS, "");
}

/** Whether a file name has one of the extensions a project file has had. */
export function isProjectFileName(name: string): boolean {
  return /\.(cslp|cslope|json)$/i.test(name);
}

// ── Writing ─────────────────────────────────────────────────────────

/**
 * Split a project into the part saved in project.json and the outcomes of
 * its runs (results.json; null when no model has one).
 */
export function splitResults(file: ProjectFile): {
  project: ProjectFile;
  results: { models: Record<string, Record<string, unknown>> } | null;
} {
  const results: Record<string, Record<string, unknown>> = {};
  let any = false;
  const models = file.models.map((model) => {
    const rest: Record<string, unknown> = { ...model };
    for (const f of RUN_FIELDS) delete rest[f];
    if (model.runState === "done" || model.runState === "error") {
      const run: Record<string, unknown> = {};
      for (const f of SAVED_RUN_FIELDS) {
        if (model[f] !== undefined) run[f] = model[f];
      }
      results[model.id] = run;
      any = true;
    }
    return rest as unknown as ProjectFile["models"][number];
  });
  return { project: { ...file, models }, results: any ? { models: results } : null };
}

/** A project as a .cslp archive. */
export async function writeProjectArchive(file: ProjectFile, created = new Date()): Promise<Uint8Array> {
  const { project, results } = splitResults(file);
  const manifest: CslpManifest = {
    format: CSLP_FORMAT,
    formatVersion: CSLP_FORMAT_VERSION,
    appVersion: APP_VERSION || "unknown",
    created: created.toISOString(),
  };
  const entries = [
    { name: MANIFEST, data: JSON.stringify(manifest, null, 2) },
    { name: PROJECT, data: JSON.stringify(project, null, 2) },
  ];
  // The results are large (surfaces, slices, finite element meshes) and not
  // read by people: no indentation.
  if (results) entries.push({ name: RESULTS, data: JSON.stringify(results) });
  return writeZipDeflated(entries);
}

/**
 * The current project as a .cslp archive. The caller must call
 * `state.saveCurrentModel()` first, so the latest edits are in the models.
 */
export function buildProjectArchive(state: AppState): Promise<Uint8Array> {
  return writeProjectArchive(serializeProject(state));
}

// ── Reading ─────────────────────────────────────────────────────────

const decoder = new TextDecoder();

/**
 * Read a project file: a .cslp archive or a JSON project file of an earlier
 * version (told apart by the content).
 */
export async function readProjectBytes(bytes: Uint8Array): Promise<ProjectFile> {
  if (bytes.length > MAX_FILE_BYTES) {
    throw new Error("The file is too large to be a cSlope project.");
  }
  if (isZip(bytes)) return readProjectArchive(bytes);
  // TextDecoder drops a byte order mark.
  const text = decoder.decode(bytes);
  if (!/^\s*\{/.test(text)) {
    throw new Error("The file is not a cSlope project (neither a .cslp archive nor a JSON project file).");
  }
  return parseProjectFile(text);
}

/** Read a .cslp archive. */
export async function readProjectArchive(bytes: Uint8Array): Promise<ProjectFile> {
  let entries: Map<string, Uint8Array>;
  try {
    entries = await readZip(bytes, (name) => name === MANIFEST || name === PROJECT || name === RESULTS);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`The file is not a readable cSlope project: ${msg}`);
  }
  const text = (name: string) => decoder.decode(entries.get(name));

  if (!entries.has(MANIFEST)) {
    throw new Error("The file is not a cSlope project (the archive has no manifest.json).");
  }
  const manifest = parseJson(text(MANIFEST), "The project's manifest.json is not valid JSON.") as Partial<CslpManifest> | null;
  if (!manifest || typeof manifest !== "object" || manifest.format !== CSLP_FORMAT) {
    throw new Error("The file is not a cSlope project (its manifest names another format).");
  }
  const version = manifest.formatVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new Error("The project's manifest.json is damaged (no valid formatVersion).");
  }
  if (version > CSLP_FORMAT_VERSION) {
    const by = typeof manifest.appVersion === "string" && manifest.appVersion ? ` (cSlope ${manifest.appVersion})` : "";
    throw new Error(
      `This project was saved by a newer version of cSlope${by}, in project format ${version}; this version reads format ${CSLP_FORMAT_VERSION}. Update cSlope to open it.`,
    );
  }
  if (!entries.has(PROJECT)) {
    throw new Error("The project file is damaged (the archive has no project.json).");
  }
  const project = parseJson(text(PROJECT), "The project's project.json is not valid JSON.");
  const results = entries.has(RESULTS) ? parseJson(text(RESULTS), "The project's results.json is not valid JSON.") : null;
  return parseProjectData(joinResults(project, results));
}

/**
 * Put the outcomes of results.json back into the models of project.json.
 * Outcome fields in project.json itself are ignored (results come only from
 * results.json), and only the known outcome fields are taken over; the
 * models are then validated as a JSON project's.
 */
function joinResults(project: unknown, results: unknown): unknown {
  if (!project || typeof project !== "object") return project;
  const root = project as Record<string, unknown>;
  if (!Array.isArray(root.models)) return project;
  const byId =
    results && typeof results === "object" && (results as Record<string, unknown>).models && typeof (results as Record<string, unknown>).models === "object"
      ? ((results as Record<string, unknown>).models as Record<string, unknown>)
      : null;
  const models = root.models.map((m: unknown) => {
    if (!m || typeof m !== "object" || Array.isArray(m)) return m;
    const model: Record<string, unknown> = { ...(m as Record<string, unknown>) };
    for (const f of RUN_FIELDS) delete model[f];
    const id = model.id;
    const run = byId && typeof id === "string" && Object.hasOwn(byId, id) ? byId[id] : null;
    if (run && typeof run === "object" && !Array.isArray(run)) {
      for (const f of SAVED_RUN_FIELDS) {
        if (Object.hasOwn(run, f)) model[f] = (run as Record<string, unknown>)[f];
      }
    }
    return model;
  });
  return { ...root, models };
}
