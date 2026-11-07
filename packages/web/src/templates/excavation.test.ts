// @vitest-environment node
/**
 * The excavation template: the geometry rules, the ten named sets against
 * their pinned F and their committed fixtures, and the monotonic checks
 * (F falls with a deeper excavation, a lower Su and the road).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { initEngine, publicDefaultOptions, swedishPartialFactors as engineFactors, validateDefinition } from "@cslope/engine";
import { dumps } from "../engine/document";
import { APP_OPTIONS } from "./builder";
import { EXCAVATION_EXAMPLES } from "./excavation-examples";
import { excavationDocument, excavationNotes, excavationProblems, excavationTemplate, geometry, type ExcavationParams } from "./excavation";
import { regionCount } from "./regions";
import { swedishPartialFactors } from "./partial-factors";
import { runDocument } from "./run-document";
import type { AnalysisDocument } from "../engine/document";

beforeAll(() => initEngine());

/** The committed fixtures (scripts/write-fixtures.ts), as text. */
const fixtures = import.meta.glob("./fixtures/*.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const expected = JSON.parse(fixtures["./fixtures/expected.json"] ?? "{}") as Record<string, { fos: number; fosLabel: string }>;

const base = EXCAVATION_EXAMPLES["clay-5m-water"];
/** Points rounded to 1e-9 m, to compare computed coordinates. */
const r9 = (pts: [number, number][]) => pts.map(([x, y]) => [Number(x.toFixed(9)) + 0, Number(y.toFixed(9)) + 0]);
const withLayers = (params: ExcavationParams, ...layers: ExcavationParams["layers"]) => ({ ...params, layers });

describe("the geometry rules", () => {
  it("reaches 1.5 × its depth beyond the crest and the toe, and 2H below the bottom or to the deepest layer", () => {
    const g = geometry(base);
    // 2H below the bottom is −5; the layer goes down to −10, and the model with it:
    // 20 m deep, so each side reaches 30 m.
    expect(g).toMatchObject({ ground: 10, bottom: 5, crestX: 0, toeX: 10, left: -30, right: 40, base: -10, road: null, levels: [] });
    const def = excavationDocument(base).definition;
    expect(def.coordinates).toEqual([
      [-30, -10],
      [-30, 10],
      [0, 10],
      [10, 5],
      [40, 5],
      [40, -10],
    ]);
    expect(def.orientation).toBe("ltr");
    expect(def.waterTable).toEqual({ mode: "height", value: 9, freeWater: false });
    // A shallower layer: the base is 2H below the bottom, the sides at least 3H.
    const shallow = geometry(withLayers({ ...base, excavationDepth: 2 }, { bottomLevel: 7, material: { kind: "undrained", gamma: 16, su: 25 } }));
    expect(shallow).toMatchObject({ base: 4, left: -9, right: 4 + 9 });
  });

  it("lets surfaces enter behind the crest and exit from the crest on, in the face or the bottom", () => {
    expect(excavationDocument(base).definition.analysisLimits).toEqual({ entryLeftX: -30, entryRightX: 0, exitLeftX: 0, exitRightX: 40 });
  });

  it("models the bottom as wide as asked when that is wider than the model needs, and says when it is wider", () => {
    expect(geometry({ ...base, bottomWidth: 4 }).right).toBe(40);
    expect(excavationNotes({ ...base, bottomWidth: 4 })).toEqual(["The bottom is modelled 30 m wide, not 4 m: the model needs that width."]);
    expect(geometry({ ...base, bottomWidth: 60 }).right).toBe(70);
    expect(excavationNotes({ ...base, bottomWidth: 60 })).toEqual([]);
  });

  it("says when the last layer goes on below its bottom level", () => {
    expect(excavationNotes(base)).toEqual([]);
    expect(excavationNotes(withLayers(base, { name: "Clay", bottomLevel: 0, material: { kind: "undrained", gamma: 16, su: 25 } }))).toEqual([
      "Clay goes on below its bottom level 0 m, down to -5 m, 2H below the excavation bottom: the model needs that depth.",
    ]);
    expect(excavationNotes({ ...base, slope: 0 })).toEqual([]);
    expect(excavationTemplate.notes(base)).toEqual([]);
  });

  it("ends each layer boundary on vertices of the outline: the left edge and the face, or the right edge below the bottom", () => {
    const def = excavationDocument(
      withLayers(
        base,
        { bottomLevel: 8, material: { kind: "drained", gamma: 18, c: 2, phi: 30 } },
        { bottomLevel: 2, material: { kind: "undrained", gamma: 16, su: 20 } },
        { bottomLevel: -10, material: { kind: "undrained", gamma: 16, su: 40 } },
      ),
    ).definition;
    // y = 8 is 2 m below the ground: the face 1:2 is at x = 4.
    expect(def.coordinates).toEqual([
      [-30, -10],
      [-30, 2],
      [-30, 8],
      [-30, 10],
      [0, 10],
      [4, 8],
      [10, 5],
      [40, 5],
      [40, 2],
      [40, -10],
    ]);
    expect(def.materialBoundaries).toEqual([{ coordinates: [[-30, 8], [4, 8]] }, { coordinates: [[-30, 2], [40, 2]] }]);
    expect(def.regionAssignments).toEqual([
      { point: [-29, 9], materialName: "Layer 1" },
      { point: [-29, 5], materialName: "Layer 2" },
      { point: [-29, -4], materialName: "Layer 3" },
    ]);
    expect(validateDefinition(excavationDocument(base)).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("splits a 5 cm crust as its own region", () => {
    const params = withLayers(
      base,
      { name: "Crust", bottomLevel: 9.95, material: { kind: "drained", gamma: 18, c: 2, phi: 30 } },
      { name: "Clay", bottomLevel: -10, material: { kind: "undrained", gamma: 16, su: 25 } },
    );
    expect(excavationProblems(params)).toEqual([]);
    const def = excavationDocument(params).definition;
    expect(validateDefinition(def).filter((i) => i.severity === "error")).toEqual([]);
    expect(regionCount(def)).toBe(2);
  });

  it("names the layers, gives Su growing with depth by elevation from the layer's top, and γsat to drained layers", () => {
    const def = excavationDocument(
      withLayers(
        base,
        { name: "Crust", bottomLevel: 8, material: { kind: "drained", gamma: 18, gammaSat: 19, c: 2, phi: 30 } },
        { name: "Clay", bottomLevel: -10, material: { kind: "undrained-increasing", gamma: 16, su: 15, suRate: 1.5 } },
      ),
    ).definition;
    expect(def.materials).toEqual([
      { name: "Crust", model: { kind: "mohr-coulomb", unitWeight: 18, unitWeightSat: 19, cohesion: 2, frictionAngle: 30 } },
      { name: "Clay", model: { kind: "s-f-datum", unitWeight: 16, unitWeightSat: 16, suRef: 15, yRef: 8, rate: 1.5 } },
    ]);
  });

  it("builds the road as a fill region with 1:1.5 sides, its own material and the traffic load over its top", () => {
    const params = EXCAVATION_EXAMPLES["clay-road"];
    const g = geometry(params);
    // The top's near edge 3 m behind the crest, 0.8 m high with 1:1.5 sides, a 4 m top.
    const road = { farToe: -8.2, topLeft: -7, topRight: -3, nearToe: -1.8, top: 0.8 };
    for (const [k, v] of Object.entries(road)) expect(g.road![k as keyof typeof road], k).toBeCloseTo(v, 9);
    // 2H below the bottom is −12, the clay goes to −20: 20 m deep, each side 30 m.
    expect(g.left).toBeCloseTo(-8.2 - 30, 9);
    const def = excavationDocument(params).definition;
    expect(r9(def.coordinates.slice(1, 8))).toEqual(
      r9([
        [g.left, 0],
        [-8.2, 0],
        [-7, 0.8],
        [-3, 0.8],
        [-1.8, 0],
        [0, 0],
        [8, -4],
      ]),
    );
    expect(def.materials.map((m) => m.name)).toEqual(["Layer 1", "Road fill"]);
    expect(def.materials[1].model).toEqual({ kind: "mohr-coulomb", unitWeight: 20, unitWeightSat: 20, cohesion: 0, frictionAngle: 38 });
    expect(r9(def.materialBoundaries![0].coordinates)).toEqual([[-8.2, 0], [-1.8, 0]]);
    expect(def.materialBoundaries).toHaveLength(1);
    const fill = def.regionAssignments!.find((a) => a.materialName === "Road fill")!;
    expect(r9([fill.point])).toEqual([[-5, 0.4]]);
    expect(def.udls).toEqual([{ magnitude: 20, x1: -7, x2: -3 }]);
    expect(excavationDocument(EXCAVATION_EXAMPLES["clay-road-no-traffic"]).definition.udls).toBeUndefined();
  });

  it("cuts the fill's side at the crest when the road is closer than its side reaches", () => {
    const params = EXCAVATION_EXAMPLES["steep-road-at-crest"];
    // The top 1.5 m behind the crest, 1 m high: the side just reaches the crest.
    expect(geometry(params).road).toMatchObject({ nearToe: 0, topRight: -1.5 });
    const def = excavationDocument(params).definition;
    expect(def.coordinates.slice(2, 6)).toEqual([
      [-8, 20],
      [-6.5, 21],
      [-1.5, 21],
      [0, 20],
    ]);
    expect(def.materialBoundaries).toEqual([{ coordinates: [[-8, 20], [0, 20]] }]);
    const atCrest = geometry({ ...params, road: { ...params.road!, distanceFromCrest: 0 } }).road!;
    expect(atCrest).toMatchObject({ nearToe: 0, topRight: -0 });
  });

  it("snaps a near toe within 5 cm of the crest to it", () => {
    const road = { distanceFromCrest: 1.24, width: 4, height: 0.8, fill: { gamma: 20, c: 0, phi: 38 }, trafficLoad: null };
    expect(geometry({ ...base, road }).road?.nearToe).toBe(0);
    expect(geometry({ ...base, road: { ...road, distanceFromCrest: 1.3 } }).road?.nearToe).toBeCloseTo(-0.1, 9);
  });

  it("uses the app's options, with the partial factors of the safety class on design values and the tension crack", () => {
    const doc = excavationDocument(EXCAVATION_EXAMPLES["clay-road-design-sk2"]);
    expect(doc.options).toEqual({
      ...APP_OPTIONS,
      partialFactors: { cu: 1.5, cohesion: 1.3, tanPhi: 1.3, variableLoad: 1.183, basis: { safetyClass: 2, etaCu: 1, etaDrained: 1, variableLoadBase: 1.3 } },
    });
    expect(excavationDocument(base).options).toEqual(APP_OPTIONS);
    expect(excavationDocument({ ...base, tensionCrackDepth: 0 }).options).toEqual(APP_OPTIONS);
    expect(excavationDocument({ ...base, tensionCrackDepth: 1.5 }).options).toEqual({ ...APP_OPTIONS, tensionCrackDepth: 1.5 });
    expect(doc.format).toBe("cslope-analysis");
    expect(doc.formatVersion).toBe(1);
  });

  it("refuses what it cannot build, with a sentence each", () => {
    expect(excavationProblems(base)).toEqual([]);
    expect(excavationProblems({ ...base, excavationDepth: 0 })).toEqual(["Excavation depth H (m) must be from 0.5 to 20 m."]);
    expect(excavationProblems({ ...base, tensionCrackDepth: -1 })).toEqual(["Tension crack depth (m) must be from 0 to 10 m."]);
    expect(excavationProblems(withLayers(base))).toEqual(["The ground needs at least one layer."]);
    expect(
      excavationProblems(
        withLayers(
          base,
          { bottomLevel: 9.97, material: { kind: "undrained", gamma: 16, su: 20 } },
          { bottomLevel: 5.03, material: { kind: "undrained", gamma: 16, su: 20 } },
          { bottomLevel: -10, material: { kind: "drained", gamma: 16, gammaSat: 30, c: 1, phi: 30 } },
        ),
      ),
    ).toEqual([
      "Layer 1: the bottom level 9.97 must be at least 0.05 m below the ground (10).",
      "Layer 2: the bottom level 5.03 is within 0.05 m of the excavation bottom; move it.",
      "Layer 3: Saturated unit weight γsat (kN/m³) must be from 10 to 25 kN/m³.",
    ]);
    expect(excavationProblems({ ...base, values: { basis: "design", safetyClass: 2, etaCu: 2, etaDrained: 1, variableLoadBase: 1.3 } })).toEqual(["η undrained must be from 0.5 to 1.2."]);
    expect(() => excavationDocument({ ...base, slope: 0 })).toThrow("Slope 1:n must be from 0.5 to 5.");
  });

  it("is listed with its parameters", () => {
    expect(excavationTemplate.id).toBe("excavation");
    expect(excavationTemplate.params.excavationDepth).toMatchObject({ name: "excavationDepth", unit: "m", min: 0.5, max: 20, step: 0.1 });
    expect(excavationTemplate.params.road).toMatchObject({ distanceFromCrest: { label: "Distance from the crest to the road (m)" } });
    expect(excavationTemplate.toDocument(base)).toEqual(excavationDocument(base));
  });
});

describe("the engine's defaults, computed here", () => {
  it("writes the app's options as the engine's public defaults", async () => {
    await initEngine();
    const pub = publicDefaultOptions();
    for (const [k, v] of Object.entries(pub)) expect(APP_OPTIONS[k as keyof typeof APP_OPTIONS], k).toEqual(v);
  });

  it("forms the Swedish partial factors as the engine does", async () => {
    await initEngine();
    for (const safetyClass of [1, 2, 3] as const) {
      for (const [etaCu, etaDrained, variableLoadBase] of [
        [1, 1, 1.3],
        [0.9, 1.1, 1.4],
        [0.75, 0.85, 1],
      ]) {
        const basis = { safetyClass, etaCu, etaDrained, variableLoadBase };
        expect(swedishPartialFactors(basis)).toEqual(engineFactors(basis));
      }
    }
  });
});

describe("the ten named sets", () => {
  const names = Object.keys(EXCAVATION_EXAMPLES);
  it("are ten, with a fixture and an expected F each", () => {
    expect(names).toHaveLength(10);
    expect(Object.keys(expected).sort()).toEqual([...names].sort());
  });

  for (const name of names) {
    it(`${name}: the fixture is the document, which validates and runs to F ${expected[name]?.fos.toFixed(3)}`, async () => {
      const params = EXCAVATION_EXAMPLES[name];
      expect(excavationProblems(params)).toEqual([]);
      const doc = excavationDocument(params);
      const file = `./fixtures/${name}.json`;
      expect(fixtures[file], `${file} is missing: bun scripts/write-fixtures.ts`).toBeDefined();
      expect(fixtures[file], `${file} is stale: bun scripts/write-fixtures.ts`).toBe(dumps(doc));
      const { summary, issues } = await runDocument(doc);
      expect(issues.filter((i) => i.severity === "error")).toEqual([]);
      expect(summary.fos).not.toBeNull();
      expect(summary.fosLabel).toBe(expected[name].fosLabel);
      expect(Math.abs(summary.fos! - expected[name].fos), `F ${summary.fos} is not the pinned ${expected[name].fos}`).toBeLessThan(1e-6);
    });
  }

  it("say what F is: a factor of safety on characteristic values, an over-design factor on design values", () => {
    expect(expected["clay-road"].fosLabel).toBe("factor of safety");
    expect(expected["clay-road-design-sk2"].fosLabel).toBe("over-design factor");
    expect(expected["clay-road-design-sk2"].fos).toBeLessThan(expected["clay-road"].fos);
  });
});

/**
 * The document with each side of the model twice as far from the slope
 * (the outline and the boundaries), with the same search limits: the same
 * trial surfaces, so a change of F is the edge's alone. (Widening the
 * limits too makes the search grid coarser, which raises F by up to 0.6 %
 * here: search resolution, not the edge.)
 */
function widened(params: ExcavationParams): AnalysisDocument {
  const g = geometry(params);
  const doc = excavationDocument(params);
  const left = 2 * g.left;
  const right = g.toeX + 2 * (g.right - g.toeX);
  const move = ([x, y]: [number, number]): [number, number] => [x <= g.left + 1e-9 ? left : x >= g.right - 1e-9 ? right : x, y];
  const def = doc.definition;
  def.coordinates = def.coordinates.map(move);
  for (const b of def.materialBoundaries ?? []) b.coordinates = b.coordinates.map(move);
  return doc;
}

describe("the model's extent", () => {
  for (const name of Object.keys(EXCAVATION_EXAMPLES)) {
    it(`${name}: twice as wide, F does not change beyond 1e-3, and the critical surface keeps off the edges`, async () => {
      const params = EXCAVATION_EXAMPLES[name];
      const g = geometry(params);
      const { result, summary } = await runDocument(excavationDocument(params));
      const own = summary.fos!;
      // The search limits do not bind: entry and exit at least 5 % of the width from the edges.
      const margin = 0.05 * (g.right - g.left);
      expect(result.criticalSurface!.entryPoint[0] - g.left, "entry near the left edge").toBeGreaterThan(margin);
      expect(g.right - result.criticalSurface!.exitPoint[0], "exit near the right edge").toBeGreaterThan(margin);
      const wide = (await runDocument(widened(params))).summary.fos!;
      expect(Math.abs(wide - own), `F ${own}, twice as wide ${wide}`).toBeLessThan(1e-3);
    });
  }

  it("a shallow excavation over deep soft clay: twice as wide, F does not change beyond 1e-3", async () => {
    const deep: ExcavationParams = { ...base, groundLevel: 0, excavationDepth: 2, slope: 3, waterLevel: null, layers: [{ bottomLevel: -20, material: { kind: "undrained", gamma: 16, su: 6 } }] };
    const own = (await runDocument(excavationDocument(deep))).summary.fos!;
    const wide = (await runDocument(widened(deep))).summary.fos!;
    expect(Math.abs(wide - own), `F ${own}, twice as wide ${wide}`).toBeLessThan(1e-3);
  });
});

describe("a weak layer in the face", () => {
  it("is found: the critical surface exits in the face, not the bottom", async () => {
    // Loose sand to 2 m over stiff clay, H 4 m at 1:1.5 (the review's case:
    // with exits in the bottom only, F was 4.458).
    const params: ExcavationParams = {
      groundLevel: 0,
      excavationDepth: 4,
      slope: 1.5,
      bottomWidth: null,
      layers: [
        { name: "Sand", bottomLevel: -2, material: { kind: "drained", gamma: 18, c: 1, phi: 30 } },
        { name: "Clay", bottomLevel: -16, material: { kind: "undrained", gamma: 17, su: 60 } },
      ],
      waterLevel: null,
      road: null,
      values: { basis: "characteristic" },
    };
    const { result, summary } = await runDocument(excavationDocument(params));
    expect(summary.fos!).toBeLessThan(1.4);
    const [x, y] = result.criticalSurface!.exitPoint;
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(6);
    expect(y).toBeGreaterThan(-4);
  });
});

describe("monotonic checks", () => {
  const F = async (params: ExcavationParams) => (await runDocument(excavationDocument(params))).summary.fos!;

  it("F falls with a deeper excavation", async () => {
    expect(await F({ ...base, excavationDepth: 7 })).toBeLessThan(await F(base));
  });

  it("F falls with a lower Su", async () => {
    expect(await F(withLayers(base, { bottomLevel: -10, material: { kind: "undrained", gamma: 16, su: 18 } }))).toBeLessThan(await F(base));
  });

  it("F falls when the road is added, and more with its traffic", async () => {
    const plain = EXCAVATION_EXAMPLES["clay-road-no-traffic"];
    const without = await F({ ...plain, road: null });
    const road = await F(plain);
    const traffic = await F(EXCAVATION_EXAMPLES["clay-road"]);
    expect(road).toBeLessThan(without);
    expect(traffic).toBeLessThan(road);
  });
});
