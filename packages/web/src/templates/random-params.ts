/**
 * Random parameters within the templates' bounds, for the property tests
 * (excavation-property.test.ts, embankment-property.test.ts): a seeded
 * generator, so that a failure can be rerun.
 */
import { LAYER_PARAMETERS as L, type LayerMaterial, type ParameterDescriptionLike } from "./common";

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
export function value(rnd: () => number, d: ParameterDescriptionLike, min = d.typical?.[0] ?? d.min, max = d.typical?.[1] ?? d.max): number {
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
    case "drained": {
      // Now and then φ′ = 0, with c′ > 0 (both 0 is no strength, refused by the engine).
      const phi = rnd() < 0.1 ? 0 : value(rnd, L.phi);
      return { kind: "drained", gamma, c: value(rnd, L.c, phi === 0 ? 1 : 0), phi };
    }
    case "impenetrable":
      return { kind: "impenetrable", gamma };
  }
}
