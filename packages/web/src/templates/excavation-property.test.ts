// @vitest-environment node
/**
 * Random parameter sets within the bounds (thin layers, a road at the
 * crest, an excavation deeper than every layer, water above the ground):
 * every set `excavationProblems` accepts gives a document the engine
 * validates without an error. A failure prints the seed and the set.
 */
import { describe, expect, it } from "vitest";
import { initEngine, validateDefinition } from "@cslope/engine";
import {
  EXCAVATION_PARAMETERS as P,
  excavationDocument,
  minLayerThickness,
  excavationProblems,
  type ExcavationParams,
  type Layer,
  type LayerMaterial,
  type ParameterDescriptionLike,
} from "./excavation";

/** mulberry32: a small seeded generator, so that a failure can be rerun. */
function random(seed: number): () => number {
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
function value(rnd: () => number, d: ParameterDescriptionLike, min = d.min, max = d.max): number {
  const steps = Math.floor((max - min) / d.step);
  const v = min + Math.floor(rnd() * (steps + 1)) * d.step;
  return Number(Math.min(max, v).toFixed(6));
}

const pick = <T>(rnd: () => number, items: readonly T[]): T => items[Math.floor(rnd() * items.length)];

function material(rnd: () => number): LayerMaterial {
  const gamma = value(rnd, P.layer.gamma);
  switch (pick(rnd, ["undrained", "undrained-increasing", "drained", "impenetrable"] as const)) {
    case "undrained":
      return { kind: "undrained", gamma, su: value(rnd, P.layer.su) };
    case "undrained-increasing":
      return { kind: "undrained-increasing", gamma, su: value(rnd, P.layer.su), suRate: value(rnd, P.layer.suRate) };
    case "drained":
      return { kind: "drained", gamma, c: value(rnd, P.layer.c), phi: value(rnd, P.layer.phi) };
    case "impenetrable":
      return { kind: "impenetrable", gamma };
  }
}

/**
 * A parameter set within the bounds. The geometry is drawn first (the
 * depth, the slope, the road, the deepest layer), then the levels between
 * the ground and the deepest layer with that model's least thickness
 * (minLayerThickness), mostly thin ones near the excavation.
 */
export function randomParams(rnd: () => number): ExcavationParams {
  const groundLevel = value(rnd, P.groundLevel, -20, 100);
  const excavationDepth = value(rnd, P.excavationDepth);
  const bottom = groundLevel - excavationDepth;
  const road =
    rnd() < 0.6
      ? {
          // A fifth of the roads stand at the crest.
          distanceFromCrest: rnd() < 0.2 ? 0 : value(rnd, P.road.distanceFromCrest, 0, 12),
          width: value(rnd, P.road.width),
          height: value(rnd, P.road.height),
          fill: { gamma: value(rnd, P.road.gamma), c: value(rnd, P.road.c), phi: value(rnd, P.road.phi) },
          trafficLoad: rnd() < 0.7 ? value(rnd, P.road.trafficLoad) : null,
        }
      : null;
  // The deepest layer: above the bottom now and then (an excavation deeper than every layer).
  const deepest = Math.max(P.layer.bottomLevel.min, Number((groundLevel - Math.max(0.5, rnd() * 5 * excavationDepth)).toFixed(1)));
  const shape: ExcavationParams = {
    groundLevel,
    excavationDepth,
    slope: value(rnd, P.slope),
    bottomWidth: rnd() < 0.5 ? null : value(rnd, P.bottomWidth),
    layers: [{ bottomLevel: deepest, material: material(rnd) }],
    waterLevel: null,
    road,
    values: { basis: "characteristic" },
  };
  const thin = minLayerThickness(shape);
  // The deepest layer is at least that thick too (moving it up stays above 2H below the bottom: the size holds).
  shape.layers[0].bottomLevel = Math.min(deepest, Math.floor((groundLevel - thin) * 10) / 10);
  const levels: number[] = [];
  let top = groundLevel;
  const wanted = Math.floor(rnd() * 5);
  for (let i = 0; i < wanted; i++) {
    const thickness = rnd() < 0.7 ? thin + rnd() * 2 : thin + rnd() * 2 * excavationDepth;
    let level = Math.floor((top - thickness) * 10) / 10;
    if (Math.abs(level - bottom) < thin) level = Math.floor((bottom - thin) * 10) / 10;
    level = Number(level.toFixed(1));
    if (level > top - thin || level < shape.layers[0].bottomLevel + thin) break;
    levels.push(level);
    top = level;
  }
  const layers: Layer[] = [...levels.map((bottomLevel) => ({ bottomLevel, material: material(rnd) })), shape.layers[0]];
  // The water anywhere from well below the base to above the ground (and the road).
  const waterLevel = rnd() < 0.8 ? value(rnd, P.waterLevel, groundLevel - 4 * excavationDepth, groundLevel + 3) : null;
  const values: ExcavationParams["values"] =
    rnd() < 0.5
      ? { basis: "characteristic" }
      : {
          basis: "design",
          safetyClass: pick(rnd, [1, 2, 3] as const),
          etaCu: value(rnd, P.design.etaCu),
          etaDrained: value(rnd, P.design.etaDrained),
          variableLoadBase: value(rnd, P.design.variableLoadBase),
        };
  return { ...shape, layers, waterLevel, values };
}

describe("random parameter sets within the bounds", () => {
  it("give documents the engine validates without an error, 500 times", async () => {
    await initEngine();
    const seed = 20261106;
    const rnd = random(seed);
    const seen = { road: 0, roadAtCrest: 0, deeperThanLayers: 0, waterAboveGround: 0, thin: 0, design: 0, warnings: 0 };
    for (let i = 0; i < 500; i++) {
      const params = randomParams(rnd);
      const where = `set ${i} of seed ${seed}: ${JSON.stringify(params)}`;
      expect(excavationProblems(params), where).toEqual([]);
      const doc = excavationDocument(params);
      const issues = validateDefinition(doc);
      expect(
        issues.filter((x) => x.severity === "error").map((x) => `${x.path}: ${x.message}`),
        `${where}\n${JSON.stringify(doc)}`,
      ).toEqual([]);
      if (issues.length) seen.warnings++;
      if (params.road) seen.road++;
      if (params.road && params.road.distanceFromCrest === 0) seen.roadAtCrest++;
      if (params.layers.every((l) => l.bottomLevel > params.groundLevel - params.excavationDepth)) seen.deeperThanLayers++;
      if (params.waterLevel !== null && params.waterLevel > params.groundLevel) seen.waterAboveGround++;
      if (params.layers.some((l, k) => (k === 0 ? params.groundLevel : params.layers[k - 1].bottomLevel) - l.bottomLevel < 0.3)) seen.thin++;
      if (params.values.basis === "design") seen.design++;
    }
    // The cases the issue names all came up.
    for (const [what, count] of Object.entries(seen)) expect(count, what).toBeGreaterThan(what === "warnings" ? -1 : 10);
  });
});
