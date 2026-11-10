/**
 * The .cslp project file: a ZIP archive of manifest.json, project.json,
 * one folder per model (model.json, result.json, backgrounds.json),
 * attachments and a thumbnail. Earlier JSON projects and the first .cslp
 * layout still open; what is read goes through the ZIP limits and the
 * same validation as a JSON project.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../store/app-store";
import { parseProjectFile, PROJECT_FILE_VERSION, serializeProject, type ProjectFile } from "../../store/persistence";
import { dosDateTime, openZip, readZip, writeZip, writeZipDeflated } from "../../utils/zip";
import {
  buildProjectArchive,
  CSLP_FORMAT_VERSION,
  openedProjectAssets,
  adoptProjectAssets,
  openProject,
  readProject,
  readProjectBytes,
  withSafeModelIds,
  writeProjectArchive,
  type CslpResult,
  type ProjectAsset,
} from "./cslp";
import { analysisInputHash, sha256Hex } from "./input-hash";
import type { BackgroundImage } from "../../store/types";
import { MAX_PROJECT_FILE_BYTES } from "./file-limits";

const store = () => useAppStore.getState();
const enc = new TextEncoder();
const dec = new TextDecoder();
const MB = 1024 * 1024;

const fem = {
  factorOfSafety: 1.3,
  failedF: 1.31,
  flowRule: "davis-b",
  levels: [{ elements: 1, fos: 1.3 }],
  warnings: [],
  elapsedMs: 10,
  x: [0, 1, 0],
  y: [0, 0, 1],
  triangles: [0, 1, 2],
  plasticShear: [0.01],
  displacement: [0, 0, 0, 0, 0, 0],
};
const result = {
  minFOS: 1.2,
  maxFOS: 2,
  criticalSurface: null,
  allSurfaces: [],
  criticalSlices: [],
  method: "Bishop",
  elapsedMs: 1,
  fem,
};

/** A 1 × 1 PNG (70 bytes). */
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

const MODIFIED = new Date("2026-11-04T12:00:00Z");

/** The current project with a second model, as it is saved. */
function project(): ProjectFile {
  store().newProject();
  store().addModel("Second");
  store().saveCurrentModel();
  return serializeProject(store());
}

/** A project whose first model has a result (with a finite element mesh) and second an error. */
function projectWithResults(): ProjectFile {
  const file = project();
  const [a, b] = file.models;
  return {
    ...file,
    models: [
      { ...a, runState: "done", progress: 1, result: result as never, errorMessage: null },
      { ...b, runState: "error", progress: 0, result: null, errorMessage: "Too few slices" },
    ],
  };
}

/** What a JSON project file of the same content opens as (the reference). */
const viaJson = (file: ProjectFile) => parseProjectFile(JSON.stringify(file));

/** An opened project without the file's own `created`, to compare with the reference. */
function content(file: ProjectFile): ProjectFile {
  const rest = { ...file };
  delete rest.created;
  return rest;
}

/** The archive's entries in order, JSON parsed (other entries as bytes). */
async function entries(bytes: Uint8Array): Promise<[string, unknown][]> {
  const archive = openZip(bytes);
  const out: [string, unknown][] = [];
  for (const e of archive.entries()) {
    const data = await archive.read(e.name);
    out.push([e.name, e.name.endsWith(".json") ? JSON.parse(dec.decode(data)) : data]);
  }
  return out;
}
const names = async (bytes: Uint8Array) => (await entries(bytes)).map(([n]) => n);
const entry = async (bytes: Uint8Array, name: string) => (await entries(bytes)).find(([n]) => n === name)?.[1];

/** An archive of the given entries (stored), to craft files. */
const archive = (files: Record<string, unknown>) =>
  writeZip(
    Object.entries(files)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => ({ name, data: typeof value === "string" || value instanceof Uint8Array ? value : JSON.stringify(value) })),
  );

const manifest = (over: Record<string, unknown> = {}) => ({
  format: "cslope-project",
  formatVersion: 1,
  minReaderVersion: 1,
  appVersion: "0.1.0",
  created: "2026-11-04T00:00:00.000Z",
  modified: "2026-11-04T00:00:00.000Z",
  generator: "cSlope 0.1.0",
  ...over,
});

/** A model without its run fields and backgrounds (as model.json holds it). */
function withoutRun(m: ProjectFile["models"][number]): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...m };
  for (const f of ["runState", "progress", "result", "errorMessage", "backgrounds"]) delete rest[f];
  return rest;
}

/** The entries of an archive in this version's layout, from a project's models (results as result.json). */
function layout(file: ProjectFile, over: Record<string, unknown> = {}): Record<string, unknown> {
  const files: Record<string, unknown> = {
    "manifest.json": manifest(),
    "project.json": { version: file.version, activeModelId: file.activeModelId, models: file.models.map((m) => m.id), units: "SI", settings: {} },
  };
  for (const m of file.models) {
    const { runState, result, errorMessage, backgrounds } = m;
    files[`models/${m.id}/model.json`] = withoutRun(m);
    if (backgrounds) files[`models/${m.id}/backgrounds.json`] = backgrounds;
    if (runState === "done" || runState === "error") {
      files[`models/${m.id}/result.json`] = { runState, result, errorMessage, inputHash: "", engine: { version: "", sourceHash: "" } };
    }
  }
  return { ...files, ...over };
}

beforeEach(() => {
  store().newProject();
});

describe(".cslp round trip", () => {
  it("writes one folder per model, in order, and opens as the same project (no results: no result.json)", async () => {
    const file = project();
    const [a, b] = file.models;
    const bytes = await buildProjectArchive(store());
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 3, 4]);
    expect(await names(bytes)).toEqual(["manifest.json", "project.json", `models/${a.id}/model.json`, `models/${b.id}/model.json`]);
    expect(await entry(bytes, "project.json")).toEqual({
      version: PROJECT_FILE_VERSION,
      activeModelId: file.activeModelId,
      models: [a.id, b.id],
      units: "SI",
      settings: {},
    });
    const opened = await readProjectBytes(bytes);
    expect(content(opened)).toEqual(viaJson(file));
    expect(opened.models.map((m) => m.name)).toEqual(file.models.map((m) => m.name));
    expect(opened.models.every((m) => m.runState === "idle" && m.result === null)).toBe(true);
  });

  it("keeps each result in its model's result.json, with the input hash and the engine, and restores it", async () => {
    const file = projectWithResults();
    const [a, b] = file.models;
    const bytes = await writeProjectArchive(file);
    expect(await names(bytes)).toEqual([
      "manifest.json",
      "project.json",
      `models/${a.id}/model.json`,
      `models/${a.id}/result.json`,
      `models/${b.id}/model.json`,
      `models/${b.id}/result.json`,
    ]);
    // model.json has no outcome fields
    for (const id of [a.id, b.id]) {
      const m = (await entry(bytes, `models/${id}/model.json`)) as Record<string, unknown>;
      expect(m.id).toBe(id);
      for (const f of ["runState", "progress", "result", "errorMessage"]) expect(m).not.toHaveProperty(f);
    }
    const ra = (await entry(bytes, `models/${a.id}/result.json`)) as CslpResult;
    expect(ra).toEqual({
      runState: "done",
      result,
      errorMessage: null,
      inputHash: await analysisInputHash(a),
      engine: { version: expect.any(String), sourceHash: expect.any(String) },
    });
    expect(ra.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await entry(bytes, `models/${b.id}/result.json`)).toMatchObject({ runState: "error", result: null, errorMessage: "Too few slices" });
    const opened = await readProjectBytes(bytes);
    expect(content(opened)).toEqual(viaJson(file));
    expect(opened.models[0].runState).toBe("done");
    expect(opened.models[0].result?.fem?.triangles).toEqual([0, 1, 2]);
    expect(opened.models[1]).toMatchObject({ runState: "error", errorMessage: "Too few slices" });
    // the input hash and engine of each result are read with the file
    const project = await openProject(bytes);
    expect(project.layout).toBe("cslp");
    expect(project.results.get(a.id)).toEqual({ inputHash: ra.inputHash, engine: ra.engine });
    expect(project.results.has(b.id)).toBe(true);
  });

  it("can leave the results out", async () => {
    const file = projectWithResults();
    const bytes = await writeProjectArchive(file, { results: false });
    expect((await names(bytes)).some((n) => n.endsWith("result.json"))).toBe(false);
    const opened = await readProjectBytes(bytes);
    expect(opened.models.every((m) => m.runState === "idle" && m.result === null)).toBe(true);
  });

  it("writes a manifest naming the format, its versions, the app, and the times; created is kept over saves", async () => {
    const file = project();
    const bytes = await writeProjectArchive(file, { modified: MODIFIED });
    const m = (await entry(bytes, "manifest.json")) as Record<string, unknown>;
    expect(m).toEqual({
      format: "cslope-project",
      formatVersion: CSLP_FORMAT_VERSION,
      minReaderVersion: 1,
      appVersion: expect.any(String),
      created: "2026-11-04T12:00:00.000Z",
      modified: "2026-11-04T12:00:00.000Z",
      generator: `cSlope ${m.appVersion as string}`,
    });
    // The project's own created (from the file it was opened from) stays.
    const opened = await readProjectBytes(bytes);
    expect(opened.created).toBe("2026-11-04T12:00:00.000Z");
    const again = await writeProjectArchive(opened, { modified: new Date("2026-12-01T08:00:00Z") });
    expect(await entry(again, "manifest.json")).toMatchObject({ created: "2026-11-04T12:00:00.000Z", modified: "2026-12-01T08:00:00.000Z" });
    // ... and reaches the store when the project is loaded
    store().loadProject(opened);
    expect(store().projectCreated).toBe("2026-11-04T12:00:00.000Z");
    expect(serializeProject(store()).created).toBe("2026-11-04T12:00:00.000Z");
    store().newProject();
    expect(store().projectCreated).toBeNull();
    expect(serializeProject(store()).created).toBeUndefined();
  });

  it("is deterministic: the same project saved twice is byte-identical, canonical JSON, one time stamp", async () => {
    const file = projectWithResults();
    const a = await writeProjectArchive(file, { modified: MODIFIED });
    const b = await writeProjectArchive(file, { modified: MODIFIED });
    expect(a).toEqual(b);
    // JSON: sorted keys, 2-space indentation, LF, a final newline
    const text = dec.decode((await readZip(a)).get("project.json"));
    expect(text).toBe(`{\n  "activeModelId": ${JSON.stringify(file.activeModelId)},\n  "models": [\n    ${JSON.stringify(file.models[0].id)},\n    ${JSON.stringify(file.models[1].id)}\n  ],\n  "settings": {},\n  "units": "SI",\n  "version": ${PROJECT_FILE_VERSION}\n}\n`);
    const model = dec.decode((await readZip(a)).get(`models/${file.models[0].id}/model.json`));
    expect(model).not.toContain("\r");
    const keys = [...model.matchAll(/^ {2}"([^"]+)":/gm)].map((m) => m[1]);
    expect(keys).toEqual([...keys].sort());
    // every entry's header carries the save time (DOS time, local)
    const stamp = dosDateTime(MODIFIED);
    for (const e of openZip(a).entries()) {
      expect(a[e.local + 10] | (a[e.local + 11] << 8)).toBe(stamp.time);
      expect(a[e.local + 12] | (a[e.local + 13] << 8)).toBe(stamp.date);
    }
    // another save time: another file
    const c = await writeProjectArchive(file, { modified: new Date("2026-11-04T12:00:02Z") });
    expect(c).not.toEqual(a);
  });

  it("deflates the JSON entries", async () => {
    const file = projectWithResults();
    const bytes = await writeProjectArchive(file);
    const list = openZip(bytes).entries();
    for (const e of list) {
      expect(e.method).toBe(8);
      expect(e.compressedSize).toBeLessThan(e.size);
    }
    expect(bytes.length).toBeLessThan(list.reduce((n, e) => n + e.size, 0));
  });

  it("gives a model whose id is not a folder name a new UUID (the active model follows)", async () => {
    const file = project();
    const [a, b] = file.models;
    const odd = { ...file, activeModelId: "model 2", models: [{ ...a, id: "../x" }, { ...b, id: "model 2" }] };
    const safe = withSafeModelIds(odd);
    expect(safe.models.map((m) => m.id)).toEqual([expect.stringMatching(/^[0-9a-f-]{36}$/), expect.stringMatching(/^[0-9a-f-]{36}$/)]);
    expect(safe.activeModelId).toBe(safe.models[1].id);
    expect(withSafeModelIds(file)).toBe(file);
    const opened = await readProjectBytes(await writeProjectArchive(odd));
    expect(opened.models.map((m) => m.name)).toEqual([a.name, b.name]);
    expect(opened.activeModelId).toBe(opened.models[1].id);
    expect(opened.models[1].id).toMatch(/^[0-9a-f-]{36}$/);
    // a JSON project with such ids gets them when it is opened, so every save uses the same ids
    const fromJson = await readProjectBytes(enc.encode(JSON.stringify(odd)));
    expect(fromJson.models.map((m) => m.id)).toEqual([expect.stringMatching(/^[0-9a-f-]{36}$/), expect.stringMatching(/^[0-9a-f-]{36}$/)]);
    expect(fromJson.activeModelId).toBe(fromJson.models[1].id);
  });

  it("writes the thumbnail last, stored, when there is one", async () => {
    const file = project();
    const bytes = await writeProjectArchive(file, { thumbnail: PNG });
    const list = await names(bytes);
    expect(list[list.length - 1]).toBe("thumbnail.png");
    expect(openZip(bytes).entries().find((e) => e.name === "thumbnail.png")?.method).toBe(0);
    expect(await (await openProject(bytes)).readThumbnail()).toEqual(PNG);
    const none = await writeProjectArchive(file, { thumbnail: () => null });
    expect(await names(none)).not.toContain("thumbnail.png");
    expect(await (await openProject(none)).readThumbnail()).toBeNull();
  });
});

describe("attachments and backgrounds", () => {
  const assets = (): ProjectAsset[] => [
    { id: "img-1", mime: "image/png", originalName: "plan.png", addedAt: "2026-11-04T00:00:00.000Z", data: () => PNG },
    { id: "unused", mime: "text/plain", originalName: "notes.txt", addedAt: "2026-11-04T00:00:00.000Z", data: () => enc.encode("x") },
  ];
  const background: BackgroundImage = {
    id: "drawing-1",
    assetId: "img-1",
    calibration: { mode: "points", points: [{ source: [0, 0], model: [1, 2] }, { source: [10, 0], model: [1.5, 2] }] },
    transform: { a: 0.05, b: 0, c: 0, d: -0.05, e: 1, f: 2 },
    opacity: 0.5,
    visible: true,
    order: 0,
  };

  function withBackground(): ProjectFile {
    const file = project();
    return { ...file, models: [{ ...file.models[0], backgrounds: [background] }, file.models[1]] };
  }

  it("writes the attachments the models refer to (stored when compressed already), with an index, and reads them on demand", async () => {
    const file = withBackground();
    const id = file.models[0].id;
    const bytes = await writeProjectArchive(file, { assets: assets(), modified: MODIFIED });
    expect(await names(bytes)).toEqual(["manifest.json", "project.json", `models/${id}/model.json`, `models/${id}/backgrounds.json`, `models/${file.models[1].id}/model.json`, "assets/index.json", "assets/img-1.png"]);
    expect(await entry(bytes, `models/${id}/backgrounds.json`)).toEqual([background]);
    expect((await entry(bytes, `models/${id}/model.json`) as object)).not.toHaveProperty("backgrounds");
    expect(await entry(bytes, "assets/index.json")).toEqual([
      { id: "img-1", path: "assets/img-1.png", mime: "image/png", bytes: PNG.length, sha256: expect.stringMatching(/^[0-9a-f]{64}$/), originalName: "plan.png", addedAt: "2026-11-04T00:00:00.000Z" },
    ]);
    expect(openZip(bytes).entries().find((e) => e.name === "assets/img-1.png")?.method).toBe(0);

    const opened = await openProject(bytes);
    expect(opened.assets.map((a) => a.id)).toEqual(["img-1"]);
    expect(opened.file.models[0].backgrounds).toEqual([background]);
    expect(opened.file.models[1].backgrounds).toBeUndefined();
    expect(await opened.readAsset("img-1")).toEqual(PNG);
    await expect(opened.readAsset("unused")).rejects.toThrow("no attachment unused");

    // Read and loaded (adopted), the attachment is there for the next save.
    const reread = await readProject(bytes);
    expect(reread.assets.map((a) => a.id)).toEqual(["img-1"]);
    adoptProjectAssets(reread.assets);
    expect(openedProjectAssets().map((a) => a.id)).toEqual(["img-1"]);
    const again = await writeProjectArchive(reread.file, { modified: MODIFIED });
    expect(await entry(again, "assets/img-1.png")).toEqual(PNG);
    expect(await entry(again, "assets/index.json")).toEqual(await entry(bytes, "assets/index.json"));
  });

  it("reading another project without loading it keeps the current project's attachments", async () => {
    const a = withBackground();
    const opened = await readProject(await writeProjectArchive(a, { assets: assets() }));
    adoptProjectAssets(opened.assets);
    // Project B is read (dropped on the window), then the user cancels or saves A first.
    const b = await readProject(await writeProjectArchive(project()));
    expect(b.assets).toEqual([]);
    await readProjectBytes(await writeProjectArchive(project()));
    const saved = await writeProjectArchive(opened.file);
    expect(await entry(saved, "assets/img-1.png")).toEqual(PNG);
    expect(await entry(saved, `models/${a.models[0].id}/backgrounds.json`)).toEqual([background]);
    adoptProjectAssets([]);
  });

  it("checks an attachment against its hash when it is read, and only then", async () => {
    const file = withBackground();
    const bytes = await writeProjectArchive(file, { assets: assets() });
    // flip a byte of the stored PNG (the CRC after its IEND chunk)
    const at = find(bytes, enc.encode("IEND")) + 4;
    expect(at).toBeGreaterThan(4);
    const damaged = bytes.slice();
    damaged[at] ^= 0xff;
    const opened = await openProject(damaged);
    expect(opened.assets).toHaveLength(1);
    await expect(opened.readAsset("img-1")).rejects.toThrow(/plan\.png does not match its hash/);
  });

  it("opens a file whose attachment would break the limits, failing only when it is read", async () => {
    const file = withBackground();
    const index = [{ id: "img-1", path: "assets/img-1.png", mime: "image/png", bytes: 0xffffffff, sha256: "0".repeat(64), originalName: "plan.png", addedAt: "" }];
    const bytes = rawZip([
      ...Object.entries(layout(file, { "assets/index.json": index })).map(([name, value]) => ({ name, data: enc.encode(JSON.stringify(value)), method: 0, uncompressed: -1 })),
      { name: "assets/img-1.png", data: await deflated(new Uint8Array(4 * MB)), method: 8, uncompressed: 0xffffffff },
    ]);
    const opened = await openProject(bytes);
    expect(opened.file.models[0].backgrounds?.[0].assetId).toBe("img-1");
    expect(opened.assets[0].bytes).toBe(0xffffffff);
    await expect(opened.readAsset("img-1")).rejects.toThrow(/img-1\.png is too large to import/);
  });

  it("drops a background without its attachment, index entries that do not match the archive, and a bad backgrounds.json", async () => {
    const file = withBackground();
    const id = file.models[0].id;
    const good = { id: "img-1", path: "assets/img-1.png", mime: "image/png", bytes: PNG.length, sha256: "a".repeat(64), originalName: "plan.png", addedAt: "" };
    const open = (over: Record<string, unknown>) => openProject(archive(layout(file, { "assets/img-1.png": PNG, ...over })));
    // no index at all: no attachments, no backgrounds
    expect((await open({})).file.models[0].backgrounds).toBeUndefined();
    // index entries: wrong size, wrong path, no hash, a repeated id
    for (const bad of [{ ...good, bytes: 1 }, { ...good, path: "assets/other.png" }, { ...good, sha256: "x" }, { ...good, id: "../x" }]) {
      const opened = await open({ "assets/index.json": [bad] });
      expect(opened.assets).toEqual([]);
      expect(opened.file.models[0].backgrounds).toBeUndefined();
    }
    const twice = await open({ "assets/index.json": [good, good] });
    expect(twice.assets).toHaveLength(1);
    // backgrounds.json: entries without a usable transform are dropped, one of
    // the first form (origin, scale) is converted (its image is 1 × 1 px:
    // the bottom-left corner at the origin), the rest sorted by order
    const opened = await open({
      "assets/index.json": [good],
      [`models/${id}/backgrounds.json`]: [
        { ...background, order: 2, opacity: 7 },
        { assetId: "img-1" },
        { ...background, id: "singular", transform: { ...background.transform, a: 0, d: 0 } },
        { ...background, id: "elsewhere", assetId: "missing", order: 0 },
        { assetId: "img-1", order: 1, visible: false, transform: { originX: 3, originY: 4, scale: 2 } },
        { ...background, id: "old-scale", transform: { originX: 0, originY: 0, scale: 0 } },
      ],
    });
    expect(opened.file.models[0].backgrounds).toEqual([
      { id: "drawing-5", assetId: "img-1", calibration: { mode: "drawing", points: [] }, transform: { a: 2, b: 0, c: 0, d: -2, e: 3, f: 6 }, opacity: 1, visible: false, order: 1 },
      { ...background, order: 2, opacity: 1 },
    ]);
    expect((await open({ "assets/index.json": [good], [`models/${id}/backgrounds.json`]: { not: "a list" } })).file.models[0].backgrounds).toBeUndefined();
  });

  it("writes a drawing placed in two models once, with each model's page, crop and calibration", async () => {
    const PDF = enc.encode("%PDF-1.4\n% a stand-in: the writer does not read it\n");
    const pdfAsset: ProjectAsset = { id: "sheet", mime: "application/pdf", originalName: "sections.pdf", addedAt: "2026-11-04T00:00:00.000Z", data: () => PDF };
    const first: BackgroundImage = {
      id: "drawing-a",
      assetId: "sheet",
      name: "Section A",
      page: 1,
      crop: { x0: 40, y0: 60, x1: 500, y1: 300 },
      calibration: {
        mode: "axes",
        points: [],
        axes: {
          x: [{ source: [50, 280], value: 0 }, { source: [450, 280], value: 40 }],
          y: [{ source: [45, 280], value: 0 }, { source: [45, 80], value: 10 }],
        },
      },
      transform: { a: 0.1, b: 0, c: 0, d: -0.05, e: -5, f: 14 },
      opacity: 0.4,
      visible: true,
      order: 0,
      showInResults: true,
    };
    const second: BackgroundImage = {
      ...first,
      id: "drawing-b",
      name: "Section B",
      page: 2,
      crop: { x0: 10, y0: 20, x1: 300, y1: 200 },
      calibration: { ...first.calibration, axes: { ...first.calibration.axes!, reuseFrom: "model-a/drawing-a" } },
      showInResults: undefined,
    };
    delete second.showInResults;
    const file = project();
    const two: ProjectFile = { ...file, models: [{ ...file.models[0], backgrounds: [first] }, { ...file.models[1], backgrounds: [second] }] };
    const bytes = await writeProjectArchive(two, { assets: [pdfAsset] });
    const list = await names(bytes);
    expect(list.filter((n) => n.startsWith("assets/"))).toEqual(["assets/index.json", "assets/sheet.pdf"]);
    expect(openZip(bytes).entries().find((e) => e.name === "assets/sheet.pdf")?.method).toBe(0);
    const opened = await openProject(bytes);
    expect(opened.file.models[0].backgrounds).toEqual([first]);
    expect(opened.file.models[1].backgrounds).toEqual([second]);
    expect([...(await opened.readAsset("sheet"))]).toEqual([...PDF]);
  });

  it("stores every attachment, and reads them within limits of their own: a project with large deflated drawings saves again and again", async () => {
    // A file of an earlier version: two TIFF drawings, deflated, together
    // more than the JSON entries may unpack to (limits scaled down: 64 kB
    // for the JSON entries, 1 MB each and 2 MB in all for the drawings).
    const limits = { entries: { entryBytes: MB, totalBytes: 64 * 1024 }, assets: { entryBytes: MB, totalBytes: 2 * MB } };
    const tiff = (fill: number) => new Uint8Array(600 * 1024).fill(fill);
    const tiffs = { a: tiff(1), b: tiff(2) };
    const file = project();
    const placed = (assetId: string) => ({ ...background, id: `drawing-${assetId}`, assetId });
    const withTwo = { ...file, models: [{ ...file.models[0], backgrounds: [placed("a"), placed("b")] }, file.models[1]] };
    const index = await Promise.all(
      Object.entries(tiffs).map(async ([id, data]) => ({ id, path: `assets/${id}.tif`, mime: "image/tiff", bytes: data.length, sha256: await sha256Hex(data), originalName: `${id}.tif`, addedAt: "" })),
    );
    const old = await writeZipDeflated([
      ...Object.entries(layout(withTwo, { "assets/index.json": index })).map(([name, value]) => ({ name, data: JSON.stringify(value) })),
      ...Object.entries(tiffs).map(([id, data]) => ({ name: `assets/${id}.tif`, data })),
    ]);
    expect(openZip(old).entries().find((e) => e.name === "assets/a.tif")?.method).toBe(8);

    let bytes = old;
    for (let save = 0; save < 3; save++) {
      const read = await readProject(bytes, limits);
      expect(read.assets.map((a) => a.id)).toEqual(["a", "b"]);
      // shown (read), then saved: each read again from what is held
      expect(await read.assets[0].data()).toEqual(tiffs.a);
      bytes = await writeProjectArchive(read.file, { assets: read.assets, modified: MODIFIED });
      expect(openZip(bytes).entries().filter((e) => e.name.startsWith("assets/") && e.name.endsWith(".tif")).map((e) => e.method)).toEqual([0, 0]);
      expect(await entry(bytes, "assets/b.tif")).toEqual(tiffs.b);
    }

    // A drawing that cannot be read is named in the error.
    const broken: ProjectAsset = { id: "a", mime: "image/tiff", originalName: "a.tif", addedAt: "", data: () => Promise.reject(new Error("gone")) };
    await expect(writeProjectArchive(withTwo, { assets: [broken] })).rejects.toThrow(/drawing a\.tif cannot be read \(gone\)/);
  });

  it("keeps the locks of the drawings a model has, and drops the others", async () => {
    const file = withBackground();
    const locked = { ...file, models: [{ ...file.models[0], locks: { backgrounds: ["drawing-1", "gone"] } }, file.models[1]] };
    const opened = await openProject(await writeProjectArchive(locked, { assets: assets() }));
    expect(opened.file.models[0].locks).toEqual({ backgrounds: ["drawing-1"] });
  });
});

describe("project files of earlier versions", () => {
  it("opens a JSON project (.json, .cslope) by its content", async () => {
    const file = projectWithResults();
    const json = JSON.stringify(file, null, 2);
    expect(await readProjectBytes(enc.encode(json))).toEqual(viaJson(file));
    // with a byte order mark and leading white space
    expect(await readProjectBytes(enc.encode(`\uFEFF \r\n${json}`))).toEqual(viaJson(file));
    expect((await openProject(enc.encode(json))).layout).toBe("json");
  });

  it("opens the first .cslp layout (project.json with the models, results.json beside it)", async () => {
    const file = projectWithResults();
    const [a, b] = file.models;
    const models = file.models.map(withoutRun);
    const old = {
      "manifest.json": { format: "cslope-project", formatVersion: 1, appVersion: "0.1.0-beta.2", created: "2026-11-04T00:00:00.000Z" },
      "project.json": { version: file.version, activeModelId: file.activeModelId, models },
      "results.json": { models: { [a.id]: { runState: "done", result, errorMessage: null }, [b.id]: { runState: "error", result: null, errorMessage: "Too few slices" } } },
    };
    const opened = await openProject(archive(old));
    expect(opened.layout).toBe("cslp-3file");
    expect(content(opened.file)).toEqual(viaJson(file));
    expect(opened.file.created).toBe("2026-11-04T00:00:00.000Z");
    expect(opened.manifest).toMatchObject({ formatVersion: 1, minReaderVersion: 1, generator: "cSlope 0.1.0-beta.2" });
    // an outcome written into project.json itself is not a result; results.json may be missing or odd
    const inProject = await readProjectBytes(archive({ ...old, "project.json": { ...old["project.json"], models: file.models }, "results.json": undefined }));
    expect(inProject.models.every((m) => m.runState === "idle" && m.result === null)).toBe(true);
    const odd = await readProjectBytes(archive({ ...old, "results.json": [1, 2] }));
    expect(odd.models[0].runState).toBe("idle");
    await expect(readProjectBytes(archive({ ...old, "results.json": "{" }))).rejects.toThrow(/results\.json is not valid JSON/);
    // saved again, it is written in this version's layout
    const saved = await writeProjectArchive(opened.file);
    expect(await names(saved)).toContain(`models/${a.id}/result.json`);
  });

  it("refuses a file that is neither", async () => {
    await expect(readProjectBytes(enc.encode("<html></html>"))).rejects.toThrow(/not a cSlope project/);
    await expect(readProjectBytes(new Uint8Array())).rejects.toThrow(/not a cSlope project/);
    await expect(readProjectBytes(enc.encode("{ broken"))).rejects.toThrow("File is not valid JSON.");
  });
});

describe(".cslp archives that are refused", () => {
  const good = () => layout(project());

  it("opens a hand-made archive (stored entries)", async () => {
    expect((await readProjectBytes(archive(good()))).models).toHaveLength(2);
  });

  it("refuses a file that needs a newer reader, with a clear message, and opens a newer format it may read", async () => {
    await expect(readProjectBytes(archive({ ...good(), "manifest.json": manifest({ formatVersion: 2, minReaderVersion: 2, appVersion: "0.9.0", generator: "cSlope 0.9.0" }) }))).rejects.toThrow(
      "This project was saved by a newer cSlope (cSlope 0.9.0); update to open it.",
    );
    // without a generator, the app version; without either, "a newer cSlope"
    await expect(readProjectBytes(archive({ ...good(), "manifest.json": manifest({ minReaderVersion: 2, generator: undefined }) }))).rejects.toThrow("(cSlope 0.1.0)");
    await expect(readProjectBytes(archive({ ...good(), "manifest.json": manifest({ minReaderVersion: 2, generator: undefined, appVersion: undefined }) }))).rejects.toThrow("(a newer cSlope)");
    // the first layout's manifest has no minReaderVersion: its format version counts
    await expect(readProjectBytes(archive({ ...good(), "manifest.json": manifest({ formatVersion: 2, minReaderVersion: undefined }) }))).rejects.toThrow(/newer cSlope/);
    // a newer format that older readers may read opens (unknown entries and fields ignored)
    const opened = await openProject(archive({ ...good(), "manifest.json": manifest({ formatVersion: 2, minReaderVersion: 1 }), "extra/new.json": { x: 1 } }));
    expect(opened.file.models).toHaveLength(2);
    expect(opened.manifest?.formatVersion).toBe(2);
  });

  it("refuses an archive without manifest.json or project.json, or with another format, or damaged", async () => {
    const files = good();
    const without = (name: string) => Object.fromEntries(Object.entries(files).filter(([n]) => n !== name));
    await expect(readProjectBytes(archive(without("manifest.json")))).rejects.toThrow(/no manifest\.json/);
    await expect(readProjectBytes(archive(without("project.json")))).rejects.toThrow(/no project\.json/);
    await expect(readProjectBytes(archive({ ...files, "manifest.json": manifest({ format: "other" }) }))).rejects.toThrow(/manifest names another format/);
    for (const formatVersion of [undefined, "1", 0, 1.5]) {
      await expect(readProjectBytes(archive({ ...files, "manifest.json": manifest({ formatVersion }) }))).rejects.toThrow(/no valid formatVersion/);
    }
    await expect(readProjectBytes(archive({ ...files, "manifest.json": "{" }))).rejects.toThrow(/manifest\.json is not valid JSON/);
    await expect(readProjectBytes(archive({ ...files, "project.json": "{" }))).rejects.toThrow(/project\.json is not valid JSON/);
    await expect(readProjectBytes(archive({ ...files, "project.json": [1] }))).rejects.toThrow(/project\.json is not an object/);
    // a model project.json names without its folder; a model.json that is not a model
    const ids = (files["project.json"] as { models: string[] }).models;
    await expect(readProjectBytes(archive({ ...files, "project.json": { ...(files["project.json"] as object), models: [...ids, "ghost"] } }))).rejects.toThrow(
      "project.json names the model ghost, but models/ghost/model.json is missing",
    );
    await expect(readProjectBytes(archive({ ...files, [`models/${ids[0]}/model.json`]: [1] }))).rejects.toThrow(/model\.json is not an object/);
    await expect(readProjectBytes(archive({ ...files, [`models/${ids[0]}/model.json`]: { name: "no coordinates" } }))).rejects.toThrow(/must include coordinates/);
    // the first layout without models
    await expect(readProjectBytes(archive({ "manifest.json": manifest(), "project.json": { x: 1 } }))).rejects.toThrow(/no models in project\.json and no models\/ folder/);
    await expect(readProjectBytes(archive({ "manifest.json": manifest(), "project.json": { models: [] } }))).rejects.toThrow(/at least one model/);
    // other units
    await expect(readProjectBytes(archive({ ...files, "project.json": { ...(files["project.json"] as object), units: "imperial" } }))).rejects.toThrow(
      "The project is in imperial units; this version of cSlope reads SI projects only.",
    );
    // An archive that is not cSlope's (no central directory: cut off)
    await expect(readProjectBytes(archive(files).subarray(0, 40))).rejects.toThrow(/not a readable cSlope project/);
  });

  it("refuses files above the project limit (500 MB, for projects with drawings)", async () => {
    expect(MAX_PROJECT_FILE_BYTES).toBe(500 * MB);
    // (a stand-in whose length says it is over the limit, not 500 MB of memory)
    const big = new Uint8Array(8);
    big.set([0x50, 0x4b, 3, 4]);
    Object.defineProperty(big, "length", { value: MAX_PROJECT_FILE_BYTES + 1 });
    await expect(readProjectBytes(big)).rejects.toThrow("The file is too large to be a cSlope project.");
  });

  it("keeps the ZIP limits: entries claiming too much, or unpacking past their declared size", async () => {
    const zeros = new Uint8Array(4 * MB);
    const comp = await deflated(zeros);
    const stored = (name: string, value: unknown) => ({ name, data: enc.encode(JSON.stringify(value)), method: 0, uncompressed: -1 });
    const m = stored("manifest.json", manifest());
    const p = (ids: string[]) => stored("project.json", { version: 3, activeModelId: ids[0], models: ids, units: "SI", settings: {} });
    await expect(readProjectBytes(rawZip([m, { name: "project.json", data: comp, method: 8, uncompressed: 0xffffffff }]))).rejects.toThrow(
      /project\.json is too large to import \(4096 MB unpacked; at most 100 MB\)/,
    );
    await expect(readProjectBytes(rawZip([m, p(["a"]), { name: "models/a/model.json", data: comp, method: 8, uncompressed: 100 }]))).rejects.toThrow(
      /model\.json is larger than its header says/,
    );
    // three results declared as 70 MB each: more than the 200 MB an archive
    // may unpack to in all (what they hold is small, so each reads alone)
    const model = stored("x", project().models[0]);
    const small = await deflated(enc.encode("{}"));
    await expect(
      readProjectBytes(
        rawZip([
          m,
          p(["a", "b", "c"]),
          ...["a", "b", "c"].flatMap((id) => [
            { ...model, name: `models/${id}/model.json` },
            { name: `models/${id}/result.json`, data: small, method: 8, uncompressed: 70 * MB },
          ]),
        ]),
      ),
    ).rejects.toThrow(/entries unpack to more than 200 MB/);
    // two of them read (the declared sizes count, not what came out)
    const two = await readProjectBytes(rawZip([m, p(["a", "b"]), ...["a", "b"].flatMap((id) => [{ ...model, name: `models/${id}/model.json` }, { name: `models/${id}/result.json`, data: small, method: 8, uncompressed: 70 * MB }])]));
    expect(two.models).toHaveLength(2);
  });
});

describe(".cslp content is validated as a JSON project's", () => {
  it("drops unknown fields and entries, and takes the outcome from result.json only", async () => {
    const file = projectWithResults();
    const id = file.models[0].id;
    const files = layout(file, { "notes.txt": "x", [`models/${id}/extra.json`]: { x: 1 } });
    (files["project.json"] as Record<string, unknown>).evil = "root";
    (files["project.json"] as Record<string, unknown>).settings = { evil: true };
    const raw = files[`models/${id}/model.json`] as Record<string, unknown>;
    raw.evil = "model";
    (raw.materials as Record<string, unknown>[])[0].evil = "material";
    (raw.options as Record<string, unknown>).evil = "options";
    raw.runState = "done"; // in model.json: ignored
    raw.result = { minFOS: 9 };
    const run = files[`models/${id}/result.json`] as Record<string, unknown>;
    run.evil = "run";
    run.mode = "result"; // a model field, not an outcome field: not taken from result.json
    const opened = await readProjectBytes(archive(files));
    const text = JSON.stringify(opened);
    expect(text).not.toContain("evil");
    expect(opened.models[0].mode).toBe(file.models[0].mode);
    expect(opened.models[0].runState).toBe("done");
    expect(opened.models[0].result?.minFOS).toBe(1.2);
    // without result.json: no outcome, whatever model.json says
    const none = Object.fromEntries(Object.entries(files).filter(([n]) => !n.endsWith("result.json")));
    expect((await readProjectBytes(archive(none))).models.every((m) => m.runState === "idle" && m.result === null && m.errorMessage === null)).toBe(true);
    // a damaged result (or one of another runState) is dropped as in a JSON project
    const bad = { ...files, [`models/${id}/result.json`]: { runState: "done", result: { minFOS: "x" } } };
    expect((await readProjectBytes(archive(bad))).models[0]).toMatchObject({ runState: "idle", result: null });
    const running = { ...files, [`models/${id}/result.json`]: { runState: "running", result } };
    expect((await readProjectBytes(archive(running))).models[0]).toMatchObject({ runState: "idle", result: null });
    await expect(readProjectBytes(archive({ ...files, [`models/${id}/result.json`]: "{" }))).rejects.toThrow(/result\.json is not valid JSON/);
  });

  it("names a model by its folder, and reads a folder project.json does not list (after the listed ones)", async () => {
    const file = project();
    const [a, b] = file.models;
    const files = layout(file);
    (files[`models/${a.id}/model.json`] as Record<string, unknown>).id = "other";
    (files["project.json"] as Record<string, unknown>).models = [b.id];
    const opened = await readProjectBytes(archive(files));
    expect(opened.models.map((m) => m.id)).toEqual([b.id, a.id]);
    expect(opened.models[1].name).toBe(a.name);
  });

  it("migrates an older project.json version as a JSON project", async () => {
    const file = project();
    const files = layout({ ...file, version: 2 });
    const opened = await readProjectBytes(archive(files));
    expect(content(opened)).toEqual(parseProjectFile(JSON.stringify({ ...file, version: 2 })));
  });
});

/** The index of `needle` in `bytes`, or -1. */
function find(bytes: Uint8Array, needle: Uint8Array): number {
  for (let i = 0; i + needle.length <= bytes.length; i++) {
    let k = 0;
    while (k < needle.length && bytes[i + k] === needle[k]) k++;
    if (k === needle.length) return i;
  }
  return -1;
}

// ── crafted archives (as in import-robustness.test.ts) ──────────────

/** An archive of entries with the declared sizes given (-1: the data's length). */
function rawZip(entries: { name: string; data: Uint8Array; method: number; uncompressed: number }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const uncompressed = e.uncompressed < 0 ? e.data.length : e.uncompressed;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, e.method, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, uncompressed, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, e.method, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, uncompressed, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    parts.push(local, e.data);
    central.push(cen);
    offset += local.length + e.data.length;
  }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, central.reduce((n, c) => n + c.length, 0), true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of all) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

async function deflated(data: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(data);
      c.close();
    },
  });
  return new Uint8Array(
    await new Response(source.pipeThrough(new CompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)).arrayBuffer(),
  );
}
