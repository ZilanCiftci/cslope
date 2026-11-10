/**
 * Reading of .sli model files and the archives that carry them: a .slim is
 * a ZIP archive holding one .sli; a .slmd is a ZIP archive of a shared part
 * (.slsp: materials, support types, strength functions), one scenario file
 * per scenario (.slsc, the same grammar as .sli) and an index (.slmm) that
 * names the scenarios and gives their order.
 *
 * The grammar is sectioned ASCII text: a line at the start of a line that
 * ends in ":" opens a section ("vertices:", "cells:", "material types:"),
 * and the indented lines below it, up to the next section, are its body,
 * mostly runs of "key: value" tokens.
 */

import { isZip, readZip } from "../../../utils/zip";

export type Pt = [number, number];
/** "key: value" tokens of a line. */
export type Fields = Record<string, string>;

/** One analysis (a .sli, or a scenario of a .slmd). */
export interface SliScenario {
  /** The scenario name ("" for a single model). */
  name: string;
  /** The scenario's file in a .slmd archive ({id}.slsc). */
  file?: string;
  /** Section name → body lines (indentation kept, line ends removed). */
  sections: Map<string, string[]>;
  /** The "model description" settings. */
  description: Map<string, string>;
  /** Vertex number → point. */
  vertices: Map<number, Pt>;
  /** The cells: their vertex numbers and material key (soil1, soil2, …). */
  cells: { ids: number[]; material: string }[];
  /** Material key → its fields (the shared strengths and the scenario's water settings merged). */
  materials: Map<string, Fields>;
  /** Material names and colours by number (soil1 is the first). */
  materialNames: string[];
  materialColours: (string | undefined)[];
}

export interface SliFile {
  kind: "sli" | "slim" | "slmd";
  version?: string;
  scenarios: SliScenario[];
}

/** Section name → body lines. */
export function parseSections(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let cur: string[] | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (line && !/^\s/.test(line) && line.endsWith(":") && !line.startsWith("#")) {
      const name = line.slice(0, -1).trim();
      cur = out.get(name);
      if (!cur) out.set(name, (cur = []));
    } else if (cur) cur.push(line);
  }
  return out;
}

/** The "key: value" tokens of a line; a value can be a [list], a {guid} or one token (a trailing comma is dropped). */
export function fields(line: string): Fields {
  const out: Fields = {};
  const re = /([A-Za-z_][\w]*):\s*(\[[^\]]*\]|\{[^}]*\}|[^\s]*)/g;
  for (let m = re.exec(line); m; m = re.exec(line)) out[m[1]] = m[2].replace(/,$/, "");
  return out;
}

/** A number of a field, or undefined. */
export function num(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** The numbers of a "[1,2,3]" list. */
export function idList(v: string | undefined): number[] {
  const m = v?.match(/^\[([^\]]*)\]$/);
  if (!m) return [];
  return m[1].split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n));
}

/** The vertex lists of a section's lines ("vertices: [..]"), one per line that has one. */
export function vertexLists(lines: string[] | undefined): { ids: number[]; fields: Fields }[] {
  return (lines ?? []).flatMap((l) => {
    const f = fields(l);
    const ids = idList(f.vertices);
    return ids.length > 0 ? [{ ids, fields: f }] : [];
  });
}

/** Material key → fields of a "material types" body ("  soil1 = type: 0 c: 20 …"). */
function materialTypes(lines: string[] | undefined): Map<string, Fields> {
  const out = new Map<string, Fields>();
  for (const l of lines ?? []) {
    const m = l.match(/^\s*(soil\d+)\s*=\s*(.*)$/);
    if (!m) continue;
    const f = fields(m[2]);
    // a name (of a function) runs to the end of the line
    const name = m[2].match(/\bname:\s*(.*)$/);
    if (name) f.name = name[1].trim();
    out.set(m[1], f);
  }
  return out;
}

/** Names and colours of the materials ("  Soil    red: 255  green: 255  blue: 193 …"), in order. */
function materialProperties(lines: string[] | undefined): { names: string[]; colours: (string | undefined)[] } {
  const names: string[] = [];
  const colours: (string | undefined)[] = [];
  for (const l of lines ?? []) {
    const m = l.match(/^\s*(.*?)\s+red:\s*(\d+)\s+green:\s*(\d+)\s+blue:\s*(\d+)/);
    if (!m) continue;
    // support colours follow the materials' ("Support 1 …" without hatch fields)
    if (!/has_hatch/.test(l)) continue;
    names.push(m[1].trim());
    const hex = (s: string) => Math.max(0, Math.min(255, Number(s))).toString(16).padStart(2, "0");
    colours.push(`#${hex(m[2])}${hex(m[3])}${hex(m[4])}`);
  }
  return { names, colours };
}

/** One scenario from its text, with the shared part's sections (of a .slmd) under its own. */
export function scenarioFromText(text: string, name: string, shared?: Map<string, string[]>): SliScenario {
  const own = parseSections(text);
  const sections = new Map(shared ?? []);
  for (const [k, v] of own) if (k !== "material types" || !shared) sections.set(k, v);
  // the materials: the shared strengths with the scenario's settings over them
  const materials = materialTypes(shared?.get("material types"));
  for (const [k, f] of materialTypes(own.get("material types"))) materials.set(k, { ...(materials.get(k) ?? {}), ...f });

  const description = new Map<string, string>();
  for (const l of sections.get("model description") ?? []) {
    const m = l.match(/^\s*([\w ]+?):\s*(.*)$/);
    if (m) description.set(m[1].trim(), m[2].trim());
  }
  const vertices = new Map<number, Pt>();
  for (const l of sections.get("vertices") ?? []) {
    const m = l.match(/^\s*(\d+)\s+x:\s*(\S+)\s+y:\s*(\S+)/);
    if (m && Number.isFinite(Number(m[2])) && Number.isFinite(Number(m[3]))) vertices.set(Number(m[1]), [Number(m[2]), Number(m[3])]);
  }
  const cells: SliScenario["cells"] = [];
  for (const l of sections.get("cells") ?? []) {
    const m = l.match(/vertices:\s*\[([^\]]*)\]\s*material:\s*(\S+)/);
    if (m) cells.push({ ids: idList(`[${m[1]}]`), material: m[2] });
  }
  const props = materialProperties(sections.get("material properties"));
  return { name, sections, description, vertices, cells, materials, materialNames: props.names, materialColours: props.colours };
}

/** Parse the text of a .sli file (one model). */
export function parseSli(text: string, name = ""): SliFile {
  if (!/^material types:/m.test(text) || !/^vertices:/m.test(text)) throw new Error("Not a .sli model (no materials or vertices).");
  const sc = scenarioFromText(text, name);
  return { kind: "sli", ...(sc.description.get("version") ? { version: sc.description.get("version") } : {}), scenarios: [sc] };
}

const latin1 = new TextDecoder("latin1");
const base = (p: string) => p.replace(/\\/g, "/").split("/").pop() ?? p;

/** Read a .sli, .slim or .slmd file (the archive's kind from its contents). */
export async function readSli(bytes: Uint8Array): Promise<SliFile> {
  if (!isZip(bytes)) return parseSli(latin1.decode(bytes));
  // only the model's text (not the images and views beside it)
  const entries = await readZip(bytes, (name) => /\.(sli|slsc|slsp|slmm)$/i.test(name));
  const names = [...entries.keys()];
  const find = (ext: string) => names.filter((n) => n.toLowerCase().endsWith(ext));
  const sli = find(".sli")[0];
  if (sli) return { ...parseSli(latin1.decode(entries.get(sli))), kind: "slim" };
  const scenarioFiles = find(".slsc");
  if (scenarioFiles.length === 0) throw new Error("The archive holds no model (.sli) or scenario (.slsc).");
  const slsp = find(".slsp")[0];
  const shared = slsp ? parseSections(latin1.decode(entries.get(slsp))) : undefined;
  let version: string | undefined;
  for (const l of shared?.get("shared model description") ?? []) {
    const m = l.match(/^\s*version:\s*(\S+)/);
    if (m) version = m[1];
  }
  // the index: scenario file → name, in order
  const order: { file: string; name: string }[] = [];
  const slmm = find(".slmm")[0];
  if (slmm) {
    let file: string | undefined, name: string | undefined;
    for (const l of latin1.decode(entries.get(slmm)).split(/\r?\n/)) {
      const f = l.match(/^\s*sc_filename:\s*"([^"]*)"/);
      if (f) file = base(f[1]);
      const n = l.match(/^\s*sc_name:\s*"([^"]*)"/);
      if (n) name = n[1];
      if (file !== undefined && name !== undefined) {
        order.push({ file, name });
        file = name = undefined;
      }
    }
  }
  const listed = order.filter((o) => scenarioFiles.some((n) => base(n) === o.file));
  for (const n of scenarioFiles) if (!listed.some((o) => o.file === base(n))) listed.push({ file: base(n), name: base(n).replace(/\.slsc$/i, "") });
  const scenarios = listed.map((o) => ({ ...scenarioFromText(latin1.decode(entries.get(scenarioFiles.find((n) => base(n) === o.file)!)), o.name, shared), file: o.file }));
  return { kind: "slmd", ...(version ? { version } : {}), scenarios };
}
