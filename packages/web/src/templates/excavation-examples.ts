/**
 * The named parameter sets of the excavation template, with F pinned by
 * the tests (excavation.test.ts) and saved as analysis documents under
 * fixtures/ (scripts/write-fixtures.ts), so that Python's tests can run
 * the same files. The soil values are illustrative; "defaults" is the
 * form's first visit (EXCAVATION_DEFAULTS).
 */
import type { ExcavationParams } from "./excavation";

/**
 * The first visit of the excavation: a complete section, so that the page
 * computes F at once. Typical values: a 2.5 m cut at 1:2 through a dry
 * crust and a soft clay into sand and gravel, which reaches below 3H
 * (no shallow-base note), and a low haul road with traffic 1 m
 * behind the crest; dry.
 */
export const EXCAVATION_DEFAULTS: ExcavationParams = {
  groundLevel: 0,
  excavationDepth: 2.5,
  slope: 2,
  bottomWidth: null,
  layers: [
    { name: "Dry crust", bottomLevel: -1, material: { kind: "undrained", gamma: 17, su: 30 } },
    { name: "Clay", bottomLevel: -4, material: { kind: "undrained", gamma: 17, su: 15 } },
    { name: "Sand and gravel", bottomLevel: -9, material: { kind: "drained", gamma: 22, c: 0, phi: 35 } },
  ],
  waterLevel: null,
  road: { distanceFromCrest: 1, width: 4, height: 0.3, fill: { gamma: 18, c: 0, phi: 39 }, trafficLoad: 15 },
};

export const EXCAVATION_EXAMPLES: Record<string, ExcavationParams> = {
  defaults: EXCAVATION_DEFAULTS,
  /** One clay on rock 15 m down, dry, no road. */
  "clay-3m": {
    groundLevel: 10,
    excavationDepth: 3,
    slope: 1.5,
    bottomWidth: null,
    layers: [
      { bottomLevel: -5, material: { kind: "undrained", gamma: 16, su: 20 } },
      { bottomLevel: -15, material: { kind: "impenetrable", gamma: 24 } },
    ],
    waterLevel: null,
    road: null,
  },
  /** One clay on rock 20 m down, with the water 1 m below the ground. */
  "clay-5m-water": {
    groundLevel: 10,
    excavationDepth: 5,
    slope: 2,
    bottomWidth: null,
    layers: [
      { bottomLevel: -10, material: { kind: "undrained", gamma: 16, su: 25 } },
      { bottomLevel: -20, material: { kind: "impenetrable", gamma: 24 } },
    ],
    waterLevel: 9,
    road: null,
  },
  /** Su growing with depth, 15 kPa at the ground and 1.5 kPa/m below it. */
  "clay-increasing": {
    groundLevel: 10,
    excavationDepth: 5,
    slope: 2,
    bottomWidth: null,
    layers: [{ bottomLevel: -10, material: { kind: "undrained-increasing", gamma: 16, su: 15, suRate: 1.5 } }],
    waterLevel: 9,
    road: null,
  },
  /** A dry crust (drained) over soft clay. */
  "crust-over-clay": {
    groundLevel: 0,
    excavationDepth: 4,
    slope: 2,
    bottomWidth: null,
    layers: [
      { name: "Crust", bottomLevel: -1.5, material: { kind: "drained", gamma: 18, c: 2, phi: 32 } },
      { name: "Clay", bottomLevel: -20, material: { kind: "undrained", gamma: 16.5, su: 18 } },
    ],
    waterLevel: -1,
    road: null,
  },
  /** Clay over rock 8 m down: the surfaces stay above the rock. */
  "clay-over-rock": {
    groundLevel: 0,
    excavationDepth: 5,
    slope: 1.5,
    bottomWidth: null,
    layers: [
      { name: "Clay", bottomLevel: -8, material: { kind: "undrained", gamma: 17, su: 22 } },
      { name: "Rock", bottomLevel: -20, material: { kind: "impenetrable", gamma: 24 } },
    ],
    waterLevel: -1,
    road: null,
  },
  /** The road 3 m behind the crest with a traffic load. */
  "clay-road": {
    groundLevel: 0,
    excavationDepth: 4,
    slope: 2,
    bottomWidth: null,
    layers: [{ bottomLevel: -20, material: { kind: "undrained", gamma: 16, su: 25 } }],
    waterLevel: -1,
    road: { distanceFromCrest: 3, width: 4, height: 0.8, fill: { gamma: 20, c: 0, phi: 38 }, trafficLoad: 20 },
  },
  /** The same road without traffic. */
  "clay-road-no-traffic": {
    groundLevel: 0,
    excavationDepth: 4,
    slope: 2,
    bottomWidth: null,
    layers: [{ bottomLevel: -20, material: { kind: "undrained", gamma: 16, su: 25 } }],
    waterLevel: -1,
    road: { distanceFromCrest: 3, width: 4, height: 0.8, fill: { gamma: 20, c: 0, phi: 38 }, trafficLoad: null },
  },
  /** A steep slope 1:1, the road's fill reaching the crest (its top 1.5 m behind it). */
  "steep-road-at-crest": {
    groundLevel: 20,
    excavationDepth: 6,
    slope: 1,
    bottomWidth: null,
    layers: [{ bottomLevel: 0, material: { kind: "undrained", gamma: 17, su: 35 } }],
    waterLevel: 19,
    road: { distanceFromCrest: 1.5, width: 5, height: 1, fill: { gamma: 21, c: 2, phi: 36 }, trafficLoad: 30 },
  },
  /** Three layers, the water above the bottom, the road 10 m back. */
  "three-layers-wide": {
    groundLevel: 5,
    excavationDepth: 6,
    slope: 2.5,
    bottomWidth: null,
    layers: [
      { name: "Crust", bottomLevel: 3, material: { kind: "drained", gamma: 18, c: 3, phi: 30 } },
      { name: "Clay", bottomLevel: -3, material: { kind: "undrained-increasing", gamma: 16, su: 14, suRate: 1.2 } },
      { name: "Silt", bottomLevel: -15, material: { kind: "drained", gamma: 19, c: 1, phi: 33 } },
    ],
    waterLevel: 1,
    road: { distanceFromCrest: 10, width: 6, height: 1.2, fill: { gamma: 20, c: 0, phi: 40 }, trafficLoad: 15 },
  },
  /** A trench 1 m wide at the bottom, 3 m deep with sides 1:1, in clay, the water 1 m down. */
  "trench-1m": {
    groundLevel: 0,
    excavationDepth: 3,
    slope: 1,
    bottomWidth: 1,
    layers: [{ name: "Clay", bottomLevel: -12, material: { kind: "undrained", gamma: 17, su: 20 } }],
    waterLevel: -1,
    road: null,
  },
  /** A trench 2 m wide at the bottom, 4 m deep at 1:1.5, a crust over clay with Su growing with depth, the road 2 m behind the crest. */
  "trench-2m-road": {
    groundLevel: 0,
    excavationDepth: 4,
    slope: 1.5,
    bottomWidth: 2,
    layers: [
      { name: "Crust", bottomLevel: -1.5, material: { kind: "drained", gamma: 18, c: 2, phi: 32 } },
      { name: "Clay", bottomLevel: -15, material: { kind: "undrained-increasing", gamma: 16, su: 18, suRate: 1.2 } },
    ],
    waterLevel: -1.5,
    road: { distanceFromCrest: 2, width: 4, height: 0.5, fill: { gamma: 20, c: 0, phi: 38 }, trafficLoad: 20 },
  },
  /** clay-5m-water with the water 2 m above the excavation bottom, ponded in the excavation. */
  "clay-5m-ponded": {
    groundLevel: 10,
    excavationDepth: 5,
    slope: 2,
    bottomWidth: null,
    layers: [
      { bottomLevel: -10, material: { kind: "undrained", gamma: 16, su: 25 } },
      { bottomLevel: -20, material: { kind: "impenetrable", gamma: 24 } },
    ],
    waterLevel: 7,
    ponded: true,
    road: null,
  },
};
