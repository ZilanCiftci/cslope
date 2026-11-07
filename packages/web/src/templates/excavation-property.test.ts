// @vitest-environment node
/**
 * Random parameter sets within the bounds (thin layers, a road at the
 * crest, a base shallower than recommended, water above the ground):
 * every set `excavationProblems` accepts gives a document the engine
 * validates without an error. A failure prints the seed and the set.
 */
import { describe, expect, it } from "vitest";
import { initEngine, validateDefinition } from "@cslope/engine";
import { regionCount } from "./regions";
import { EXCAVATION_PARAMETERS as P, MIN_LAYER_THICKNESS, RECOMMENDED_DEPTH, excavationDocument, excavationNotes, excavationProblems, type ExcavationParams, type Layer } from "./excavation";
import { material, random, value } from "./random-params";
import { bottomLevels } from "../form/layers";

/**
 * A parameter set within the bounds. The geometry is drawn first (the
 * depth, the slope, the road, the deepest layer), then the layers'
 * thicknesses down from the ground, as the form takes them, at least 5 cm
 * (MIN_LAYER_THICKNESS), mostly thin ones near the excavation; the last
 * layer reaches the deepest level. The levels are the form's (bottomLevels).
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
          fill: { gamma: value(rnd, P.road.gamma), c: value(rnd, P.road.c), phi: value(rnd, P.road.phi) },
          trafficLoad: rnd() < 0.7 ? value(rnd, P.road.trafficLoad) : null,
        }
      : null;
  // The last layer's bottom (the model's base): mostly at or below the recommended 3H, now and then
  // shallower (a note), but always below the excavation bottom.
  const depth = rnd() < 0.85 ? RECOMMENDED_DEPTH * excavationDepth * (1 + rnd()) : excavationDepth + 0.1 + rnd() * (RECOMMENDED_DEPTH - 1) * excavationDepth;
  const deepest = Math.max(P.layer.bottomLevel.min, Math.floor((groundLevel - depth) * 10) / 10);
  const shape: ExcavationParams = {
    groundLevel,
    excavationDepth,
    slope: value(rnd, P.slope),
    bottomWidth: rnd() < 0.5 ? null : value(rnd, P.bottomWidth),
    layers: [{ bottomLevel: deepest, material: material(rnd) }],
    waterLevel: null,
    road,
  };
  const thin = MIN_LAYER_THICKNESS;
  const cm = (v: number) => Math.ceil(Number((v * 100).toFixed(6))) / 100;
  const ts: number[] = [];
  let top = groundLevel;
  const wanted = Math.floor(rnd() * 5);
  for (let i = 0; i < wanted; i++) {
    // A third are 5–10 cm thick; in whole centimeters.
    let t = cm(rnd() < 0.3 ? thin + rnd() * thin : rnd() < 0.7 ? thin + rnd() * 2 : thin + rnd() * 2 * excavationDepth);
    let [level] = bottomLevels(top, [t]);
    // A layer that would end within 5 cm of the excavation bottom ends 5 cm below it.
    if (Math.abs(level - bottom) < thin) [level] = bottomLevels(top, [(t = cm(top - bottom + thin))]);
    if (level < deepest + thin) break;
    ts.push(t);
    top = level;
  }
  // The last layer reaches the deepest level.
  ts.push(Number((top - deepest).toFixed(6)));
  const layers: Layer[] = bottomLevels(groundLevel, ts).map((bottomLevel, i) => (i === ts.length - 1 ? { ...shape.layers[0], bottomLevel } : { bottomLevel, material: material(rnd) }));
  // The water anywhere from well below the base to above the ground (and the road).
  const waterLevel = rnd() < 0.8 ? value(rnd, P.waterLevel, groundLevel - 4 * excavationDepth, groundLevel + 3) : null;
  return { ...shape, layers, waterLevel, ...(waterLevel !== null && rnd() < 0.3 ? { ponded: true } : {}) };
}

describe("random parameter sets within the bounds", () => {
  it("give documents the engine validates without an error, 500 times", async () => {
    await initEngine();
    const seed = 20261106;
    const rnd = random(seed);
    const seen = { trench: 0, road: 0, roadAtCrest: 0, shallowBase: 0, deepBase: 0, waterAboveGround: 0, thin: 0, warnings: 0 };
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
      // Every layer and the road is a region of its own; in a trench, a layer above the bottom is one on each side.
      const bottom = params.groundLevel - params.excavationDepth;
      const split = params.bottomWidth === null ? 0 : params.layers.filter((l) => l.bottomLevel > bottom).length;
      expect(regionCount(doc.definition), where).toBe(params.layers.length + split + (params.road ? 1 : 0));
      if (params.bottomWidth !== null) seen.trench++;
      if (issues.length) seen.warnings++;
      if (params.road) seen.road++;
      if (params.road && params.road.distanceFromCrest === 0) seen.roadAtCrest++;
      const shallow = params.layers[params.layers.length - 1].bottomLevel > params.groundLevel - RECOMMENDED_DEPTH * params.excavationDepth + 1e-9;
      expect(excavationNotes(params).some((n) => n.startsWith("The model ends")), where).toBe(shallow);
      if (shallow) seen.shallowBase++;
      else seen.deepBase++;
      if (params.waterLevel !== null && params.waterLevel > params.groundLevel) seen.waterAboveGround++;
      if (params.layers.some((l, k) => (k === 0 ? params.groundLevel : params.layers[k - 1].bottomLevel) - l.bottomLevel < 0.1)) seen.thin++;
    }
    // The cases the issue names all came up.
    for (const [what, count] of Object.entries(seen)) expect(count, what).toBeGreaterThan(what === "warnings" ? -1 : 10);
  });
});
