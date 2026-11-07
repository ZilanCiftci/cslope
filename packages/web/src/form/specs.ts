/**
 * How the page shows each template: the groups of its form, the short keys
 * of its address, the first visit's values, how the fields' text becomes
 * a parameter set and back, what the drawing draws and where the engine's
 * issues land. The layers, the water level and the safety group are the
 * same for every template (draft.ts, Form.tsx). Pure TypeScript.
 */
import { embankmentTemplate, type EmbankmentParams } from "../templates/embankment";
import { excavationTemplate, type ExcavationParams } from "../templates/excavation";
import type { Fill, Layer, Values } from "../templates/common";
import type { ParameterDescription, Template } from "../templates/types";
import { embankmentShapes, excavationShapes, type SectionShapes } from "../section/section-geometry";
import type { IssueTargets } from "./issues";

/** A group of the form, with its fields' keys. */
export interface GroupSpec {
  /** The group's key; for an optional group, its key in the address ("road=on"). */
  id: string;
  title: string;
  /** The fields, by the keys the template's problems use ("groundLevel", "road.width"). */
  keys: string[];
  /** An optional group: a checkbox shows its fields, which start at `initial`. */
  toggle?: { label: string; title: string; initial: Record<string, string> };
}

/** The fields' values, as a template's `params` reads them. */
export interface Read {
  /** A required number: NaN when empty or not a number. */
  num(key: string): number;
  /** An optional number: null when empty. */
  opt(key: string): number | null;
  /** The optional groups switched on. */
  on: ReadonlySet<string>;
  layers: Layer[];
  values: Values;
  /** Water above the ground stands as ponded (free) water. */
  ponded: boolean;
}

/** `ponded: true` when it is on and there is water; nothing otherwise (the parameter sets of the examples leave it out). */
const pondedOf = (read: Read, water: number | null) => (read.ponded && water !== null ? { ponded: true } : {});

export interface FormSpec<P> {
  template: Template<P>;
  /** The groups before the layers and after them; the safety group ends the form. */
  before: GroupSpec[];
  after: GroupSpec[];
  /** Shorter keys in the address ("H" for excavationDepth). */
  short: Record<string, string>;
  /** The first visit's fields: a plain section the drawing can show, without strengths (B5). */
  initial: Record<string, string>;
  /** The file name of the JSON download. */
  fileName: string;
  /** The drawing's caption: what its axes measure. */
  caption: string;
  params(read: Read): P;
  /** The fields of a parameter set (layers and values aside), and the optional groups on. */
  toFields(params: P): { fields: Record<string, string>; on: string[] };
  /** The fields the drawing needs; the others (strengths, safety) do not change it. */
  geometry: RegExp;
  /** The parameters to draw, with the optional fields the drawing shows left out when `ok` says they are wrong. */
  drawable(params: P, ok: (field: string) => boolean): P;
  shapes(params: P): SectionShapes;
  /** The lowest ground (m): ponded water matters only with the water above it. */
  lowestGround(params: P): number;
  /** What ponded water does in this template, for the checkbox's hint. */
  pondedHint: string;
  /** What the drawing shows, for screen readers: "the excavation: 1 layer, a haul road". */
  describe(params: P): string;
  targets(params: P): IssueTargets;
}

const text = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

function fillOf(read: Read, group: string): Fill {
  return { gamma: read.num(`${group}.gamma`), c: read.num(`${group}.c`), phi: read.num(`${group}.phi`) };
}

function fillFields(fill: Fill, group: string): Record<string, string> {
  return { [`${group}.gamma`]: text(fill.gamma), [`${group}.c`]: text(fill.c), [`${group}.phi`]: text(fill.phi) };
}

const layersText = (layers: Layer[], water: number | null) => `${layers.length === 1 ? "1 layer" : `${layers.length} layers`}${water !== null ? `, ground water at ${water} m` : ""}`;

const layerTargets = (layers: Layer[]) => ({
  materials: layers.map((_, i) => `layers.${i}`),
  regions: layers.map((_, i) => `layers.${i}.bottomLevel`),
});

const fillKeys = (group: string) => ["gamma", "c", "phi"].map((k) => `${group}.${k}`);

export const excavationSpec: FormSpec<ExcavationParams> = {
  template: excavationTemplate,
  before: [{ id: "geometry", title: "Geometry", keys: ["groundLevel", "excavationDepth", "slope", "bottomWidth"] }],
  after: [
    { id: "water", title: "Water", keys: ["waterLevel"] },
    {
      id: "road",
      title: "Haul road",
      keys: ["road.distanceFromCrest", "road.width", "road.height", ...fillKeys("road"), "road.trafficLoad"],
      toggle: {
        label: "Haul road behind the crest",
        title: "A fill on the ground behind the crest, with its own material and an optional traffic load.",
        initial: { "road.distanceFromCrest": "2", "road.width": "4", "road.height": "0.5" },
      },
    },
  ],
  short: { groundLevel: "ground", excavationDepth: "H", waterLevel: "water" },
  initial: { groundLevel: "0", excavationDepth: "3", slope: "1.5" },
  fileName: "cslope-excavation.json",
  caption: "Elevation and distance from the crest (m).",
  params(read) {
    const { num, opt } = read;
    return {
      groundLevel: num("groundLevel"),
      excavationDepth: num("excavationDepth"),
      slope: num("slope"),
      bottomWidth: opt("bottomWidth"),
      layers: read.layers,
      waterLevel: opt("waterLevel"),
      road: read.on.has("road")
        ? { distanceFromCrest: num("road.distanceFromCrest"), width: num("road.width"), height: num("road.height"), fill: fillOf(read, "road"), trafficLoad: opt("road.trafficLoad") }
        : null,
      values: read.values,
      ...pondedOf(read, opt("waterLevel")),
    };
  },
  toFields(p) {
    const fields: Record<string, string> = {
      groundLevel: text(p.groundLevel),
      excavationDepth: text(p.excavationDepth),
      slope: text(p.slope),
      bottomWidth: text(p.bottomWidth),
      waterLevel: text(p.waterLevel),
    };
    if (p.road) {
      Object.assign(fields, {
        "road.distanceFromCrest": text(p.road.distanceFromCrest),
        "road.width": text(p.road.width),
        "road.height": text(p.road.height),
        ...fillFields(p.road.fill, "road"),
        "road.trafficLoad": text(p.road.trafficLoad),
      });
    }
    return { fields, on: p.road ? ["road"] : [] };
  },
  geometry: /^(groundLevel|excavationDepth|slope|bottomWidth|layers|layers\.\d+\.bottomLevel|road\.(distanceFromCrest|width|height))$/,
  drawable: (p, ok) => ({
    ...p,
    waterLevel: ok("waterLevel") ? p.waterLevel : null,
    road: p.road && { ...p.road, trafficLoad: ok("road.trafficLoad") ? p.road.trafficLoad : null },
  }),
  shapes: excavationShapes,
  lowestGround: (p) => p.groundLevel - p.excavationDepth,
  pondedHint: "Water above the ground stands in the excavation as ponded water. Off: the level follows the ground surface and seeps out of the slope.",
  describe: (p) => `the excavation${p.bottomWidth !== null ? `, a trench ${p.bottomWidth} m wide at the bottom` : ""}: ${layersText(p.layers, p.waterLevel)}${p.road ? ", a haul road" : ""}`,
  targets: (p) => {
    const t = layerTargets(p.layers);
    return p.road ? { materials: [...t.materials, "road"], regions: [...t.regions, "road.height"], udl: "road.trafficLoad" } : { ...t, udl: null };
  },
};

export const embankmentSpec: FormSpec<EmbankmentParams> = {
  template: embankmentTemplate,
  before: [
    { id: "geometry", title: "Geometry", keys: ["groundLevel", "embankmentHeight", "crestWidth", "slope"] },
    { id: "embankment", title: "Embankment", keys: [...fillKeys("fill"), "crestLoad"] },
  ],
  after: [{ id: "water", title: "Water", keys: ["waterLevel"] }],
  short: { groundLevel: "ground", embankmentHeight: "h", crestWidth: "B", waterLevel: "water", crestLoad: "q" },
  initial: { groundLevel: "0", embankmentHeight: "3", crestWidth: "6", slope: "2" },
  fileName: "cslope-embankment.json",
  caption: "Elevation, and distance from the crest's right edge (m).",
  params(read) {
    return {
      groundLevel: read.num("groundLevel"),
      embankmentHeight: read.num("embankmentHeight"),
      crestWidth: read.num("crestWidth"),
      slope: read.num("slope"),
      fill: fillOf(read, "fill"),
      crestLoad: read.opt("crestLoad"),
      layers: read.layers,
      waterLevel: read.opt("waterLevel"),
      values: read.values,
      ...pondedOf(read, read.opt("waterLevel")),
    };
  },
  toFields: (p) => ({
    fields: {
      groundLevel: text(p.groundLevel),
      embankmentHeight: text(p.embankmentHeight),
      crestWidth: text(p.crestWidth),
      slope: text(p.slope),
      ...fillFields(p.fill, "fill"),
      crestLoad: text(p.crestLoad),
      waterLevel: text(p.waterLevel),
    },
    on: [],
  }),
  geometry: /^(groundLevel|embankmentHeight|crestWidth|slope|layers|layers\.\d+\.bottomLevel)$/,
  drawable: (p, ok) => ({ ...p, waterLevel: ok("waterLevel") ? p.waterLevel : null, crestLoad: ok("crestLoad") ? p.crestLoad : null }),
  shapes: embankmentShapes,
  lowestGround: (p) => p.groundLevel,
  pondedHint: "Water above the ground stands beside the embankment as ponded water. Off: the level follows the ground surface and seeps out of the slope.",
  describe: (p) => `the embankment: ${layersText(p.layers, p.waterLevel)}${p.crestLoad ? `, a load of ${p.crestLoad} kPa on the crest` : ""}`,
  targets: (p) => {
    const t = layerTargets(p.layers);
    return { materials: [...t.materials, "fill"], regions: [...t.regions, "embankmentHeight"], udl: "crestLoad" };
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySpec = FormSpec<any>;

/** The templates of the page, in the picker's order; the first is the one of a link without `t`. */
export const SPECS: AnySpec[] = [excavationSpec, embankmentSpec];

export type TemplateId = "excavation" | "embankment";

/** The spec of a template id; the excavation's for an unknown one (and an old link without `t`). */
export function specOf(id: string | null | undefined): AnySpec {
  return SPECS.find((s) => s.template.id === id) ?? SPECS[0];
}

/** A field's description: "groundLevel" or "road.width" in the template's parameters. */
export function descOf(spec: AnySpec, key: string): ParameterDescription {
  const [group, name] = key.includes(".") ? key.split(".") : [null, key];
  const params = spec.template.params as Record<string, ParameterDescription | Record<string, ParameterDescription>>;
  const d = group ? (params[group] as Record<string, ParameterDescription>)[name] : params[name];
  if (!d || typeof (d as ParameterDescription).label !== "string") throw new Error(`No parameter "${key}" in ${spec.template.id}`);
  return d as ParameterDescription;
}

/** Every group of a spec, in the form's order. */
export const groupsOf = (spec: AnySpec) => [...spec.before, ...spec.after];
