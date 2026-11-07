// @vitest-environment node
/**
 * Random parameter sets within the bounds (thin layers, a road at the
 * crest, an excavation deeper than every layer, water above the ground):
 * every set `excavationProblems` accepts gives a document the engine
 * validates without an error. A failure prints the seed and the set.
 */
import { describe, expect, it } from "vitest";
import { initEngine, validateDefinition } from "@cslope/engine";
import { regionCount } from "./regions";
import { EXCAVATION_PARAMETERS as P, MIN_LAYER_THICKNESS, excavationDocument, excavationProblems, type ExcavationParams, type Layer } from "./excavation";
import { material, random, randomValues, value } from "./random-params";

/**
 * A parameter set within the bounds. The geometry is drawn first (the
 * depth, the slope, the road, the deepest layer), then the levels between
 * the ground and the deepest layer, at least 5 cm apart
 * (MIN_LAYER_THICKNESS), mostly thin ones near the excavation.
 */
function randomParams(rnd: () => number): ExcavationParams {
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
          fill: { gamma: value(rnd, P.road.gamma), gammaSat: rnd() < 0.5 ? value(rnd, P.road.gammaSat) : undefined, c: value(rnd, P.road.c), phi: value(rnd, P.road.phi) },
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
  const thin = MIN_LAYER_THICKNESS;
  const levels: number[] = [];
  let top = groundLevel;
  const wanted = Math.floor(rnd() * 5);
  for (let i = 0; i < wanted; i++) {
    // A third are 5–10 cm thick.
    const thickness = rnd() < 0.3 ? thin + rnd() * thin : rnd() < 0.7 ? thin + rnd() * 2 : thin + rnd() * 2 * excavationDepth;
    let level = Math.floor((top - thickness) * 100) / 100;
    if (Math.abs(level - bottom) < thin) level = Math.floor((bottom - thin) * 100) / 100;
    level = Number(level.toFixed(2));
    if (level > top - thin || level < shape.layers[0].bottomLevel + thin) break;
    levels.push(level);
    top = level;
  }
  const layers: Layer[] = [...levels.map((bottomLevel) => ({ bottomLevel, material: material(rnd) })), shape.layers[0]];
  // The water anywhere from well below the base to above the ground (and the road).
  const waterLevel = rnd() < 0.8 ? value(rnd, P.waterLevel, groundLevel - 4 * excavationDepth, groundLevel + 3) : null;
  const values = randomValues(rnd);
  const tensionCrackDepth = rnd() < 0.3 ? value(rnd, P.tensionCrackDepth, 0, 3) : undefined;
  return { ...shape, layers, waterLevel, values, tensionCrackDepth };
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
      // Every layer and the road is a region of its own.
      expect(regionCount(doc.definition), where).toBe(params.layers.length + (params.road ? 1 : 0));
      if (issues.length) seen.warnings++;
      if (params.road) seen.road++;
      if (params.road && params.road.distanceFromCrest === 0) seen.roadAtCrest++;
      if (params.layers.every((l) => l.bottomLevel > params.groundLevel - params.excavationDepth)) seen.deeperThanLayers++;
      if (params.waterLevel !== null && params.waterLevel > params.groundLevel) seen.waterAboveGround++;
      if (params.layers.some((l, k) => (k === 0 ? params.groundLevel : params.layers[k - 1].bottomLevel) - l.bottomLevel < 0.1)) seen.thin++;
      if (params.values.basis === "design") seen.design++;
    }
    // The cases the issue names all came up.
    for (const [what, count] of Object.entries(seen)) expect(count, what).toBeGreaterThan(what === "warnings" ? -1 : 10);
  });
});
