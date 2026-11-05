/**
 * Prepared models for the design screenshots and the manual beta test: one
 * small model per feature, each with a fixed slip circle analysed on its own
 * ("custom planes only"), so that a run gives one exact factor of safety,
 * and one model that combines them for the dialogs.
 *
 * The models are built from engine slope definitions with the app's own
 * conversion (modelFromDefinition), as an import does.
 */

import type { AnalysisOptions, SlopeDefinition } from "@cslope/engine";
import { modelFromDefinition } from "../../src/store/definition-model";
import type { ModelEntry } from "../../src/store/types";

type Pt = [number, number];
type Circle = { cx: number; cy: number; radius: number };

export interface FeatureModel {
  /** File name (no extension). */
  key: string;
  /** Model name in the app. */
  title: string;
  /** What the model tests, one line. */
  feature: string;
  /** The definition the model is built from (engine input). */
  definition: SlopeDefinition;
  options: Partial<AnalysisOptions>;
  /** The circle analysed; null: the search. */
  circle: Circle | null;
}

/** A 10 m high slope at 1:2 on flat ground (crest left). */
const SLOPE: Pt[] = [[0, -10], [0, 10], [15, 10], [35, 0], [60, 0], [60, -10]];

/** A 5 m high embankment at 1:2 (crest 25–35) on flat ground at y = 0. */
const EMBANKMENT: Pt[] = [[0, -12], [0, 0], [15, 0], [25, 5], [35, 5], [45, 0], [60, 0], [60, -12]];

/** An excavation 4 m deep: ground at 0 left of x = 20, at −4 right of x = 32. */
const EXCAVATION: Pt[] = [[0, -16], [0, 0], [20, 0], [32, -4], [60, -4], [60, -16]];

const mc = (unitWeight: number, cohesion: number, frictionAngle: number) =>
  ({ kind: "mohr-coulomb", unitWeight, cohesion, frictionAngle }) as const;

export const FEATURE_MODELS: FeatureModel[] = [
  {
    key: "01-ru",
    title: "ru 0.3",
    feature: "Pore pressure ratio rᵤ = 0.3 on a homogeneous slope, no water line",
    definition: {
      coordinates: SLOPE,
      materials: [{ name: "Clay ru", color: "#b59a6a", model: { ...mc(19, 8, 28), ru: 0.3 } }],
    },
    options: {},
    circle: { cx: 32.3, cy: 23.3, radius: 23.4 },
  },
  {
    key: "02-bbar-fill",
    title: "B-bar fill on clay",
    feature: "B̄ = 0.6 in the clay under a fill marked as load (bBarLoad), 20 kPa on the crest",
    definition: {
      coordinates: EMBANKMENT,
      materials: [
        { name: "Fill", color: "#c2a26b", model: { ...mc(19, 3, 35), bBarLoad: true } },
        { name: "Clay", color: "#7a9cc6", model: { ...mc(17, 5, 26), bBar: 0.6 } },
      ],
      materialBoundaries: [{ coordinates: [[0, 0], [60, 0]], materialName: "Clay" }],
      topRegionMaterialName: "Fill",
      regionAssignments: [
        { point: [30, 2], materialName: "Fill" },
        { point: [30, -5], materialName: "Clay" },
      ],
      waterTable: { mode: "custom", value: [[0, -1], [60, -1]] },
      udls: [{ magnitude: 20, x1: 26, x2: 34 }],
    },
    options: {},
    circle: { cx: 41, cy: 8.2, radius: 10.3 },
  },
  {
    key: "03-waternet",
    title: "Clay over aquifer",
    feature: "Head lines: phreatic line in the clay, higher head (+3) in the sand aquifer below −4",
    definition: {
      coordinates: SLOPE,
      materials: [
        { name: "Clay", color: "#7a9cc6", model: mc(18, 6, 27) },
        { name: "Sand aquifer", color: "#e0c97f", model: mc(19, 0, 34) },
      ],
      materialBoundaries: [{ coordinates: [[0, -4], [60, -4]], materialName: "Sand aquifer" }],
      regionAssignments: [
        { point: [5, 0], materialName: "Clay" },
        { point: [30, -7], materialName: "Sand aquifer" },
      ],
      waterTable: { mode: "custom", value: [[0, 7], [15, 7], [35, -0.5], [60, -0.5]] },
      waternet: {
        headLines: [
          { id: "PL1", points: [[0, 7], [15, 7], [35, -0.5], [60, -0.5]] },
          { id: "PL2", points: [[0, 3], [60, 3]] },
        ],
        referenceLines: [{ points: [[0, -4], [60, -4]], topHeadLineId: "PL2", bottomHeadLineId: "PL2" }],
        phreaticLineId: "PL1",
      },
    },
    options: {},
    circle: { cx: 35.3, cy: 21.3, radius: 25.5 },
  },
  {
    key: "04-shansep-excavation",
    title: "SHANSEP excavation",
    feature: "SHANSEP clay (S 0.25, m 0.8, POP 10 kPa) with the yield stress from an earlier stage before a 4 m excavation",
    definition: {
      coordinates: EXCAVATION,
      materials: [
        { name: "Soft clay", color: "#7a9cc6", model: { kind: "shansep", unitWeight: 16, ratio: 0.25, exponent: 0.8, pop: 10, yieldFromEarlierStage: true } },
        { name: "Sand", color: "#e0c97f", model: mc(19, 0, 35) },
      ],
      materialBoundaries: [{ coordinates: [[0, -12], [60, -12]], materialName: "Sand" }],
      regionAssignments: [
        { point: [10, -5], materialName: "Soft clay" },
        { point: [30, -14], materialName: "Sand" },
      ],
      waterTable: { mode: "custom", value: [[0, -1], [20, -1], [32, -4], [60, -4]] },
      earlierStage: {
        coordinates: [[0, -16], [0, 0], [60, 0], [60, -16]],
        materials: [
          { name: "Soft clay", model: mc(16, 0, 30) },
          { name: "Sand", model: mc(19, 0, 35) },
        ],
        materialBoundaries: [{ coordinates: [[0, -12], [60, -12]], materialName: "Sand" }],
        regionAssignments: [
          { point: [10, -5], materialName: "Soft clay" },
          { point: [30, -14], materialName: "Sand" },
        ],
        waterTable: { mode: "custom", value: [[0, -1], [60, -1]] },
      },
    },
    options: {},
    circle: { cx: 26.8, cy: 6.2, radius: 11.9 },
  },
  {
    key: "05-excess-pore-pressure",
    title: "Load with excess pore pressure",
    feature: "Distributed load 40 kPa on the crest with excess pore pressure 0.6 × load in the clay",
    definition: {
      coordinates: SLOPE,
      materials: [
        { name: "Crust", color: "#b59a6a", model: mc(18, 10, 30) },
        { name: "Clay", color: "#7a9cc6", model: mc(17, 3, 27) },
      ],
      materialBoundaries: [{ coordinates: [[0, 7], [60, 7]], materialName: "Clay" }],
      regionAssignments: [
        { point: [5, 9], materialName: "Crust" },
        { point: [30, -3], materialName: "Clay" },
      ],
      waterTable: { mode: "custom", value: [[0, 6], [15, 6], [35, -0.5], [60, -0.5]] },
      udls: [{ magnitude: 40, x1: 3, x2: 13, excessPorePressure: [{ material: "Clay", ratio: 0.6 }] }],
    },
    options: {},
    circle: { cx: 29.1, cy: 21.8, radius: 23.8 },
  },
  {
    key: "06-rapid-drawdown",
    title: "Rapid drawdown",
    feature: "Three-stage rapid drawdown from level +8 to +2; the clay has a drawdown envelope (cR 10, φR 16)",
    definition: {
      coordinates: SLOPE,
      materials: [
        {
          name: "Clay",
          color: "#7a9cc6",
          model: { ...mc(19, 5, 30), unitWeightSat: 20, drawdownStrength: { cohesion: 10, frictionAngle: 16 } },
        },
      ],
      waterTable: { mode: "custom", value: [[0, 6], [20, 4], [31, 2], [60, 2]], followBoundary: false },
      rapidDrawdown: { waterBefore: [[0, 8], [60, 8]] },
    },
    options: {},
    circle: { cx: 31.5, cy: 21.2, radius: 21.5 },
  },
  {
    key: "07-seismic",
    title: "Seismic kh 0.15",
    feature: "Pseudostatic seismic load kh = 0.15 (kv = 0), dry slope",
    definition: {
      coordinates: SLOPE,
      materials: [{ name: "Moraine", color: "#a3a3a3", model: mc(20, 10, 34) }],
    },
    options: { seismicHorizontal: 0.15 },
    circle: { cx: 33.6, cy: 26.8, radius: 26.8 },
  },
  {
    key: "08-inclined-line-load",
    title: "Inclined line load",
    feature: "Line load 80 kN/m at x = 10, inclined 30° from the vertical towards the slope",
    definition: {
      coordinates: SLOPE,
      materials: [{ name: "Sand", color: "#e0c97f", model: mc(19, 10, 32) }],
      lineLoads: [{ magnitude: 80, x: 10, angle: 30 }],
      // Global circles through the load (the search otherwise finds a small one under it).
      analysisLimits: { entryLeftX: 2, entryRightX: 9, exitLeftX: 30, exitRightX: 60 },
    },
    options: {},
    circle: { cx: 35.1, cy: 39, radius: 39 },
  },
];

/** The app model of a feature model (its circle analyzed alone, or the search). */
export function featureModel(f: FeatureModel, withCircle = true): ModelEntry {
  const def: SlopeDefinition = withCircle && f.circle ? { ...f.definition, customSearchPlanes: [f.circle], customPlanesOnly: true } : f.definition;
  return modelFromDefinition(def, { id: `beta-${f.key}`, name: f.title, options: f.options });
}

/**
 * One model with every material kind the dialogs show notices for: a fill
 * with rᵤ, B̄ load and a strength above the water line, SHANSEP clay with
 * POP and an imported earlier stage, silt with a drawdown envelope and
 * suction strength, rockfill with a shear-normal function; head lines,
 * rapid drawdown, seismic load, a distributed load with excess pore
 * pressure and two line loads (one inclined).
 */
export function designReviewModel(): ModelEntry {
  const boundary: Pt[] = [[0, -10], [0, 10], [15, 10], [35, 0.5], [60, 0.5], [60, -10]];
  const def: SlopeDefinition = {
    coordinates: boundary,
    materials: [
      {
        name: "Fill",
        color: "#c2a26b",
        model: { ...mc(20, 2, 34), bBarLoad: true, ru: 0.1, aboveWater: mc(20, 5, 36) },
      },
      { name: "Soft clay", color: "#7a9cc6", model: { kind: "shansep", unitWeight: 16, ratio: 0.3, exponent: 0.8, pop: 15, yieldFromEarlierStage: true, suMin: 10, bBar: 0.6 } },
      { name: "Silt", color: "#9fbf8a", model: { ...mc(18, 3, 28), drawdownStrength: { cohesion: 12, frictionAngle: 14 }, phiB: 15, maxSuction: 50 } },
      { name: "Rockfill", color: "#999999", model: { kind: "shear-normal", unitWeight: 21, points: [[0, 0], [50, 45], [200, 140], [500, 300]] } },
    ],
    materialBoundaries: [
      { coordinates: [[0, 2], [60, 2]], materialName: "Soft clay" },
      { coordinates: [[0, -4], [60, -4]], materialName: "Silt" },
      { coordinates: [[0, -7], [60, -7]], materialName: "Rockfill" },
    ],
    topRegionMaterialName: "Fill",
    regionAssignments: [
      { point: [5, 6], materialName: "Fill" },
      { point: [30, 0], materialName: "Soft clay" },
      { point: [30, -5], materialName: "Silt" },
      { point: [30, -8], materialName: "Rockfill" },
    ],
    waterTable: { mode: "custom", value: [[0, 6], [20, 5], [35, 0.5], [60, 0.5]] },
    rapidDrawdown: { waterBefore: [[0, 8], [25, 8], [60, 8]] },
    waternet: {
      headLines: [
        { id: "PL1", points: [[0, 6], [20, 5], [35, 0.5], [60, 0.5]] },
        { id: "PL2", points: [[0, 1.5], [60, 1]] },
        { id: "PL3", points: [[0, 2.5], [60, 2]] },
      ],
      referenceLines: [
        { points: [[0, 2], [60, 2]], topHeadLineId: "PL1", bottomHeadLineId: "PL2" },
        { points: [[0, -4], [60, -4]], topHeadLineId: "PL2", bottomHeadLineId: "PL3" },
      ],
      phreaticLineId: "PL1",
    },
    // The fill was placed long ago: the clay is consolidated under it (and
    // under a lower water table), so that the stress history matters.
    earlierStage: {
      coordinates: boundary,
      materials: [
        { name: "Fill", model: mc(20, 2, 34) },
        { name: "Soft clay", model: mc(16, 5, 25) },
        { name: "Silt", model: mc(18, 3, 28) },
        { name: "Rockfill", model: mc(21, 0, 40) },
      ],
      materialBoundaries: [
        { coordinates: [[0, 2], [60, 2]], materialName: "Soft clay" },
        { coordinates: [[0, -4], [60, -4]], materialName: "Silt" },
        { coordinates: [[0, -7], [60, -7]], materialName: "Rockfill" },
      ],
      topRegionMaterialName: "Fill",
      // by points, as an import gives it (a saved project keeps no boundary names in a stage)
      regionAssignments: [
        { point: [5, 6], materialName: "Fill" },
        { point: [30, 0], materialName: "Soft clay" },
        { point: [30, -5], materialName: "Silt" },
        { point: [30, -8], materialName: "Rockfill" },
      ],
      waterTable: { mode: "custom", value: [[0, 1], [60, 0]] },
    },
    udls: [{ magnitude: 20, x1: 2, x2: 12, excessPorePressure: [{ material: "Soft clay", ratio: 0.5 }, { material: "Silt", ratio: 0.2 }] }],
    lineLoads: [
      { magnitude: 50, x: 8, angle: 20 },
      { magnitude: 30, x: 45 },
    ],
  };
  return modelFromDefinition(def, {
    id: "design-review",
    name: "Design review embankment",
    options: { seismicHorizontal: 0.1, seismicVertical: -0.05 },
  });
}
