/**
 * The second template: an embankment on clay. The ground is level, in
 * horizontal layers (as in the excavation); the embankment is a drained
 * fill of height h with a crest of width B and both sides 1:n; the ground
 * water is a level; a load may stand on the crest. F is a factor of safety
 * on characteristic values, or an over-design factor on design values with
 * Swedish partial factors from the safety class (B4). No strength has a
 * default (B5).
 *
 * Geometry (x to the right, y up, m; the slope slides to the right):
 *
 *               (−B, G + h) ── crest ── (0, G + h)
 *              ╱ 1:n                          ╲ 1:n
 *   ground ── (−B − nh, G)                    toe (nh, G) ── ground ── edge
 *
 * - The model reaches EXTENT_FACTOR × its depth (crest to base), and at
 *   least 3h, beyond each toe; its base is 2h below the ground, or the
 *   deepest layer's bottom when that is deeper. A test widens every
 *   example 2× and finds F unchanged.
 * - Each layer level is a vertex of the outline at both edges, and its
 *   interior boundary runs between them; one region assignment per layer.
 * - The embankment is its own region above the ground, its line on the
 *   ground from toe to toe (both vertices of the outline); the load acts
 *   vertically over the crest's width.
 * - Water: a level, cut at the ground and the embankment (no free water).
 * - Surfaces enter on the embankment (its crest, and its far side, where a
 *   deep circle under a narrow crest enters) and exit anywhere from the
 *   crest's edge to the right edge: in the face (a shallow slide in the
 *   fill, which can govern), at the toe or on the ground beyond it; the
 *   app's options (D-23).
 */
import type { AnalysisDocument } from "../engine/document";
import { Definition, type Point } from "./builder";
import {
  addLayers,
  DESIGN_PARAMETERS,
  EXTENT_FACTOR,
  FILL_PARAMETERS,
  GROUND_LEVEL,
  LAYER_PARAMETERS,
  lastLayerNote,
  p,
  partialFactorsOf,
  Problems,
  SLOPE,
  WATER_LEVEL,
  type FieldProblem,
  type Fill,
  type Layer,
  type Values,
} from "./common";
import type { Template } from "./types";

export interface EmbankmentParams {
  /** The elevation of the ground (m). */
  groundLevel: number;
  /** h, from the ground to the crest (m). */
  embankmentHeight: number;
  /** B, the width of the crest (m). */
  crestWidth: number;
  /** n in 1:n, horizontal per vertical, on both sides. */
  slope: number;
  /** The embankment's material, drained. */
  fill: Fill;
  /** A vertical load q over the crest (kPa), a variable load; null: none. */
  crestLoad: number | null;
  /** From the top down; the first starts at the ground. */
  layers: Layer[];
  /** The ground-water level (m); null: dry. */
  waterLevel: number | null;
  values: Values;
}

/** The parameters, with their bounds: the form renders from these. */
export const EMBANKMENT_PARAMETERS = {
  groundLevel: GROUND_LEVEL,
  embankmentHeight: p("embankmentHeight", "Embankment height h (m)", "m", 0.5, 15, 0.1, "From the ground to the crest."),
  crestWidth: p("crestWidth", "Crest width B (m)", "m", 1, 60, 0.5, "The width of the embankment's top; a load on the crest acts over it."),
  slope: { ...SLOPE, description: `${SLOPE.description} Both sides of the embankment.` },
  crestLoad: p("crestLoad", "Load on the crest q (kPa)", "kPa", 0, 100, 1, "A vertical load over the crest's width, a variable load (traffic, a stockpile); leave out for none."),
  waterLevel: WATER_LEVEL,
  fill: FILL_PARAMETERS,
  layer: LAYER_PARAMETERS,
  design: DESIGN_PARAMETERS,
} satisfies Template<EmbankmentParams>["params"];

export const EMBANKMENT_FILL_NAME = "Embankment";

/** The numbers of the geometry a parameter set gives. */
export interface EmbankmentGeometry {
  ground: number;
  crest: number;
  base: number;
  /** The crest from `crestLeft` (−B) to 0. */
  crestLeft: number;
  /** The toes: the far one (left) and the one the slope slides over (right). */
  farToe: number;
  toeX: number;
  left: number;
  right: number;
  /** The levels of the interior boundaries between layers (all but the last layer's bottom). */
  levels: number[];
}

export function embankmentGeometry(params: EmbankmentParams): EmbankmentGeometry {
  const G = params.groundLevel;
  const h = params.embankmentHeight;
  const nh = params.slope * h;
  const last = params.layers[params.layers.length - 1];
  const base = Math.min(G - 2 * h, last ? last.bottomLevel : Infinity);
  const reach = Math.max(3 * h, EXTENT_FACTOR * (G + h - base));
  const crestLeft = -params.crestWidth;
  const farToe = crestLeft - nh;
  return {
    ground: G,
    crest: G + h,
    base,
    crestLeft,
    farToe,
    toeX: nh,
    left: farToe - reach,
    right: nh + reach,
    levels: params.layers.slice(0, -1).map((l) => l.bottomLevel),
  };
}

/** What stops a parameter set from being built, each with its field; empty when nothing does. */
export function embankmentFieldProblems(params: EmbankmentParams): FieldProblem[] {
  const P = EMBANKMENT_PARAMETERS;
  const out = new Problems();
  out.check("groundLevel", params.groundLevel, P.groundLevel);
  out.check("embankmentHeight", params.embankmentHeight, P.embankmentHeight);
  out.check("crestWidth", params.crestWidth, P.crestWidth);
  out.check("slope", params.slope, P.slope);
  out.fill(params.fill, "fill", "Embankment: ");
  if (params.crestLoad !== null) out.check("crestLoad", params.crestLoad, P.crestLoad);
  if (params.waterLevel !== null) out.check("waterLevel", params.waterLevel, P.waterLevel);
  out.layers(params.layers, params.groundLevel, { reserved: { name: EMBANKMENT_FILL_NAME, what: "the embankment's material" } });
  out.values(params.values);
  return out.list;
}

export function embankmentProblems(params: EmbankmentParams): string[] {
  return embankmentFieldProblems(params).map((x) => x.message);
}

/** What the model does that the parameters do not say: the last layer going on below its bottom level. */
export function embankmentNotes(params: EmbankmentParams): string[] {
  if (embankmentProblems(params).length) return [];
  const note = lastLayerNote(params.layers, embankmentGeometry(params).base, "2h below the ground");
  return note ? [note] : [];
}

/** The outline: the base, the left edge, the ground to the far toe, the embankment, the ground to the right edge, with a vertex at each layer level on both edges. */
export function embankmentExterior(g: EmbankmentGeometry): Point[] {
  const down = [...g.levels].reverse();
  return [
    [g.left, g.base],
    ...down.map((l): Point => [g.left, l]),
    [g.left, g.ground],
    [g.farToe, g.ground],
    [g.crestLeft, g.crest],
    [0, g.crest],
    [g.toeX, g.ground],
    [g.right, g.ground],
    ...g.levels.map((l): Point => [g.right, l]),
    [g.right, g.base],
  ];
}

/** The analysis document of a parameter set `embankmentProblems` accepts. */
export function embankmentDocument(params: EmbankmentParams): AnalysisDocument {
  const problems = embankmentProblems(params);
  if (problems.length) throw new Error(`The parameters cannot be built:\n${problems.join("\n")}`);
  const g = embankmentGeometry(params);
  const d = new Definition("ltr");
  d.exterior = embankmentExterior(g);
  addLayers(d, params.layers, g.ground, g.base, g.left + 1);
  for (const level of g.levels) {
    d.addInteriorBoundary([
      [g.left, level],
      [g.right, level],
    ]);
  }
  const fill = d.addMaterial(EMBANKMENT_FILL_NAME, { ...params.fill });
  d.addInteriorBoundary([
    [g.farToe, g.ground],
    [g.toeX, g.ground],
  ]);
  d.assign(fill, [g.crestLeft / 2, g.ground + params.embankmentHeight / 2]);
  if (params.crestLoad) d.addDistributedLoad([g.crestLeft, 0], params.crestLoad);
  if (params.waterLevel !== null) d.setWaterLevel(params.waterLevel);
  // Entry on the embankment, from the far toe to the crest's edge; exit from the crest's edge on: the face, the toe, the ground.
  d.searchLimits([g.farToe, 0], [0, g.right]);
  const factors = partialFactorsOf(params.values);
  return d.toDocument(factors ? { partialFactors: factors } : {});
}

export const embankmentTemplate: Template<EmbankmentParams> = {
  id: "embankment",
  title: "Embankment on clay",
  description: "An embankment with sides 1:n on level ground of horizontal layers, with a ground-water level and a load on the crest.",
  params: EMBANKMENT_PARAMETERS,
  problems: embankmentProblems,
  fieldProblems: embankmentFieldProblems,
  notes: embankmentNotes,
  toDocument: embankmentDocument,
};

