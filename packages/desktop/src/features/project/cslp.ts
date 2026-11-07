/**
 * The cSlope project file (.cslp): a ZIP archive (docs/file-format.md is
 * the specification) of
 *
 *   manifest.json                   the format and its version, who wrote the file and when
 *   project.json                    the project: schema version, the models' order, the active model, units
 *   models/<id>/model.json          one model without the outcome of its run
 *   models/<id>/result.json         the outcome of its run (optional), with the hash of the input it belongs to
 *   models/<id>/backgrounds.json    the drawings placed under it (optional)
 *   assets/index.json               the binary attachments (optional)
 *   assets/<id>.<ext>               the attachments themselves
 *   thumbnail.png                   the active model's result sheet, small (optional)
 *
 * The JSON entries are written canonically (utils/canonical-json.ts) in a
 * fixed order with one time stamp, so the same project saved twice gives
 * the same bytes. Reading opens the archive's directory only and unpacks
 * the JSON entries; an asset is unpacked when it is asked for.
 *
 * Projects saved before .cslp are a single JSON file (.json or .cslope),
 * and the first .cslp layout (never released) had project.json and
 * results.json at the root; both open as before and are written in the
 * layout above. What a file is, is told by its content (a ZIP archive or
 * a JSON object), not by its extension.
 *
 * Everything read goes through openZip (with its limits on what an
 * archive may unpack to) and then through the same validation as a JSON
 * project (parseProjectData: only known fields are kept).
 */
import {
  parseJson,
  parseProjectData,
  parseProjectFile,
  RUN_FIELDS,
  serializeProject,
  type ProjectFile,
} from "../../store/persistence";
import type { AnalysisResult, AppState, ModelEntry } from "../../store/types";
import { APP_VERSION, ENGINE_BUILD } from "../../utils/app-version";
import { canonicalJson } from "../../utils/canonical-json";
import { isZip, openZip, writeZipDeflated, ZIP_LIMITS, type ZipArchive, type ZipInput, type ZipLimits } from "../../utils/zip";
import { MAX_DRAWING_BYTES, MAX_PROJECT_FILE_BYTES } from "./file-limits";
import { analysisInputHash, sha256Hex } from "./input-hash";
import { adoptProjectAssets, openedProjectAssets, type ProjectAsset } from "../drawings/asset-registry";
import { isLegacyEntry, normalizeBackgrounds } from "../drawings/placement";
import { imageSize } from "../drawings/image-size";
import { markResultOutOfDate } from "../../store/out-of-date";

export { adoptProjectAssets, openedProjectAssets, normalizeBackgrounds, type ProjectAsset };

/** The project file's extension. */
export const PROJECT_EXTENSION = ".cslp";
/** The manifest's `format`. */
export const CSLP_FORMAT = "cslope-project";
/** The archive layout this version writes (and the newest it knows). */
export const CSLP_FORMAT_VERSION = 1;
/** The oldest reader that reads what this version writes (the manifest's `minReaderVersion`). */
export const CSLP_MIN_READER_VERSION = 1;

export interface CslpManifest {
  format: typeof CSLP_FORMAT;
  /** The layout; rises only with a change an older reader cannot ignore. */
  formatVersion: number;
  /** A reader whose format version is below this must refuse the file. */
  minReaderVersion: number;
  /** The cSlope version that saved the file. */
  appVersion: string;
  /** When the project file was first saved (ISO 8601). */
  created: string;
  /** When the file was saved (ISO 8601). */
  modified: string;
  /** The program that saved the file, for messages: "cSlope <version>". */
  generator: string;
}

/** project.json. */
export interface CslpProject {
  /** The project schema version (persistence.ts PROJECT_FILE_VERSION, with its migrations). */
  version: number;
  activeModelId: string;
  /** The models' ids in order; each has a folder models/<id>/. */
  models: string[];
  units: "SI";
  /** Project-wide settings; none defined yet. */
  settings: Record<string, unknown>;
}

/** models/<id>/result.json. */
export interface CslpResult {
  runState: "done" | "error";
  result: AnalysisResult | null;
  errorMessage: string | null;
  /** The hash of the model's analysis input the result was computed for (input-hash.ts). */
  inputHash: string;
  /** The engine that computed it. */
  engine: { version: string; sourceHash: string };
}

/** An entry of assets/index.json. */
export interface CslpAssetEntry {
  /** [A-Za-z0-9_-]+, a UUID for new assets. */
  id: string;
  /** The entry's name in the archive: assets/<id>.<ext>. */
  path: string;
  mime: string;
  /** The size in bytes. */
  bytes: number;
  /** SHA-256 of the bytes, lowercase hex. */
  sha256: string;
  /** The name the file had when it was attached. */
  originalName: string;
  /** When it was attached (ISO 8601). */
  addedAt: string;
}

/** What is written besides the project. */
export interface WriteProjectOptions {
  /** Write the models' results (default true). */
  results?: boolean;
  /** When the file was saved (the manifest's `modified` and the archive's time stamps; default now). */
  modified?: Date;
  /** When the project was first saved (default the project's `created`, else `modified`). */
  created?: Date | string;
  /** thumbnail.png: the bytes, or a function that draws them (null: none). */
  thumbnail?: Uint8Array | null | (() => Uint8Array | null);
  /**
   * The attachments available; those a model refers to are written. The
   * default is the attachments of the project last opened (so they survive
   * a save).
   */
  assets?: ProjectAsset[];
}

/** A project file opened: its content, and what else the archive holds. */
export interface OpenedProject {
  file: ProjectFile;
  /** "cslp": the layout above; "cslp-3file": the first .cslp layout; "json": a JSON project. */
  layout: "cslp" | "cslp-3file" | "json";
  manifest: CslpManifest | null;
  /** The attachments the file lists (those with an entry of the declared size). */
  assets: CslpAssetEntry[];
  /** An attachment's bytes, unpacked now and checked against the index's hash. */
  readAsset: (id: string) => Promise<Uint8Array>;
  /** thumbnail.png, or null without one. */
  readThumbnail: () => Promise<Uint8Array | null>;
  /** By model id: what result.json says about the result's input and engine. */
  results: Map<string, Pick<CslpResult, "inputHash" | "engine">>;
}

const MANIFEST = "manifest.json";
const PROJECT = "project.json";
const RESULTS = "results.json";
const ASSET_INDEX = "assets/index.json";
const THUMBNAIL = "thumbnail.png";
const MODELS_DIR = "models/";

/** Run fields kept in result.json (the progress of a run is not saved). */
const SAVED_RUN_FIELDS = RUN_FIELDS.filter((f) => f !== "progress");

/** A model's id, as a folder name: letters, digits, "_" and "-" only. */
export const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Asset entries: assets/<id>.<ext>. */
const ASSET_PATH = /^assets\/([A-Za-z0-9_-]+)\.[A-Za-z0-9]+$/;

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

// ── Model ids ───────────────────────────────────────────────────────

/**
 * The project with every model id a folder name (SAFE_ID): a model with
 * another id (a hand-edited file) gets a new UUID, and the active model's
 * id follows. Nothing else refers to a model by id.
 */
export function withSafeModelIds(file: ProjectFile): ProjectFile {
  if (file.models.every((m) => SAFE_ID.test(m.id))) return file;
  let activeModelId = file.activeModelId;
  const models = file.models.map((m) => {
    if (SAFE_ID.test(m.id)) return m;
    const id = crypto.randomUUID();
    if (m.id === activeModelId) activeModelId = id;
    return { ...m, id };
  });
  return { ...file, activeModelId, models };
}

// ── Writing ─────────────────────────────────────────────────────────

/** The file extension of an attachment, from its type. */
function extensionOf(mime: string): string {
  const known: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
    "image/tiff": "tif",
    "image/svg+xml": "svg",
    "application/pdf": "pdf",
    "image/vnd.dwg": "dwg",
    "image/vnd.dxf": "dxf",
  };
  return known[mime.toLowerCase()] ?? "bin";
}

/**
 * What an archive may unpack to, read: the JSON entries within the ZIP
 * limits; the attachments within limits of their own (a drawing's size
 * each, the project file's size in all), so that the drawings read never
 * use up what the JSON entries may unpack to, and the reverse.
 */
export interface ProjectZipLimits {
  entries: ZipLimits;
  assets: ZipLimits;
}
export const PROJECT_ZIP_LIMITS: ProjectZipLimits = {
  entries: ZIP_LIMITS,
  assets: { entryBytes: MAX_DRAWING_BYTES, totalBytes: MAX_PROJECT_FILE_BYTES },
};

const json = (name: string, value: unknown): ZipInput => ({ name, data: canonicalJson(value) });

/** A model as model.json: without the outcome of its run and its backgrounds (their own files). */
function modelJson(model: ModelEntry): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...model };
  for (const f of RUN_FIELDS) delete rest[f];
  delete rest.backgrounds;
  return rest;
}

/** The outcome of a model's run as result.json, or null without one. */
async function resultJson(model: ModelEntry): Promise<CslpResult | null> {
  if (model.runState !== "done" && model.runState !== "error") return null;
  return {
    runState: model.runState,
    result: model.runState === "done" ? (model.result ?? null) : null,
    errorMessage: model.runState === "error" ? (model.errorMessage ?? null) : null,
    inputHash: await analysisInputHash(model),
    engine: { ...ENGINE_BUILD },
  };
}

const isoOf = (d: Date | string) => (typeof d === "string" ? d : d.toISOString());

/** A project as a .cslp archive. */
export async function writeProjectArchive(input: ProjectFile, options: WriteProjectOptions = {}): Promise<Uint8Array> {
  const file = withSafeModelIds(input);
  const modified = options.modified ?? new Date();
  const created = options.created ?? file.created ?? modified;
  const manifest: CslpManifest = {
    format: CSLP_FORMAT,
    formatVersion: CSLP_FORMAT_VERSION,
    minReaderVersion: CSLP_MIN_READER_VERSION,
    appVersion: APP_VERSION || "unknown",
    created: isoOf(created),
    modified: modified.toISOString(),
    generator: `cSlope ${APP_VERSION || "unknown"}`,
  };
  const project: CslpProject = {
    version: file.version,
    activeModelId: file.activeModelId,
    models: file.models.map((m) => m.id),
    units: "SI",
    settings: {},
  };
  const entries: ZipInput[] = [json(MANIFEST, manifest), json(PROJECT, project)];

  // The attachments the models refer to (others are dropped).
  const available = new Map((options.assets ?? openedProjectAssets()).map((a) => [a.id, a]));
  const referenced = new Set<string>();
  for (const model of file.models) {
    const dir = `${MODELS_DIR}${model.id}/`;
    entries.push(json(`${dir}model.json`, modelJson(model)));
    if (options.results !== false) {
      const result = await resultJson(model);
      if (result) entries.push(json(`${dir}result.json`, result));
    }
    const backgrounds = (model.backgrounds ?? []).filter((b) => available.has(b.assetId));
    if (backgrounds.length > 0) {
      entries.push(json(`${dir}backgrounds.json`, backgrounds));
      for (const b of backgrounds) referenced.add(b.assetId);
    }
  }
  if (referenced.size > 0) {
    const index: CslpAssetEntry[] = [];
    const files: ZipInput[] = [];
    for (const id of [...referenced].sort()) {
      const asset = available.get(id)!;
      let data: Uint8Array;
      try {
        data = await asset.data();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`The drawing ${asset.originalName || id} cannot be read (${msg}); remove it from the models that place it to save the project.`, { cause: err });
      }
      const path = `assets/${id}.${extensionOf(asset.mime)}`;
      index.push({ id, path, mime: asset.mime, bytes: data.length, sha256: await sha256Hex(data), originalName: asset.originalName, addedAt: asset.addedAt });
      // Stored as they are, whatever the type: most drawings are compressed
      // already, and a stored entry is read without unpacking (a view of
      // the file's bytes), so large drawings never run into what deflated
      // entries may unpack to when the project is opened and saved again.
      files.push({ name: path, data, method: "store" });
    }
    entries.push(json(ASSET_INDEX, index), ...files);
  }
  const thumbnail = typeof options.thumbnail === "function" ? options.thumbnail() : options.thumbnail;
  if (thumbnail && thumbnail.length > 0) entries.push({ name: THUMBNAIL, data: thumbnail, method: "store" });
  return writeZipDeflated(entries, { time: modified });
}

/**
 * The current project as a .cslp archive. The caller must call
 * `state.saveCurrentModel()` first, so the latest edits are in the models.
 */
export function buildProjectArchive(state: AppState, options: WriteProjectOptions = {}): Promise<Uint8Array> {
  return writeProjectArchive(serializeProject(state), options);
}

// ── Reading ─────────────────────────────────────────────────────────

const decoder = new TextDecoder();

/** A project file read: its content and its attachments (to adoptProjectAssets when it is loaded). */
export interface ReadProject {
  file: ProjectFile;
  assets: ProjectAsset[];
}

/**
 * Read a project file: a .cslp archive or a JSON project file of an earlier
 * version (told apart by the content), with the archive's attachments.
 * Changes nothing: the caller that loads the project adopts its assets.
 */
export async function readProject(bytes: Uint8Array, limits: ProjectZipLimits = PROJECT_ZIP_LIMITS): Promise<ReadProject> {
  const opened = await openProject(bytes, limits);
  // A result computed for other input than its model's (the file was
  // edited after the run) stays, marked as out of date.
  for (const model of opened.file.models) {
    const saved = opened.results.get(model.id);
    if (model.runState === "done" && model.result && saved && saved.inputHash !== (await analysisInputHash(model))) {
      markResultOutOfDate(model.result);
    }
  }
  const assets = opened.assets.map((a) => {
    // An attachment read once is kept (a stored one is a view of the
    // file's bytes, held anyway): a later save never depends on reading it again.
    let held: Promise<Uint8Array> | undefined;
    return {
      id: a.id,
      mime: a.mime,
      originalName: a.originalName,
      addedAt: a.addedAt,
      sha256: a.sha256,
      bytes: a.bytes,
      data: () =>
        (held ??= opened.readAsset(a.id).catch((err: unknown) => {
          held = undefined;
          throw err;
        })),
    };
  });
  return { file: opened.file, assets };
}

/** The content of a project file (readProject without the attachments). */
export async function readProjectBytes(bytes: Uint8Array): Promise<ProjectFile> {
  return (await readProject(bytes)).file;
}

/** Open a project file (a .cslp archive, or a JSON project of an earlier version) and what else it holds. */
export async function openProject(bytes: Uint8Array, limits: ProjectZipLimits = PROJECT_ZIP_LIMITS): Promise<OpenedProject> {
  if (bytes.length > MAX_PROJECT_FILE_BYTES) {
    throw new Error("The file is too large to be a cSlope project.");
  }
  if (isZip(bytes)) return openProjectArchive(bytes, limits);
  // TextDecoder drops a byte order mark.
  const text = decoder.decode(bytes);
  if (!/^\s*\{/.test(text)) {
    throw new Error("The file is not a cSlope project (neither a .cslp archive nor a JSON project file).");
  }
  return withoutArchive(parseProjectFile(text), "json");
}

/**
 * A project without attachments (a JSON project, or the first .cslp
 * layout). Its model ids become folder names here (withSafeModelIds), so
 * the project is saved under the same ids every time.
 */
function withoutArchive(file: ProjectFile, layout: OpenedProject["layout"], manifest: CslpManifest | null = null): OpenedProject {
  return {
    file: withSafeModelIds(file),
    layout,
    manifest,
    assets: [],
    readAsset: async (id) => {
      throw new Error(`The project has no attachment ${id}.`);
    },
    readThumbnail: async () => null,
    results: new Map(),
  };
}

/** A JSON entry of the archive, parsed. */
async function readJsonEntry(archive: ZipArchive, name: string): Promise<unknown> {
  return parseJson(decoder.decode(await archive.read(name)), `The project's ${name} is not valid JSON.`);
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Open a .cslp archive. */
export async function openProjectArchive(bytes: Uint8Array, limits: ProjectZipLimits = PROJECT_ZIP_LIMITS): Promise<OpenedProject> {
  let archive: ZipArchive;
  let assetArchive: ZipArchive;
  try {
    archive = openZip(bytes, limits.entries);
    // (the same archive, its attachments read within their own limits)
    assetArchive = openZip(bytes, limits.assets);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`The file is not a readable cSlope project: ${msg}`, { cause: err });
  }
  if (!archive.has(MANIFEST)) {
    throw new Error("The file is not a cSlope project (the archive has no manifest.json).");
  }
  const manifest = readManifest(await readJsonEntry(archive, MANIFEST));

  const hasModels = archive.entries().some((e) => e.name.startsWith(MODELS_DIR) && e.name.endsWith("/model.json"));
  if (!hasModels) {
    // The first layout: project.json with the models, results.json beside it.
    if (!archive.has(PROJECT)) {
      throw new Error("The project file is damaged (the archive has no project.json).");
    }
    const project = await readJsonEntry(archive, PROJECT);
    if (!isObject(project) || !Array.isArray(project.models)) {
      throw new Error("The project file is damaged (no models in project.json and no models/ folder).");
    }
    const results = archive.has(RESULTS) ? await readJsonEntry(archive, RESULTS) : null;
    return withoutArchive(parseProjectData({ ...joinResults(project, results), created: manifest.created }), "cslp-3file", manifest);
  }
  return openLayout(archive, assetArchive, manifest);
}

/** The manifest validated; refuses a file this version must not read. */
function readManifest(raw: unknown): CslpManifest {
  if (!isObject(raw) || raw.format !== CSLP_FORMAT) {
    throw new Error("The file is not a cSlope project (its manifest names another format).");
  }
  const version = raw.formatVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new Error("The project's manifest.json is damaged (no valid formatVersion).");
  }
  const minReader = raw.minReaderVersion;
  // (the first layout's manifest has no minReaderVersion: its own version)
  const minReaderVersion = typeof minReader === "number" && Number.isInteger(minReader) && minReader >= 1 ? minReader : version;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const appVersion = str(raw.appVersion);
  const generator = str(raw.generator) || (appVersion ? `cSlope ${appVersion}` : "a newer cSlope");
  if (minReaderVersion > CSLP_FORMAT_VERSION) {
    throw new Error(`This project was saved by a newer cSlope (${generator}); update to open it.`);
  }
  return {
    format: CSLP_FORMAT,
    formatVersion: version,
    minReaderVersion,
    appVersion,
    created: str(raw.created),
    modified: str(raw.modified),
    generator,
  };
}

/** The layout of this version: project.json naming the models, each in its folder. */
async function openLayout(archive: ZipArchive, assetArchive: ZipArchive, manifest: CslpManifest): Promise<OpenedProject> {
  if (!archive.has(PROJECT)) {
    throw new Error("The project file is damaged (the archive has no project.json).");
  }
  const project = await readJsonEntry(archive, PROJECT);
  if (!isObject(project)) throw new Error("The project file is damaged (project.json is not an object).");

  // The models in the order project.json gives; folders it does not name
  // come after, by name (nothing in the file is lost).
  const listed = Array.isArray(project.models) ? project.models.filter((id): id is string => typeof id === "string" && SAFE_ID.test(id)) : [];
  const folders = archive
    .entries()
    .map((e) => /^models\/([A-Za-z0-9_-]+)\/model\.json$/.exec(e.name)?.[1])
    .filter((id): id is string => !!id)
    .sort();
  const ids = [...new Set([...listed, ...folders])];
  for (const id of listed) {
    if (!archive.has(`${MODELS_DIR}${id}/model.json`)) {
      throw new Error(`The project file is damaged (project.json names the model ${id}, but models/${id}/model.json is missing).`);
    }
  }

  const results = new Map<string, Pick<CslpResult, "inputHash" | "engine">>();
  const rawBackgrounds = new Map<string, unknown>();
  const models: unknown[] = [];
  for (const id of ids) {
    const dir = `${MODELS_DIR}${id}/`;
    const raw = await readJsonEntry(archive, `${dir}model.json`);
    if (!isObject(raw)) throw new Error(`The project file is damaged (models/${id}/model.json is not an object).`);
    // The folder names the model; the outcome comes from result.json only.
    const model: Record<string, unknown> = { ...raw, id };
    for (const f of RUN_FIELDS) delete model[f];
    delete model.backgrounds;
    if (archive.has(`${dir}result.json`)) {
      const run = await readJsonEntry(archive, `${dir}result.json`);
      if (isObject(run) && (run.runState === "done" || run.runState === "error")) {
        for (const f of SAVED_RUN_FIELDS) {
          if (Object.hasOwn(run, f)) model[f] = run[f];
        }
        const engine = isObject(run.engine) ? run.engine : {};
        results.set(id, {
          inputHash: typeof run.inputHash === "string" ? run.inputHash : "",
          engine: { version: typeof engine.version === "string" ? engine.version : "", sourceHash: typeof engine.sourceHash === "string" ? engine.sourceHash : "" },
        });
      }
    }
    if (archive.has(`${dir}backgrounds.json`)) {
      rawBackgrounds.set(id, await readJsonEntry(archive, `${dir}backgrounds.json`));
    }
    models.push(model);
  }

  const file = parseProjectData({
    version: project.version,
    activeModelId: project.activeModelId,
    units: project.units,
    created: manifest.created,
    models,
  });

  // The attachments: entries of the declared size; a background without
  // its attachment is dropped.
  const assets = archive.has(ASSET_INDEX) ? normalizeAssetIndex(await readJsonEntry(archive, ASSET_INDEX), archive) : [];
  const assetIds = new Set(assets.map((a) => a.id));
  // An entry of the first form is placed by its image's corner: the
  // image's size is read from its header (only for such an entry).
  const sizes = new Map<string, { width: number; height: number } | null>();
  for (const raw of rawBackgrounds.values()) {
    for (const item of Array.isArray(raw) ? raw : []) {
      const assetId = isLegacyEntry(item) ? (item as { assetId?: unknown }).assetId : undefined;
      const entry = typeof assetId === "string" && !sizes.has(assetId) ? assets.find((a) => a.id === assetId) : undefined;
      if (entry) sizes.set(entry.id, await assetArchive.read(entry.path).then(imageSize, () => null));
    }
  }
  for (const model of file.models) {
    const backgrounds = normalizeBackgrounds(rawBackgrounds.get(model.id), (id) => sizes.get(id) ?? null).filter((b) => assetIds.has(b.assetId));
    if (backgrounds.length > 0) model.backgrounds = backgrounds;
    // Locks of drawings the model does not have are dropped.
    if (model.locks?.backgrounds) {
      const placed = new Set(backgrounds.map((b) => b.id));
      const kept = model.locks.backgrounds.filter((id) => placed.has(id));
      const locks = { ...model.locks };
      if (kept.length > 0) locks.backgrounds = kept;
      else delete locks.backgrounds;
      if (Object.keys(locks).length > 0) model.locks = locks;
      else delete model.locks;
    }
  }
  for (const id of results.keys()) {
    if (!file.models.some((m) => m.id === id && (m.runState === "done" || m.runState === "error"))) results.delete(id);
  }

  return {
    file,
    layout: "cslp",
    manifest,
    assets,
    readAsset: async (id) => {
      const entry = assets.find((a) => a.id === id);
      if (!entry) throw new Error(`The project has no attachment ${id}.`);
      const data = await assetArchive.read(entry.path);
      if ((await sha256Hex(data)) !== entry.sha256) {
        throw new Error(`The project file is damaged (the attachment ${entry.originalName || entry.path} does not match its hash).`);
      }
      return data;
    },
    readThumbnail: async () => (archive.has(THUMBNAIL) ? archive.read(THUMBNAIL) : null),
    results,
  };
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** assets/index.json validated: entries naming an archive entry of the declared size. */
function normalizeAssetIndex(raw: unknown, archive: ZipArchive): CslpAssetEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: CslpAssetEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isObject(item) || typeof item.id !== "string" || !SAFE_ID.test(item.id) || seen.has(item.id)) continue;
    if (typeof item.path !== "string" || ASSET_PATH.exec(item.path)?.[1] !== item.id) continue;
    if (!finite(item.bytes) || archive.size(item.path) !== item.bytes) continue;
    if (typeof item.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(item.sha256)) continue;
    seen.add(item.id);
    out.push({
      id: item.id,
      path: item.path,
      mime: typeof item.mime === "string" ? item.mime : "application/octet-stream",
      bytes: item.bytes,
      sha256: item.sha256,
      originalName: typeof item.originalName === "string" ? item.originalName : "",
      addedAt: typeof item.addedAt === "string" ? item.addedAt : "",
    });
  }
  return out;
}

/**
 * The first .cslp layout: put the outcomes of results.json back into the
 * models of project.json. Outcome fields in project.json itself are
 * ignored (results come only from results.json), and only the known
 * outcome fields are taken over; the models are then validated as a JSON
 * project's.
 */
function joinResults(project: Record<string, unknown>, results: unknown): Record<string, unknown> {
  if (!Array.isArray(project.models)) return project;
  const byId = isObject(results) && isObject(results.models) ? results.models : null;
  const models = project.models.map((m: unknown) => {
    if (!isObject(m)) return m;
    const model: Record<string, unknown> = { ...m };
    for (const f of RUN_FIELDS) delete model[f];
    const id = model.id;
    const run = byId && typeof id === "string" && Object.hasOwn(byId, id) ? byId[id] : null;
    if (isObject(run)) {
      for (const f of SAVED_RUN_FIELDS) {
        if (Object.hasOwn(run, f)) model[f] = run[f];
      }
    }
    return model;
  });
  return { ...project, models };
}
