/**
 * Eleven named parameter sets of the embankment template, with F pinned by
 * the tests (embankment.test.ts) and saved as analysis documents under
 * fixtures/embankment/ (scripts/write-fixtures.ts). The soil values are
 * illustrative, never defaults (B5).
 */
import type { EmbankmentParams } from "./embankment";

const characteristic = { basis: "characteristic" } as const;
const sand = { gamma: 19, c: 0, phi: 35 };

export const EMBANKMENT_EXAMPLES: Record<string, EmbankmentParams> = {
  /** A 2 m embankment on a soft clay, dry. */
  "clay-2m": {
    groundLevel: 0,
    embankmentHeight: 2,
    crestWidth: 6,
    slope: 2.5,
    fill: sand,
    crestLoad: null,
    layers: [{ name: "Clay", bottomLevel: -15, material: { kind: "undrained", gamma: 16, su: 10 } }],
    waterLevel: null,
    values: characteristic,
  },
  /** 3 m high on a firmer clay. */
  "clay-3m": {
    groundLevel: 0,
    embankmentHeight: 3,
    crestWidth: 6,
    slope: 2.5,
    fill: sand,
    crestLoad: null,
    layers: [{ name: "Clay", bottomLevel: -15, material: { kind: "undrained", gamma: 16, su: 15 } }],
    waterLevel: null,
    values: characteristic,
  },
  /** clay-3m with a traffic load on the crest and the water 1 m below the ground. */
  "clay-3m-traffic": {
    groundLevel: 0,
    embankmentHeight: 3,
    crestWidth: 6,
    slope: 2.5,
    fill: sand,
    crestLoad: 20,
    layers: [{ name: "Clay", bottomLevel: -15, material: { kind: "undrained", gamma: 16, su: 15 } }],
    waterLevel: -1,
    values: characteristic,
  },
  /** clay-3m-traffic on design values, safety class 2: F is an over-design factor. */
  "clay-3m-design-sk2": {
    groundLevel: 0,
    embankmentHeight: 3,
    crestWidth: 6,
    slope: 2.5,
    fill: sand,
    crestLoad: 20,
    layers: [{ name: "Clay", bottomLevel: -15, material: { kind: "undrained", gamma: 16, su: 15 } }],
    waterLevel: -1,
    values: { basis: "design", safetyClass: 2, etaCu: 1, etaDrained: 1, variableLoadBase: 1.3 },
  },
  /** Su growing with depth, 10 kPa at the ground and 1.5 kPa/m below it. */
  "clay-increasing": {
    groundLevel: 10,
    embankmentHeight: 4,
    crestWidth: 8,
    slope: 2.5,
    fill: sand,
    crestLoad: null,
    layers: [{ name: "Clay", bottomLevel: -10, material: { kind: "undrained-increasing", gamma: 16, su: 10, suRate: 1.5 } }],
    waterLevel: 9.5,
    values: characteristic,
  },
  /** A dry crust (drained) over soft clay. */
  "crust-over-clay": {
    groundLevel: 0,
    embankmentHeight: 3,
    crestWidth: 10,
    slope: 2,
    fill: { gamma: 20, c: 0, phi: 38 },
    crestLoad: 10,
    layers: [
      { name: "Crust", bottomLevel: -1.5, material: { kind: "drained", gamma: 18, c: 3, phi: 30 } },
      { name: "Clay", bottomLevel: -20, material: { kind: "undrained", gamma: 16, su: 14 } },
    ],
    waterLevel: -1,
    values: characteristic,
  },
  /** Thin clay over rock 5 m down: the critical surface runs along the rock. */
  "clay-over-rock": {
    groundLevel: 0,
    embankmentHeight: 4,
    crestWidth: 6,
    slope: 2,
    fill: { gamma: 19, c: 3, phi: 35 },
    crestLoad: null,
    layers: [
      { name: "Clay", bottomLevel: -5, material: { kind: "undrained", gamma: 17, su: 14 } },
      { name: "Rock", bottomLevel: -20, material: { kind: "impenetrable", gamma: 24 } },
    ],
    waterLevel: -0.5,
    values: characteristic,
  },
  /** A steep, low embankment of a cohesive fill on stiff clay: the surface stays in the fill. */
  "steep-on-stiff-clay": {
    groundLevel: 5,
    embankmentHeight: 3,
    crestWidth: 4,
    slope: 1.5,
    fill: { gamma: 20, c: 5, phi: 32 },
    crestLoad: 15,
    layers: [{ name: "Clay", bottomLevel: -10, material: { kind: "undrained", gamma: 18, su: 60 } }],
    waterLevel: null,
    values: characteristic,
  },
  /** A wide, high embankment with flat sides on a deep soft clay. */
  "wide-high": {
    groundLevel: 0,
    embankmentHeight: 6,
    crestWidth: 20,
    slope: 3,
    fill: { gamma: 20, c: 0, phi: 38 },
    crestLoad: 20,
    layers: [{ name: "Clay", bottomLevel: -30, material: { kind: "undrained-increasing", gamma: 16, su: 20, suRate: 1.2 } }],
    waterLevel: -1,
    values: characteristic,
  },
  /** Three layers, the water 0.5 m above the ground, seeping out of the embankment's faces, design values in safety class 3. */
  "three-layers-design-sk3": {
    groundLevel: 2,
    embankmentHeight: 4,
    crestWidth: 8,
    slope: 2,
    fill: { gamma: 19, c: 2, phi: 36 },
    crestLoad: 15,
    layers: [
      { name: "Crust", bottomLevel: 1, material: { kind: "drained", gamma: 18, c: 3, phi: 30 } },
      { name: "Clay", bottomLevel: -6, material: { kind: "undrained-increasing", gamma: 16, su: 14, suRate: 1.2 } },
      { name: "Silt", bottomLevel: -15, material: { kind: "drained", gamma: 19, c: 1, phi: 33 } },
    ],
    waterLevel: 2.5,
    values: { basis: "design", safetyClass: 3, etaCu: 0.9, etaDrained: 1, variableLoadBase: 1.4 },
  },
  /** clay-3m with the water 1 m above the ground, ponded beside the embankment. */
  "clay-3m-ponded": {
    groundLevel: 0,
    embankmentHeight: 3,
    crestWidth: 6,
    slope: 2.5,
    fill: sand,
    crestLoad: null,
    layers: [{ name: "Clay", bottomLevel: -15, material: { kind: "undrained", gamma: 16, su: 15 } }],
    waterLevel: 1,
    ponded: true,
    values: characteristic,
  },
};
