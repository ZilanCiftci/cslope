/**
 * The first template: an excavation in clay with a working road. The
 * ground is level, in horizontal layers; the excavation has a slope 1:n
 * and a flat bottom; the ground water is a level; a working road (a fill
 * with an optional traffic load, decision B3) may stand behind the crest.
 * F is a factor of safety on characteristic values, or an over-design
 * factor on design values with Swedish partial factors from the safety
 * class (B4). No strength has a default (B5).
 *
 * Geometry (x to the right, y up, m; the slope slides to the right):
 *
 *   ground ─── road ─── crest (0, G)
 *                          ╲ 1:n
 *                           toe (nH, G − H) ─── bottom ─── edge
 *
 * - The model reaches EXTENT_FACTOR × its depth (ground to base), and at
 *   least 3H, beyond the crest (beyond the road when there is one) and
 *   beyond the toe; its base is 2H below the bottom, or the deepest layer's
 *   bottom when that is deeper. A test widens every example 2× and finds
 *   F unchanged.
 * - Each layer level is a vertex of the outline at the left edge and at
 *   the slope face (or the right edge, below the bottom), and its interior
 *   boundary runs between those two vertices; one region assignment per
 *   layer on the ground side (a layer under the bottom is one region with
 *   its ground side).
 * - Layers are at least 5 cm thick, and no level is within 5 cm of the
 *   excavation bottom.
 * - The road is its own region above the ground, with the fill material,
 *   its sides 1:1.5 and the near edge of its top at the given distance
 *   behind the crest (its side cut at the crest when closer), and a
 *   vertical distributed load over the width of its top.
 * - Water: a level, cut at the ground (no free water).
 * - Surfaces enter left of the crest (on the ground and the road) and exit
 *   anywhere from the crest to the right edge (on the face or in the
 *   bottom); the app's options (D-23) with the given tension crack depth.
 */
import type { PartialFactors, SafetyClass } from "@cslope/engine";
import type { AnalysisDocument } from "../engine/document";
import { Definition, type Point, type Strength } from "./builder";
import { swedishPartialFactors } from "./partial-factors";
import type { ParameterDescription, Template } from "./types";

/** A parameter's bounds (the tests draw values within them). */
export type ParameterDescriptionLike = Pick<ParameterDescription, "min" | "max" | "step">;

/** A layer's material: the kind names the fields. */
export type LayerMaterial =
  | { kind: "undrained"; gamma: number; su: number }
  | {
      /** Su is `su` at the top of the layer and grows by `suRate` per meter below it (by elevation: the profile the clay had before the excavation). */
      kind: "undrained-increasing";
      gamma: number;
      su: number;
      suRate: number;
    }
  | {
      kind: "drained";
      gamma: number;
      /** The unit weight below the water (kN/m³); not set: `gamma`. */
      gammaSat?: number;
      c: number;
      phi: number;
    }
  | { kind: "impenetrable"; gamma: number };

export type LayerKind = LayerMaterial["kind"];

export interface Layer {
  /** The name in the results; default "Layer n". */
  name?: string;
  /** The elevation of the layer's bottom (m). The last layer goes on down to the model's base when that is deeper (a note says so). */
  bottomLevel: number;
  material: LayerMaterial;
}

export interface Road {
  /** From the crest to the near edge of the road's top, where the load starts (m). */
  distanceFromCrest: number;
  /** The width of the road's top (m). */
  width: number;
  /** The height of the fill above the ground (m). */
  height: number;
  /** The fill, drained. */
  fill: { gamma: number; gammaSat?: number; c: number; phi: number };
  /** The traffic load q over the road's width (kPa); null: none. */
  trafficLoad: number | null;
}

/** Characteristic values (F a factor of safety) or design values (F an over-design factor). */
export type Values =
  | { basis: "characteristic" }
  | { basis: "design"; safetyClass: SafetyClass; etaCu: number; etaDrained: number; variableLoadBase: number };

export interface ExcavationParams {
  /** The elevation of the ground (m). */
  groundLevel: number;
  /** H, the depth of the excavation (m). */
  excavationDepth: number;
  /** n in 1:n, horizontal per vertical. */
  slope: number;
  /** The bottom from the toe to the model's edge (m); null: as far as the model needs. More is modelled when the model needs it (a note says so). */
  bottomWidth: number | null;
  /** From the top down; the first starts at the ground. */
  layers: Layer[];
  /** The ground-water level (m); null: dry. */
  waterLevel: number | null;
  road: Road | null;
  values: Values;
  /**
   * The depth of a tension crack (m), an analysis option; not set: 0, the
   * app's default. The engine warns when a crack is deeper than it should
   * be; the page (#89) shows the run's warnings with F.
   */
  tensionCrackDepth?: number;
}

const p = (name: string, label: string, unit: string | null, min: number, max: number, step: number, description: string): ParameterDescription => ({
  name,
  label,
  unit,
  min,
  max,
  step,
  description,
});

/** The parameters, with their bounds: the form renders from these. */
export const EXCAVATION_PARAMETERS = {
  groundLevel: p("groundLevel", "Ground level (m)", "m", -100, 1000, 0.1, "The elevation of the ground surface; the levels of the layers and the water are elevations too."),
  excavationDepth: p("excavationDepth", "Excavation depth H (m)", "m", 0.5, 20, 0.1, "From the ground to the bottom of the excavation."),
  slope: p("slope", "Slope 1:n", null, 0.5, 5, 0.1, "n horizontal per 1 vertical: 1:2 is flatter than 1:1."),
  bottomWidth: p("bottomWidth", "Bottom width (m)", "m", 1, 300, 0.5, "The flat bottom from the toe to the edge of the model; as wide as the model needs when left out, and never narrower."),
  tensionCrackDepth: p("tensionCrackDepth", "Tension crack depth (m)", "m", 0, 10, 0.1, "A dry tension crack at the top of each slip surface; 0 for none, as in the app."),
  waterLevel: p("waterLevel", "Ground-water level (m)", "m", -100, 1000, 0.1, "The elevation of the ground water, cut at the ground; leave out for a dry slope."),
  layer: {
    bottomLevel: p("bottomLevel", "Bottom level (m)", "m", -100, 1000, 0.1, "The elevation of the layer's bottom. A layer is at least 0.05 m thick and does not end within 0.05 m of the excavation bottom."),
    gamma: p("gamma", "Unit weight γ (kN/m³)", "kN/m³", 10, 25, 0.1, "Above the water, and below it for clay and rock."),
    gammaSat: p("gammaSat", "Saturated unit weight γsat (kN/m³)", "kN/m³", 10, 25, 0.1, "Below the water, for a drained layer; γ when left out."),
    su: p("su", "Su (kPa)", "kPa", 1, 500, 0.5, "The undrained shear strength; for a growing profile, its value at the top of the layer."),
    suRate: p("suRate", "Su increase (kPa/m)", "kPa/m", 0, 10, 0.1, "The growth of Su per meter below the top of the layer (by elevation)."),
    c: p("c", "c′ (kPa)", "kPa", 0, 100, 0.5, "The effective cohesion."),
    phi: p("phi", "φ′ (°)", "°", 5, 45, 0.5, "The effective friction angle."),
  },
  road: {
    distanceFromCrest: p("distanceFromCrest", "Distance from the crest to the road (m)", "m", 0, 50, 0.5, "From the crest to the near edge of the road's top, where the load starts; the fill's side goes down 1:1.5 from there, cut at the crest."),
    width: p("width", "Width (m)", "m", 2, 20, 0.5, "The width of the road's top; the load acts over it."),
    height: p("height", "Height (m)", "m", 0.2, 5, 0.1, "The height of the fill above the ground; its sides are 1:1.5."),
    gamma: p("gamma", "Fill unit weight γ (kN/m³)", "kN/m³", 15, 24, 0.1, "Above the water."),
    gammaSat: p("gammaSat", "Fill saturated unit weight γsat (kN/m³)", "kN/m³", 15, 24, 0.1, "Below the water; γ when left out."),
    c: p("c", "Fill c′ (kPa)", "kPa", 0, 20, 0.5, "The effective cohesion of the fill."),
    phi: p("phi", "Fill φ′ (°)", "°", 25, 45, 0.5, "The effective friction angle of the fill."),
    trafficLoad: p("trafficLoad", "Traffic load q (kPa)", "kPa", 0, 50, 1, "A vertical load over the road's width, a variable load; leave out for none."),
  },
  design: {
    etaCu: p("etaCu", "η undrained", null, 0.5, 1.2, 0.05, "The conversion factor on Su: γcu = 1.5 / η."),
    etaDrained: p("etaDrained", "η drained", null, 0.5, 1.2, 0.05, "The conversion factor on c′ and tan φ′: γc′ = γφ′ = 1.3 / η."),
    variableLoadBase: p("variableLoadBase", "γQ / γd", null, 1, 1.5, 0.1, "γQ = this factor × γd: variable loads Q_d = γQ γd Q_k, γd = 0.83, 0.91, 1.0 in safety class 1, 2, 3. The governing document decides γQ."),
  },
} satisfies Template<ExcavationParams>["params"];

/** The sides of the road's fill: horizontal per vertical. */
export const ROAD_FILL_SLOPE = 1.5;
/** A layer is at least this thick, and no level comes closer than this to the excavation bottom (m). */
export const MIN_LAYER_THICKNESS = 0.05;
/**
 * Each side of the model reaches this many times the model's depth (ground
 * to base), and at least 3H: a slip circle through a deep soft layer
 * reaches far, and an edge too close cuts it off and raises F (the review
 * found 1–4 %). A test widens every example 2× and finds F unchanged.
 */
export const EXTENT_FACTOR = 1.5;
/** The fill's near toe snaps to the crest when closer than this (m), so that no edge is nearly zero. */
const SNAP = 0.05;

/** The numbers of the geometry a parameter set gives. */
export interface ExcavationGeometry {
  ground: number;
  bottom: number;
  base: number;
  crestX: number;
  toeX: number;
  left: number;
  right: number;
  /** The road's fill: the far toe, the top from `topLeft` to `topRight` (its near edge), the near toe (≤ the crest). */
  road: { farToe: number; topLeft: number; topRight: number; nearToe: number; top: number } | null;
  /** The levels of the interior boundaries between layers (all but the last layer's bottom). */
  levels: number[];
}

export function geometry(params: ExcavationParams): ExcavationGeometry {
  const G = params.groundLevel;
  const H = params.excavationDepth;
  const n = params.slope;
  const bottom = G - H;
  const levels = params.layers.slice(0, -1).map((l) => l.bottomLevel);
  const last = params.layers[params.layers.length - 1];
  const base = Math.min(G - 3 * H, last ? last.bottomLevel : Infinity);
  const reach = Math.max(3 * H, EXTENT_FACTOR * (G - base));
  const toeX = n * H;
  const right = toeX + Math.max(params.bottomWidth ?? 0, reach);
  let road: ExcavationGeometry["road"] = null;
  let left = -reach;
  if (params.road) {
    const { distanceFromCrest: d, width: w, height: h } = params.road;
    const topRight = -d;
    let nearToe = Math.min(0, topRight + ROAD_FILL_SLOPE * h);
    if (nearToe > -SNAP) nearToe = 0;
    const topLeft = topRight - w;
    const farToe = topLeft - ROAD_FILL_SLOPE * h;
    road = { farToe, topLeft, topRight, nearToe, top: G + h };
    left = Math.min(left, farToe - reach);
  }
  return { ground: G, bottom, base, crestX: 0, toeX, left, right, road, levels };
}

const within = (v: number, d: ParameterDescription) => Number.isFinite(v) && v >= d.min && v <= d.max;

/** A problem of a parameter set, with the field it is about. */
export interface FieldProblem {
  /**
   * The field: a key of the parameters ("excavationDepth"), of a layer
   * ("layers.0.su"), of the road ("road.width", the fill's "road.gamma")
   * or of the design values ("values.etaCu"); "layers" for the list.
   */
  field: string;
  /** The sentence, as `excavationProblems` gives it. */
  message: string;
}

/** What stops a parameter set from being built, each with its field; empty when nothing does. */
export function excavationFieldProblems(params: ExcavationParams): FieldProblem[] {
  const out: FieldProblem[] = [];
  const P = EXCAVATION_PARAMETERS;
  const add = (field: string, message: string) => out.push({ field, message });
  const check = (field: string, v: number, d: ParameterDescription, where = "") => {
    if (!within(v, d)) add(field, `${where}${d.label} must be from ${d.min} to ${d.max}${d.unit ? ` ${d.unit}` : ""}.`);
  };
  check("groundLevel", params.groundLevel, P.groundLevel);
  check("excavationDepth", params.excavationDepth, P.excavationDepth);
  check("slope", params.slope, P.slope);
  if (params.bottomWidth !== null) check("bottomWidth", params.bottomWidth, P.bottomWidth);
  if (params.waterLevel !== null) check("waterLevel", params.waterLevel, P.waterLevel);
  if (params.tensionCrackDepth !== undefined) check("tensionCrackDepth", params.tensionCrackDepth, P.tensionCrackDepth);
  if (!params.layers.length) add("layers", "The ground needs at least one layer.");
  const names = new Map<string, number>();
  const thin = MIN_LAYER_THICKNESS;
  let top = params.groundLevel;
  for (const [i, layer] of params.layers.entries()) {
    const where = `Layer ${i + 1}: `;
    const f = (key: string) => `layers.${i}.${key}`;
    const name = layerName(layer, i);
    if (names.has(name)) add(f("name"), `${where}the name "${name}" is used twice.`);
    else names.set(name, i);
    check(f("bottomLevel"), layer.bottomLevel, P.layer.bottomLevel, where);
    const isLast = i === params.layers.length - 1;
    if (Number.isFinite(layer.bottomLevel)) {
      // (1e-9 m: a level typed at exactly the least distance is accepted, 30.2 − 29.8 being 0.3999…)
      if (layer.bottomLevel > top - thin + 1e-9) {
        add(f("bottomLevel"), `${where}the bottom level ${layer.bottomLevel} must be at least ${thin} m below the ${i === 0 ? "ground" : "layer above"} (${top}).`);
      }
      if (!isLast && Math.abs(layer.bottomLevel - (params.groundLevel - params.excavationDepth)) < thin - 1e-9) {
        add(f("bottomLevel"), `${where}the bottom level ${layer.bottomLevel} is within ${thin} m of the excavation bottom; move it.`);
      }
    }
    top = layer.bottomLevel;
    const m = layer.material;
    check(f("gamma"), m.gamma, P.layer.gamma, where);
    if (m.kind === "undrained" || m.kind === "undrained-increasing") check(f("su"), m.su, P.layer.su, where);
    if (m.kind === "undrained-increasing") check(f("suRate"), m.suRate, P.layer.suRate, where);
    if (m.kind === "drained") {
      if (m.gammaSat !== undefined) check(f("gammaSat"), m.gammaSat, P.layer.gammaSat, where);
      check(f("c"), m.c, P.layer.c, where);
      check(f("phi"), m.phi, P.layer.phi, where);
    }
  }
  if (names.has(ROAD_FILL_NAME) && params.road) add(`layers.${names.get(ROAD_FILL_NAME)}.name`, `A layer is named "${ROAD_FILL_NAME}", which is the road's material.`);
  if (params.road) {
    const r = params.road;
    const where = "Road: ";
    check("road.distanceFromCrest", r.distanceFromCrest, P.road.distanceFromCrest, where);
    check("road.width", r.width, P.road.width, where);
    check("road.height", r.height, P.road.height, where);
    check("road.gamma", r.fill.gamma, P.road.gamma, where);
    if (r.fill.gammaSat !== undefined) check("road.gammaSat", r.fill.gammaSat, P.road.gammaSat, where);
    check("road.c", r.fill.c, P.road.c, where);
    check("road.phi", r.fill.phi, P.road.phi, where);
    if (r.trafficLoad !== null) check("road.trafficLoad", r.trafficLoad, P.road.trafficLoad, where);
  }
  if (params.values.basis === "design") {
    const v = params.values;
    if (![1, 2, 3].includes(v.safetyClass)) add("values.safetyClass", "The safety class must be 1, 2 or 3.");
    check("values.etaCu", v.etaCu, P.design.etaCu);
    check("values.etaDrained", v.etaDrained, P.design.etaDrained);
    check("values.variableLoadBase", v.variableLoadBase, P.design.variableLoadBase);
  }
  return out;
}

/** What stops a parameter set from being built; empty when nothing does. */
export function excavationProblems(params: ExcavationParams): string[] {
  return excavationFieldProblems(params).map((p) => p.message);
}

export const ROAD_FILL_NAME = "Road fill";

const fmt = (v: number) => String(Math.round(v * 100) / 100);

/**
 * What the model does that the parameters do not say, for the form to show
 * beside them (they do not stop the analysis): the last layer going on
 * below its bottom level, a bottom wider than asked. Empty for a set
 * `excavationProblems` refuses.
 */
export function excavationNotes(params: ExcavationParams): string[] {
  if (excavationProblems(params).length) return [];
  const g = geometry(params);
  const out: string[] = [];
  const i = params.layers.length - 1;
  const last = params.layers[i];
  if (last.bottomLevel > g.base) {
    out.push(`${layerName(last, i)} goes on below its bottom level ${fmt(last.bottomLevel)} m, down to ${fmt(g.base)} m, 2H below the excavation bottom: the model needs that depth.`);
  }
  if (params.bottomWidth !== null && g.right - g.toeX > params.bottomWidth + 1e-9) {
    out.push(`The bottom is modelled ${fmt(g.right - g.toeX)} m wide, not ${fmt(params.bottomWidth)} m: the model needs that width.`);
  }
  return out;
}

function layerName(layer: Layer, index: number): string {
  return layer.name?.trim() || `Layer ${index + 1}`;
}

function strengthOf(material: LayerMaterial, top: number): Strength {
  switch (material.kind) {
    case "undrained":
      return { su: material.su, gamma: material.gamma };
    case "undrained-increasing":
      return { su: material.su, suRate: material.suRate, suLevel: top, gamma: material.gamma };
    case "drained":
      return { c: material.c, phi: material.phi, gamma: material.gamma, gammaSat: material.gammaSat };
    case "impenetrable":
      return { impenetrable: true, gamma: material.gamma };
  }
}

/** The partial factors of a parameter set, or null on characteristic values. */
export function partialFactorsOf(values: Values): PartialFactors | null {
  if (values.basis !== "design") return null;
  const { safetyClass, etaCu, etaDrained, variableLoadBase } = values;
  return swedishPartialFactors({ safetyClass, etaCu, etaDrained, variableLoadBase });
}

/**
 * The outline of the model: ground → road → crest → slope → bottom → edge,
 * with a vertex at each layer level on the left edge and on the face (or
 * the right edge, below the bottom), where the level's boundary ends.
 */
export function exteriorOf(params: ExcavationParams, g: ExcavationGeometry = geometry(params)): Point[] {
  const { ground: G, bottom, base, toeX, left, right, road } = g;
  const above = g.levels.filter((l) => l > bottom);
  const below = g.levels.filter((l) => l < bottom);
  const faceX = (level: number) => params.slope * (G - level);
  const exterior: Point[] = [[left, base], ...[...g.levels].reverse().map((l): Point => [left, l]), [left, G]];
  if (road) {
    exterior.push([road.farToe, G], [road.topLeft, road.top], [road.topRight, road.top]);
    if (road.nearToe < 0) exterior.push([road.nearToe, G]);
  }
  exterior.push([0, G], ...above.map((l): Point => [faceX(l), l]), [toeX, bottom], [right, bottom], ...below.map((l): Point => [right, l]), [right, base]);
  return exterior;
}

/** The analysis document of a parameter set `excavationProblems` accepts. */
export function excavationDocument(params: ExcavationParams): AnalysisDocument {
  const problems = excavationProblems(params);
  if (problems.length) throw new Error(`The parameters cannot be built:\n${problems.join("\n")}`);
  const g = geometry(params);
  const { ground: G, bottom, base, left, right, road } = g;
  const d = new Definition("ltr");
  d.exterior = exteriorOf(params, g);
  const faceX = (level: number) => params.slope * (G - level);

  // The layers: a boundary at each level, between its two vertices, and a region on the ground side.
  const names = params.layers.map((layer, i) => d.addMaterial(layerName(layer, i), strengthOf(layer.material, i === 0 ? G : params.layers[i - 1].bottomLevel)));
  for (const level of g.levels) {
    d.addInteriorBoundary([
      [left, level],
      [level > bottom ? faceX(level) : right, level],
    ]);
  }
  const x = left + Math.min(1, params.excavationDepth / 2);
  let top = G;
  for (const [i, layer] of params.layers.entries()) {
    const layerBottom = i === params.layers.length - 1 ? base : layer.bottomLevel;
    d.assign(names[i], [x, (top + layerBottom) / 2]);
    top = layer.bottomLevel;
  }

  // The road: its own region on the ground (its line from toe to toe, both
  // corners of the outline), and the traffic load over it.
  if (road && params.road) {
    const { c, phi, gamma, gammaSat } = params.road.fill;
    const fill = d.addMaterial(ROAD_FILL_NAME, { c, phi, gamma, gammaSat });
    d.addInteriorBoundary([
      [road.farToe, G],
      [road.nearToe, G],
    ]);
    d.assign(fill, [(road.topLeft + road.topRight) / 2, G + params.road.height / 2]);
    if (params.road.trafficLoad) d.addDistributedLoad([road.topLeft, road.topRight], params.road.trafficLoad);
  }

  if (params.waterLevel !== null) d.setWaterLevel(params.waterLevel);
  // Entry behind the crest, exit from the crest on: the face or the bottom.
  d.searchLimits([left, 0], [0, right]);

  const factors = partialFactorsOf(params.values);
  return d.toDocument({
    ...(factors ? { partialFactors: factors } : {}),
    ...(params.tensionCrackDepth ? { tensionCrackDepth: params.tensionCrackDepth } : {}),
  });
}

export const excavationTemplate: Template<ExcavationParams> = {
  id: "excavation",
  title: "Excavation in clay with a working road",
  description:
    "An excavation with a slope 1:n in level ground of horizontal layers, with a ground-water level and, behind the crest, a working road with a traffic load.",
  params: EXCAVATION_PARAMETERS,
  problems: excavationProblems,
  fieldProblems: excavationFieldProblems,
  notes: excavationNotes,
  toDocument: excavationDocument,
};
