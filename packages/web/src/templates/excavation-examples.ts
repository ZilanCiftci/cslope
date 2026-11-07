/**
 * Ten named parameter sets of the excavation template, with F pinned by
 * the tests (excavation.test.ts) and saved as analysis documents under
 * fixtures/ (scripts/write-fixtures.ts), so that Python's tests can run
 * the same files. The soil values are illustrative, never defaults (B5).
 */
import type { ExcavationParams } from "./excavation";

const characteristic = { basis: "characteristic" } as const;

export const EXCAVATION_EXAMPLES: Record<string, ExcavationParams> = {
  /** One clay, dry, no road. */
  "clay-3m": {
    groundLevel: 10,
    excavationDepth: 3,
    slope: 1.5,
    bottomWidth: null,
    layers: [{ bottomLevel: -5, material: { kind: "undrained", gamma: 16, su: 20 } }],
    waterLevel: null,
    road: null,
    values: characteristic,
  },
  /** One clay with the water 1 m below the ground. */
  "clay-5m-water": {
    groundLevel: 10,
    excavationDepth: 5,
    slope: 2,
    bottomWidth: null,
    layers: [{ bottomLevel: -10, material: { kind: "undrained", gamma: 16, su: 25 } }],
    waterLevel: 9,
    road: null,
    values: characteristic,
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
    values: characteristic,
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
    values: characteristic,
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
    values: characteristic,
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
    values: characteristic,
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
    values: characteristic,
  },
  /** clay-road on design values, safety class 2: F is an over-design factor. */
  "clay-road-design-sk2": {
    groundLevel: 0,
    excavationDepth: 4,
    slope: 2,
    bottomWidth: null,
    layers: [{ bottomLevel: -20, material: { kind: "undrained", gamma: 16, su: 25 } }],
    waterLevel: -1,
    road: { distanceFromCrest: 3, width: 4, height: 0.8, fill: { gamma: 20, c: 0, phi: 38 }, trafficLoad: 20 },
    values: { basis: "design", safetyClass: 2, etaCu: 1, etaDrained: 1, variableLoadBase: 1.3 },
  },
  /** A steep slope 1:1, the road at the crest. */
  "steep-road-at-crest": {
    groundLevel: 20,
    excavationDepth: 6,
    slope: 1,
    bottomWidth: 10,
    layers: [{ bottomLevel: 0, material: { kind: "undrained", gamma: 17, su: 35 } }],
    waterLevel: 19,
    road: { distanceFromCrest: 0, width: 5, height: 1, fill: { gamma: 21, c: 2, phi: 36 }, trafficLoad: 30 },
    values: characteristic,
  },
  /** Three layers, a wide bottom, the water above the bottom, the road 10 m back. */
  "three-layers-wide": {
    groundLevel: 5,
    excavationDepth: 6,
    slope: 2.5,
    bottomWidth: 30,
    layers: [
      { name: "Crust", bottomLevel: 3, material: { kind: "drained", gamma: 18, c: 3, phi: 30 } },
      { name: "Clay", bottomLevel: -3, material: { kind: "undrained-increasing", gamma: 16, su: 14, suRate: 1.2 } },
      { name: "Silt", bottomLevel: -15, material: { kind: "drained", gamma: 19, c: 1, phi: 33 } },
    ],
    waterLevel: 1,
    road: { distanceFromCrest: 10, width: 6, height: 1.2, fill: { gamma: 20, c: 0, phi: 40 }, trafficLoad: 15 },
    values: { basis: "design", safetyClass: 3, etaCu: 0.9, etaDrained: 1, variableLoadBase: 1.4 },
  },
};
