// @vitest-environment node
/**
 * Random parameter sets within the bounds (thin layers, a layer shallower
 * than the model's base, water above the ground and in the embankment, a
 * load on the crest): every set `embankmentProblems` accepts gives a
 * document the engine validates without an error, with every layer and the
 * embankment a region of its own. A failure prints the seed and the set.
 */
import { describe, expect, it } from "vitest";
import { initEngine, validateDefinition } from "@cslope/engine";
import { MIN_LAYER_THICKNESS } from "./common";
import { EMBANKMENT_PARAMETERS as P, embankmentDocument, embankmentProblems, type EmbankmentParams } from "./embankment";
import { material, random, randomValues, value } from "./random-params";
import { regionCount } from "./regions";

function randomParams(rnd: () => number): EmbankmentParams {
  const groundLevel = value(rnd, P.groundLevel, -20, 100);
  const embankmentHeight = value(rnd, P.embankmentHeight);
  // The deepest layer: now and then above the model's base (2h below the ground).
  const deepest = Math.max(P.layer.bottomLevel.min, Number((groundLevel - Math.max(0.5, rnd() * 5 * embankmentHeight)).toFixed(1)));
  const levels: number[] = [];
  let top = groundLevel;
  const wanted = Math.floor(rnd() * 5);
  for (let i = 0; i < wanted; i++) {
    // A third are 5–10 cm thick.
    const t = MIN_LAYER_THICKNESS;
    const thickness = rnd() < 0.3 ? t + rnd() * t : t + rnd() * 2 * embankmentHeight;
    const level = Number((Math.floor((top - thickness) * 100) / 100).toFixed(2));
    if (level > top - t || level < deepest + t) break;
    levels.push(level);
    top = level;
  }
  return {
    groundLevel,
    embankmentHeight,
    crestWidth: value(rnd, P.crestWidth),
    slope: value(rnd, P.slope),
    fill: { gamma: value(rnd, P.fill.gamma), gammaSat: rnd() < 0.5 ? value(rnd, P.fill.gammaSat) : undefined, c: value(rnd, P.fill.c), phi: value(rnd, P.fill.phi) },
    crestLoad: rnd() < 0.6 ? value(rnd, P.crestLoad) : null,
    layers: [...levels, deepest].map((bottomLevel) => ({ bottomLevel, material: material(rnd) })),
    // The water anywhere from well below the base to above the crest.
    waterLevel: rnd() < 0.8 ? value(rnd, P.waterLevel, groundLevel - 4 * embankmentHeight, groundLevel + embankmentHeight + 1) : null,
    values: randomValues(rnd),
  };
}

describe("random embankments within the bounds", () => {
  it("give documents the engine validates without an error, 500 times", async () => {
    await initEngine();
    const seed = 20261107;
    const rnd = random(seed);
    const seen = { load: 0, shallowLayers: 0, waterInEmbankment: 0, thin: 0, design: 0, layered: 0 };
    for (let i = 0; i < 500; i++) {
      const params = randomParams(rnd);
      const where = `set ${i} of seed ${seed}: ${JSON.stringify(params)}`;
      expect(embankmentProblems(params), where).toEqual([]);
      const doc = embankmentDocument(params);
      const issues = validateDefinition(doc);
      expect(
        issues.filter((x) => x.severity === "error").map((x) => `${x.path}: ${x.message}`),
        `${where}\n${JSON.stringify(doc)}`,
      ).toEqual([]);
      expect(regionCount(doc.definition), where).toBe(params.layers.length + 1);
      const G = params.groundLevel;
      if (params.crestLoad) seen.load++;
      if (params.layers[params.layers.length - 1].bottomLevel > G - 2 * params.embankmentHeight) seen.shallowLayers++;
      if (params.waterLevel !== null && params.waterLevel > G) seen.waterInEmbankment++;
      if (params.layers.some((l, k) => (k === 0 ? G : params.layers[k - 1].bottomLevel) - l.bottomLevel < 0.1)) seen.thin++;
      if (params.values.basis === "design") seen.design++;
      if (params.layers.length > 2) seen.layered++;
    }
    for (const [what, count] of Object.entries(seen)) expect(count, what).toBeGreaterThan(10);
  });
});
