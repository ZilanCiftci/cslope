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
 * - The model reaches 3H beyond the crest (beyond the road when there is
 *   one) and at least 3H beyond the toe, and 2H below the bottom, or down
 *   to the deepest layer when that is deeper.
 * - One interior boundary per layer level, from the left edge to the slope
 *   face or across the whole model, crossing the outline by 0.3 % of the
 *   model's size (OVERSHOOT); one region assignment per layer, on
 *   the ground side (a layer under the bottom is one region with its
 *   ground side, which the engine assigns as one).
 * - Layers are at least 0.1 m thick, or 0.25 % of the model's size when
 *   that is more, and no level comes that close to the excavation bottom
 *   (the engine joins lines closer than 0.1 % of the size).
 * - The road is its own region above the ground, with the fill material,
 *   its sides 1:1.5 and its near toe at the given distance behind the
 *   crest (at the crest for 0), and a vertical distributed load over the
 *   width of its top.
 * - Water: a level, cut at the ground (no free water).
 * - Surfaces enter on the ground and the road (left of the crest) and exit
 *   in the bottom; the app's options (D-23).
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
      /** Su is `su` at the top of the layer and grows by `suRate` per metre below it (by elevation: the profile the clay had before the excavation). */
      kind: "undrained-increasing";
      gamma: number;
      su: number;
      suRate: number;
    }
  | { kind: "drained"; gamma: number; c: number; phi: number }
  | { kind: "impenetrable"; gamma: number };

export type LayerKind = LayerMaterial["kind"];

export interface Layer {
  /** The name in the results; default "Layer n". */
  name?: string;
  /** The elevation of the layer's bottom (m). The last layer's is where the model ends when deeper than 2H below the bottom. */
  bottomLevel: number;
  material: LayerMaterial;
}

export interface Road {
  /** From the crest to the near toe of the fill (m). */
  distanceFromCrest: number;
  /** The width of the road's top (m). */
  width: number;
  /** The height of the fill above the ground (m). */
  height: number;
  /** The fill, drained. */
  fill: { gamma: number; c: number; phi: number };
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
  /** The bottom from the toe to the model's edge (m); null: 3H. At least 3H is modelled. */
  bottomWidth: number | null;
  /** From the top down; the first starts at the ground. */
  layers: Layer[];
  /** The ground-water level (m); null: dry. */
  waterLevel: number | null;
  road: Road | null;
  values: Values;
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
  bottomWidth: p("bottomWidth", "Bottom width (m)", "m", 1, 100, 0.5, "The flat bottom from the toe to the edge of the model; 3H when left out, and at least 3H is modelled."),
  waterLevel: p("waterLevel", "Ground-water level (m)", "m", -100, 1000, 0.1, "The elevation of the ground water, cut at the ground; leave out for a dry slope."),
  layer: {
    bottomLevel: p("bottomLevel", "Bottom level (m)", "m", -100, 1000, 0.1, "The elevation of the layer's bottom. A layer is at least 0.1 m thick (more in a large model) and does not end that close to the excavation bottom."),
    gamma: p("gamma", "Unit weight γ (kN/m³)", "kN/m³", 10, 25, 0.1, "Used above and below the water."),
    su: p("su", "Su (kPa)", "kPa", 1, 500, 0.5, "The undrained shear strength; for a growing profile, its value at the top of the layer."),
    suRate: p("suRate", "Su increase (kPa/m)", "kPa/m", 0, 10, 0.1, "The growth of Su per metre below the top of the layer."),
    c: p("c", "c′ (kPa)", "kPa", 0, 100, 0.5, "The effective cohesion."),
    phi: p("phi", "φ′ (°)", "°", 5, 45, 0.5, "The effective friction angle."),
  },
  road: {
    distanceFromCrest: p("distanceFromCrest", "Distance from the crest (m)", "m", 0, 50, 0.5, "From the crest to the near toe of the fill; 0 puts the fill at the crest."),
    width: p("width", "Width (m)", "m", 2, 20, 0.5, "The width of the road's top; the load acts over it."),
    height: p("height", "Height (m)", "m", 0.2, 5, 0.1, "The height of the fill above the ground; its sides are 1:1.5."),
    gamma: p("gamma", "Fill unit weight γ (kN/m³)", "kN/m³", 15, 24, 0.1, "Used above and below the water."),
    c: p("c", "Fill c′ (kPa)", "kPa", 0, 20, 0.5, "The effective cohesion of the fill."),
    phi: p("phi", "Fill φ′ (°)", "°", 25, 45, 0.5, "The effective friction angle of the fill."),
    trafficLoad: p("trafficLoad", "Traffic load q (kPa)", "kPa", 0, 50, 1, "A vertical load over the road's width, a variable load; leave out for none."),
  },
  design: {
    etaCu: p("etaCu", "η undrained", null, 0.5, 1.2, 0.05, "The conversion factor on Su: γcu = 1.5 / η."),
    etaDrained: p("etaDrained", "η drained", null, 0.5, 1.2, 0.05, "The conversion factor on c′ and tan φ′: γc′ = γφ′ = 1.3 / η."),
    variableLoadBase: p("variableLoadBase", "γQ before γd", null, 1, 1.5, 0.1, "γQ = this × γd of the safety class; 1.3 as EN 1997-1, 1.4 in some guidance for traffic loads."),
  },
} satisfies Template<ExcavationParams>["params"];

/** The sides of the road's fill: horizontal per vertical. */
export const ROAD_FILL_SLOPE = 1.5;
/** A layer is at least this thick, and no level comes closer than this to the bottom (m); more in a large model (minLayerThickness). */
export const MIN_LAYER_THICKNESS = 0.1;
/**
 * The engine puts a boundary end that lies within 1e-3 of the model's size
 * of another line onto it (END_SNAP_TOLERANCE, packages/engine-rs/crates/
 * cslope-engine/src/model/geometry_ops.rs), so two levels that close would
 * merge and a layer would vanish. The template keeps lines 2.5 times that
 * apart (the property test found 0.15 m layers merging in a 167 m model).
 */
export const LINE_SEPARATION = 2.5e-3;
/**
 * How far a layer's boundary crosses the outline, normal to it, as a
 * fraction of the model's size: three times the engine's snap distance.
 * An end on the outline, or outside it within the snap distance, is put on
 * the outline by the engine, which then sometimes does not split the
 * layer off (the property test found an end on a 1:3.2 face, computed to
 * the last digit, failing where 1e-6 m past it worked); a plain crossing
 * is split reliably.
 */
export const OVERSHOOT = 3e-3;
/** The road's near toe snaps to the crest when closer than this (m), so that no edge is nearly zero. */
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
  /** The road's fill: the far toe, the top from `topLeft` to `topRight`, the near toe (≤ the crest). */
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
  const toeX = n * H;
  const right = toeX + Math.max(params.bottomWidth ?? 3 * H, 3 * H);
  let road: ExcavationGeometry["road"] = null;
  let left = -3 * H;
  if (params.road) {
    const { distanceFromCrest: d, width: w, height: h } = params.road;
    const nearToe = d < SNAP ? 0 : -d;
    const topRight = nearToe - ROAD_FILL_SLOPE * h;
    const topLeft = topRight - w;
    const farToe = topLeft - ROAD_FILL_SLOPE * h;
    road = { farToe, topLeft, topRight, nearToe, top: G + h };
    left = Math.min(left, farToe - 3 * H);
  }
  return { ground: G, bottom, base, crestX: 0, toeX, left, right, road, levels };
}

/** The model's size: its width or its height, the larger. */
export function modelSize(g: ExcavationGeometry): number {
  return Math.max(g.right - g.left, (g.road ? g.road.top : g.ground) - g.base);
}

/** The least thickness of a layer in this model (m), and the least distance of a level from the excavation bottom. */
export function minLayerThickness(params: ExcavationParams): number {
  const size = modelSize(geometry(params));
  return Math.max(MIN_LAYER_THICKNESS, Math.ceil(LINE_SEPARATION * size * 100) / 100);
}

const within = (v: number, d: ParameterDescription) => Number.isFinite(v) && v >= d.min && v <= d.max;

/** What stops a parameter set from being built; empty when nothing does. */
export function excavationProblems(params: ExcavationParams): string[] {
  const out: string[] = [];
  const P = EXCAVATION_PARAMETERS;
  const check = (v: number, d: ParameterDescription, where = "") => {
    if (!within(v, d)) out.push(`${where}${d.label} must be from ${d.min} to ${d.max}${d.unit ? ` ${d.unit}` : ""}.`);
  };
  check(params.groundLevel, P.groundLevel);
  check(params.excavationDepth, P.excavationDepth);
  check(params.slope, P.slope);
  if (params.bottomWidth !== null) check(params.bottomWidth, P.bottomWidth);
  if (params.waterLevel !== null) check(params.waterLevel, P.waterLevel);
  if (!params.layers.length) out.push("The ground needs at least one layer.");
  const names = new Set<string>();
  const finiteLevels = params.layers.every((l) => Number.isFinite(l.bottomLevel)) && [params.groundLevel, params.excavationDepth, params.slope].every(Number.isFinite);
  const thin = finiteLevels && params.layers.length ? minLayerThickness(params) : MIN_LAYER_THICKNESS;
  let top = params.groundLevel;
  for (const [i, layer] of params.layers.entries()) {
    const where = `Layer ${i + 1}: `;
    const name = layerName(layer, i);
    if (names.has(name)) out.push(`${where}the name "${name}" is used twice.`);
    names.add(name);
    check(layer.bottomLevel, P.layer.bottomLevel, where);
    const isLast = i === params.layers.length - 1;
    if (Number.isFinite(layer.bottomLevel)) {
      // (1e-9 m: a level typed at exactly the least distance is accepted, 30.2 − 29.8 being 0.3999…)
      if (layer.bottomLevel > top - thin + 1e-9) {
        out.push(`${where}the bottom level ${layer.bottomLevel} must be at least ${thin} m below the ${i === 0 ? "ground" : "layer above"} (${top}).`);
      }
      if (!isLast && Math.abs(layer.bottomLevel - (params.groundLevel - params.excavationDepth)) < thin - 1e-9) {
        out.push(`${where}the bottom level ${layer.bottomLevel} is within ${thin} m of the excavation bottom; move it.`);
      }
    }
    top = layer.bottomLevel;
    const m = layer.material;
    check(m.gamma, P.layer.gamma, where);
    if (m.kind === "undrained" || m.kind === "undrained-increasing") check(m.su, P.layer.su, where);
    if (m.kind === "undrained-increasing") check(m.suRate, P.layer.suRate, where);
    if (m.kind === "drained") {
      check(m.c, P.layer.c, where);
      check(m.phi, P.layer.phi, where);
    }
  }
  if (names.has(ROAD_FILL_NAME) && params.road) out.push(`A layer is named "${ROAD_FILL_NAME}", which is the road's material.`);
  if (params.road) {
    const r = params.road;
    const where = "Road: ";
    check(r.distanceFromCrest, P.road.distanceFromCrest, where);
    check(r.width, P.road.width, where);
    check(r.height, P.road.height, where);
    check(r.fill.gamma, P.road.gamma, where);
    check(r.fill.c, P.road.c, where);
    check(r.fill.phi, P.road.phi, where);
    if (r.trafficLoad !== null) check(r.trafficLoad, P.road.trafficLoad, where);
  }
  if (params.values.basis === "design") {
    const v = params.values;
    if (![1, 2, 3].includes(v.safetyClass)) out.push("The safety class must be 1, 2 or 3.");
    check(v.etaCu, P.design.etaCu);
    check(v.etaDrained, P.design.etaDrained);
    check(v.variableLoadBase, P.design.variableLoadBase);
  }
  return out;
}

export const ROAD_FILL_NAME = "Road fill";

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
      return { c: material.c, phi: material.phi, gamma: material.gamma };
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

/** The analysis document of a parameter set `excavationProblems` accepts. */
export function excavationDocument(params: ExcavationParams): AnalysisDocument {
  const problems = excavationProblems(params);
  if (problems.length) throw new Error(`The parameters cannot be built:\n${problems.join("\n")}`);
  const g = geometry(params);
  const { ground: G, bottom, base, toeX, left, right, road } = g;
  const n = params.slope;
  const d = new Definition("ltr");

  // The outline: ground → road → crest → slope → bottom → edge.
  const exterior: Point[] = [
    [left, base],
    [left, G],
  ];
  if (road) {
    exterior.push([road.farToe, G], [road.topLeft, road.top], [road.topRight, road.top]);
    if (road.nearToe < 0) exterior.push([road.nearToe, G]);
  }
  exterior.push([0, G], [toeX, bottom], [right, bottom], [right, base]);
  d.exterior = exterior;

  // The layers: a boundary at each level, a region on the ground side.
  const over = OVERSHOOT * modelSize(g);
  const names = params.layers.map((layer, i) => d.addMaterial(layerName(layer, i), strengthOf(layer.material, i === 0 ? G : params.layers[i - 1].bottomLevel)));
  for (const level of g.levels) {
    // Above the bottom the boundary ends on the slope face; below it crosses the model.
    // Normal to a face 1:n, a horizontal reach of o·√(1 + n²) is o.
    const end = level > bottom ? n * (G - level) + over * Math.hypot(1, n) : right + over;
    d.addInteriorBoundary([
      [left - over, level],
      [end, level],
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
    const fill = d.addMaterial(ROAD_FILL_NAME, { c: params.road.fill.c, phi: params.road.fill.phi, gamma: params.road.fill.gamma });
    d.addInteriorBoundary([
      [road.farToe, G],
      [road.nearToe, G],
    ]);
    d.assign(fill, [(road.topLeft + road.topRight) / 2, G + params.road.height / 2]);
    if (params.road.trafficLoad) d.addDistributedLoad([road.topLeft, road.topRight], params.road.trafficLoad);
  }

  if (params.waterLevel !== null) d.setWaterLevel(params.waterLevel);
  d.searchLimits([left, 0], [toeX, right]);

  const factors = partialFactorsOf(params.values);
  return d.toDocument(factors ? { partialFactors: factors } : {});
}

export const excavationTemplate: Template<ExcavationParams> = {
  id: "excavation",
  title: "Excavation in clay with a working road",
  description:
    "An excavation with a slope 1:n in level ground of horizontal layers, with a ground-water level and, behind the crest, a working road with a traffic load.",
  params: EXCAVATION_PARAMETERS,
  problems: excavationProblems,
  toDocument: excavationDocument,
};
