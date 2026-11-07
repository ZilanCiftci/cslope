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
import type { AnalysisDocument } from "../engine/document";
import { Definition, type Point } from "./builder";
import {
  addLayers,
  DESIGN_PARAMETERS,
  EXTENT_FACTOR,
  FILL_PARAMETERS,
  fmt,
  GROUND_LEVEL,
  LAYER_PARAMETERS,
  lastLayerNote,
  p,
  partialFactorsOf,
  Problems,
  SLOPE,
  TENSION_CRACK_DEPTH,
  WATER_LEVEL,
  type FieldProblem,
  type Fill,
  type Layer,
  type Values,
} from "./common";
import type { Template } from "./types";

export type { FieldProblem, Fill, Layer, LayerKind, LayerMaterial, ParameterDescriptionLike, Values } from "./common";
export { EXTENT_FACTOR, MIN_LAYER_THICKNESS, partialFactorsOf } from "./common";

export interface Road {
  /** From the crest to the near edge of the road's top, where the load starts (m). */
  distanceFromCrest: number;
  /** The width of the road's top (m). */
  width: number;
  /** The height of the fill above the ground (m). */
  height: number;
  /** The fill, drained. */
  fill: Fill;
  /** The traffic load q over the road's width (kPa); null: none. */
  trafficLoad: number | null;
}

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

/** The parameters, with their bounds: the form renders from these. */
export const EXCAVATION_PARAMETERS = {
  groundLevel: GROUND_LEVEL,
  excavationDepth: p("excavationDepth", "Excavation depth H (m)", "m", 0.5, 20, 0.1, "From the ground to the bottom of the excavation."),
  slope: SLOPE,
  bottomWidth: p("bottomWidth", "Bottom width (m)", "m", 1, 300, 0.5, "The flat bottom from the toe to the edge of the model; as wide as the model needs when left out, and never narrower."),
  tensionCrackDepth: TENSION_CRACK_DEPTH,
  waterLevel: WATER_LEVEL,
  layer: {
    ...LAYER_PARAMETERS,
    bottomLevel: { ...LAYER_PARAMETERS.bottomLevel, description: "The elevation of the layer's bottom. A layer is at least 0.05 m thick and does not end within 0.05 m of the excavation bottom." },
  },
  road: {
    distanceFromCrest: p("distanceFromCrest", "Distance from the crest to the road (m)", "m", 0, 50, 0.5, "From the crest to the near edge of the road's top, where the load starts; the fill's side goes down 1:1.5 from there, cut at the crest."),
    width: p("width", "Width (m)", "m", 2, 20, 0.5, "The width of the road's top; the load acts over it."),
    height: p("height", "Height (m)", "m", 0.2, 5, 0.1, "The height of the fill above the ground; its sides are 1:1.5."),
    ...FILL_PARAMETERS,
    trafficLoad: p("trafficLoad", "Traffic load q (kPa)", "kPa", 0, 50, 1, "A vertical load over the road's width, a variable load; leave out for none."),
  },
  design: DESIGN_PARAMETERS,
} satisfies Template<ExcavationParams>["params"];

/** The sides of the road's fill: horizontal per vertical. */
export const ROAD_FILL_SLOPE = 1.5;
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

/** What stops a parameter set from being built, each with its field; empty when nothing does. */
export function excavationFieldProblems(params: ExcavationParams): FieldProblem[] {
  const P = EXCAVATION_PARAMETERS;
  const out = new Problems();
  out.check("groundLevel", params.groundLevel, P.groundLevel);
  out.check("excavationDepth", params.excavationDepth, P.excavationDepth);
  out.check("slope", params.slope, P.slope);
  if (params.bottomWidth !== null) out.check("bottomWidth", params.bottomWidth, P.bottomWidth);
  if (params.waterLevel !== null) out.check("waterLevel", params.waterLevel, P.waterLevel);
  if (params.tensionCrackDepth !== undefined) out.check("tensionCrackDepth", params.tensionCrackDepth, P.tensionCrackDepth);
  out.layers(params.layers, params.groundLevel, {
    avoid: { level: params.groundLevel - params.excavationDepth, text: "the excavation bottom" },
    reserved: params.road ? { name: ROAD_FILL_NAME, what: "the road's material" } : undefined,
  });
  if (params.road) {
    const r = params.road;
    const where = "Road: ";
    out.check("road.distanceFromCrest", r.distanceFromCrest, P.road.distanceFromCrest, where);
    out.check("road.width", r.width, P.road.width, where);
    out.check("road.height", r.height, P.road.height, where);
    out.fill(r.fill, "road", where);
    if (r.trafficLoad !== null) out.check("road.trafficLoad", r.trafficLoad, P.road.trafficLoad, where);
  }
  out.values(params.values);
  return out.list;
}

/** What stops a parameter set from being built; empty when nothing does. */
export function excavationProblems(params: ExcavationParams): string[] {
  return excavationFieldProblems(params).map((p) => p.message);
}

export const ROAD_FILL_NAME = "Road fill";

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
  const last = lastLayerNote(params.layers, g.base, "2H below the excavation bottom");
  if (last) out.push(last);
  if (params.bottomWidth !== null && g.right - g.toeX > params.bottomWidth + 1e-9) {
    out.push(`The bottom is modelled ${fmt(g.right - g.toeX)} m wide, not ${fmt(params.bottomWidth)} m: the model needs that width.`);
  }
  return out;
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

  // The layers: a region each on the ground side, and a boundary at each level, between its two vertices.
  addLayers(d, params.layers, G, base, left + Math.min(1, params.excavationDepth / 2));
  for (const level of g.levels) {
    d.addInteriorBoundary([
      [left, level],
      [level > bottom ? faceX(level) : right, level],
    ]);
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
