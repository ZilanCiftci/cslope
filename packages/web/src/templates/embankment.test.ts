// @vitest-environment node
/**
 * The embankment template: the geometry rules, the ten named sets against
 * their pinned F and their committed fixtures, the model's extent, and the
 * monotonic checks (F falls with a higher embankment, a larger load on the
 * crest and a lower Su).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { initEngine, validateDefinition } from "@cslope/engine";
import { dumps, type AnalysisDocument } from "../engine/document";
import { APP_OPTIONS } from "./builder";
import { EMBANKMENT_EXAMPLES } from "./embankment-examples";
import {
  embankmentDocument,
  embankmentFieldProblems,
  embankmentGeometry,
  embankmentNotes,
  embankmentProblems,
  embankmentTemplate,
  modelDepth,
  WATER_ABOVE_GROUND,
  type EmbankmentParams,
} from "./embankment";
import { regionCount } from "./regions";
import { runDocument } from "./run-document";

beforeAll(() => initEngine());

/** The committed fixtures (scripts/write-fixtures.ts), as text. */
const fixtures = import.meta.glob<string>("./fixtures/embankment/*.json", { query: "?raw", import: "default", eager: true });
const expected = JSON.parse(fixtures["./fixtures/embankment/expected.json"] ?? "{}") as Record<string, { fos: number; fosLabel: string }>;

const base = EMBANKMENT_EXAMPLES["clay-3m"];
const clay = (su: number, bottomLevel = -15) => ({ name: "Clay", bottomLevel, material: { kind: "undrained" as const, gamma: 16, su } });

describe("the geometry rules", () => {
  it("puts the crest from −B to 0 and the toes n·h beyond it, and reaches 1.5 × the depth beyond each toe", () => {
    const g = embankmentGeometry(base);
    // 3 m high, 1:2.5: the toes 7.5 m out; the clay to −15, 18 m below the crest: each side 27 m.
    expect(g).toMatchObject({ ground: 0, crest: 3, base: -15, crestLeft: -6, farToe: -13.5, toeX: 7.5, left: -40.5, right: 34.5, levels: [] });
    const def = embankmentDocument(base).definition;
    expect(def.coordinates).toEqual([
      [-40.5, -15],
      [-40.5, 0],
      [-13.5, 0],
      [-6, 3],
      [0, 3],
      [7.5, 0],
      [34.5, 0],
      [34.5, -15],
    ]);
    expect(def.orientation).toBe("ltr");
    expect(def.waterTable).toBeUndefined();
    // A shallow layer: the base at its bottom, the sides at least 3h.
    expect(embankmentGeometry({ ...base, embankmentHeight: 1, layers: [clay(15, -0.5)] })).toMatchObject({ base: -0.5, left: -8.5 - 3, right: 2.5 + 3 });
    // The recommended depth: 3h, or half the foot's width when that is more.
    expect(modelDepth({ embankmentHeight: 4, crestWidth: 2, slope: 1 })).toBe(12);
    expect(modelDepth({ embankmentHeight: 1, crestWidth: 6, slope: 2.5 })).toBe(5.5);
  });

  it("lets surfaces enter on the embankment (the crest and the far side) and exit from the crest's edge on: the face, the toe, the ground", () => {
    expect(embankmentDocument(base).definition.analysisLimits).toEqual({ entryLeftX: -13.5, entryRightX: 0, exitLeftX: 0, exitRightX: 34.5 });
  });

  it("makes the embankment its own region, of its own material, with the load over the crest", () => {
    const def = embankmentDocument(EMBANKMENT_EXAMPLES["clay-3m-traffic"]).definition;
    expect(def.materials.map((m) => m.name)).toEqual(["Clay", "Embankment"]);
    expect(def.materials[1].model).toEqual({ kind: "mohr-coulomb", unitWeight: 19, unitWeightSat: 19, cohesion: 0, frictionAngle: 35 });
    expect(def.materialBoundaries).toEqual([{ coordinates: [[-13.5, 0], [7.5, 0]] }]);
    expect(def.regionAssignments).toEqual([
      { point: [-39.5, -7.5], materialName: "Clay" },
      { point: [-3, 1.5], materialName: "Embankment" },
    ]);
    expect(def.udls).toEqual([{ magnitude: 20, x1: -6, x2: 0 }]);
    expect(def.waterTable).toEqual({ mode: "height", value: -1, freeWater: false });
    expect(embankmentDocument(base).definition.udls).toBeUndefined();
    expect(embankmentDocument({ ...base, crestLoad: 0 }).definition.udls).toBeUndefined();
  });

  it("ends each layer boundary on the outline's vertices at both edges, with a region per layer", () => {
    const params = EMBANKMENT_EXAMPLES["three-layers"];
    const g = embankmentGeometry(params);
    const def = embankmentDocument(params).definition;
    expect(def.coordinates.slice(0, 4)).toEqual([
      [g.left, -15],
      [g.left, -6],
      [g.left, 1],
      [g.left, 2],
    ]);
    expect(def.coordinates.slice(-3)).toEqual([
      [g.right, 1],
      [g.right, -6],
      [g.right, -15],
    ]);
    expect(def.materialBoundaries!.slice(0, 2)).toEqual([{ coordinates: [[g.left, 1], [g.right, 1]] }, { coordinates: [[g.left, -6], [g.right, -6]] }]);
    expect(def.materials[1].model).toMatchObject({ kind: "s-f-datum", suRef: 14, yRef: 1, rate: 1.2 });
    expect(validateDefinition(def).filter((i) => i.severity === "error")).toEqual([]);
    expect(regionCount(def)).toBe(4);
  });

  it("ends at the last layer's bottom as firm ground, and says so when that is shallower than recommended", () => {
    expect(embankmentNotes(base)).toEqual([]);
    // 3 m high, B 6 m, 1:2.5: half the foot's width is 10.5 m.
    expect(embankmentNotes({ ...base, layers: [clay(15, -10.5)] })).toEqual([]);
    expect(embankmentNotes({ ...base, layers: [clay(15, -2)] })).toEqual([
      "The model ends at the last layer's bottom (-2 m), treated as firm ground. If the soil continues deeper, enter its real bottom: a deeper base can give a lower F.",
    ]);
    expect(embankmentDocument({ ...base, layers: [clay(15, -2)] }).definition.coordinates[0]).toEqual([embankmentGeometry({ ...base, layers: [clay(15, -2)] }).left, -2]);
    expect(embankmentTemplate.notes({ ...base, slope: 0 })).toEqual([]);
  });

  it("lets the water stand in the embankment, seeping out of its faces, and refuses it above the crest", () => {
    expect(embankmentNotes({ ...base, waterLevel: 0 })).toEqual([]);
    expect(embankmentNotes({ ...base, waterLevel: 1.5 })).toEqual([WATER_ABOVE_GROUND]);
    // Ponded: the water stands beside the embankment (free water), and the note goes.
    expect(embankmentNotes({ ...base, waterLevel: 1.5, ponded: true })).toEqual([]);
    expect(embankmentDocument({ ...base, waterLevel: 1.5, ponded: true }).definition.waterTable).toEqual({ mode: "height", value: 1.5, freeWater: true });
    expect(embankmentDocument({ ...base, waterLevel: 1.5 }).definition.waterTable).toEqual({ mode: "height", value: 1.5, freeWater: false });
    expect(WATER_ABOVE_GROUND).toBe("The water above the ground seeps out of the embankment's faces; no free water stands beside it.");
    expect(embankmentDocument({ ...base, waterLevel: 3 }).definition.waterTable).toEqual({ mode: "height", value: 3, freeWater: false });
    expect(embankmentFieldProblems({ ...base, waterLevel: 3.1 })).toEqual([{ field: "waterLevel", message: "The ground-water level must not be above the crest (3 m)." }]);
  });

  it("uses the app's options without a tension crack (unlike the excavation), on characteristic values (no partial factors)", () => {
    expect(embankmentDocument(base).options).toEqual(APP_OPTIONS);
    expect(embankmentDocument(base).options).not.toHaveProperty("tensionCrackAuto");
    expect(embankmentDocument(base).options).not.toHaveProperty("tensionCrackAngle");
    expect(embankmentDocument(EMBANKMENT_EXAMPLES["clay-3m-traffic"]).options).not.toHaveProperty("partialFactors");
  });

  it("refuses what it cannot build, with a sentence each at its field", () => {
    expect(embankmentProblems(base)).toEqual([]);
    const params: EmbankmentParams = {
      ...base,
      embankmentHeight: 20,
      crestWidth: 0.5,
      fill: { gamma: 19, c: 0, phi: 90 },
      crestLoad: -5,
      layers: [{ ...clay(15), name: "Embankment" }, { bottomLevel: -14.98, material: { kind: "undrained", gamma: 16, su: -1 } }],
    };
    expect(embankmentFieldProblems(params)).toEqual([
      { field: "embankmentHeight", message: "Must be from 0.5 to 15 m.", general: "Embankment height h must be from 0.5 to 15 m." },
      { field: "crestWidth", message: "Must be from 1 to 60 m.", general: "Crest width B must be from 1 to 60 m." },
      { field: "fill.phi", message: "Must be at least 0° and less than 90°.", general: "Embankment: Fill φ′ must be at least 0° and less than 90°." },
      { field: "crestLoad", message: "Must be at least 0 kPa.", general: "Load on the crest q must be at least 0 kPa." },
      { field: "layers.1.bottomLevel", message: "Layer 2: the bottom level -14.98 must be at least 0.05 m below the layer above (-15)." },
      { field: "layers.1.su", message: "Must be more than 0 kPa.", general: "Layer 2: Su must be more than 0 kPa." },
      { field: "layers.0.name", message: 'A layer is named "Embankment", which is the embankment\'s material.' },
    ]);
    expect(() => embankmentDocument({ ...base, slope: 0 })).toThrow("Slope 1:n must be from 0.5 to 5.");
  });

  it("is listed with its parameters", () => {
    expect(embankmentTemplate.id).toBe("embankment");
    expect(embankmentTemplate.params.embankmentHeight).toMatchObject({ unit: "m", min: 0.5, max: 15 });
    expect(embankmentTemplate.toDocument(base)).toEqual(embankmentDocument(base));
  });
});

describe("the ten named sets", () => {
  const names = Object.keys(EMBANKMENT_EXAMPLES);
  it("are ten, with a fixture and an expected F each", () => {
    expect(names).toHaveLength(10);
    expect(Object.keys(expected).sort()).toEqual([...names].sort());
  });

  for (const name of names) {
    it(`${name}: the fixture is the document, which validates and runs to F ${expected[name]?.fos.toFixed(3)}`, async () => {
      const params = EMBANKMENT_EXAMPLES[name];
      expect(embankmentProblems(params)).toEqual([]);
      const doc = embankmentDocument(params);
      const file = `./fixtures/embankment/${name}.json`;
      expect(fixtures[file], `${file} is missing: bun scripts/write-fixtures.ts`).toBeDefined();
      expect(fixtures[file], `${file} is stale: bun scripts/write-fixtures.ts`).toBe(dumps(doc));
      const { summary, issues } = await runDocument(doc);
      expect(issues.filter((i) => i.severity === "error")).toEqual([]);
      expect(summary.fosLabel).toBe(expected[name].fosLabel);
      expect(Math.abs(summary.fos! - expected[name].fos), `F ${summary.fos} is not the pinned ${expected[name].fos}`).toBeLessThan(1e-6);
    });
  }

  it("say what F is: a factor of safety on characteristic values, for every set", () => {
    for (const name of names) expect(expected[name].fosLabel, name).toBe("factor of safety");
  });
});

/** The document with each side of the model twice as far from the embankment, with the same search limits. */
function widened(params: EmbankmentParams): AnalysisDocument {
  const g = embankmentGeometry(params);
  const doc = embankmentDocument(params);
  const left = g.farToe + 2 * (g.left - g.farToe);
  const right = g.toeX + 2 * (g.right - g.toeX);
  const move = ([x, y]: [number, number]): [number, number] => [x <= g.left + 1e-9 ? left : x >= g.right - 1e-9 ? right : x, y];
  const def = doc.definition;
  def.coordinates = def.coordinates.map(move);
  for (const b of def.materialBoundaries ?? []) b.coordinates = b.coordinates.map(move);
  return doc;
}

describe("the model's extent and the search limits", () => {
  for (const name of Object.keys(EMBANKMENT_EXAMPLES)) {
    it(`${name}: twice as wide, F does not change beyond 1e-3; the critical surface exits before the edge`, async () => {
      const params = EMBANKMENT_EXAMPLES[name];
      const g = embankmentGeometry(params);
      const { result, summary } = await runDocument(embankmentDocument(params));
      const own = summary.fos!;
      const cs = result.criticalSurface!;
      // The search limits do not bind: the exit keeps off the right edge, the entry off the far toe.
      expect(g.right - cs.exitPoint[0], "exit near the right edge").toBeGreaterThan(0.25 * (g.right - g.toeX));
      expect(cs.entryPoint[0] - g.farToe, "entry at the far toe").toBeGreaterThan(0.1);
      const wide = (await runDocument(widened(params))).summary.fos!;
      expect(Math.abs(wide - own), `F ${own}, twice as wide ${wide}`).toBeLessThan(1e-3);
    });
  }

  it("an entry on the crest alone finds no lower F (the far side only widens the search)", async () => {
    for (const name of ["clay-3m-traffic", "crust-over-clay", "clay-over-rock", "wide-high"]) {
      const params = EMBANKMENT_EXAMPLES[name];
      const doc = embankmentDocument(params);
      const own = (await runDocument(doc)).summary.fos!;
      doc.definition.analysisLimits!.entryLeftX = embankmentGeometry(params).crestLeft;
      const crest = (await runDocument(doc)).summary.fos!;
      expect(crest, name).toBeGreaterThan(own - 2e-3);
    }
  });
});

/** The document with its base twice as far below the ground: the last layer goes on twice as deep. */
function deepened(params: EmbankmentParams): AnalysisDocument {
  const g = embankmentGeometry(params);
  const doc = embankmentDocument(params);
  const base = g.base - (g.ground - g.base);
  doc.definition.coordinates = doc.definition.coordinates.map(([x, y]) => [x, Math.abs(y - g.base) < 1e-9 ? base : y]);
  return doc;
}

/** Wide embankments on a uniform clay that ends at the recommended depth (the review's cases). */
const WIDE: Record<string, EmbankmentParams> = Object.fromEntries(
  (
    [
      [1.5, 40, 6],
      [3, 30, 12],
      [2, 60, 10],
    ] as const
  ).map(([h, B, su]) => [`h ${h} m, B ${B} m, Su ${su} kPa`, { ...base, embankmentHeight: h, crestWidth: B, slope: 2, crestLoad: 20, layers: [clay(su, -modelDepth({ embankmentHeight: h, crestWidth: B, slope: 2 }))] }]),
);

describe("the model's depth", () => {
  // Only where the last layer reaches the recommended depth: a shallower firm base is the user's (a note says so).
  const deepEnough = Object.entries(EMBANKMENT_EXAMPLES).filter(([, p]) => !embankmentNotes(p).some((n) => n.startsWith("The model ends")));
  it("covers every example", () => expect(deepEnough).toHaveLength(Object.keys(EMBANKMENT_EXAMPLES).length));
  for (const [name, params] of [...deepEnough, ...Object.entries(WIDE)]) {
    it(`${name}: twice as deep, F does not change beyond 1e-3`, async () => {
      const own = (await runDocument(embankmentDocument(params))).summary.fos!;
      const deep = (await runDocument(deepened(params))).summary.fos!;
      expect(Math.abs(deep - own), `F ${own}, twice as deep ${deep}`).toBeLessThan(1e-3);
    });
  }
});

describe("a shallow slide in the face", () => {
  it("is found in a steep sand fill on stiff clay: F is tan φ′ / tan β, the exit in the face, with the engine's warning", async () => {
    // 1:1.5 and φ′ 32°: tan φ′ / tan β = 0.6249 × 1.5 = 0.937 (the infinite slope).
    const params: EmbankmentParams = { ...base, embankmentHeight: 4, slope: 1.5, fill: { gamma: 19, c: 0, phi: 32 }, layers: [{ ...clay(80), material: { kind: "undrained", gamma: 18, su: 80 } }] };
    const { result, summary } = await runDocument(embankmentDocument(params));
    const infinite = Math.tan((32 * Math.PI) / 180) * 1.5;
    expect(summary.fos!).toBeGreaterThan(infinite * 0.99);
    expect(summary.fos!).toBeLessThan(infinite * 1.01);
    const [x, y] = result.criticalSurface!.exitPoint;
    expect(x).toBeLessThan(embankmentGeometry(params).toeX);
    expect(y).toBeGreaterThan(0);
    expect(summary.warnings.map((w) => w.code)).toContain("frictional-surface-slide");
  });
});

describe("monotonic checks", () => {
  const F = async (params: EmbankmentParams) => (await runDocument(embankmentDocument(params))).summary.fos!;

  it("F falls with a higher embankment", async () => {
    const fs = [];
    for (const h of [2, 3, 4, 5]) fs.push(await F({ ...base, embankmentHeight: h }));
    for (let i = 1; i < fs.length; i++) expect(fs[i], `h ${i + 2} m against ${i + 1} m: ${fs.join(", ")}`).toBeLessThan(fs[i - 1]);
  });

  it("F falls with a larger load on the crest", async () => {
    const fs = [];
    for (const q of [null, 10, 20, 40]) fs.push(await F({ ...base, crestLoad: q }));
    for (let i = 1; i < fs.length; i++) expect(fs[i], fs.join(", ")).toBeLessThan(fs[i - 1]);
  });

  it("F falls with a lower Su", async () => {
    expect(await F({ ...base, layers: [clay(12)] })).toBeLessThan(await F(base));
  });
});
