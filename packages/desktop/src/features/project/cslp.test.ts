/**
 * The .cslp project file: a ZIP archive of manifest.json, project.json and
 * (when a model has an outcome) results.json. Earlier JSON projects still
 * open; what is read goes through the ZIP limits and the same validation
 * as a JSON project.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../store/app-store";
import { parseProjectFile, serializeProject, type ProjectFile } from "../../store/persistence";
import { readZip, writeZip } from "../../utils/zip";
import {
  buildProjectArchive,
  CSLP_FORMAT_VERSION,
  readProjectBytes,
  splitResults,
  writeProjectArchive,
} from "./cslp";

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

async function entries(bytes: Uint8Array): Promise<Record<string, unknown>> {
  const map = await readZip(bytes);
  return Object.fromEntries([...map].map(([name, data]) => [name, JSON.parse(dec.decode(data))]));
}

/** An archive of the given JSON entries (stored), to craft files. */
const archive = (files: Record<string, unknown>) =>
  writeZip(Object.entries(files).map(([name, value]) => ({ name, data: typeof value === "string" ? value : JSON.stringify(value) })));

const manifest = (over: Record<string, unknown> = {}) => ({
  format: "cslope-project",
  formatVersion: 1,
  appVersion: "0.1.0",
  created: "2026-11-04T00:00:00.000Z",
  ...over,
});

beforeEach(() => {
  store().newProject();
});

describe(".cslp round trip", () => {
  it("opens a saved project as it was (no results: no results.json)", async () => {
    const file = project();
    const bytes = await buildProjectArchive(store());
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 3, 4]);
    expect(Object.keys(await entries(bytes)).sort()).toEqual(["manifest.json", "project.json"]);
    const opened = await readProjectBytes(bytes);
    expect(opened).toEqual(viaJson(file));
    expect(opened.models.map((m) => m.name)).toEqual(file.models.map((m) => m.name));
    expect(opened.models.every((m) => m.runState === "idle" && m.result === null)).toBe(true);
  });

  it("keeps the results in results.json and restores them on opening", async () => {
    const file = projectWithResults();
    const bytes = await writeProjectArchive(file);
    const content = await entries(bytes);
    expect(Object.keys(content).sort()).toEqual(["manifest.json", "project.json", "results.json"]);
    // project.json has no outcome fields
    for (const m of (content["project.json"] as ProjectFile).models) {
      expect(Object.keys(m)).not.toEqual(expect.arrayContaining(["result"]));
      expect(m).not.toHaveProperty("runState");
      expect(m).not.toHaveProperty("errorMessage");
      expect(m).not.toHaveProperty("progress");
    }
    const [a, b] = file.models;
    expect(content["results.json"]).toEqual({
      models: {
        [a.id]: { runState: "done", result, errorMessage: null },
        [b.id]: { runState: "error", result: null, errorMessage: "Too few slices" },
      },
    });
    const opened = await readProjectBytes(bytes);
    expect(opened).toEqual(viaJson(file));
    expect(opened.models[0].runState).toBe("done");
    expect(opened.models[0].result?.fem?.triangles).toEqual([0, 1, 2]);
    expect(opened.models[1]).toMatchObject({ runState: "error", errorMessage: "Too few slices" });
  });

  it("writes a manifest naming the format, its version, the app version and the time", async () => {
    const bytes = await writeProjectArchive(project(), new Date("2026-11-04T12:00:00Z"));
    const m = (await entries(bytes))["manifest.json"] as Record<string, unknown>;
    expect(m).toMatchObject({ format: "cslope-project", formatVersion: CSLP_FORMAT_VERSION, created: "2026-11-04T12:00:00.000Z" });
    expect(typeof m.appVersion).toBe("string");
  });

  it("deflates the entries", async () => {
    const file = projectWithResults();
    const bytes = await writeProjectArchive(file);
    // compression method of the first local header
    expect(bytes[8] | (bytes[9] << 8)).toBe(8);
    // (the JSON project file of earlier versions was indented)
    expect(bytes.length).toBeLessThan(JSON.stringify(file, null, 2).length / 3);
  });

  it("splitResults leaves models without an outcome out of results.json", () => {
    const file = project();
    expect(splitResults(file).results).toBeNull();
    const running = { ...file, models: [{ ...file.models[0], runState: "running" as const }, file.models[1]] };
    expect(splitResults(running).results).toBeNull();
  });
});

describe("project files of earlier versions", () => {
  it("opens a JSON project (.json, .cslope) by its content", async () => {
    const file = projectWithResults();
    const json = JSON.stringify(file, null, 2);
    expect(await readProjectBytes(enc.encode(json))).toEqual(viaJson(file));
    // with a byte order mark and leading white space
    expect(await readProjectBytes(enc.encode(`\uFEFF \r\n${json}`))).toEqual(viaJson(file));
  });

  it("refuses a file that is neither", async () => {
    await expect(readProjectBytes(enc.encode("<html></html>"))).rejects.toThrow(/not a cSlope project/);
    await expect(readProjectBytes(new Uint8Array())).rejects.toThrow(/not a cSlope project/);
    await expect(readProjectBytes(enc.encode("{ broken"))).rejects.toThrow("File is not valid JSON.");
  });
});

describe(".cslp archives that are refused", () => {
  const good = () => {
    const file = project();
    return { "manifest.json": manifest(), "project.json": file };
  };

  it("opens a hand-made archive (stored entries)", async () => {
    const files = good();
    expect((await readProjectBytes(archive(files))).models).toHaveLength(2);
  });

  it("refuses a newer format version with a clear message", async () => {
    const files = { ...good(), "manifest.json": manifest({ formatVersion: 2, appVersion: "0.9.0" }) };
    await expect(readProjectBytes(archive(files))).rejects.toThrow(
      "This project was saved by a newer version of cSlope (cSlope 0.9.0), in project format 2; this version reads format 1. Update cSlope to open it.",
    );
  });

  it("refuses an archive without manifest.json or project.json, or with another format", async () => {
    const { "project.json": p, "manifest.json": m } = good();
    await expect(readProjectBytes(archive({ "project.json": p }))).rejects.toThrow(/no manifest\.json/);
    await expect(readProjectBytes(archive({ "manifest.json": m }))).rejects.toThrow(/no project\.json/);
    await expect(readProjectBytes(archive({ "manifest.json": manifest({ format: "other" }), "project.json": p }))).rejects.toThrow(
      /manifest names another format/,
    );
    for (const formatVersion of [undefined, "1", 0, 1.5]) {
      await expect(readProjectBytes(archive({ "manifest.json": manifest({ formatVersion }), "project.json": p }))).rejects.toThrow(
        /no valid formatVersion/,
      );
    }
    await expect(readProjectBytes(archive({ "manifest.json": "{", "project.json": p }))).rejects.toThrow(/manifest\.json is not valid JSON/);
    await expect(readProjectBytes(archive({ "manifest.json": m, "project.json": "{" }))).rejects.toThrow(/project\.json is not valid JSON/);
    await expect(readProjectBytes(archive({ "manifest.json": m, "project.json": { models: [] } }))).rejects.toThrow(/at least one model/);
    // An archive that is not cSlope's (no central directory: cut off)
    const bytes = archive(good());
    await expect(readProjectBytes(bytes.subarray(0, 40))).rejects.toThrow(/not a readable cSlope project/);
  });

  it("refuses files above the 50 MB limit", async () => {
    const big = new Uint8Array(50 * MB + 1);
    big.set([0x50, 0x4b, 3, 4]);
    await expect(readProjectBytes(big)).rejects.toThrow("The file is too large to be a cSlope project.");
  });

  it("keeps the ZIP limits: entries claiming too much, or unpacking past their declared size", async () => {
    const zeros = new Uint8Array(4 * MB);
    const comp = await deflated(zeros);
    await expect(readProjectBytes(rawZip([{ name: "project.json", data: comp, method: 8, uncompressed: 0xffffffff }]))).rejects.toThrow(
      /project\.json is too large to import \(4096 MB unpacked; at most 100 MB\)/,
    );
    await expect(readProjectBytes(rawZip([{ name: "results.json", data: comp, method: 8, uncompressed: 100 }]))).rejects.toThrow(
      /results\.json is larger than its header says/,
    );
    await expect(
      readProjectBytes(rawZip([1, 2, 3].map(() => ({ name: "results.json", data: comp, method: 8, uncompressed: 70 * MB })))),
    ).rejects.toThrow(/entries unpack to more than 200 MB/);
  });
});

describe(".cslp content is validated as a JSON project's", () => {
  it("drops unknown fields in project.json and results.json", async () => {
    const file = projectWithResults();
    const { project: p, results } = splitResults(file);
    const raw = JSON.parse(JSON.stringify(p));
    raw.evil = "root";
    raw.models[0].evil = "model";
    raw.models[0].materials[0].evil = "material";
    raw.models[0].options.evil = "options";
    const r = JSON.parse(JSON.stringify(results));
    const id = file.models[0].id;
    r.models[id].evil = "run";
    r.models[id].mode = "result"; // a model field, not an outcome field: not taken from results.json
    const opened = await readProjectBytes(archive({ "manifest.json": manifest(), "project.json": raw, "results.json": r }));
    const text = JSON.stringify(opened);
    expect(text).not.toContain("evil");
    expect(opened).not.toHaveProperty("evil");
    expect(opened.models[0]).not.toHaveProperty("evil");
    expect(opened.models[0].mode).toBe(file.models[0].mode);
    expect(opened.models[0].runState).toBe("done");
  });

  it("takes outcomes from results.json only (none without it), and only valid ones", async () => {
    const file = projectWithResults();
    // An outcome written into project.json itself is not a result.
    const opened = await readProjectBytes(archive({ "manifest.json": manifest(), "project.json": file }));
    expect(opened.models.every((m) => m.runState === "idle" && m.result === null && m.errorMessage === null)).toBe(true);
    // A damaged result is dropped as in a JSON project.
    const id = file.models[0].id;
    const { project: p } = splitResults(file);
    const bad = { models: { [id]: { runState: "done", result: { minFOS: "x" } } } };
    const reopened = await readProjectBytes(archive({ "manifest.json": manifest(), "project.json": p, "results.json": bad }));
    expect(reopened.models[0]).toMatchObject({ runState: "idle", result: null });
    expect(reopened.models[1]).toMatchObject({ runState: "idle", result: null });
    // results.json that is not an object, or not valid JSON
    const odd = await readProjectBytes(archive({ "manifest.json": manifest(), "project.json": p, "results.json": [1, 2] }));
    expect(odd.models[0].runState).toBe("idle");
    await expect(readProjectBytes(archive({ "manifest.json": manifest(), "project.json": p, "results.json": "{" }))).rejects.toThrow(
      /results\.json is not valid JSON/,
    );
  });

  it("migrates an older project.json version as a JSON project", async () => {
    const file = project();
    const old = { ...file, version: 2 };
    const opened = await readProjectBytes(archive({ "manifest.json": manifest(), "project.json": old }));
    expect(opened).toEqual(parseProjectFile(JSON.stringify(old)));
  });
});

// ── crafted archives (as in import-robustness.test.ts) ──────────────

function rawZip(entries: { name: string; data: Uint8Array; method: number; uncompressed: number }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, e.method, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.uncompressed, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, e.method, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.uncompressed, true);
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
