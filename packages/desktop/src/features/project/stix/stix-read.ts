/**
 * Reading of .stix project files: a ZIP archive of JSON
 * documents (projectinfo, scenarios with stages and calculations, soils,
 * geometries, soil layers, waternets, states, loads, reinforcements,
 * calculation settings and results), which refer to each other by "Id".
 */

import { readZip, isZip } from "../../../utils/zip";

type Json = Record<string, unknown>;
export type Pt = [number, number];

/** A stage of a scenario with the documents it uses. */
export interface StixStage {
  label: string;
  geometry?: Json;
  soilLayers?: Json;
  waternet?: Json;
  state?: Json;
  loads?: Json;
  reinforcements?: Json;
  /** How the stage defines the water: "Waternet" (default) or "WaterMesh". */
  waterDefinition?: string;
}

/** A calculation of a scenario: its stage (the last), settings and result. */
export interface StixCalculation {
  scenario: string;
  label: string;
  /** The stage calculated (the last of the scenario, or in a file from
   *  before 2024 the stage named like the calculation). */
  stage: StixStage;
  /** The stages of the scenario up to the calculated one, in order. */
  stages: StixStage[];
  settings?: Json;
  result?: Json;
}

export interface StixFile {
  soils: Json[];
  /** Soil id → colour (#RRGGBB). */
  colours: Map<string, string>;
  calculations: StixCalculation[];
  application?: string;
}

/** Parse the JSON documents of a .stix archive (path → document). */
export function parseStixDocuments(docs: Map<string, Json>): StixFile {
  const byId = new Map<string, Json>();
  for (const d of docs.values()) {
    const id = d.Id;
    if (typeof id === "string" && !byId.has(id)) byId.set(id, d);
  }
  const doc = (id: unknown) => (typeof id === "string" ? byId.get(id) : undefined);
  const soils = list(docs.get("soils.json")?.Soils);
  const colours = new Map<string, string>();
  for (const v of list(docs.get("soilvisualizations.json")?.SoilVisualizations)) {
    const c = typeof v.Color === "string" ? v.Color : "";
    // #AARRGGBB
    const m = c.match(/^#([0-9a-f]{2})?([0-9a-f]{6})$/i);
    if (m && typeof v.SoilId === "string") colours.set(v.SoilId, `#${m[2].toLowerCase()}`);
  }
  const calculations: StixCalculation[] = [];
  const app = docs.get("projectinfo.json")?.ApplicationModified;
  const year = typeof app === "string" ? Number(app.match(/\b(20\d\d)\b/)?.[1]) : NaN;
  const legacy = Number.isFinite(year) && year < 2024;
  const scenarios = [...docs.entries()].filter(([p]) => /^scenarios\/scenario(_\d+)?\.json$/i.test(p)).sort(([a], [b]) => order(a) - order(b));
  for (const [, sc] of scenarios) {
    const stageList = list(sc.Stages).map((g): StixStage => ({
      label: str(g.Label),
      geometry: doc(g.GeometryId),
      soilLayers: doc(g.SoilLayersId),
      waternet: doc(g.WaternetId),
      state: doc(g.StateId),
      loads: doc(g.LoadsId),
      reinforcements: doc(g.ReinforcementsId),
      ...(typeof g.WaterDefinitionType === "string" ? { waterDefinition: g.WaterDefinitionType } : {}),
    }));
    if (stageList.length === 0) continue;
    for (const c of list(sc.Calculations)) {
      const label = str(c.Label);
      // Files from before 2024 calculated each stage on its own; a
      // converted file names each calculation after its stage. Later
      // versions calculate the last stage.
      const own = legacy ? stageList.findIndex((g) => g.label === label) : -1;
      const upTo = own >= 0 ? own + 1 : stageList.length;
      calculations.push({
        scenario: str(sc.Label),
        label,
        stage: stageList[upTo - 1],
        stages: stageList.slice(0, upTo),
        settings: doc(c.CalculationSettingsId),
        result: doc(c.ResultId),
      });
    }
  }
  return { soils, colours, calculations, ...(typeof app === "string" ? { application: app } : {}) };
}

/** The n of scenario_n.json (0 for scenario.json), for the scenarios' order. */
function order(path: string): number {
  const m = path.match(/_(\d+)\.json$/);
  return m ? Number(m[1]) : 0;
}

/** Read a .stix file. */
export async function readStix(bytes: Uint8Array): Promise<StixFile> {
  if (!isZip(bytes)) throw new Error("Not a .stix project file (expected a ZIP archive).");
  const entries = await readZip(bytes);
  const docs = new Map<string, Json>();
  const text = new TextDecoder();
  for (const [name, data] of entries) {
    if (!name.toLowerCase().endsWith(".json")) continue;
    try {
      const d: unknown = JSON.parse(text.decode(data).replace(/^\uFEFF/, ""));
      // (each document is an object; another value is left out as well)
      if (isObject(d)) docs.set(name.replace(/\\/g, "/").toLowerCase(), d);
    } catch {
      // a document that is not JSON is left out
    }
  }
  if (!docs.has("soils.json")) throw new Error("The .stix file has no soils (soils.json).");
  return parseStixDocuments(docs);
}

/** A number of the file (they write "NaN" for none). */
export function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
}

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** The objects of a list of the file (nothing when it is not a list). */
export function list(v: unknown): Json[] {
  return Array.isArray(v) ? v.filter(isObject) : [];
}

/** A label of the file as text ("" when it is not text or a number). */
function str(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

/** Points [{X, Z}] as [x, y]. */
export function pts(v: unknown): Pt[] {
  return list(v).flatMap((p) => {
    const x = num(p?.X), z = num(p?.Z);
    return x !== undefined && z !== undefined ? [[x, z] as Pt] : [];
  });
}
