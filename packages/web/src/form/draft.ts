/**
 * The form's state: a template's parameters as the user typed them (text),
 * turned into a parameter set with the problems of each field, and written
 * to and read from the page's address, so that a link opens the same
 * section of the same template. Pure TypeScript, without React. What each
 * template's fields are is in specs.ts; the layers are the same for every
 * template. The values are characteristic: F is a factor of safety.
 *
 * The excavation starts at a complete section (its defaults), so that the
 * page computes F at once; the embankment's strengths and unit weights
 * start empty, its geometry at a plain section that the drawing can show.
 */
import { MATERIAL_MODEL_LABELS } from "@cslope/engine";
import { LAYER_PARAMETERS, type Layer, type LayerMaterial } from "../templates/common";
import { defaultLayerColor, LAYER_COLORS, layerColorOf } from "../templates/colors";
import { bottomLevels, newThickness, thicknesses, thicknessProblems } from "./layers";
import { groupsOf, specOf, type GroupSpec, type TemplateId } from "./specs";

export type { TemplateId } from "./specs";

/**
 * A layer's material model, as the app names them (MATERIAL_MODEL_LABELS):
 * Undrained (Su, increasing with depth when the rate is filled in),
 * Mohr-Coulomb (c′, φ′) or Impenetrable (bedrock). The template's own
 * kinds split Undrained in two: constant and increasing.
 */
export type LayerModel = "undrained" | "mohr-coulomb" | "impenetrable";

export interface LayerDraft {
  /** A key that stays with the layer while others are added or removed (not a parameter). */
  key: string;
  name: string;
  kind: LayerModel;
  /** The thickness (m): the layers stack down from the ground level. */
  thickness: string;
  /** The color in the drawing, one of LAYER_COLORS ("#d4a373"); it stays with the layer when the layers are reordered. */
  color: string;
  gamma: string;
  su: string;
  suRate: string;
  c: string;
  phi: string;
}

export interface Draft {
  /** The template's id: "excavation", "embankment". */
  template: TemplateId;
  /** The template's own fields, by the keys its problems use ("groundLevel", "road.width", "fill.c"). */
  fields: Record<string, string>;
  /** The optional groups switched on ("road"). */
  on: string[];
  layers: LayerDraft[];
  /** Water above the ground stands as ponded (free) water. */
  ponded: boolean;
}

/** The material models of a layer, as the form offers them, with the app's names. */
export const LAYER_KINDS: { kind: LayerModel; label: string }[] = (["undrained", "mohr-coulomb", "impenetrable"] as const).map((kind) => ({
  kind,
  label: MATERIAL_MODEL_LABELS[kind],
}));

/** The fields of a layer of each model, in the form's order. */
export const LAYER_FIELDS: Record<LayerModel, Exclude<keyof typeof LAYER_PARAMETERS, "bottomLevel">[]> = {
  undrained: ["gamma", "su", "suRate"],
  "mohr-coulomb": ["gamma", "c", "phi"],
  impenetrable: ["gamma"],
};

/** A layer's strength in a few words, from the text typed: "Su 18 kPa, +1.2 kPa/m", "c′ 3 kPa, φ′ 30°"; empty values are left out. */
export function strengthSummary(layer: LayerDraft): string {
  const v = (t: string) => t.trim();
  switch (layer.kind) {
    case "undrained":
      return [v(layer.su) && `Su ${v(layer.su)} kPa`, v(layer.su) && v(layer.suRate) && `+${v(layer.suRate)} kPa/m`].filter(Boolean).join(", ");
    case "mohr-coulomb":
      return [v(layer.c) && `c′ ${v(layer.c)} kPa`, v(layer.phi) && `φ′ ${v(layer.phi)}°`].filter(Boolean).join(", ");
    case "impenetrable":
      return "";
  }
}

/** The bottom level of each layer of a draft (NaN where a thickness, or the ground, is not a number). */
export function draftLevels(draft: Draft): number[] {
  return bottomLevels(parseNumber(draft.fields.groundLevel ?? "") ?? NaN, draft.layers.map((l) => parseNumber(l.thickness) ?? NaN));
}

/** A layer added at the bottom is 5 m thick, one inserted 1 m, less when the lowest level (−100 m) is closer. */
export const ADDED_THICKNESS = 5;
export const INSERTED_THICKNESS = 1;

/** The color of a layer new at `index`: its position's, or the first swatch no other layer has. */
export function nextColor(layers: LayerDraft[], index: number): string {
  const used = new Set(layers.map((l) => l.color));
  const own = defaultLayerColor(index);
  if (!used.has(own)) return own;
  return LAYER_COLORS.find((c) => !used.has(c.color))?.color ?? own;
}

/** The layers with a new one at `index` (at the bottom when it is the count), its thickness and color chosen; the layers below move down by it. */
export function withNewLayer(draft: Draft, index: number): { layers: LayerDraft[]; layer: LayerDraft } {
  const base = draftLevels(draft).at(-1) ?? NaN;
  const atEnd = index >= draft.layers.length;
  const layer = emptyLayer(newThickness(base, atEnd ? ADDED_THICKNESS : INSERTED_THICKNESS), nextColor(draft.layers, index));
  const layers = [...draft.layers];
  layers.splice(index, 0, layer);
  return { layers, layer };
}

/** The layers with the one at `from` moved to `to` (the thicknesses move with their layers, so the levels follow). */
export function moveLayer(layers: LayerDraft[], from: number, to: number): LayerDraft[] {
  if (to < 0 || to >= layers.length || from === to) return layers;
  const out = [...layers];
  const [layer] = out.splice(from, 1);
  out.splice(to, 0, layer);
  return out;
}

/** Fields that may be left empty, by their last key, with what empty means (the placeholder). */
export const OPTIONAL_FIELDS: Record<string, string> = {
  bottomWidth: "Wide",
  waterLevel: "Dry",
  suRate: "Constant",
  trafficLoad: "None",
  crestLoad: "None",
};

const lastKey = (field: string) => field.slice(field.lastIndexOf(".") + 1);
/** What an empty optional field means, or undefined for a required field. */
export const emptyText = (field: string): string | undefined => OPTIONAL_FIELDS[lastKey(field)];

let layerKeys = 0;

export function emptyLayer(thickness = "", color: string = defaultLayerColor(0)): LayerDraft {
  return { key: `layer-${++layerKeys}`, name: "", kind: "undrained", thickness, color, gamma: "", su: "", suRate: "", c: "", phi: "" };
}

/** The form on a first visit of a template. */
export function initialDraft(template: TemplateId = "excavation"): Draft {
  const spec = specOf(template);
  if (spec.defaults) return draftOf(spec.template.id as TemplateId, spec.defaults);
  return {
    template: spec.template.id as TemplateId,
    fields: { ...spec.initial },
    on: [],
    layers: [{ ...emptyLayer("15"), name: "Clay" }],
    ponded: false,
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
    out.push([`layers.${i}.thickness`, layer.thickness]);
    for (const k of LAYER_FIELDS[layer.kind]) out.push([`layers.${i}.${k}`, layer[k]]);
  });
  spec.after.filter(shownGroup(draft)).forEach(group);
  return out;
}

const required = (text: string) => parseNumber(text) ?? NaN;

function layerOf(l: LayerDraft, index: number, bottomLevel: number): Layer {
  const gamma = required(l.gamma);
  let material: LayerMaterial;
  switch (l.kind) {
    case "undrained": {
      // An empty rate: Su constant; a rate: Su increasing with depth.
      const suRate = parseNumber(l.suRate);
      material = suRate === null ? { kind: "undrained", gamma, su: required(l.su) } : { kind: "undrained-increasing", gamma, su: required(l.su), suRate };
      break;
    }
    case "mohr-coulomb": {
      material = { kind: "drained", gamma, c: required(l.c), phi: required(l.phi) };
      break;
    }
    case "impenetrable":
      material = { kind: "impenetrable", gamma };
      break;
  }
  return { ...(l.name.trim() ? { name: l.name.trim() } : {}), bottomLevel, material, ...(l.color !== defaultLayerColor(index) ? { color: l.color } : {}) };
}

export function formState(draft: Draft): FormState {
  const spec = specOf(draft.template);
  const levels = draftLevels(draft);
  const params = spec.params({
    num: (k) => required(draft.fields[k] ?? ""),
    opt: (k) => parseNumber(draft.fields[k] ?? ""),
    on: new Set(draft.on),
    layers: draft.layers.map((l, i) => layerOf(l, i, levels[i])),
    ponded: draft.ponded,
  });
  const errors = new Map<string, string>();
  const missing: string[] = [];
  for (const [field, text] of draftFields(draft)) {
    const v = parseNumber(text);
    if (v === null && emptyText(field) === undefined) missing.push(field);
    else if (v !== null && Number.isNaN(v)) errors.set(field, "Enter a number, such as 1.5.");
  }
  // The thicknesses, checked by the template's rules on the levels, worded for a thickness. The ground's own problem comes first.
  const groundOk = !missing.includes("groundLevel") && !errors.has("groundLevel") && !spec.template.fieldProblems(params).some((p) => p.field === "groundLevel");
  const ground = groundOk ? params.groundLevel : NaN;
  const avoid = spec.avoidLevel?.(params);
  for (const p of thicknessProblems(ground, draft.layers.map((l) => parseNumber(l.thickness)), avoid ?? null)) {
    const field = `layers.${p.index}.thickness`;
    if (!errors.has(field)) errors.set(field, p.message);
  }
  for (const p of spec.template.fieldProblems(params)) {
    // A level's problem is at the layer's thickness (it has its own sentence there); none while the ground is wrong.
    const level = /^layers\.(\d+)\.bottomLevel$/.exec(p.field);
    const field = level ? `layers.${level[1]}.thickness` : p.field;
    if (level && !groundOk) continue;
    if (missing.includes(field) || errors.has(field)) continue;
    errors.set(field, p.message);
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
    put(p + "t", l.thickness);
    for (const k of LAYER_FIELDS[l.kind]) put(p + k, l[k]);
    if (l.color !== defaultLayerColor(i)) q.set(p + "color", l.color.slice(1));
  });
  if (draft.ponded && draft.fields.waterLevel?.trim()) q.set("pond", "1");
  for (const g of groups.filter((g) => g.toggle && draft.on.includes(g.id))) {
    q.set(g.id, "on");
    for (const k of g.keys) put(spec.short[k] ?? k, draft.fields[k]);
  }
  return q.toString();
}

/**
 * The draft of an address's query; the template's first visit when it has
 * no fields. A query without "t" is the excavation's; unknown keys are
 * ignored.
 */
export function fromQuery(search: string): Draft {
  const q = new URLSearchParams(search);
  const spec = specOf(q.get("t"));
  const draft = initialDraft(spec.template.id as TemplateId);
  if (!q.has("layers")) return draft;
  const get = (key: string) => (q.get(key) ?? "").slice(0, 40);
  // The address says everything: the first visit's groups (the excavation's road) are on only when it says so.
  draft.fields = {};
  draft.on = [];
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
    const given = q.get(p + "kind") ?? "";
    const kind = Object.hasOwn(LAYER_FIELDS, given) ? (given as LayerModel) : "undrained";
    const layer: LayerDraft = { ...emptyLayer(get(p + "t"), layerColorOf(q.get(p + "color")) ?? defaultLayerColor(i)), name: get(p + "name"), kind };
    for (const k of LAYER_FIELDS[kind]) layer[k] = get(p + k);
    return layer;
  });
  draft.ponded = q.get("pond") === "1";
  return draft;
}

/** The app's material model of a template's layer material. */
function modelOf(m: LayerMaterial): LayerModel {
  return m.kind === "drained" ? "mohr-coulomb" : m.kind === "undrained-increasing" ? "undrained" : m.kind;
}

/** The draft of a template's parameter set (the form filled in with it). */
export function draftOf(template: TemplateId, params: { groundLevel: number; layers: Layer[]; ponded?: boolean }): Draft {
  const t = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  const { fields, on } = specOf(template).toFields(params);
  const ts = thicknesses(params.groundLevel, params.layers.map((l) => l.bottomLevel));
  return {
    template,
    fields,
    on,
    layers: params.layers.map((l, i) => {
      const m = l.material;
      return {
        ...emptyLayer(t(ts[i]), l.color ?? defaultLayerColor(i)),
        name: l.name ?? "",
        kind: modelOf(m),
        gamma: t(m.gamma),
        su: m.kind === "undrained" || m.kind === "undrained-increasing" ? t(m.su) : "",
        suRate: m.kind === "undrained-increasing" ? t(m.suRate) : "",
        c: m.kind === "drained" ? t(m.c) : "",
        phi: m.kind === "drained" ? t(m.phi) : "",
      };
    }),
    ponded: params.ponded === true,
  };
}
