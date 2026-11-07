// @vitest-environment node
/**
 * Random parameter sets within the bounds (thin layers, a base shallower
 * than recommended, water above the ground and in the embankment, a
 * load on the crest): every set `embankmentProblems` accepts gives a
 * document the engine validates without an error, with every layer and the
 * embankment a region of its own. A failure prints the seed and the set.
 */
import { describe, expect, it } from "vitest";
import { initEngine, validateDefinition } from "@cslope/engine";
import { MIN_LAYER_THICKNESS } from "./common";
import { EMBANKMENT_PARAMETERS as P, embankmentDocument, embankmentNotes, embankmentProblems, modelDepth, type EmbankmentParams } from "./embankment";
import { material, random, value } from "./random-params";
import { regionCount } from "./regions";
import { bottomLevels } from "../form/layers";

function randomParams(rnd: () => number): EmbankmentParams {
  const groundLevel = value(rnd, P.groundLevel, -20, 100);
  const embankmentHeight = value(rnd, P.embankmentHeight);
  const crestWidth = value(rnd, P.crestWidth);
  const slope = value(rnd, P.slope);
  // The last layer's bottom (the model's base): mostly at or below the recommended depth, now and then shallower (a note).
  const recommended = modelDepth({ embankmentHeight, crestWidth, slope });
  const depth = rnd() < 0.85 ? recommended * (1 + rnd()) : 0.2 + rnd() * (recommended - 0.2);
  const deepest = Math.max(P.layer.bottomLevel.min, Math.floor((groundLevel - depth) * 10) / 10);
  // The layers' thicknesses down from the ground, as the form takes them, in whole centimeters; the last reaches the deepest level.
  const thin = MIN_LAYER_THICKNESS;
  const ts: number[] = [];
  let top = groundLevel;
  const wanted = Math.floor(rnd() * 5);
  for (let i = 0; i < wanted; i++) {
    // A third are 5–10 cm thick.
    const t = Math.ceil(Number(((rnd() < 0.3 ? thin + rnd() * thin : thin + rnd() * 2 * embankmentHeight) * 100).toFixed(6))) / 100;
    const [level] = bottomLevels(top, [t]);
    if (level < deepest + thin) break;
    ts.push(t);
    top = level;
  }
  ts.push(Number((top - deepest).toFixed(6)));
  return {
    groundLevel,
    embankmentHeight,
    crestWidth,
    slope,
    fill: { gamma: value(rnd, P.fill.gamma), c: value(rnd, P.fill.c), phi: value(rnd, P.fill.phi) },
    crestLoad: rnd() < 0.6 ? value(rnd, P.crestLoad) : null,
    layers: bottomLevels(groundLevel, ts).map((bottomLevel) => ({ bottomLevel, material: material(rnd) })),
    // The water anywhere from well below the base to the crest.
    waterLevel: rnd() < 0.8 ? value(rnd, P.waterLevel, groundLevel - 4 * embankmentHeight, groundLevel + embankmentHeight) : null,
    // Now and then ponded water beside the embankment (nothing without water).
    ...(rnd() < 0.3 ? { ponded: true } : {}),
  };
}

describe("random embankments within the bounds", () => {
  it("give documents the engine validates without an error, 500 times", async () => {
    await initEngine();
    const seed = 20261107;
    const rnd = random(seed);
    const seen = { load: 0, shallowLayers: 0, deepLayers: 0, waterInEmbankment: 0, thin: 0, layered: 0 };
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
      const shallow = params.layers[params.layers.length - 1].bottomLevel > G - modelDepth(params) + 1e-9;
      expect(embankmentNotes(params).some((n) => n.startsWith("The model ends")), where).toBe(shallow);
      if (shallow) seen.shallowLayers++;
      else seen.deepLayers++;
      if (params.waterLevel !== null && params.waterLevel > G) seen.waterInEmbankment++;
      if (params.layers.some((l, k) => (k === 0 ? G : params.layers[k - 1].bottomLevel) - l.bottomLevel < 0.1)) seen.thin++;
      if (params.layers.length > 2) seen.layered++;
    }
    for (const [what, count] of Object.entries(seen)) expect(count, what).toBeGreaterThan(10);
  });
});
