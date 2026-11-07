/**
 * The form's state: the excavation template's parameters as the user typed
 * them (text), turned into a parameter set with the problems of each field,
 * and written to and read from the page's address, so that a link opens the
 * same section. Pure TypeScript, without React.
 *
 * Strengths and unit weights start empty (decision B5); so do the safety
 * class and η (they are the engineer's choice). The geometry starts at a
 * plain section that the drawing can show.
 */
import {
  excavationFieldProblems,
  EXCAVATION_PARAMETERS,
  type ExcavationParams,
  type Layer,
  type LayerKind,
  type LayerMaterial,
} from "../templates/excavation";
import type { SafetyClass } from "@cslope/engine";

export interface LayerDraft {
  /** A key that stays with the layer while others are added or removed (not a parameter). */
  key: string;
  name: string;
  kind: LayerKind;
  bottomLevel: string;
  gamma: string;
  gammaSat: string;
  su: string;
  suRate: string;
  c: string;
  phi: string;
}

export interface RoadDraft {
  distanceFromCrest: string;
  width: string;
  height: string;
  gamma: string;
  gammaSat: string;
  c: string;
  phi: string;
  trafficLoad: string;
}

export type Basis = "characteristic" | "design";

export interface Draft {
  groundLevel: string;
  excavationDepth: string;
  slope: string;
  bottomWidth: string;
  tensionCrackDepth: string;
  waterLevel: string;
  layers: LayerDraft[];
  road: RoadDraft | null;
  basis: Basis;
  safetyClass: string;
  etaCu: string;
  etaDrained: string;
  variableLoadBase: string;
}

/** The kinds of layer, as the form offers them. */
export const LAYER_KINDS: { kind: LayerKind; label: string }[] = [
  { kind: "undrained", label: "Su constant" },
  { kind: "undrained-increasing", label: "Su increasing" },
  { kind: "drained", label: "Drained c′, φ′" },
  { kind: "impenetrable", label: "Rock" },
];

/** The fields of a layer of each kind, in the form's order. */
export const LAYER_FIELDS: Record<LayerKind, (keyof typeof EXCAVATION_PARAMETERS.layer)[]> = {
  undrained: ["gamma", "su"],
  "undrained-increasing": ["gamma", "su", "suRate"],
  drained: ["gamma", "gammaSat", "c", "phi"],
  impenetrable: ["gamma"],
};

/** A new layer's bottom: 5 m below the last one's, within the bounds; empty when that one has none. */
export function nextBottomLevel(layers: LayerDraft[]): string {
  const last = parseNumber(layers[layers.length - 1]?.bottomLevel ?? "");
  if (last === null || !Number.isFinite(last)) return "";
  const { min, max } = EXCAVATION_PARAMETERS.layer.bottomLevel;
  return String(Math.min(max, Math.max(min, Math.round((last - 5) * 10) / 10)));
}

/** Fields that may be left empty (and what empty means is in their description). */
export const OPTIONAL_FIELDS = new Set(["bottomWidth", "tensionCrackDepth", "waterLevel", "gammaSat", "trafficLoad"]);

let layerKeys = 0;

export function emptyLayer(bottomLevel = ""): LayerDraft {
  return { key: `layer-${++layerKeys}`, name: "", kind: "undrained", bottomLevel, gamma: "", gammaSat: "", su: "", suRate: "", c: "", phi: "" };
}

/** A road as it appears when switched on: its size, without the fill's strength. */
export function newRoad(): RoadDraft {
  return { distanceFromCrest: "2", width: "4", height: "0.5", gamma: "", gammaSat: "", c: "", phi: "", trafficLoad: "" };
}

/** The form on a first visit. */
export function initialDraft(): Draft {
  return {
    groundLevel: "0",
    excavationDepth: "3",
    slope: "1.5",
    bottomWidth: "",
    tensionCrackDepth: "",
    waterLevel: "",
    layers: [{ ...emptyLayer("-15"), name: "Clay" }],
    road: null,
    basis: "characteristic",
    safetyClass: "",
    etaCu: "",
    etaDrained: "",
    variableLoadBase: "",
  };
}

/** A typed number: null when empty, NaN when not a number. A decimal comma is read as a point. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(",", ".").replace("−", "-");
  if (!t) return null;
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) ? Number(t) : NaN;
}

/** What the form makes of a draft. */
export interface FormState {
  /** The parameter set (empty fields are NaN in it): to build when `ready`. */
  params: ExcavationParams;
  /** The problems of fields the user filled in, by field ("layers.0.su"). */
  errors: Map<string, string>;
  /** Fields that must be filled in and are empty. */
  missing: string[];
  /** Nothing missing and no errors: the template can build the document. */
  ready: boolean;
}

/** The fields of a draft, as the keys `excavationFieldProblems` uses, with their text. */
export function draftFields(draft: Draft): [string, string][] {
  const out: [string, string][] = [];
  for (const k of ["groundLevel", "excavationDepth", "slope", "bottomWidth", "tensionCrackDepth", "waterLevel"] as const) out.push([k, draft[k]]);
  draft.layers.forEach((layer, i) => {
    out.push([`layers.${i}.bottomLevel`, layer.bottomLevel]);
    for (const k of LAYER_FIELDS[layer.kind]) out.push([`layers.${i}.${k}`, layer[k]]);
  });
  if (draft.road) for (const [k, v] of Object.entries(draft.road)) out.push([`road.${k}`, v]);
  if (draft.basis === "design") for (const k of ["safetyClass", "etaCu", "etaDrained", "variableLoadBase"] as const) out.push([`values.${k}`, draft[k]]);
  return out;
}

const lastKey = (field: string) => field.slice(field.lastIndexOf(".") + 1);

export function formState(draft: Draft): FormState {
  const num = (text: string) => parseNumber(text) ?? NaN;
  const opt = (text: string) => parseNumber(text);
  const layers: Layer[] = draft.layers.map((l) => {
    const gamma = num(l.gamma);
    let material: LayerMaterial;
    switch (l.kind) {
      case "undrained":
        material = { kind: "undrained", gamma, su: num(l.su) };
        break;
      case "undrained-increasing":
        material = { kind: "undrained-increasing", gamma, su: num(l.su), suRate: num(l.suRate) };
        break;
      case "drained": {
        const gammaSat = opt(l.gammaSat);
        material = { kind: "drained", gamma, c: num(l.c), phi: num(l.phi), ...(gammaSat === null ? {} : { gammaSat }) };
        break;
      }
      case "impenetrable":
        material = { kind: "impenetrable", gamma };
        break;
    }
    return { ...(l.name.trim() ? { name: l.name.trim() } : {}), bottomLevel: num(l.bottomLevel), material };
  });
  const r = draft.road;
  const tension = opt(draft.tensionCrackDepth);
  const params: ExcavationParams = {
    groundLevel: num(draft.groundLevel),
    excavationDepth: num(draft.excavationDepth),
    slope: num(draft.slope),
    bottomWidth: opt(draft.bottomWidth),
    layers,
    waterLevel: opt(draft.waterLevel),
    road: r && {
      distanceFromCrest: num(r.distanceFromCrest),
      width: num(r.width),
      height: num(r.height),
      fill: { gamma: num(r.gamma), c: num(r.c), phi: num(r.phi), ...(opt(r.gammaSat) === null ? {} : { gammaSat: opt(r.gammaSat)! }) },
      trafficLoad: opt(r.trafficLoad),
    },
    values:
      draft.basis === "design"
        ? {
            basis: "design",
            safetyClass: num(draft.safetyClass) as SafetyClass,
            etaCu: num(draft.etaCu),
            etaDrained: num(draft.etaDrained),
            variableLoadBase: num(draft.variableLoadBase),
          }
        : { basis: "characteristic" },
    ...(tension === null ? {} : { tensionCrackDepth: tension }),
  };

  const errors = new Map<string, string>();
  const missing: string[] = [];
  for (const [field, text] of draftFields(draft)) {
    const v = parseNumber(text);
    if (v === null && !OPTIONAL_FIELDS.has(lastKey(field))) missing.push(field);
    else if (v !== null && Number.isNaN(v)) errors.set(field, "Enter a number, such as 1.5.");
  }
  for (const p of excavationFieldProblems(params)) {
    if (missing.includes(p.field) || errors.has(p.field)) continue;
    errors.set(p.field, p.message);
  }
  return { params, errors, missing, ready: !missing.length && !errors.size };
}

// ── The address ────────────────────────────────────────────────────────

/**
 * The draft as the query of the page's address: one key per field that is
 * filled in ("H=4&slope=1.5&layer1.kind=undrained&layer1.su=20"), so that a
 * link is readable and opens the same section. Nothing is sent anywhere.
 */
const SHORT: Record<string, string> = { groundLevel: "ground", excavationDepth: "H", waterLevel: "water", tensionCrackDepth: "crack" };

export function toQuery(draft: Draft): string {
  const q = new URLSearchParams();
  const put = (key: string, value: string) => {
    if (value.trim()) q.set(key, value.trim());
  };
  for (const k of ["groundLevel", "excavationDepth", "slope", "bottomWidth", "tensionCrackDepth", "waterLevel"] as const) put(SHORT[k] ?? k, draft[k]);
  q.set("layers", String(draft.layers.length));
  draft.layers.forEach((l, i) => {
    const p = `layer${i + 1}.`;
    put(p + "name", l.name);
    q.set(p + "kind", l.kind);
    put(p + "bottomLevel", l.bottomLevel);
    for (const k of LAYER_FIELDS[l.kind]) put(p + k, l[k]);
  });
  if (draft.road) {
    q.set("road", "on");
    for (const [k, v] of Object.entries(draft.road)) put(`road.${k}`, v);
  }
  if (draft.basis === "design") {
    q.set("values", "design");
    for (const k of ["safetyClass", "etaCu", "etaDrained", "variableLoadBase"] as const) put(k, draft[k]);
  }
  return q.toString();
}

/** The draft of an address's query; the first visit's draft when it has none. Unknown keys are ignored. */
export function fromQuery(search: string): Draft {
  const q = new URLSearchParams(search);
  const draft = initialDraft();
  if (!q.has("layers")) return draft;
  const get = (key: string) => (q.get(key) ?? "").slice(0, 40);
  for (const k of ["groundLevel", "excavationDepth", "slope", "bottomWidth", "tensionCrackDepth", "waterLevel"] as const) draft[k] = get(SHORT[k] ?? k);
  const count = Math.max(1, Math.min(12, Math.floor(Number(q.get("layers"))) || 1));
  draft.layers = Array.from({ length: count }, (_, i) => {
    const p = `layer${i + 1}.`;
    const kind = LAYER_KINDS.find((k) => k.kind === q.get(p + "kind"))?.kind ?? "undrained";
    const layer: LayerDraft = { ...emptyLayer(get(p + "bottomLevel")), name: get(p + "name"), kind };
    for (const k of LAYER_FIELDS[kind]) layer[k] = get(p + k);
    return layer;
  });
  if (q.get("road") === "on") {
    const road = newRoad();
    for (const k of Object.keys(road) as (keyof RoadDraft)[]) road[k] = get(`road.${k}`);
    draft.road = road;
  }
  if (q.get("values") === "design") {
    draft.basis = "design";
    for (const k of ["safetyClass", "etaCu", "etaDrained", "variableLoadBase"] as const) draft[k] = get(k);
    // "2.0" is class 2, which the form's buttons show as "2".
    const c = parseNumber(draft.safetyClass);
    if (c !== null && Number.isFinite(c)) draft.safetyClass = String(c);
  }
  return draft;
}

/** The draft of a parameter set (the form filled in with it). */
export function draftOf(params: ExcavationParams): Draft {
  const t = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  const v = params.values;
  return {
    groundLevel: t(params.groundLevel),
    excavationDepth: t(params.excavationDepth),
    slope: t(params.slope),
    bottomWidth: t(params.bottomWidth),
    tensionCrackDepth: t(params.tensionCrackDepth),
    waterLevel: t(params.waterLevel),
    layers: params.layers.map((l) => {
      const m = l.material;
      return {
        ...emptyLayer(t(l.bottomLevel)),
        name: l.name ?? "",
        kind: m.kind,
        gamma: t(m.gamma),
        gammaSat: m.kind === "drained" ? t(m.gammaSat) : "",
        su: m.kind === "undrained" || m.kind === "undrained-increasing" ? t(m.su) : "",
        suRate: m.kind === "undrained-increasing" ? t(m.suRate) : "",
        c: m.kind === "drained" ? t(m.c) : "",
        phi: m.kind === "drained" ? t(m.phi) : "",
      };
    }),
    road: params.road && {
      distanceFromCrest: t(params.road.distanceFromCrest),
      width: t(params.road.width),
      height: t(params.road.height),
      gamma: t(params.road.fill.gamma),
      gammaSat: t(params.road.fill.gammaSat),
      c: t(params.road.fill.c),
      phi: t(params.road.fill.phi),
      trafficLoad: t(params.road.trafficLoad),
    },
    basis: v.basis,
    safetyClass: v.basis === "design" ? t(v.safetyClass) : "",
    etaCu: v.basis === "design" ? t(v.etaCu) : "",
    etaDrained: v.basis === "design" ? t(v.etaDrained) : "",
    variableLoadBase: v.basis === "design" ? t(v.variableLoadBase) : "",
  };
}
