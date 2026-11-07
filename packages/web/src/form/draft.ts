/**
 * The form's state: a template's parameters as the user typed them (text),
 * turned into a parameter set with the problems of each field, and written
 * to and read from the page's address, so that a link opens the same
 * section of the same template. Pure TypeScript, without React. What each
 * template's fields are is in specs.ts; the layers and the safety values
 * are the same for every template.
 *
 * Strengths and unit weights start empty (decision B5); so do the safety
 * class and η (they are the engineer's choice). The geometry starts at a
 * plain section that the drawing can show.
 */
import type { SafetyClass } from "@cslope/engine";
import { LAYER_PARAMETERS, type Layer, type LayerKind, type LayerMaterial, type Values } from "../templates/common";
import { groupsOf, specOf, type GroupSpec, type TemplateId } from "./specs";

export type { TemplateId } from "./specs";

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

export type Basis = "characteristic" | "design";

export interface Draft {
  /** The template's id: "excavation", "embankment". */
  template: TemplateId;
  /** The template's own fields, by the keys its problems use ("groundLevel", "road.width", "fill.c"). */
  fields: Record<string, string>;
  /** The optional groups switched on ("road"). */
  on: string[];
  layers: LayerDraft[];
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
export const LAYER_FIELDS: Record<LayerKind, (keyof typeof LAYER_PARAMETERS)[]> = {
  undrained: ["gamma", "su"],
  "undrained-increasing": ["gamma", "su", "suRate"],
  drained: ["gamma", "gammaSat", "c", "phi"],
  impenetrable: ["gamma"],
};

const VALUE_KEYS = ["safetyClass", "etaCu", "etaDrained", "variableLoadBase"] as const;

/** A new layer's bottom: 5 m below the last one's, within the bounds; empty when that one has none. */
export function nextBottomLevel(layers: LayerDraft[]): string {
  const last = parseNumber(layers[layers.length - 1]?.bottomLevel ?? "");
  if (last === null || !Number.isFinite(last)) return "";
  const { min, max } = LAYER_PARAMETERS.bottomLevel;
  return String(Math.min(max, Math.max(min, Math.round((last - 5) * 10) / 10)));
}

/** Fields that may be left empty, by their last key, with what empty means (the placeholder). */
export const OPTIONAL_FIELDS: Record<string, string> = {
  bottomWidth: "As needed",
  tensionCrackDepth: "None",
  waterLevel: "Dry",
  gammaSat: "As γ",
  trafficLoad: "None",
  crestLoad: "None",
};

const lastKey = (field: string) => field.slice(field.lastIndexOf(".") + 1);
/** What an empty optional field means, or undefined for a required field. */
export const emptyText = (field: string): string | undefined => OPTIONAL_FIELDS[lastKey(field)];

let layerKeys = 0;

export function emptyLayer(bottomLevel = ""): LayerDraft {
  return { key: `layer-${++layerKeys}`, name: "", kind: "undrained", bottomLevel, gamma: "", gammaSat: "", su: "", suRate: "", c: "", phi: "" };
}

/** The form on a first visit of a template. */
export function initialDraft(template: TemplateId = "excavation"): Draft {
  const spec = specOf(template);
  return {
    template: spec.template.id as TemplateId,
    fields: { ...spec.initial },
    on: [],
    layers: [{ ...emptyLayer("-15"), name: "Clay" }],
    basis: "characteristic",
    safetyClass: "",
    etaCu: "",
    etaDrained: "",
    variableLoadBase: "",
  };
}

/** The draft with an optional group switched on (its fields from their start) or off. */
export function withGroup(draft: Draft, id: string, on: boolean): Draft {
  const group = groupsOf(specOf(draft.template)).find((g) => g.id === id);
  if (!group?.toggle) return draft;
  const fields = { ...draft.fields };
  for (const k of group.keys) fields[k] = on ? (group.toggle.initial[k] ?? "") : "";
  return { ...draft, fields, on: on ? [...new Set([...draft.on, id])] : draft.on.filter((g) => g !== id) };
}

/** A typed number: null when empty, NaN when not a number. A decimal comma is read as a point. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(",", ".").replace("−", "-");
  if (!t) return null;
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) ? Number(t) : NaN;
}

/** What the form makes of a draft. */
export interface FormState {
  /** The template's parameter set (empty fields are NaN in it): to build when `ready`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any;
  /** The problems of fields the user filled in, by field ("layers.0.su"). */
  errors: Map<string, string>;
  /** Fields that must be filled in and are empty. */
  missing: string[];
  /** Nothing missing and no errors: the template can build the document. */
  ready: boolean;
}

const shownGroup = (draft: Draft) => (g: GroupSpec) => !g.toggle || draft.on.includes(g.id);

/** The fields the form shows, as the keys of the template's problems, with their text. */
export function draftFields(draft: Draft): [string, string][] {
  const spec = specOf(draft.template);
  const out: [string, string][] = [];
  const group = (g: GroupSpec) => g.keys.forEach((k) => out.push([k, draft.fields[k] ?? ""]));
  spec.before.filter(shownGroup(draft)).forEach(group);
  draft.layers.forEach((layer, i) => {
    out.push([`layers.${i}.bottomLevel`, layer.bottomLevel]);
    for (const k of LAYER_FIELDS[layer.kind]) out.push([`layers.${i}.${k}`, layer[k]]);
  });
  spec.after.filter(shownGroup(draft)).forEach(group);
  if (draft.basis === "design") for (const k of VALUE_KEYS) out.push([`values.${k}`, draft[k]]);
  return out;
}

const required = (text: string) => parseNumber(text) ?? NaN;

function layerOf(l: LayerDraft): Layer {
  const gamma = required(l.gamma);
  let material: LayerMaterial;
  switch (l.kind) {
    case "undrained":
      material = { kind: "undrained", gamma, su: required(l.su) };
      break;
    case "undrained-increasing":
      material = { kind: "undrained-increasing", gamma, su: required(l.su), suRate: required(l.suRate) };
      break;
    case "drained": {
      const gammaSat = parseNumber(l.gammaSat);
      material = { kind: "drained", gamma, c: required(l.c), phi: required(l.phi), ...(gammaSat === null ? {} : { gammaSat }) };
      break;
    }
    case "impenetrable":
      material = { kind: "impenetrable", gamma };
      break;
  }
  return { ...(l.name.trim() ? { name: l.name.trim() } : {}), bottomLevel: required(l.bottomLevel), material };
}

function valuesOf(draft: Draft): Values {
  return draft.basis === "design"
    ? {
        basis: "design",
        safetyClass: required(draft.safetyClass) as SafetyClass,
        etaCu: required(draft.etaCu),
        etaDrained: required(draft.etaDrained),
        variableLoadBase: required(draft.variableLoadBase),
      }
    : { basis: "characteristic" };
}

export function formState(draft: Draft): FormState {
  const spec = specOf(draft.template);
  const params = spec.params({
    num: (k) => required(draft.fields[k] ?? ""),
    opt: (k) => parseNumber(draft.fields[k] ?? ""),
    on: new Set(draft.on),
    layers: draft.layers.map(layerOf),
    values: valuesOf(draft),
  });
  const errors = new Map<string, string>();
  const missing: string[] = [];
  for (const [field, text] of draftFields(draft)) {
    const v = parseNumber(text);
    if (v === null && emptyText(field) === undefined) missing.push(field);
    else if (v !== null && Number.isNaN(v)) errors.set(field, "Enter a number, such as 1.5.");
  }
  for (const p of spec.template.fieldProblems(params)) {
    if (missing.includes(p.field) || errors.has(p.field)) continue;
    errors.set(p.field, p.message);
  }
  return { params, errors, missing, ready: !missing.length && !errors.size };
}

// ── The address ────────────────────────────────────────────────────────

/**
 * The draft as the query of the page's address: the template ("t") and
 * one key per field that is filled in ("t=excavation&H=4&slope=1.5&
 * layer1.kind=undrained&layer1.su=20"), so that a link is readable and
 * opens the same section. Nothing is sent anywhere.
 */
export function toQuery(draft: Draft): string {
  const spec = specOf(draft.template);
  const q = new URLSearchParams();
  const put = (key: string, value: string | undefined) => {
    if (value?.trim()) q.set(key, value.trim());
  };
  q.set("t", spec.template.id);
  const groups = groupsOf(spec);
  for (const g of groups.filter((g) => !g.toggle)) for (const k of g.keys) put(spec.short[k] ?? k, draft.fields[k]);
  q.set("layers", String(draft.layers.length));
  draft.layers.forEach((l, i) => {
    const p = `layer${i + 1}.`;
    put(p + "name", l.name);
    q.set(p + "kind", l.kind);
    put(p + "bottomLevel", l.bottomLevel);
    for (const k of LAYER_FIELDS[l.kind]) put(p + k, l[k]);
  });
  for (const g of groups.filter((g) => g.toggle && draft.on.includes(g.id))) {
    q.set(g.id, "on");
    for (const k of g.keys) put(spec.short[k] ?? k, draft.fields[k]);
  }
  if (draft.basis === "design") {
    q.set("values", "design");
    for (const k of VALUE_KEYS) put(k, draft[k]);
  }
  return q.toString();
}

/**
 * The draft of an address's query; the template's first visit when it has
 * no fields. A query without "t" (an older link) is the excavation's.
 * Unknown keys are ignored.
 */
export function fromQuery(search: string): Draft {
  const q = new URLSearchParams(search);
  const spec = specOf(q.get("t"));
  const draft = initialDraft(spec.template.id as TemplateId);
  if (!q.has("layers")) return draft;
  const get = (key: string) => (q.get(key) ?? "").slice(0, 40);
  draft.fields = {};
  for (const g of groupsOf(spec)) {
    if (g.toggle) {
      if (q.get(g.id) !== "on") continue;
      draft.on.push(g.id);
    }
    for (const k of g.keys) draft.fields[k] = get(spec.short[k] ?? k);
  }
  const count = Math.max(1, Math.min(12, Math.floor(Number(q.get("layers"))) || 1));
  draft.layers = Array.from({ length: count }, (_, i) => {
    const p = `layer${i + 1}.`;
    const kind = LAYER_KINDS.find((k) => k.kind === q.get(p + "kind"))?.kind ?? "undrained";
    const layer: LayerDraft = { ...emptyLayer(get(p + "bottomLevel")), name: get(p + "name"), kind };
    for (const k of LAYER_FIELDS[kind]) layer[k] = get(p + k);
    return layer;
  });
  if (q.get("values") === "design") {
    draft.basis = "design";
    for (const k of VALUE_KEYS) draft[k] = get(k);
    // "2.0" is class 2, which the form's buttons show as "2".
    const c = parseNumber(draft.safetyClass);
    if (c !== null && Number.isFinite(c)) draft.safetyClass = String(c);
  }
  return draft;
}

/** The draft of a template's parameter set (the form filled in with it). */
export function draftOf(template: TemplateId, params: { layers: Layer[]; values: Values }): Draft {
  const t = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  const v = params.values;
  const { fields, on } = specOf(template).toFields(params);
  return {
    template,
    fields,
    on,
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
    basis: v.basis,
    safetyClass: v.basis === "design" ? t(v.safetyClass) : "",
    etaCu: v.basis === "design" ? t(v.etaCu) : "",
    etaDrained: v.basis === "design" ? t(v.etaDrained) : "",
    variableLoadBase: v.basis === "design" ? t(v.variableLoadBase) : "",
  };
}
