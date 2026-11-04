/**
 * Robustness of the project file importers (.gsz, .stix, .sli/.slim/.slmd)
 * against damaged and unusual files. Valid files come from the program's
 * own writers; mutations of them (seeded, so a failure repeats) and
 * targeted cases must each either import a model that the engine can
 * build, or fail with a plain Error whose message is meant for the user.
 * None may hang.
 */
import { describe, expect, it } from "vitest";
import { buildSlope, toCanonicalSlopeDefinition, DEFAULT_ANALYSIS_OPTIONS, type SlopeDefinition } from "@cslope/engine";
import { modelFromDefinition } from "../../store/definition-model";
import { readZip, writeZip } from "../../utils/zip";
import { gszImports } from "./importGsz";
import { stixImports } from "./importStix";
import { sliImports } from "./importSli";
import { modelToGsz } from "./gsz/gsz-write";
import { modelToStix } from "./stix/stix-write";
import { modelToSli, modelToSlim } from "./sli/sli-write";

type Json = unknown;
type Kind = "gsz" | "stix" | "sli";

/** More random cases per test (e.g. CSLOPE_FUZZ_SCALE=20 for a longer local run; the seeds stay the same). */
const SCALE = Math.max(1, Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.CSLOPE_FUZZ_SCALE) || 1);

/** Two soils under a slope, with water and a load: enough to exercise most of each reader. */
const DEF: SlopeDefinition = {
  coordinates: [[0, 0], [0, 6], [10, 6], [16, 10], [20, 10], [28, 6], [40, 6], [40, 0]],
  materials: [
    { name: "Sand", model: { kind: "mohr-coulomb", unitWeight: 18, unitWeightSat: 20, cohesion: 0, frictionAngle: 32 } },
    { name: "Clay", model: { kind: "mohr-coulomb", unitWeight: 16, cohesion: 5, frictionAngle: 25 } },
  ],
  materialBoundaries: [{ coordinates: [[0, 3], [40, 3]], materialName: "" }],
  regionAssignments: [
    { point: [20, 1], materialName: "Sand" },
    { point: [18, 8], materialName: "Clay" },
  ],
  waterTable: { mode: "custom", value: [[0, 5], [40, 5]], followBoundary: false },
  udls: [{ magnitude: 13, x1: 16, x2: 20 }],
  lineLoads: [{ magnitude: 10, x: 18 }],
  customSearchPlanes: [{ cx: 26, cy: 16, radius: 12 }],
};

const model = (def: SlopeDefinition = DEF, name = "Dike") =>
  modelFromDefinition(def, { id: "m", name, options: { ...DEFAULT_ANALYSIS_OPTIONS, method: "Bishop" } });

const enc = new TextEncoder();
const dec = new TextDecoder();
const latin1 = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0) & 0xff));
const unlatin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

const importers: Record<Kind, (bytes: Uint8Array, name: string) => Promise<{ definition: SlopeDefinition; notes: string[]; name: string }[]>> = {
  gsz: gszImports,
  stix: stixImports,
  sli: sliImports,
};

/** Text that is not for a user: internal errors of the runtime or the parser. */
const INTERNAL = /Cannot read|Cannot set|undefined|null\b|is not a function|is not iterable|is not an object|Maximum call stack|Invalid array length|Unexpected token|in JSON at|\bat [\w.<>]+ \(|\.ts:\d|\bNaN\b|\[object /;

/**
 * The time budget counts this process's own CPU time where Node reports it:
 * it guards against pathological parsing (a deep nesting, a huge count), and
 * wall-clock time on a loaded machine (other test runs, builds) is not that.
 */
const cpuUsage = (globalThis as { process?: { cpuUsage?: (previous?: { user: number; system: number }) => { user: number; system: number } } }).process?.cpuUsage;

/** Check one input; returns a description of what went wrong, or nothing. */
async function check(kind: Kind, bytes: Uint8Array, label: string, limitMs = 5000): Promise<string | undefined> {
  const t0 = performance.now();
  const cpu0 = cpuUsage?.();
  let out: Awaited<ReturnType<(typeof importers)[Kind]>> | undefined;
  let err: unknown;
  try {
    out = await importers[kind](bytes, `x.${kind}`);
  } catch (e) {
    err = e;
  }
  const wallMs = performance.now() - t0;
  const cpu = cpu0 && cpuUsage ? cpuUsage(cpu0) : undefined;
  const ms = cpu ? (cpu.user + cpu.system) / 1000 : wallMs;
  if (ms > limitMs) return `${label}: took ${Math.round(ms)} ms${cpu ? " of CPU time" : ""}`;
  if (err !== undefined) {
    if (!(err instanceof Error)) return `${label}: threw a non-Error ${String(err)}`;
    if (!err.message || err.message.trim() === "") return `${label}: empty error message`;
    if (INTERNAL.test(err.message)) return `${label}: internal message "${err.message}"`;
    return undefined;
  }
  for (const imp of out ?? []) {
    // (a note can quote the file, which may say NaN)
    for (const n of imp.notes) if (INTERNAL.test(n.replace(/\bNaN\b/g, ""))) return `${label}: internal note "${n}"`;
    try {
      buildSlope(toCanonicalSlopeDefinition(imp.definition));
    } catch (e) {
      return `${label}: imported a model the engine rejects: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return undefined;
}

/** A small seeded random generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] };
}
type Rng = ReturnType<typeof rng>;

// ---------------------------------------------------------------- bytes

/** Mutations of the raw bytes of any file. */
function byteMutants(bytes: Uint8Array, r: Rng, n: number): [string, Uint8Array][] {
  const out: [string, Uint8Array][] = [
    ["empty", new Uint8Array(0)],
    ["one byte", new Uint8Array([0x50])],
    ["ZIP signature only", new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
    ["text", enc.encode("hello, this is not a model\n")],
    ["UTF-8 BOM before", new Uint8Array([0xef, 0xbb, 0xbf, ...bytes])],
    ["all zero", new Uint8Array(bytes.length)],
    ["all 0xff", new Uint8Array(bytes.length).fill(0xff)],
  ];
  for (let i = 0; i < n; i++) {
    const kind = r.int(4);
    if (kind === 0) {
      const cut = r.int(bytes.length);
      out.push([`truncated at ${cut}`, bytes.slice(0, cut)]);
    } else if (kind === 1) {
      const b = bytes.slice();
      const flips = 1 + r.int(8);
      for (let k = 0; k < flips; k++) b[r.int(b.length)] ^= 1 << r.int(8);
      out.push([`bit flips (${i})`, b]);
    } else if (kind === 2) {
      const b = bytes.slice();
      const at = r.int(b.length - 4);
      new DataView(b.buffer).setUint32(at, r.pick([0, 0xffffffff, 0x7fffffff, r.int(0x10000)]), true);
      out.push([`word at ${at} overwritten`, b]);
    } else {
      const start = r.int(bytes.length), len = 1 + r.int(64);
      out.push([`bytes ${start}+${len} removed`, new Uint8Array([...bytes.subarray(0, start), ...bytes.subarray(start + len)])]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- ZIP structure

/** Mutations of the entries of a ZIP archive (via the program's own reader and writer). */
async function zipMutants(bytes: Uint8Array, r: Rng, n: number, decode: (b: Uint8Array) => string, encode: (s: string) => Uint8Array): Promise<[string, Uint8Array][]> {
  const entries = [...(await readZip(bytes)).entries()];
  const out: [string, Uint8Array][] = [
    ["no entries", writeZip([])],
    ["entries empty", writeZip(entries.map(([name]) => ({ name, data: new Uint8Array(0) })))],
    ["entries garbage", writeZip(entries.map(([name]) => ({ name, data: new Uint8Array(64).map(() => r.int(256)) })))],
    ["entries duplicated", writeZip([...entries, ...entries].map(([name, data]) => ({ name, data })))],
    ["names in upper case", writeZip(entries.map(([name, data]) => ({ name: name.toUpperCase(), data })))],
    ["names in a folder", writeZip(entries.map(([name, data]) => ({ name: `folder/${name}`, data })))],
    ["entries UTF-16", writeZip(entries.map(([name, data]) => ({ name, data: utf16(decode(data)) })))],
    ["entries with BOM", writeZip(entries.map(([name, data]) => ({ name, data: new Uint8Array([0xef, 0xbb, 0xbf, ...data]) })))],
    ["entries with LF only", writeZip(entries.map(([name, data]) => ({ name, data: encode(decode(data).replace(/\r\n/g, "\n")) })))],
    ["entries with CRLF", writeZip(entries.map(([name, data]) => ({ name, data: encode(decode(data).replace(/\r?\n/g, "\r\n")) })))],
    ["deflate method on stored data", setMethod(bytes, 8)],
    ["unknown compression method", setMethod(bytes, 99)],
    ["entry count huge", setEocd(bytes, 10, 0xffff)],
    ["central directory offset out of range", setEocd32(bytes, 16, 0x7fffffff)],
    ["central directory offset zero", setEocd32(bytes, 16, 0)],
  ];
  for (let i = 0; i < n; i++) {
    const keep = entries.filter(() => r.next() < 0.6);
    out.push([`random subset of ${keep.length} entries (${i})`, writeZip(keep.map(([name, data]) => ({ name, data })))]);
    const [name, data] = r.pick(entries);
    const text = decode(data);
    const cut = r.int(text.length);
    out.push([`${name} truncated at ${cut}`, writeZip(entries.map(([n2, d]) => ({ name: n2, data: n2 === name ? encode(text.slice(0, cut)) : d })))]);
  }
  return out;
}

const utf16 = (s: string) => {
  const b = new Uint8Array(2 + s.length * 2);
  b[0] = 0xff;
  b[1] = 0xfe;
  for (let i = 0; i < s.length; i++) new DataView(b.buffer).setUint16(2 + 2 * i, s.charCodeAt(i), true);
  return b;
};
const eocdAt = (b: Uint8Array) => {
  for (let i = b.length - 22; i >= 0; i--) if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 5 && b[i + 3] === 6) return i;
  return -1;
};
function setEocd(bytes: Uint8Array, off: number, v: number) {
  const b = bytes.slice();
  new DataView(b.buffer).setUint16(eocdAt(b) + off, v, true);
  return b;
}
function setEocd32(bytes: Uint8Array, off: number, v: number) {
  const b = bytes.slice();
  new DataView(b.buffer).setUint32(eocdAt(b) + off, v, true);
  return b;
}
/** Every central directory entry given the compression method. */
function setMethod(bytes: Uint8Array, method: number) {
  const b = bytes.slice();
  const v = new DataView(b.buffer);
  for (let i = 0; i + 46 <= b.length; i++) if (v.getUint32(i, true) === 0x02014b50) v.setUint16(i + 10, method, true);
  return b;
}

// ---------------------------------------------------------------- JSON values

const ODD_VALUES: Json[] = [null, "x", "", "NaN", "1e400", 1e308, -1e308, -1, 0, 1.5, true, {}, [], [null], { X: "a" }, [[[[[]]]]], "\u0000", 2 ** 64];

/** A deep copy of a JSON value with one random change somewhere. */
function mutateJson(v: Json, r: Rng): Json {
  const copy = JSON.parse(JSON.stringify(v)) as Json;
  // collect the containers and their keys
  const slots: [Record<string, Json> | Json[], string | number][] = [];
  const walk = (x: Json) => {
    if (Array.isArray(x)) x.forEach((c, i) => (slots.push([x, i]), walk(c)));
    else if (x && typeof x === "object") for (const k of Object.keys(x)) {
      slots.push([x as Record<string, Json>, k]);
      walk((x as Record<string, Json>)[k]);
    }
  };
  walk(copy);
  if (slots.length === 0) return r.pick(ODD_VALUES);
  const changes = 1 + r.int(3);
  for (let i = 0; i < changes; i++) {
    const [parent, key] = r.pick(slots);
    const what = r.int(5);
    if (what === 0 && !Array.isArray(parent)) delete (parent as Record<string, Json>)[key as string];
    else if (what === 1 && Array.isArray(parent)) parent.splice(key as number, 1);
    else if (what === 2) {
      const cur = (parent as Record<string, Json>)[key as string];
      // an array as an object or the other way round
      (parent as Record<string, Json>)[key as string] = Array.isArray(cur) ? Object.fromEntries(cur.map((c, j) => [String(j), c])) : cur && typeof cur === "object" ? Object.values(cur) : r.pick(ODD_VALUES);
    } else (parent as Record<string, Json>)[key as string] = r.pick(ODD_VALUES);
  }
  return copy;
}

// ---------------------------------------------------------------- XML

/** One random change to an XML document: an element removed, duplicated or emptied, or a text or attribute changed. */
function mutateXml(xml: string, r: Rng): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const all = Array.from(doc.getElementsByTagName("*")).slice(1);
  const changes = 1 + r.int(3);
  for (let i = 0; i < changes && all.length > 0; i++) {
    const el = r.pick(all);
    const odd = String(r.pick(["", "x", "NaN", "-1", "0", "1e308", "-1e308", "1,2,x", "999999", "true", ",,,", "Regions-x"]));
    switch (r.int(6)) {
      case 0:
        el.parentNode?.removeChild(el);
        break;
      case 1:
        el.parentNode?.insertBefore(el.cloneNode(true), el);
        break;
      case 2:
        while (el.firstChild) el.removeChild(el.firstChild);
        break;
      case 3:
        if (el.children.length === 0) el.textContent = odd;
        else el.appendChild(doc.createElement(r.pick(["Point", "Region", "Analysis", "Material", "ID"])));
        break;
      default: {
        const attrs = Array.from(el.attributes);
        if (attrs.length > 0) el.setAttribute(r.pick(attrs).name, odd);
        else el.setAttribute("Missing", "true");
      }
    }
  }
  return new XMLSerializer().serializeToString(doc);
}

// ---------------------------------------------------------------- .sli text

const ODD_TOKENS = ["", "x", "NaN", "-1", "0", "1e308", "-1e308", "[", "]", "[1,2", "[]", "[x,y]", "{", "999999999", "-0", "1,2"];

/** One random change to the lines of a .sli text: lines removed, duplicated, swapped, or a value replaced. */
function mutateSliText(text: string, r: Rng): string {
  const lines = text.split(/\r?\n/);
  const changes = 1 + r.int(4);
  for (let i = 0; i < changes; i++) {
    const at = r.int(lines.length);
    switch (r.int(5)) {
      case 0:
        lines.splice(at, 1 + r.int(5));
        break;
      case 1:
        lines.splice(at, 0, ...lines.slice(at, at + 1 + r.int(5)));
        break;
      case 2: {
        const b = r.int(lines.length);
        [lines[at], lines[b]] = [lines[b], lines[at]];
        break;
      }
      default: {
        // a value after a "key:" or a number in the line
        const tokens = lines[at].split(/(\s+)/);
        const idx = tokens.map((t, j) => (/\S/.test(t) ? j : -1)).filter((j) => j >= 0);
        if (idx.length > 0) tokens[r.pick(idx)] = r.pick(ODD_TOKENS);
        lines[at] = tokens.join("");
      }
    }
  }
  return lines.join("\r\n");
}

// ---------------------------------------------------------------- the valid files

const gszBytes = () => modelToGsz(model()).bytes;
const stixBytes = () => modelToStix(model()).bytes;
const sliText = () => modelToSli(model()).text;
const slimBytes = () => modelToSlim(model(), "Dike").bytes;
/** A .slmd of two scenarios, both the same model. */
function slmdBytes(text = sliText()) {
  const index = ['  sc_name: "First"', '  sc_filename: "{A}.slsc"', '  sc_name: "Second"', '  sc_filename: "{B}.slsc"'].join("\r\n");
  return writeZip([
    { name: "m.slmm", data: latin1(index) },
    { name: "{A}.slsc", data: latin1(text) },
    { name: "{B}.slsc", data: latin1(text) },
  ]);
}

async function zipJson(bytes: Uint8Array): Promise<[string, Json][]> {
  return [...(await readZip(bytes)).entries()].map(([n, d]) => [n, JSON.parse(dec.decode(d)) as Json]);
}
const jsonZip = (docs: [string, Json][]) => writeZip(docs.map(([name, d]) => ({ name, data: JSON.stringify(d) })));

async function run(kind: Kind, cases: [string, Uint8Array][], limitMs?: number) {
  const failures: string[] = [];
  for (const [label, bytes] of cases) {
    const f = await check(kind, bytes, label, limitMs);
    if (f) failures.push(f);
  }
  // one per line, so that a failing run lists them all
  return failures.join("\n");
}

describe("import robustness: the valid files import", () => {
  it("the writers' own files import and build", async () => {
    expect(await run("gsz", [["gsz", gszBytes()]])).toBe("");
    expect(await run("stix", [["stix", stixBytes()]])).toBe("");
    expect(await run("sli", [["sli", latin1(sliText())], ["slim", slimBytes()], ["slmd", slmdBytes()]])).toBe("");
    expect(await sliImports(slmdBytes(), "m.slmd")).toHaveLength(2);
  });
});

describe("import robustness: damaged bytes", () => {
  const files = [["gsz", "gsz", gszBytes], ["stix", "stix", stixBytes], ["sli", "sli", () => latin1(sliText())], ["slim", "sli", slimBytes], ["slmd", "sli", () => slmdBytes()]] as const;
  files.forEach(([ext, kind, make], k) => {
    it(`.${ext}: truncated, flipped and cut bytes`, async () => {
      const r = rng(31 + k);
      expect(await run(kind, byteMutants(make(), r, 150 * SCALE))).toBe("");
    });
  });
});

describe("import robustness: damaged archives", () => {
  it(".gsz entries", async () => {
    const r = rng(11);
    expect(await run("gsz", await zipMutants(gszBytes(), r, 30 * SCALE, (b) => dec.decode(b), (s) => enc.encode(s)))).toBe("");
  });
  it(".stix entries", async () => {
    const r = rng(12);
    expect(await run("stix", await zipMutants(stixBytes(), r, 30 * SCALE, (b) => dec.decode(b), (s) => enc.encode(s)))).toBe("");
  });
  it(".slim and .slmd entries", async () => {
    const r = rng(13);
    expect(await run("sli", await zipMutants(slimBytes(), r, 20 * SCALE, unlatin1, latin1))).toBe("");
    expect(await run("sli", await zipMutants(slmdBytes(), r, 20 * SCALE, unlatin1, latin1))).toBe("");
  });
});

describe("import robustness: damaged documents", () => {
  it(".stix JSON with wrong types, missing keys and odd values", async () => {
    const r = rng(21);
    const docs = await zipJson(stixBytes());
    const cases: [string, Uint8Array][] = [];
    for (const [name] of docs) {
      for (const odd of [null, [], 1, "x", true]) cases.push([`${name} is ${JSON.stringify(odd)}`, jsonZip(docs.map(([n, d]) => [n, n === name ? odd : d]))]);
      cases.push([`${name} left out`, jsonZip(docs.filter(([n]) => n !== name))]);
    }
    for (let i = 0; i < 600 * SCALE; i++) {
      const at = r.int(docs.length);
      cases.push([`${docs[at][0]} mutated (${i})`, jsonZip(docs.map(([n, d], j) => [n, j === at ? mutateJson(d, r) : d]))]);
    }
    expect(await run("stix", cases)).toBe("");
  });

  it(".gsz XML with elements removed, duplicated or given odd values", async () => {
    const r = rng(22);
    const entries = [...(await readZip(gszBytes())).entries()];
    const [xmlName, xmlData] = entries.find(([n]) => n.endsWith(".xml"))!;
    const xml = dec.decode(xmlData);
    const withXml = (x: string) => writeZip(entries.map(([n, d]) => ({ name: n, data: n === xmlName ? x : d })));
    const cases: [string, Uint8Array][] = [
      ["not XML", withXml("{ not xml")],
      ["empty XML", withXml("")],
      ["other root", withXml("<Other/>")],
      ["empty root", withXml("<GSIData/>")],
      ["BOM before the XML", withXml(`\uFEFF${xml}`)],
      ["LF only", withXml(xml.replace(/\r\n/g, "\n"))],
      ["imperial units", withXml(xml.replace(/UnitSystem="Metric"/i, 'UnitSystem="Imperial"'))],
      ["unknown units", withXml(xml.replace(/UnitSystem="Metric"/i, 'UnitSystem="Furlongs"'))],
      ["deep nesting", withXml(xml.replace("</GSIData>", `${"<A>".repeat(5000)}${"</A>".repeat(5000)}</GSIData>`))],
    ];
    for (let i = 0; i < 400 * SCALE; i++) cases.push([`XML mutated (${i})`, withXml(mutateXml(xml, r))]);
    expect(await run("gsz", cases)).toBe("");
  });

  it(".sli text with lines removed, duplicated, swapped or given odd values", async () => {
    const r = rng(23);
    const text = sliText();
    const cases: [string, Uint8Array][] = [
      ["LF only", latin1(text.replace(/\r\n/g, "\n"))],
      ["CR only", latin1(text.replace(/\r\n/g, "\r"))],
      ["UTF-8 BOM", new Uint8Array([0xef, 0xbb, 0xbf, ...latin1(text)])],
      ["UTF-16", utf16(text)],
      ["no cells", latin1(text.replace(/^cells:[\s\S]*?(?=^\S)/m, ""))],
      ["no vertices section body", latin1(text.replace(/^(vertices:\r\n)[\s\S]*?(?=^\S)/m, "$1"))],
      ["only the section headers", latin1("material types:\r\nvertices:\r\n")],
      ["imperial", latin1(text.replace(/units:\s*\S+/, "units: 1"))],
    ];
    for (let i = 0; i < 600 * SCALE; i++) cases.push([`text mutated (${i})`, latin1(mutateSliText(text, r))]);
    expect(await run("sli", cases)).toBe("");
  });
});

describe("import robustness: unknown values and references", () => {
  it(".stix: unknown model types and methods, duplicate and missing ids", async () => {
    const docs = await zipJson(stixBytes());
    const edit = (name: RegExp, f: (d: Record<string, Json>) => Record<string, Json>) => jsonZip(docs.map(([n, d]) => [n, name.test(n) ? f(JSON.parse(JSON.stringify(d)) as Record<string, Json>) : d]));
    const soils = (f: (s: Record<string, Json>) => void) => edit(/^soils\.json$/, (d) => ((d.Soils as Record<string, Json>[]).forEach(f), d));
    const cases: [string, Uint8Array][] = [
      ["unknown strength model", soils((s) => ((s.ShearStrengthModelTypeAbovePhreaticLevel = "Telepathy"), (s.ShearStrengthModelTypeBelowPhreaticLevel = "Telepathy")))],
      ["strength model a number", soils((s) => (s.ShearStrengthModelTypeBelowPhreaticLevel = 7))],
      ["soil without an id", soils((s) => delete s.Id)],
      ["soils with the same id", soils((s) => (s.Id = "same"))],
      ["unknown analysis type", edit(/calculationsettings/, (d) => ({ ...d, AnalysisType: "Astrology", CalculationType: { a: 1 } }))],
      ["every document with the same id", jsonZip(docs.map(([n, d]) => [n, { ...(d as object), Id: "1" }]))],
      ["every id removed", jsonZip(docs.map(([n, d]) => [n, JSON.parse(JSON.stringify(d).replace(/"(\w*Id)":"[^"]*"/g, '"$1":null'))]))],
    ];
    expect(await run("stix", cases)).toBe("");
  });

  it(".gsz: unknown strength models, methods and units, and imperial units", async () => {
    const entries = [...(await readZip(gszBytes())).entries()];
    const [xmlName, xmlData] = entries.find(([n]) => n.endsWith(".xml"))!;
    const xml = dec.decode(xmlData);
    const withXml = (x: string) => writeZip(entries.map(([n, d]) => ({ name: n, data: n === xmlName ? x : d })));
    const cases: [string, Uint8Array][] = [
      ["unknown strength model", withXml(xml.replace(/<SlopeModel>[^<]*<\/SlopeModel>/g, "<SlopeModel>Telepathy</SlopeModel>"))],
      ["unknown method", withXml(xml.replace(/<Method>[^<]*<\/Method>/g, "<Method>Astrology</Method>"))],
      ["imperial", withXml(xml.replace(/UnitSystem="\w+"/, 'UnitSystem="Imperial"'))],
      ["no unit system, water of 62.4", withXml(xml.replace(/UnitSystem="\w+"/, "").replace(/<UnitWaterWeight>[^<]*</g, "<UnitWaterWeight>62.4<"))],
      ["no unit system, water of 5", withXml(xml.replace(/UnitSystem="\w+"/, "").replace(/<UnitWaterWeight>[^<]*</g, "<UnitWaterWeight>5<"))],
      ["every ID 1", withXml(xml.replace(/<ID>\d+<\/ID>/g, "<ID>1</ID>").replace(/ID="\d+"/g, 'ID="1"'))],
    ];
    expect(await run("gsz", cases)).toBe("");
  });

  it(".sli: unknown material types, water methods and units", async () => {
    const text = sliText();
    const cases: [string, Uint8Array][] = [
      ["unknown strength type", latin1(text.replace(/(soil\d+ = type:)\s*\d+/g, "$1 99"))],
      ["unknown water method", latin1(text.replace(/^(\s*water:\s*)\S+/m, "$1telepathy"))],
      ["imperial", latin1(text.replace(/^(\s*units:\s*)\S+/m, "$1imperial"))],
      ["unknown units", latin1(text.replace(/^(\s*units:\s*)\S+/m, "$1cubits"))],
      ["unknown direction", latin1(text.replace(/^(\s*direction:\s*).*$/m, "$1sideways"))],
    ];
    expect(await run("sli", cases)).toBe("");
  });
});

describe("import robustness: degenerate geometry", () => {
  it(".sli cells that are degenerate, self-intersecting or refer to missing vertices", async () => {
    const text = sliText();
    const cellsAt = text.match(/^cells:\r\n([\s\S]*?)(?=^\S)/m)!;
    const withCells = (lines: string[]) => latin1(text.replace(cellsAt[0], `cells:\r\n${lines.map((l) => `${l}\r\n`).join("")}`));
    const first = cellsAt[1].split("\r\n").find((l) => /vertices:/.test(l))!;
    const material = first.match(/material:\s*(\S+)/)![1];
    const cell = (ids: number[]) => `  cell  vertices: [${ids.join(",")}]  material: ${material}`;
    const cases: [string, Uint8Array][] = [
      ["a zero-area cell", withCells([...cellsAt[1].split("\r\n").filter(Boolean), cell([1, 1, 1])])],
      ["only zero-area cells", withCells([cell([1, 2, 1]), cell([3, 3, 3])])],
      ["a bow-tie cell", withCells([cell([1, 2, 3, 4])])],
      ["a cell of missing vertices", withCells([cell([90001, 90002, 90003])])],
      ["a cell of two vertices", withCells([cell([1, 2])])],
      ["an unknown material", withCells([`  cell  vertices: [1,2,3]  material: soil999`])],
    ];
    expect(await run("sli", cases)).toBe("");
  });

  it(".stix layers that are empty, collinear, self-intersecting or with odd points", async () => {
    const docs = await zipJson(stixBytes());
    const geoAt = docs.findIndex(([n]) => /geometries\//.test(n));
    const geo = docs[geoAt][1] as { Layers: { Points: { X: unknown; Z: unknown }[] }[] };
    const withLayers = (layers: unknown) => jsonZip(docs.map(([n, d], j) => [n, j === geoAt ? { ...geo, Layers: layers } : d]));
    const layer0 = geo.Layers[0];
    const cases: [string, Uint8Array][] = [
      ["no layers", withLayers([])],
      ["a layer of no points", withLayers([{ ...layer0, Points: [] }])],
      ["collinear points", withLayers([{ ...layer0, Points: [{ X: 0, Z: 0 }, { X: 1, Z: 0 }, { X: 2, Z: 0 }] }])],
      ["a bow tie", withLayers([{ ...layer0, Points: [{ X: 0, Z: 0 }, { X: 10, Z: 10 }, { X: 10, Z: 0 }, { X: 0, Z: 10 }] }])],
      ["one point repeated", withLayers([{ ...layer0, Points: Array(10).fill({ X: 1, Z: 1 }) }])],
      ["huge coordinates", withLayers([{ ...layer0, Points: [{ X: -1e300, Z: 0 }, { X: 1e300, Z: 0 }, { X: 0, Z: 1e300 }] }])],
      ["string coordinates", withLayers([{ ...layer0, Points: [{ X: "0", Z: "0" }, { X: "10", Z: "0" }, { X: "5", Z: "x" }] }])],
      ["layers as an object", withLayers({ a: layer0 })],
      ["layers null", withLayers(null)],
      ["layer null", withLayers([null, ...geo.Layers])],
      ["duplicate layers", withLayers([...geo.Layers, ...geo.Layers])],
    ];
    expect(await run("stix", cases)).toBe("");
  });
});

describe("import robustness: large files", () => {
  it(".sli with 50 000 cells imports or fails quickly", async () => {
    // a 250 × 100 grid of triangles
    const nx = 250, ny = 100;
    const v: string[] = [];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) v.push(`  ${j * (nx + 1) + i + 1}  x: ${i * 0.4}  y: ${j * 0.1}`);
    const cells: string[] = [];
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i + 1, b = a + 1, c = a + nx + 2, d = a + nx + 1;
        cells.push(`  cell  vertices: [${a},${b},${c}]  material: soil1`, `  cell  vertices: [${a},${c},${d}]  material: soil1`);
      }
    const text = sliText().replace(/^vertices:\r\n[\s\S]*?(?=^\S)/m, `vertices:\r\n${v.join("\r\n")}\r\n`).replace(/^cells:\r\n[\s\S]*?(?=^\S)/m, `cells:\r\n${cells.join("\r\n")}\r\n`);
    expect(await run("sli", [["50k cells", latin1(text)]], 10_000)).toBe("");
  });

  it(".stix with 5000 layers imports or fails quickly", async () => {
    const docs = await zipJson(stixBytes());
    const geoAt = docs.findIndex(([n]) => /geometries\//.test(n));
    const geo = docs[geoAt][1] as { Layers: Json[] };
    const layers = Array.from({ length: 5000 }, (_, i) => ({ Id: `L${i}`, Label: "", Notes: "", Points: [{ X: 0, Z: -i - 1 }, { X: 40, Z: -i - 1 }, { X: 40, Z: -i }, { X: 0, Z: -i }] }));
    const big = jsonZip(docs.map(([n, d], j) => [n, j === geoAt ? { ...geo, Layers: [...geo.Layers, ...layers] } : d]));
    expect(await run("stix", [["5000 layers", big]], 5000)).toBe("");
    await expect(stixImports(big, "x.stix")).rejects.toThrow(/has 50\d\d layers; at most 1000 can be imported/);
  });

  /** A .gsz with n more regions below the model (a row of n columns from y = 0 to −1), with a material or without. */
  async function gszWithRegions(n: number, assigned: boolean) {
    const entries = [...(await readZip(gszBytes())).entries()];
    const [xmlName, xmlData] = entries.find(([nm]) => nm.endsWith(".xml"))!;
    const pts: string[] = [];
    for (let i = 0; i <= n; i++) pts.push(`<Point ID="${100000 + 2 * i}" X="${(i * 40) / n}" Y="0" /><Point ID="${100001 + 2 * i}" X="${(i * 40) / n}" Y="-1" />`);
    const regions: string[] = [];
    for (let i = 0; i < n; i++) regions.push(`<Region><ID>${1000 + i}</ID><PointIDs>${100000 + 2 * i},${100002 + 2 * i},${100003 + 2 * i},${100001 + 2 * i}</PointIDs></Region>`);
    const uses = assigned ? regions.map((_, i) => `<GeometryUsesMaterial ID="Regions-${1000 + i}" Entry="1" />`).join("") : "";
    const xml = dec
      .decode(xmlData)
      .replace("</Points>", `${pts.join("")}</Points>`)
      .replace("</Regions>", `${regions.join("")}</Regions>`)
      .replace("</GeometryUsesMaterials>", `${uses}</GeometryUsesMaterials>`);
    return writeZip(entries.map(([nm, d]) => ({ name: nm, data: nm === xmlName ? xml : d })));
  }

  it(".gsz with 10 000 regions imports or fails quickly", async () => {
    const used = await gszWithRegions(10_000, true);
    expect(await run("gsz", [["10k regions", used], ["10k regions without a material", await gszWithRegions(10_000, false)]], 8000)).toBe("");
    await expect(gszImports(used, "x.gsz")).rejects.toThrow(/has 100\d\d soil regions; at most 1000 can be imported/);
  });

  it(".sli with 3000 soil regions fails quickly", async () => {
    // a row of 3000 columns of alternating materials
    const n = 3000;
    const v: string[] = [];
    for (let i = 0; i <= n; i++) v.push(`  ${2 * i + 1}  x: ${(i * 40) / n}  y: 0`, `  ${2 * i + 2}  x: ${(i * 40) / n}  y: 5`);
    const cells: string[] = [];
    for (let i = 0; i < n; i++) cells.push(`  cell  vertices: [${2 * i + 1},${2 * i + 3},${2 * i + 4},${2 * i + 2}]  material: soil${(i % 2) + 1}`);
    const text = sliText().replace(/^vertices:\r\n[\s\S]*?(?=^\S)/m, `vertices:\r\n${v.join("\r\n")}\r\n`).replace(/^cells:\r\n[\s\S]*?(?=^\S)/m, `cells:\r\n${cells.join("\r\n")}\r\n`);
    expect(await run("sli", [["3000 regions", latin1(text)]], 5000)).toBe("");
    await expect(sliImports(latin1(text), "x.sli")).rejects.toThrow(/has \d+ soil regions; at most 1000 can be imported/);
  });
});

describe("import robustness: zip bombs", () => {
  /** A ZIP archive with the compression methods and declared sizes given (what a crafted archive can claim). */
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
    return new Uint8Array(await new Response(source.pipeThrough(new CompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)).arrayBuffer());
  }

  const MB = 1024 * 1024;
  const names = { gsz: "m.xml", stix: "soils.json", sli: "m.sli" } as const;

  it("refuses entries and archives that claim to unpack above the limits, and streams that unpack past their declared size", async () => {
    // 4 MB of zeros deflate to a few kB (the ratio of a bomb)
    const zeros = new Uint8Array(4 * MB);
    const comp = await deflated(zeros);
    expect(comp.length).toBeLessThan(16 * 1024);
    for (const kind of ["gsz", "stix", "sli"] as const) {
      const name = names[kind];
      const cases: [string, Uint8Array][] = [
        ["entry claims 4 GB", rawZip([{ name, data: comp, method: 8, uncompressed: 0xffffffff }])],
        ["entry claims 101 MB", rawZip([{ name, data: comp, method: 8, uncompressed: 101 * MB }])],
        ["three entries claim 70 MB each", rawZip([1, 2, 3].map((i) => ({ name: `${i}/${name}`, data: comp, method: 8, uncompressed: 70 * MB })))],
        ["entry claims 100 bytes but unpacks to 4 MB", rawZip([{ name, data: comp, method: 8, uncompressed: 100 }])],
        ["stored entry claims fewer bytes than it holds", rawZip([{ name, data: zeros.subarray(0, 1000), method: 0, uncompressed: 10 }])],
        ["entry unpacks to the 4 MB it declares", rawZip([{ name, data: comp, method: 8, uncompressed: zeros.length }])],
      ];
      expect(await run(kind, cases)).toBe("");
    }
    await expect(gszImports(rawZip([{ name: "m.xml", data: comp, method: 8, uncompressed: 0xffffffff }]), "x.gsz")).rejects.toThrow(
      /m\.xml is too large to import \(4096 MB unpacked; at most 100 MB\)/,
    );
    await expect(stixImports(rawZip([{ name: "soils.json", data: comp, method: 8, uncompressed: 100 }]), "x.stix")).rejects.toThrow(/soils\.json is larger than its header says/);
    await expect(sliImports(rawZip([1, 2, 3].map((i) => ({ name: `${i}.slsc`, data: comp, method: 8, uncompressed: 70 * MB }))), "x.slmd")).rejects.toThrow(
      /entries unpack to more than 200 MB/,
    );
  });
});

describe("import robustness: one bad analysis among good ones", () => {
  it(".slmd: a scenario without cells is named, the others import", async () => {
    const good = sliText();
    const bad = good.replace(/^cells:\r\n[\s\S]*?(?=^\S)/m, "cells:\r\n");
    const index = ['  sc_name: "Good"', '  sc_filename: "{A}.slsc"', '  sc_name: "Broken"', '  sc_filename: "{B}.slsc"', '  sc_name: "Also good"', '  sc_filename: "{C}.slsc"'].join("\r\n");
    const bytes = writeZip([
      { name: "m.slmm", data: latin1(index) },
      { name: "{A}.slsc", data: latin1(good) },
      { name: "{B}.slsc", data: latin1(bad) },
      { name: "{C}.slsc", data: latin1(good) },
    ]);
    const imps = await sliImports(bytes, "m.slmd");
    expect(imps).toHaveLength(2);
    expect(imps[0].notes.join(" ")).toMatch(/Not imported: .*Broken/);
  });

  it(".stix: a calculation whose stage has a damaged geometry is named, the others import", async () => {
    const docs = await zipJson(stixBytes());
    const scAt = docs.findIndex(([n]) => /scenarios\/scenario/.test(n));
    const sc = docs[scAt][1] as { Stages: Record<string, Json>[]; Calculations: Record<string, Json>[] };
    // a second stage whose geometry is not a document, and a calculation of it in a second scenario
    const broken = { ...sc, Id: "sc2", Label: "Broken scenario", Stages: [{ ...sc.Stages[0], GeometryId: "missing" }], Calculations: [{ ...sc.Calculations[0], Label: "Broken calc" }] };
    const odd = { ...sc, Id: "sc3", Label: "Odd scenario", Stages: [{ ...sc.Stages[0], SoilLayersId: 42 }], Calculations: [{ ...sc.Calculations[0], Label: "Odd calc" }] };
    const bytes = jsonZip([...docs, ["scenarios/scenario_1.json", broken], ["scenarios/scenario_2.json", odd]]);
    const imps = await stixImports(bytes, "x.stix");
    expect(imps).toHaveLength(1);
    const notes = imps[0].notes.join(" ");
    expect(notes).toMatch(/Not imported: .*Broken/);
    expect(notes).toMatch(/Not imported: .*Odd/);
  });

  it(".gsz: an analysis that refers to a missing geometry is named, the other imports", async () => {
    const entries = [...(await readZip(gszBytes())).entries()];
    const [xmlName, xmlData] = entries.find(([n]) => n.endsWith(".xml"))!;
    const xml = dec.decode(xmlData);
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const analysis = doc.getElementsByTagName("Analysis")[0];
    const copy = analysis.cloneNode(true) as Element;
    copy.getElementsByTagName("ID")[0].textContent = "77";
    copy.getElementsByTagName("Name")[0].textContent = "Broken analysis";
    const g = copy.getElementsByTagName("GeometryId")[0] ?? copy.appendChild(doc.createElement("GeometryId"));
    g.textContent = "9";
    analysis.parentNode!.appendChild(copy);
    const bytes = writeZip(entries.map(([n, d]) => ({ name: n, data: n === xmlName ? new XMLSerializer().serializeToString(doc) : d })));
    const imps = await gszImports(bytes, "x.gsz");
    expect(imps).toHaveLength(1);
    expect(imps[0].notes.join(" ")).toMatch(/Not imported: .*Broken analysis/);
  });
});
