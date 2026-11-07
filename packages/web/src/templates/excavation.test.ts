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
import { excavationDocument, excavationProblems, excavationTemplate, geometry, minLayerThickness, type ExcavationParams } from "./excavation";
import { swedishPartialFactors } from "./partial-factors";
import { runDocument } from "./run-document";

beforeAll(() => initEngine());

/** The committed fixtures (scripts/write-fixtures.ts), as text. */
const fixtures = import.meta.glob("./fixtures/*.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const expected = JSON.parse(fixtures["./fixtures/expected.json"] ?? "{}") as Record<string, { fos: number; fosLabel: string }>;

const base = EXCAVATION_EXAMPLES["clay-5m-water"];
/** Points rounded to 1e-9 m, to compare computed coordinates. */
const r9 = (pts: [number, number][]) => pts.map(([x, y]) => [Number(x.toFixed(9)) + 0, Number(y.toFixed(9)) + 0]);
const withLayers = (params: ExcavationParams, ...layers: ExcavationParams["layers"]) => ({ ...params, layers });

describe("the geometry rules", () => {
  it("reaches 3H beyond the crest and the toe and 2H below the bottom", () => {
    const g = geometry(base);
    // 2H below the bottom is −5; the layer goes down to −10, and the model with it.
    expect(g).toMatchObject({ ground: 10, bottom: 5, crestX: 0, toeX: 10, left: -15, right: 25, base: -10, road: null, levels: [] });
    expect(geometry(withLayers(base, { bottomLevel: 0, material: { kind: "undrained", gamma: 16, su: 25 } })).base).toBe(-5);
    const def = excavationDocument(base).definition;
    expect(def.coordinates).toEqual([
      [-15, -10],
      [-15, 10],
      [0, 10],
      [10, 5],
      [25, 5],
      [25, -10],
    ]);
    expect(def.orientation).toBe("ltr");
    expect(def.analysisLimits).toEqual({ entryLeftX: -15, entryRightX: 0, exitLeftX: 10, exitRightX: 25 });
    expect(def.waterTable).toEqual({ mode: "height", value: 9, freeWater: false });
  });

  it("goes down to the deepest layer when that is deeper than 2H below the bottom", () => {
    const g = geometry(withLayers(base, { bottomLevel: -12, material: { kind: "undrained", gamma: 16, su: 25 } }));
    expect(g.base).toBe(-12);
  });

  it("models at least 3H of bottom, and the given width when wider", () => {
    expect(geometry({ ...base, bottomWidth: 4 }).right).toBe(25);
    expect(geometry({ ...base, bottomWidth: 40 }).right).toBe(50);
  });

  it("ends a boundary above the bottom past the slope face and runs one below it across, both crossing the outline", () => {
    const def = excavationDocument(
      withLayers(
        base,
        { bottomLevel: 8, material: { kind: "drained", gamma: 18, c: 2, phi: 30 } },
        { bottomLevel: 2, material: { kind: "undrained", gamma: 16, su: 20 } },
        { bottomLevel: -10, material: { kind: "undrained", gamma: 16, su: 40 } },
      ),
    ).definition;
    expect(def.materialBoundaries).toEqual([
      // The model is 40 m wide: the lines cross the outline by 0.3 % of it, 0.12 m
      // normal to it. y = 8 is 2 m below the ground: the face 1:2 is at x = 4.
      { coordinates: [[-15.12, 8], [4 + 0.12 * Math.sqrt(5), 8]] },
      { coordinates: [[-15.12, 2], [25.12, 2]] },
    ]);
    expect(def.regionAssignments).toEqual([
      { point: [-14, 9], materialName: "Layer 1" },
      { point: [-14, 5], materialName: "Layer 2" },
      { point: [-14, -4], materialName: "Layer 3" },
    ]);
    expect(validateDefinition(excavationDocument(base)).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("names the layers and gives Su growing with depth by elevation from the layer's top", () => {
    const def = excavationDocument(
      withLayers(
        base,
        { name: "Crust", bottomLevel: 8, material: { kind: "drained", gamma: 18, c: 2, phi: 30 } },
        { name: "Clay", bottomLevel: -10, material: { kind: "undrained-increasing", gamma: 16, su: 15, suRate: 1.5 } },
      ),
    ).definition;
    expect(def.materials).toEqual([
      { name: "Crust", model: { kind: "mohr-coulomb", unitWeight: 18, unitWeightSat: 18, cohesion: 2, frictionAngle: 30 } },
      { name: "Clay", model: { kind: "s-f-datum", unitWeight: 16, unitWeightSat: 16, suRef: 15, yRef: 8, rate: 1.5 } },
    ]);
  });

  it("builds the road as a fill region with 1:1.5 sides, its own material and the traffic load", () => {
    const params = EXCAVATION_EXAMPLES["clay-road"];
    const g = geometry(params);
    // The near toe 3 m behind the crest, 0.8 m high with 1:1.5 sides, a 4 m top.
    const road = { farToe: -9.4, topLeft: -8.2, topRight: -4.2, nearToe: -3, top: 0.8 };
    for (const [k, v] of Object.entries(road)) expect(g.road![k as keyof typeof road], k).toBeCloseTo(v, 9);
    expect(g.left).toBeCloseTo(-9.4 - 12, 9);
    const def = excavationDocument(params).definition;
    expect(r9(def.coordinates.slice(1, 8))).toEqual(r9([
      [g.left, 0],
      [-9.4, 0],
      [-8.2, 0.8],
      [-4.2, 0.8],
      [-3, 0],
      [0, 0],
      [8, -4],
    ]));
    expect(def.materials.map((m) => m.name)).toEqual(["Layer 1", "Road fill"]);
    expect(r9(def.materialBoundaries![0].coordinates)).toEqual([[-9.4, 0], [-3, 0]]);
    expect(def.materialBoundaries).toHaveLength(1);
    const fill = def.regionAssignments!.find((a) => a.materialName === "Road fill")!;
    expect(r9([fill.point])).toEqual([[-6.2, 0.4]]);
    expect(def.udls).toEqual([{ magnitude: 20, x1: -8.2, x2: -4.2 }]);
    expect(excavationDocument(EXCAVATION_EXAMPLES["clay-road-no-traffic"]).definition.udls).toBeUndefined();
  });

  it("puts a road at the crest against it, with the fill's near side at the crest", () => {
    const params = EXCAVATION_EXAMPLES["steep-road-at-crest"];
    const g = geometry(params);
    expect(g.road?.nearToe).toBe(0);
    const def = excavationDocument(params).definition;
    expect(def.coordinates.slice(2, 6)).toEqual([
      [-8, 20],
      [-6.5, 21],
      [-1.5, 21],
      [0, 20],
    ]);
    expect(def.materialBoundaries).toEqual([{ coordinates: [[-8, 20], [0, 20]] }]);
  });

  it("snaps a near toe within 5 cm of the crest to it", () => {
    const road = { distanceFromCrest: 0.04, width: 4, height: 0.8, fill: { gamma: 20, c: 0, phi: 38 }, trafficLoad: null };
    expect(geometry({ ...base, road }).road?.nearToe).toBe(0);
    expect(geometry({ ...base, road: { ...road, distanceFromCrest: 0.1 } }).road?.nearToe).toBe(-0.1);
  });

  it("keeps layers thick enough for the engine to tell them apart in a large model", () => {
    const deep = { ...base, groundLevel: 50, excavationDepth: 18.6, slope: 3 };
    // The model is 167.4 m wide: 0.25 % of it is 0.42 m.
    expect(minLayerThickness(deep)).toBe(0.42);
    expect(minLayerThickness(base)).toBe(0.1);
    const thin = withLayers(
      deep,
      { bottomLevel: 48.5, material: { kind: "undrained", gamma: 16, su: 20 } },
      { bottomLevel: 48.2, material: { kind: "undrained", gamma: 16, su: 20 } },
      { bottomLevel: 10, material: { kind: "undrained", gamma: 16, su: 20 } },
    );
    expect(excavationProblems(thin)).toEqual(["Layer 2: the bottom level 48.2 must be at least 0.42 m below the layer above (48.5)."]);
  });

  it("uses the app's options, with the partial factors of the safety class on design values", () => {
    const doc = excavationDocument(EXCAVATION_EXAMPLES["clay-road-design-sk2"]);
    expect(doc.options).toEqual({
      ...APP_OPTIONS,
      partialFactors: { cu: 1.5, cohesion: 1.3, tanPhi: 1.3, variableLoad: 1.183, basis: { safetyClass: 2, etaCu: 1, etaDrained: 1, variableLoadBase: 1.3 } },
    });
    expect(excavationDocument(base).options).toEqual(APP_OPTIONS);
    expect(doc.format).toBe("cslope-analysis");
    expect(doc.formatVersion).toBe(1);
  });

  it("refuses what it cannot build, with a sentence each", () => {
    expect(excavationProblems(base)).toEqual([]);
    expect(excavationProblems({ ...base, excavationDepth: 0 })).toEqual(["Excavation depth H (m) must be from 0.5 to 20 m."]);
    expect(excavationProblems(withLayers(base))).toEqual(["The ground needs at least one layer."]);
    expect(
      excavationProblems(
        withLayers(
          base,
          { bottomLevel: 9.95, material: { kind: "undrained", gamma: 16, su: 20 } },
          { bottomLevel: 5.05, material: { kind: "undrained", gamma: 16, su: 20 } },
          { bottomLevel: -10, material: { kind: "undrained", gamma: 16, su: 20 } },
        ),
      ),
    ).toEqual([
      "Layer 1: the bottom level 9.95 must be at least 0.1 m below the ground (10).",
      "Layer 2: the bottom level 5.05 is within 0.1 m of the excavation bottom; move it.",
    ]);
    expect(excavationProblems({ ...base, values: { basis: "design", safetyClass: 2, etaCu: 2, etaDrained: 1, variableLoadBase: 1.3 } })).toEqual(["η undrained must be from 0.5 to 1.2."]);
    expect(() => excavationDocument({ ...base, slope: 0 })).toThrow("Slope 1:n must be from 0.5 to 5.");
  });

  it("is listed with its parameters", () => {
    expect(excavationTemplate.id).toBe("excavation");
    expect(excavationTemplate.params.excavationDepth).toMatchObject({ name: "excavationDepth", unit: "m", min: 0.5, max: 20, step: 0.1 });
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
