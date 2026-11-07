/**
 * Random parameters within the templates' bounds, for the property tests
 * (excavation-property.test.ts, embankment-property.test.ts): a seeded
 * generator, so that a failure can be rerun.
 */
import { DESIGN_PARAMETERS as D, LAYER_PARAMETERS as L, type LayerMaterial, type ParameterDescriptionLike, type Values } from "./common";

/** mulberry32: a small seeded generator, so that a failure can be rerun. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A value within a parameter's bounds, on its step. */
export function value(rnd: () => number, d: ParameterDescriptionLike, min = d.min, max = d.max): number {
  const steps = Math.floor((max - min) / d.step);
  const v = min + Math.floor(rnd() * (steps + 1)) * d.step;
  return Number(Math.min(max, v).toFixed(6));
}

export const pick = <T>(rnd: () => number, items: readonly T[]): T => items[Math.floor(rnd() * items.length)];

export function material(rnd: () => number): LayerMaterial {
  const gamma = value(rnd, L.gamma);
  switch (pick(rnd, ["undrained", "undrained-increasing", "drained", "impenetrable"] as const)) {
    case "undrained":
      return { kind: "undrained", gamma, su: value(rnd, L.su) };
    case "undrained-increasing":
      return { kind: "undrained-increasing", gamma, su: value(rnd, L.su), suRate: value(rnd, L.suRate) };
    case "drained":
      return { kind: "drained", gamma, gammaSat: rnd() < 0.5 ? value(rnd, L.gammaSat) : undefined, c: value(rnd, L.c), phi: value(rnd, L.phi) };
    case "impenetrable":
      return { kind: "impenetrable", gamma };
  }
}

/** Characteristic values half of the time, design values in a random safety class the other half. */
export function randomValues(rnd: () => number): Values {
  return rnd() < 0.5
    ? { basis: "characteristic" }
    : {
        basis: "design",
        safetyClass: pick(rnd, [1, 2, 3] as const),
        etaCu: value(rnd, D.etaCu),
        etaDrained: value(rnd, D.etaDrained),
        variableLoadBase: value(rnd, D.variableLoadBase),
      };
}
