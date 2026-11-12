// @vitest-environment node
/**
 * The excavation template: the geometry rules, the twelve named sets against
 * their pinned F and their committed fixtures, and the monotonic checks
 * (F falls with a deeper excavation, a lower Su and the road).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { initEngine, publicDefaultOptions, validateDefinition } from "@cslope/engine";
import { dumps } from "../engine/document";
import { APP_OPTIONS } from "./builder";
import { TEMPLATE_OPTIONS } from "./common";
import { EXCAVATION_EXAMPLES } from "./excavation-examples";
import { excavationDocument, excavationFieldProblems, excavationNotes, excavationProblems, excavationTemplate, geometry, type ExcavationParams } from "./excavation";
import { regionCount } from "./regions";
import { runDocument } from "./run-document";
import type { AnalysisDocument } from "../engine/document";

beforeAll(() => initEngine());

/** The committed fixtures (scripts/write-fixtures.ts), as text. */
const fixtures = import.meta.glob<string>("./fixtures/*.json", { query: "?raw", import: "default", eager: true });
const expected = JSON.parse(fixtures["./fixtures/expected.json"] ?? "{}") as Record<string, { fos: number; fosLabel: string }>;

/** One clay to −10, the water 1 m down: clay-5m-water without its rock. */
const base: ExcavationParams = { ...EXCAVATION_EXAMPLES["clay-5m-water"], layers: [{ bottomLevel: -10, material: { kind: "undrained", gamma: 16, su: 25 } }] };
/** Points rounded to 1e-9 m, to compare computed coordinates. */
const r9 = (pts: [number, number][]) => pts.map(([x, y]) => [Number(x.toFixed(9)) + 0, Number(y.toFixed(9)) + 0]);
const withLayers = (params: ExcavationParams, ...layers: ExcavationParams["layers"]) => ({ ...params, layers });
/** The case of issue 161: the crust 1.5 m, the clay 2.5 m down to the excavation bottom (−4 m), gravel 5 m below it. */
const onBottom: ExcavationParams = {
  ...EXCAVATION_EXAMPLES["crust-over-clay"],
  layers: [
    { name: "Crust", bottomLevel: -1.5, material: { kind: "drained", gamma: 18, c: 2, phi: 32 } },
    { name: "Clay", bottomLevel: -4, material: { kind: "undrained", gamma: 16.5, su: 18 } },
    { name: "Gravel", bottomLevel: -9, material: { kind: "drained", gamma: 20, c: 0, phi: 35 } },
  ],
};
const onBottomTrench: ExcavationParams = { ...onBottom, bottomWidth: 2 };
const onBottomRoad = { distanceFromCrest: 2, width: 4, height: 0.5, fill: { gamma: 20, c: 0, phi: 38 }, trafficLoad: 20 };

describe("the geometry rules", () => {
  it("reaches 1.5 × its depth beyond the crest and the toe, down to the last layer's bottom", () => {
    const g = geometry(base);
    // The layer goes down to −10, and the model with it:
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
    // A shallow layer: the base at its bottom, the sides at least 3H.
    const shallow = geometry(withLayers({ ...base, excavationDepth: 2 }, { bottomLevel: 7, material: { kind: "undrained", gamma: 16, su: 25 } }));
    expect(shallow).toMatchObject({ base: 7, left: -6, right: 4 + 6 });
  });

  it("lets surfaces enter behind the crest and exit from the crest on, in the face or the bottom", () => {
    expect(excavationDocument(base).definition.analysisLimits).toEqual({ entryLeftX: -30, entryRightX: 0, exitLeftX: 0, exitRightX: 40 });
  });

  it("ends at the last layer's bottom as firm ground, says so when that is less than 3H below the ground, and refuses it above the excavation bottom", () => {
    expect(excavationNotes(base)).toEqual([]);
    expect(excavationNotes(withLayers(base, { name: "Clay", bottomLevel: -5, material: { kind: "undrained", gamma: 16, su: 25 } }))).toEqual([]);
    expect(excavationNotes(withLayers(base, { name: "Clay", bottomLevel: 0, material: { kind: "undrained", gamma: 16, su: 25 } }))).toEqual([
      "The model ends at the last layer's bottom (0 m), treated as firm ground. If the soil continues deeper, enter its real bottom: a deeper base can give a lower F.",
    ]);
    expect(geometry(withLayers(base, { bottomLevel: 0, material: { kind: "undrained", gamma: 16, su: 25 } })).base).toBe(0);
    expect(excavationFieldProblems(withLayers(base, { bottomLevel: 5, material: { kind: "undrained", gamma: 16, su: 25 } }))).toEqual([
      { field: "layers.0.bottomLevel", message: "Layer 1: the bottom level 5 must be at least 0.05 m below the excavation bottom (5); the model ends at the last layer's bottom." },
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

  it("models a trench with a bottom width: the opposite side 1:n up to the ground, exits within the bottom", () => {
    const trench = { ...base, bottomWidth: 1 };
    // The bottom from x = 10 to 11, the opposite crest at 11 + 2 × 5 = 21, the edge 30 m beyond it.
    expect(geometry(trench)).toMatchObject({ toeX: 10, left: -30, right: 51, trench: { bottomEnd: 11, farCrest: 21 } });
    const def = excavationDocument(trench).definition;
    expect(def.coordinates).toEqual([
      [-30, -10],
      [-30, 10],
      [0, 10],
      [10, 5],
      [11, 5],
      [21, 10],
      [51, 10],
      [51, -10],
    ]);
    expect(def.analysisLimits).toEqual({ entryLeftX: -30, entryRightX: 0, exitLeftX: 0, exitRightX: 11 });
    expect(def.waterTable).toEqual({ mode: "height", value: 9, freeWater: false });
    expect(excavationNotes(trench)).toEqual([]);
    expect(excavationFieldProblems({ ...base, bottomWidth: 0.2 })).toEqual([{ field: "bottomWidth", message: "Must be from 0.5 to 50 m.", general: "Bottom width must be from 0.5 to 50 m." }]);
  });

  it("ends a trench's layer boundaries on vertices of both faces and the right edge, a layer above the bottom a region on each side", () => {
    const def = excavationDocument(
      withLayers(
        { ...base, bottomWidth: 1 },
        { bottomLevel: 8, material: { kind: "drained", gamma: 18, c: 2, phi: 30 } },
        { bottomLevel: 2, material: { kind: "undrained", gamma: 16, su: 20 } },
        { bottomLevel: -10, material: { kind: "undrained", gamma: 16, su: 40 } },
      ),
    ).definition;
    // y = 8 is 3 m above the bottom: the opposite face 1:2 is at x = 11 + 6.
    expect(def.coordinates).toEqual([
      [-30, -10],
      [-30, 2],
      [-30, 8],
      [-30, 10],
      [0, 10],
      [4, 8],
      [10, 5],
      [11, 5],
      [17, 8],
      [21, 10],
      [51, 10],
      [51, 8],
      [51, 2],
      [51, -10],
    ]);
    expect(def.materialBoundaries).toEqual([{ coordinates: [[-30, 8], [4, 8]] }, { coordinates: [[17, 8], [51, 8]] }, { coordinates: [[-30, 2], [51, 2]] }]);
    expect(def.regionAssignments).toEqual([
      { point: [-29, 9], materialName: "Layer 1" },
      { point: [-29, 5], materialName: "Layer 2" },
      { point: [-29, -4], materialName: "Layer 3" },
      { point: [50, 9], materialName: "Layer 1" },
    ]);
    expect(validateDefinition(def).filter((i) => i.severity === "error")).toEqual([]);
    expect(regionCount(def)).toBe(4);
  });

  it("ends a level on the excavation bottom at the toe, with no new vertex on the face or the right edge", () => {
    const params = withLayers(
      base,
      { bottomLevel: 8, material: { kind: "drained", gamma: 18, c: 2, phi: 30 } },
      { bottomLevel: 5, material: { kind: "undrained", gamma: 16, su: 20 } },
      { bottomLevel: -10, material: { kind: "undrained", gamma: 16, su: 40 } },
    );
    expect(excavationProblems(params)).toEqual([]);
    const def = excavationDocument(params).definition;
    // The toe (10, 5) and the corner (40, 5) are the level's vertices already.
    expect(def.coordinates).toEqual([
      [-30, -10],
      [-30, 5],
      [-30, 8],
      [-30, 10],
      [0, 10],
      [4, 8],
      [10, 5],
      [40, 5],
      [40, -10],
    ]);
    expect(def.materialBoundaries).toEqual([{ coordinates: [[-30, 8], [4, 8]] }, { coordinates: [[-30, 5], [10, 5]] }]);
    expect(validateDefinition(def).filter((i) => i.severity === "error")).toEqual([]);
    expect(regionCount(def)).toBe(3);
    // Within 1e-9 m of the bottom is on it: the same outline.
    const near = withLayers(base, { bottomLevel: 5 + 1e-10, material: { kind: "undrained", gamma: 16, su: 20 } }, { bottomLevel: -10, material: { kind: "undrained", gamma: 16, su: 40 } });
    expect(excavationProblems(near)).toEqual([]);
    expect(r9(excavationDocument(near).definition.coordinates)).toEqual([
      [-30, -10],
      [-30, 5],
      [-30, 10],
      [0, 10],
      [10, 5],
      [40, 5],
      [40, -10],
    ]);
  });

  it("ends a trench's level on the bottom at both ends of the bottom, and gives its layer a region on each side", () => {
    const def = excavationDocument(
      withLayers(
        { ...base, bottomWidth: 1 },
        { bottomLevel: 8, material: { kind: "drained", gamma: 18, c: 2, phi: 30 } },
        { bottomLevel: 5, material: { kind: "undrained", gamma: 16, su: 20 } },
        { bottomLevel: -10, material: { kind: "undrained", gamma: 16, su: 40 } },
      ),
    ).definition;
    expect(def.coordinates).toEqual([
      [-30, -10],
      [-30, 5],
      [-30, 8],
      [-30, 10],
      [0, 10],
      [4, 8],
      [10, 5],
      [11, 5],
      [17, 8],
      [21, 10],
      [51, 10],
      [51, 8],
      [51, 5],
      [51, -10],
    ]);
    expect(def.materialBoundaries).toEqual([
      { coordinates: [[-30, 8], [4, 8]] },
      { coordinates: [[17, 8], [51, 8]] },
      { coordinates: [[-30, 5], [10, 5]] },
      { coordinates: [[11, 5], [51, 5]] },
    ]);
    expect(def.regionAssignments).toEqual([
      { point: [-29, 9], materialName: "Layer 1" },
      { point: [-29, 6.5], materialName: "Layer 2" },
      { point: [-29, -2.5], materialName: "Layer 3" },
      { point: [50, 9], materialName: "Layer 1" },
      { point: [50, 6.5], materialName: "Layer 2" },
    ]);
    expect(validateDefinition(def).filter((i) => i.severity === "error")).toEqual([]);
    expect(regionCount(def)).toBe(5);
  });

  it("refuses a level closer than 5 cm to the excavation bottom but not on it, offering the bottom itself", () => {
    const at = (level: number) =>
      excavationFieldProblems(withLayers(base, { bottomLevel: level, material: { kind: "undrained", gamma: 16, su: 20 } }, { bottomLevel: -10, material: { kind: "undrained", gamma: 16, su: 40 } }));
    expect(at(4.98)).toEqual([{ field: "layers.0.bottomLevel", message: "Layer 1: the bottom level 4.98 is 0.02 m from the excavation bottom (5): put it at 5, or at least 0.05 m from it." }]);
    expect(at(5.02).map((p) => p.message)).toEqual(["Layer 1: the bottom level 5.02 is 0.02 m from the excavation bottom (5): put it at 5, or at least 0.05 m from it."]);
    expect(at(5)).toEqual([]);
    expect(at(5.05)).toEqual([]);
    expect(at(4.95)).toEqual([]);
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

  it("names the layers, gives Su growing with depth by elevation from the layer's top, and γ above and below the water", () => {
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

  it("builds the road as a fill region with 1:2.5 sides, its own material and the traffic load over its top", () => {
    const params = EXCAVATION_EXAMPLES["clay-road"];
    const g = geometry(params);
    // The top's near edge 3 m behind the crest, 0.8 m high with 1:2.5 sides, a 4 m top.
    const road = { farToe: -9, topLeft: -7, topRight: -3, nearToe: -1, top: 0.8 };
    for (const [k, v] of Object.entries(road)) expect(g.road![k as keyof typeof road], k).toBeCloseTo(v, 9);
    // 2H below the bottom is −12, the clay goes to −20: 20 m deep, each side 30 m.
    expect(g.left).toBeCloseTo(-9 - 30, 9);
    const def = excavationDocument(params).definition;
    expect(r9(def.coordinates.slice(1, 8))).toEqual(
      r9([
        [g.left, 0],
        [-9, 0],
        [-7, 0.8],
        [-3, 0.8],
        [-1, 0],
        [0, 0],
        [8, -4],
      ]),
    );
    expect(def.materials.map((m) => m.name)).toEqual(["Layer 1", "Road fill"]);
    expect(def.materials[1].model).toEqual({ kind: "mohr-coulomb", unitWeight: 20, unitWeightSat: 20, cohesion: 0, frictionAngle: 38 });
    expect(r9(def.materialBoundaries![0].coordinates)).toEqual([[-9, 0], [-1, 0]]);
    expect(def.materialBoundaries).toHaveLength(1);
    const fill = def.regionAssignments!.find((a) => a.materialName === "Road fill")!;
    expect(r9([fill.point])).toEqual([[-5, 0.4]]);
    expect(def.udls).toEqual([{ magnitude: 20, x1: -7, x2: -3 }]);
    expect(excavationDocument(EXCAVATION_EXAMPLES["clay-road-no-traffic"]).definition.udls).toBeUndefined();
  });

  it("cuts the fill's side at the crest when the road is closer than its side reaches", () => {
    const params = EXCAVATION_EXAMPLES["steep-road-at-crest"];
    // The top 1.5 m behind the crest, 1 m high: the side (2.5 m wide) is cut at the crest.
    expect(geometry(params).road).toMatchObject({ nearToe: 0, topRight: -1.5 });
    const def = excavationDocument(params).definition;
    expect(def.coordinates.slice(2, 6)).toEqual([
      [-9, 20],
      [-6.5, 21],
      [-1.5, 21],
      [0, 20],
    ]);
    expect(def.materialBoundaries).toEqual([{ coordinates: [[-9, 20], [0, 20]] }]);
    const atCrest = geometry({ ...params, road: { ...params.road!, distanceFromCrest: 0 } }).road!;
    expect(atCrest).toMatchObject({ nearToe: 0, topRight: -0 });
  });

  it("snaps a near toe within 5 cm of the crest to it", () => {
    const road = { distanceFromCrest: 1.98, width: 4, height: 0.8, fill: { gamma: 20, c: 0, phi: 38 }, trafficLoad: null };
    expect(geometry({ ...base, road }).road?.nearToe).toBe(0);
    expect(geometry({ ...base, road: { ...road, distanceFromCrest: 2.1 } }).road?.nearToe).toBeCloseTo(-0.1, 9);
  });

  it("uses the app's options with the automatic tension crack, on characteristic values (no partial factors)", () => {
    const doc = excavationDocument(EXCAVATION_EXAMPLES["clay-road"]);
    expect(doc.options).toEqual({ ...APP_OPTIONS, ...TEMPLATE_OPTIONS });
    expect(doc.options).toMatchObject({ tensionCrackAuto: true, tensionCrackAngle: 65 });
    expect(doc.options).not.toHaveProperty("partialFactors");
    expect(excavationDocument(base).options).toEqual({ ...APP_OPTIONS, ...TEMPLATE_OPTIONS });
    expect(doc.format).toBe("cslope-analysis");
    expect(doc.formatVersion).toBe(1);
  });

  it("refuses an undrained Su of 0 (the bound is exclusive), constant or at the top of a rate, and takes any Su above it", () => {
    const withSu = (su: number, suRate?: number) => withLayers(base, { bottomLevel: -10, material: suRate === undefined ? { kind: "undrained", gamma: 16, su } : { kind: "undrained-increasing", gamma: 16, su, suRate } });
    expect(excavationFieldProblems(withSu(0))).toEqual([{ field: "layers.0.su", message: "Must be more than 0 kPa.", general: "Layer 1: Su must be more than 0 kPa." }]);
    expect(excavationProblems(withSu(0, 2))).toEqual(["Layer 1: Su must be more than 0 kPa."]);
    expect(excavationProblems(withSu(0.5))).toEqual([]);
  });

  it("refuses what it cannot build, with a sentence each", () => {
    expect(excavationProblems(base)).toEqual([]);
    expect(excavationProblems({ ...base, excavationDepth: 0 })).toEqual(["Excavation depth H must be from 0.5 to 20 m."]);
    expect(excavationProblems(withLayers(base))).toEqual(["The ground needs at least one layer."]);
    expect(
      excavationProblems(
        withLayers(
          base,
          { bottomLevel: 9.97, material: { kind: "undrained", gamma: 16, su: 20 } },
          { bottomLevel: 5.03, material: { kind: "undrained", gamma: 16, su: 20 } },
          { bottomLevel: -10, material: { kind: "drained", gamma: 16, c: 1, phi: 90 } },
        ),
      ),
    ).toEqual([
      "Layer 1: the bottom level 9.97 must be at least 0.05 m below the ground (10).",
      "Layer 2: the bottom level 5.03 is 0.03 m from the excavation bottom (5): put it at 5, or at least 0.05 m from it.",
      "Layer 3: φ′ must be at least 0° and less than 90°.",
    ]);
    expect(() => excavationDocument({ ...base, slope: 0 })).toThrow("Slope 1:n must be from 0.5 to 5.");
  });

  it("names the field of each problem, for the form", () => {
    const params: ExcavationParams = {
      ...withLayers(
        base,
        { name: "Road fill", bottomLevel: 9.97, material: { kind: "undrained", gamma: 16, su: -1 } },
        { bottomLevel: -10, material: { kind: "drained", gamma: 16, c: 1, phi: 90 } },
      ),
      road: { distanceFromCrest: 2, width: 1, height: 1, fill: { gamma: 19, c: 0, phi: 35 }, trafficLoad: null },
    };
    expect(excavationFieldProblems(params).map((p) => p.field)).toEqual([
      "layers.0.bottomLevel",
      "layers.0.su",
      "layers.1.phi",
      "layers.0.name",
      "road.width",
    ]);
    expect(excavationFieldProblems(params).map((p) => p.general ?? p.message)).toEqual(excavationProblems(params));
    // At the field, the bounds alone: the field's label and layer are beside it.
    expect(excavationFieldProblems(params).find((p) => p.field === "layers.1.phi")).toEqual({
      field: "layers.1.phi",
      message: "Must be at least 0° and less than 90°.",
      general: "Layer 2: φ′ must be at least 0° and less than 90°.",
    });
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
});

describe("the twelve named sets", () => {
  const names = Object.keys(EXCAVATION_EXAMPLES);
  it("are thirteen (the first visit's defaults and twelve more), with a fixture and an expected F each", () => {
    expect(names).toHaveLength(13);
    expect(names).toContain("defaults");
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

  it("say what F is: a factor of safety on characteristic values, for every set", () => {
    for (const name of names) expect(expected[name].fosLabel, name).toBe("factor of safety");
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

  for (const [what, params] of [
    ["one-sided", onBottom],
    ["a trench", onBottomTrench],
  ] as const) {
    it(`a layer that ends at the excavation bottom, ${what}: twice as wide, F does not change beyond 1e-3, and the critical surface keeps off the edges`, async () => {
      const g = geometry(params);
      const { result, summary } = await runDocument(excavationDocument(params));
      const own = summary.fos!;
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

describe("a layer that ends at the excavation bottom", () => {
  const variants: [string, ExcavationParams][] = [
    ["one-sided", onBottom],
    ["one-sided with the road", { ...onBottom, road: onBottomRoad }],
    ["a trench", onBottomTrench],
    ["a trench with the road", { ...onBottomTrench, road: onBottomRoad }],
  ];
  for (const [what, params] of variants) {
    it(`${what}: builds, validates and runs to F`, async () => {
      expect(excavationProblems(params)).toEqual([]);
      const doc = excavationDocument(params);
      expect(validateDefinition(doc).filter((i) => i.severity === "error")).toEqual([]);
      // Each layer and the road a region; in a trench the crust and the clay one on each side.
      expect(regionCount(doc.definition)).toBe(3 + (params.bottomWidth === null ? 0 : 2) + (params.road ? 1 : 0));
      const { summary, issues } = await runDocument(doc);
      expect(issues.filter((i) => i.severity === "error")).toEqual([]);
      expect(summary.fos).not.toBeNull();
      expect(summary.fos!).toBeGreaterThan(0);
    });
  }

  for (const [what, params] of [
    ["one-sided", onBottom],
    ["a trench", onBottomTrench],
  ] as const) {
    it(`${what}: F is continuous across the bottom (the clay ending 5 cm above it, on it and 5 cm below it)`, async () => {
      const clayTo = (level: number): ExcavationParams => ({ ...params, layers: params.layers.map((l) => (l.name === "Clay" ? { ...l, bottomLevel: level } : l)) });
      const F = async (level: number) => (await runDocument(excavationDocument(clayTo(level)))).summary.fos!;
      const [above2, above, on, below, below2] = [await F(-3.9), await F(-3.95), await F(-4), await F(-4.05), await F(-4.1)];
      const all = `F ${[above2, above, on, below, below2].join(", ")}`;
      // F rises as the clay goes deeper (the gravel, c′ 0, has little strength under the shallow cover beyond the toe), faster
      // below the bottom, where the clay then covers the whole bottom; the case on the bottom lies between its neighbors,
      // within 2 % of each, and no step to or from it is a jump: none more than 1.5 × the next 5 cm step on the same side.
      expect(above2 <= above && above <= on && on <= below && below <= below2, all).toBe(true);
      expect(Math.abs(above - on), all).toBeLessThan(0.02 * on);
      expect(Math.abs(below - on), all).toBeLessThan(0.02 * on);
      expect(on - above, all).toBeLessThan(1.5 * (above - above2));
      expect(below - on, all).toBeLessThan(1.5 * (below2 - below));
    });
  }
});

/** The document with its base twice as far below the ground: the last layer twice as deep. */
function deepened(params: ExcavationParams): AnalysisDocument {
  const g = geometry(params);
  const doc = excavationDocument(params);
  const deep = g.base - (g.ground - g.base);
  doc.definition.coordinates = doc.definition.coordinates.map(([x, y]) => [x, Math.abs(y - g.base) < 1e-9 ? deep : y]);
  return doc;
}

describe("the model's depth", () => {
  // Only where the last layer reaches the recommended depth: a shallower firm base is the user's (a note says so).
  const deepEnough = Object.entries(EXCAVATION_EXAMPLES).filter(([, p]) => !excavationNotes(p).some((n) => n.startsWith("The model ends")));
  it("covers every example", () => expect(deepEnough).toHaveLength(Object.keys(EXCAVATION_EXAMPLES).length));
  for (const [name, params] of deepEnough) {
    it(`${name}: twice as deep, F does not change beyond 1e-3`, async () => {
      const own = (await runDocument(excavationDocument(params))).summary.fos!;
      const deep = (await runDocument(deepened(params))).summary.fos!;
      expect(Math.abs(deep - own), `F ${own}, twice as deep ${deep}`).toBeLessThan(1e-3);
    });
  }
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

  it("F with ponded water in the excavation is at least F with the level cut at the ground: the water's weight holds the slope", async () => {
    const water = { ...base, waterLevel: 8 };
    expect(excavationDocument(water).definition.waterTable).toEqual({ mode: "height", value: 8, freeWater: false });
    expect(excavationDocument({ ...water, ponded: true }).definition.waterTable).toEqual({ mode: "height", value: 8, freeWater: true });
    expect(await F({ ...water, ponded: true })).toBeGreaterThanOrEqual(await F(water));
    const pinned = EXCAVATION_EXAMPLES["clay-5m-ponded"];
    expect(await F(pinned)).toBeGreaterThanOrEqual(await F({ ...pinned, ponded: undefined }));
  });

  it("F of a 1 m trench is at least F of the wide excavation", async () => {
    for (const params of [base, EXCAVATION_EXAMPLES["clay-road"], EXCAVATION_EXAMPLES["crust-over-clay"]]) {
      expect(await F({ ...params, bottomWidth: 1 })).toBeGreaterThanOrEqual((await F({ ...params, bottomWidth: null })) - 1e-9);
    }
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
