/**
 * The first template: an excavation in clay with a haul road. The
 * ground is level, in horizontal layers; the excavation has a slope 1:n
 * and a flat bottom; the ground water is a level; a haul road (a fill
 * with an optional traffic load, decision B3) may stand behind the crest.
 * F is a factor of safety on characteristic values (design values with
 * partial factors are for the app and Python). The parameters have no
 * defaults here; the form opens with EXCAVATION_DEFAULTS.
 *
 * Geometry (x to the right, y up, m; the slope slides to the right):
 *
 *   ground ─── road ─── crest (0, G)
 *                          ╲ 1:n
 *                           toe (nH, G − H) ─── bottom ─── edge
 *
 * With a bottom width b, a trench: the bottom ends at x = nH + b, and the
 * opposite side rises 1:n to the ground at x = 2nH + b; the ground goes on
 * to the edge. The road stays on the left.
 *
 * - The model reaches EXTENT_FACTOR × its depth (ground to base), and at
 *   least 3H, beyond the crest (beyond the road when there is one) and
 *   beyond the toe (in a trench, beyond its opposite crest). Its base is the last layer's bottom, as typed, treated
 *   as firm ground; it must be below the excavation bottom, and a note
 *   says when it is less than 3H below the ground (RECOMMENDED_DEPTH). A
 *   test widens every example 2× and finds F unchanged.
 * - Each layer level is a vertex of the outline at the left edge and at
 *   the slope face (or the right edge, below the bottom), and its interior
 *   boundary runs between those two vertices; one region assignment per
 *   layer on the ground side (a layer under the bottom is one region with
 *   its ground side). A level on the bottom (within 1e-9 m) runs from the
 *   left edge to the toe, the toe being its vertex. In a trench a level
 *   above or on the bottom also has a boundary from the opposite face (on
 *   the bottom: the far end of the bottom) to the right edge, and the
 *   layer a second region assignment there.
 * - Layers are at least 5 cm thick, and no level is within 5 cm of the
 *   excavation bottom unless on it.
 * - The road is its own region above the ground, with the fill material,
 *   its sides 1:2.5 (ROAD_FILL_SLOPE) and the near edge of its top at the given distance
 *   behind the crest (its side cut at the crest when closer), and a
 *   vertical distributed load over the width of its top.
 * - Water: a level, cut at the ground (no free water); with `ponded`, free
 *   water stands above the ground in the excavation (the engine's freeWater).
 * - Surfaces enter left of the crest (on the ground and the road) and exit
 *   anywhere from the crest to the right edge (on the face or in the
 *   bottom; in a trench, up to the far end of its bottom); the app's options (D-23)
 *   with the automatic tension crack (TEMPLATE_OPTIONS).
 */
import type { AnalysisDocument } from "../engine/document";
import { Definition, type Point } from "./builder";
import {
  addLayers,
  EXTENT_FACTOR,
  FILL_PARAMETERS,
  fmt,
  GROUND_LEVEL,
  LAYER_PARAMETERS,
  MIN_LAYER_THICKNESS,
  shallowBaseNote,
  p,
  Problems,
  SLOPE,
  WATER_LEVEL,
  type FieldProblem,
  type Fill,
  type Layer,
  TEMPLATE_OPTIONS,
} from "./common";
import type { Template } from "./types";

export type { FieldProblem, Fill, Layer, LayerKind, LayerMaterial, ParameterDescriptionLike } from "./common";
export { EXTENT_FACTOR, MIN_LAYER_THICKNESS } from "./common";

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
  /**
   * The width of a trench's bottom (m): the opposite side rises 1:n from
   * its far end to the ground. Null: a one-sided excavation, its bottom as
   * wide as the model needs.
   */
  bottomWidth: number | null;
  /** From the top down; the first starts at the ground. */
  layers: Layer[];
  /** The ground-water level (m); null: dry. */
  waterLevel: number | null;
  /** Water above the ground stands in the excavation as ponded (free) water; not set: the level is cut at the ground. */
  ponded?: boolean;
  road: Road | null;
}

/** The parameters, with their bounds: the form renders from these. */
export const EXCAVATION_PARAMETERS = {
  groundLevel: GROUND_LEVEL,
  excavationDepth: p("excavationDepth", "Excavation depth H (m)", "m", 0.5, 20, 0.1, "From the ground to the bottom of the excavation."),
  slope: SLOPE,
  bottomWidth: p(
    "bottomWidth",
    "Bottom width (m)",
    "m",
    0.5,
    50,
    0.1,
    "Empty: a one-sided excavation with a wide bottom. Set: a trench of this bottom width, the opposite side rising 1:n to the ground; slip surfaces exit within the trench.",
  ),
  waterLevel: WATER_LEVEL,
  layer: {
    ...LAYER_PARAMETERS,
    bottomLevel: { ...LAYER_PARAMETERS.bottomLevel, description: "The elevation of the layer's bottom. A layer is at least 0.05 m thick and ends either at the excavation bottom or at least 0.05 m from it." },
  },
  road: {
    distanceFromCrest: p("distanceFromCrest", "Distance from the crest to the road (m)", "m", 0, 50, 0.5, "From the crest to the near edge of the road's top, where the load starts; the fill's side goes down 1:2.5 from there, cut at the crest."),
    width: p("width", "Width (m)", "m", 2, 20, 0.5, "The width of the road's top; the load acts over it."),
    height: p("height", "Height (m)", "m", 0.2, 5, 0.1, "The height of the fill above the ground; its sides are 1:2.5."),
    ...FILL_PARAMETERS,
    trafficLoad: p("trafficLoad", "Traffic load q (kPa)", "kPa", 0, Infinity, 1, "A vertical load over the road's width, a variable load; leave out for none.", { typical: [0, 50] }),
  },
} satisfies Template<ExcavationParams>["params"];

/**
 * The sides of the road's fill: horizontal per vertical. At 1:2.5 (21.8°)
 * a cohesionless fill of φ′ 38° has tan φ′ / tan β = 1.95, so the thin
 * slide down its side (which the search does not reach) does not govern
 * the examples; at 1:1.5 it was 1.17 and at 1:2 1.56, below the F of
 * some (clay-road-no-traffic: 1.81).
 */
export const ROAD_FILL_SLOPE = 2.5;
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
  /** A trench: the far end of its bottom and the crest of its opposite side; null for a one-sided excavation. */
  trench: { bottomEnd: number; farCrest: number } | null;
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
  const base = last ? last.bottomLevel : bottom - MIN_LAYER_THICKNESS;
  const reach = Math.max(3 * H, EXTENT_FACTOR * (G - base));
  const toeX = n * H;
  const trench = params.bottomWidth === null ? null : { bottomEnd: toeX + params.bottomWidth, farCrest: toeX + params.bottomWidth + n * H };
  const right = (trench ? trench.farCrest : toeX) + reach;
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
  return { ground: G, bottom, base, crestX: 0, toeX, left, right, road, trench, levels };
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
  out.layers(params.layers, params.groundLevel, {
    avoid: { level: params.groundLevel - params.excavationDepth, text: "the excavation bottom" },
    reserved: params.road ? { name: ROAD_FILL_NAME, what: "the road's material" } : undefined,
  });
  const i = params.layers.length - 1;
  const lastBottom = params.layers[i]?.bottomLevel;
  const bottom = params.groundLevel - params.excavationDepth;
  if (Number.isFinite(lastBottom) && Number.isFinite(bottom) && lastBottom > bottom - MIN_LAYER_THICKNESS + 1e-9 && !out.list.some((x) => x.field === `layers.${i}.bottomLevel`)) {
    out.add(`layers.${i}.bottomLevel`, `Layer ${i + 1}: the bottom level ${lastBottom} must be at least ${MIN_LAYER_THICKNESS} m below the excavation bottom (${fmt(bottom)}); the model ends at the last layer's bottom.`);
  }
  if (params.road) {
    const r = params.road;
    const where = "Road: ";
    out.check("road.distanceFromCrest", r.distanceFromCrest, P.road.distanceFromCrest, where);
    out.check("road.width", r.width, P.road.width, where);
    out.check("road.height", r.height, P.road.height, where);
    out.fill(r.fill, "road", where);
    if (r.trafficLoad !== null) out.check("road.trafficLoad", r.trafficLoad, P.road.trafficLoad, where);
  }
  return out.list;
}

/** What stops a parameter set from being built; empty when nothing does. */
export function excavationProblems(params: ExcavationParams): string[] {
  return excavationFieldProblems(params).map((p) => p.general ?? p.message);
}

export const ROAD_FILL_NAME = "Road fill";

/** The depth below the ground, in H, the last layer's bottom should reach; a note says when it does not. */
export const RECOMMENDED_DEPTH = 3;

/**
 * What the model does that the parameters do not say, for the form to show
 * beside them (they do not stop the analysis): a base (the last layer's
 * bottom) less than 3H below the ground. Empty for a set
 * `excavationProblems` refuses.
 */
export function excavationNotes(params: ExcavationParams): string[] {
  if (excavationProblems(params).length) return [];
  const g = geometry(params);
  const out: string[] = [];
  const shallow = shallowBaseNote(g.base, params.groundLevel - RECOMMENDED_DEPTH * params.excavationDepth);
  if (shallow) out.push(shallow);
  return out;
}

/** A level within this distance of the excavation bottom is on it (m): its boundary ends at the toe. */
const ON_BOTTOM = 1e-9;
const onBottom = (level: number, g: ExcavationGeometry) => Math.abs(level - g.bottom) <= ON_BOTTOM;

/** Where a level above the bottom meets the face, and (in a trench) the opposite face. */
const faceXOf = (params: ExcavationParams, g: ExcavationGeometry) => (level: number) => params.slope * (g.ground - level);
const farFaceXOf = (params: ExcavationParams, g: ExcavationGeometry) => (level: number) => (g.trench?.bottomEnd ?? g.toeX) + params.slope * (level - g.bottom);

/**
 * The outline of the model: ground → road → crest → slope → bottom → edge
 * (in a trench: bottom → opposite slope → ground → edge), with a vertex at
 * each layer level on the left edge, on the face (and the opposite face)
 * above the bottom and on the right edge where the level's boundaries end.
 */
export function exteriorOf(params: ExcavationParams, g: ExcavationGeometry = geometry(params)): Point[] {
  const { ground: G, bottom, base, toeX, left, right, road, trench } = g;
  // A level on the bottom is in neither: the toe (and the far end of a trench's bottom) is its vertex.
  const above = g.levels.filter((l) => l > bottom + ON_BOTTOM);
  const below = g.levels.filter((l) => l < bottom - ON_BOTTOM);
  const faceX = faceXOf(params, g);
  const exterior: Point[] = [[left, base], ...[...g.levels].reverse().map((l): Point => [left, l]), [left, G]];
  if (road) {
    exterior.push([road.farToe, G], [road.topLeft, road.top], [road.topRight, road.top]);
    if (road.nearToe < 0) exterior.push([road.nearToe, G]);
  }
  exterior.push([0, G], ...above.map((l): Point => [faceX(l), l]), [toeX, bottom]);
  if (trench) {
    const farFaceX = farFaceXOf(params, g);
    exterior.push(
      [trench.bottomEnd, bottom],
      ...[...above].reverse().map((l): Point => [farFaceX(l), l]),
      [trench.farCrest, G],
      [right, G],
      ...g.levels.map((l): Point => [right, l]),
      [right, base],
    );
  } else {
    exterior.push([right, bottom], ...below.map((l): Point => [right, l]), [right, base]);
  }
  return exterior;
}

/**
 * The boundaries between the layers, each between two vertices of the
 * outline: from the left edge to the face above the bottom, to the toe on
 * it, or to the right edge below it; in a trench also from the opposite
 * face (on the bottom: the far end of the bottom) to the right edge.
 */
export function levelBoundaries(params: ExcavationParams, g: ExcavationGeometry = geometry(params)): [Point, Point][] {
  const faceX = faceXOf(params, g);
  const farFaceX = farFaceXOf(params, g);
  const out: [Point, Point][] = [];
  for (const level of g.levels) {
    if (onBottom(level, g)) {
      out.push([
        [g.left, level],
        [g.toeX, g.bottom],
      ]);
      if (g.trench)
        out.push([
          [g.trench.bottomEnd, g.bottom],
          [g.right, level],
        ]);
      continue;
    }
    if (level < g.bottom) {
      out.push([
        [g.left, level],
        [g.right, level],
      ]);
      continue;
    }
    out.push([
      [g.left, level],
      [faceX(level), level],
    ]);
    if (g.trench)
      out.push([
        [farFaceX(level), level],
        [g.right, level],
      ]);
  }
  return out;
}

/** The analysis document of a parameter set `excavationProblems` accepts. */
export function excavationDocument(params: ExcavationParams): AnalysisDocument {
  const problems = excavationProblems(params);
  if (problems.length) throw new Error(`The parameters cannot be built:\n${problems.join("\n")}`);
  const g = geometry(params);
  const { ground: G, bottom, left, right, road, trench } = g;
  const d = new Definition("ltr");
  d.exterior = exteriorOf(params, g);

  // The layers: a region each on the ground side, and a boundary at each level, between its two vertices.
  const inset = Math.min(1, params.excavationDepth / 2);
  const names = addLayers(d, params.layers, G, left + inset);
  for (const boundary of levelBoundaries(params, g)) d.addInteriorBoundary(boundary);
  // In a trench, a layer that ends above or on the bottom is a second region beyond the opposite face.
  if (trench) {
    let top = G;
    for (const [i, layer] of params.layers.entries()) {
      if (layer.bottomLevel > bottom - ON_BOTTOM) d.assign(names[i], [right - inset, (top + layer.bottomLevel) / 2]);
      top = layer.bottomLevel;
    }
  }

  // The road: its own region on the ground (its line from toe to toe, both
  // corners of the outline), and the traffic load over it.
  if (road && params.road) {
    const { c, phi, gamma } = params.road.fill;
    const fill = d.addMaterial(ROAD_FILL_NAME, { c, phi, gamma });
    d.addInteriorBoundary([
      [road.farToe, G],
      [road.nearToe, G],
    ]);
    d.assign(fill, [(road.topLeft + road.topRight) / 2, G + params.road.height / 2]);
    if (params.road.trafficLoad) d.addDistributedLoad([road.topLeft, road.topRight], params.road.trafficLoad);
  }

  if (params.waterLevel !== null) d.setWaterLevel(params.waterLevel, params.ponded === true);
  // Entry behind the crest, exit from the crest on: the face or the bottom (in a trench, up to its far end).
  d.searchLimits([left, 0], [0, trench ? trench.bottomEnd : right]);

  return d.toDocument(TEMPLATE_OPTIONS);
}

export const excavationTemplate: Template<ExcavationParams> = {
  id: "excavation",
  title: "Excavation",
  description:
    "An excavation with a slope 1:n in level ground of horizontal layers, with a ground-water level and, behind the crest, a haul road with a traffic load.",
  params: EXCAVATION_PARAMETERS,
  problems: excavationProblems,
  fieldProblems: excavationFieldProblems,
  notes: excavationNotes,
  toDocument: excavationDocument,
};
