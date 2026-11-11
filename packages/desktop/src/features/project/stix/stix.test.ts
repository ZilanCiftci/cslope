import { describe, expect, it } from "vitest";
import { analyseSlope, buildSlope, toCanonicalSlopeDefinition, DEFAULT_ANALYSIS_OPTIONS, type SlopeDefinition } from "@cslope/engine";
import { modelFromDefinition } from "../../../store/definition-model";
import { parseStixDocuments, readStix } from "./stix-read";
import { stixToDefinition } from "./stix-to-definition";
import { modelToStix, modelToStixDocuments } from "./stix-write";

type Json = Record<string, unknown>;

/** A dike on clay over sand: a clay with SHANSEP (POP) below the water and Mohr-Coulomb above it. */
const dike: SlopeDefinition = {
  coordinates: [[0, 0], [0, 6], [10, 6], [16, 10], [20, 10], [28, 6], [40, 6], [40, 0]],
  materials: [
    { name: "Sand", model: { kind: "mohr-coulomb", unitWeight: 18, unitWeightSat: 20, cohesion: 0, frictionAngle: 32 } },
    {
      name: "Clay",
      model: { kind: "shansep", unitWeight: 16, ratio: 0.25, exponent: 0.85, pop: 15, aboveWater: { kind: "mohr-coulomb", unitWeight: 16, cohesion: 5, frictionAngle: 25 } },
    },
    { name: "Dike", model: { kind: "mohr-coulomb", unitWeight: 19, cohesion: 4, frictionAngle: 30 } },
  ],
  materialBoundaries: [
    { coordinates: [[0, 2], [40, 2]], materialName: "" },
    { coordinates: [[0, 6], [40, 6]], materialName: "" },
  ],
  regionAssignments: [
    { point: [20, 1], materialName: "Sand" },
    { point: [20, 4], materialName: "Clay" },
    { point: [18, 8], materialName: "Dike" },
  ],
  waterTable: { mode: "custom", value: [[0, 9], [16, 9], [28, 5.5], [40, 5.5]], followBoundary: false },
  udls: [{ magnitude: 13, x1: 16, x2: 20, excessPorePressure: [{ material: "Clay", ratio: 0.9 }] }],
  lineLoads: [{ magnitude: 10, x: 18 }],
  customSearchPlanes: [{ cx: 26, cy: 16, radius: 12 }],
  customPlanesOnly: true,
};

const F = (def: SlopeDefinition, options: object) => {
  const s = buildSlope(toCanonicalSlopeDefinition(def));
  s.updateAnalysisOptions({ ...DEFAULT_ANALYSIS_OPTIONS, ...options });
  return analyseSlope(s) as number;
};
const model = (def: SlopeDefinition, method: "Bishop" | "Morgenstern-Price" = "Bishop") =>
  modelFromDefinition(def, { id: "m", name: "Dike", options: { ...DEFAULT_ANALYSIS_OPTIONS, method } });
/** The documents back through the reader, as a .stix file would be read. */
const reread = (docs: Map<string, Json>) => parseStixDocuments(new Map(JSON.parse(JSON.stringify([...docs.entries()]))));

describe(".stix export and import", () => {
  it("round-trips a model: layers, soils, water, loads and the Bishop circle give the same factor of safety", async () => {
    const m = model(dike);
    const f0 = F(dike, { method: "Bishop" });
    const { bytes, notes } = modelToStix(m);
    const file = await readStix(bytes);
    expect(file.calculations).toHaveLength(1);
    const imp = stixToDefinition(file, 0, "Dike.stix");
    expect(imp.options.method).toBe("Bishop");
    expect(imp.definition.customSearchPlanes).toEqual([{ cx: 26, cy: 16, radius: 12 }]);
    const clay = imp.definition.materials.find((q) => q.name === "Clay")!.model!;
    expect(clay).toMatchObject({ kind: "shansep", ratio: 0.25, exponent: 0.85, aboveWater: { kind: "mohr-coulomb", cohesion: 5, frictionAngle: 25 } });
    expect(imp.definition.udls?.[0].excessPorePressure).toEqual([{ material: "Clay", ratio: expect.closeTo(0.9, 9) }]);
    expect(F(imp.definition, imp.options)).toBeCloseTo(f0, 6);
    expect(notes.join(" ")).not.toMatch(/Clay/);
  });

  it("writes a right-to-left model in its own coordinates", () => {
    const rtl: SlopeDefinition = {
      orientation: "rtl",
      coordinates: [[0, 0], [0, 4], [15, 4], [30, 10], [40, 10], [40, 0]],
      materials: [{ name: "Clay", model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 8, frictionAngle: 25 } }],
      udls: [{ magnitude: 10, x1: 32, x2: 38 }],
      waterTable: { mode: "custom", value: [[0, 3], [15, 3], [40, 7]] },
      customSearchPlanes: [{ cx: 18, cy: 20, radius: 17 }],
      customPlanesOnly: true,
    };
    const f0 = F(rtl, { method: "Bishop" });
    const { docs } = modelToStixDocuments(model(rtl));
    const layer = (docs.get("geometries/geometry.json")!.Layers as Json[])[0];
    const xs = (layer.Points as { X: number }[]).map((p) => p.X);
    expect(Math.min(...xs)).toBe(0);
    expect((docs.get("loads/loads.json")!.UniformLoads as Json[])[0]).toMatchObject({ Start: 32, End: 38 });
    const imp = stixToDefinition(reread(docs), 0, "x.stix");
    expect(imp.definition.customSearchPlanes).toEqual([{ cx: 18, cy: 20, radius: 17 }]);
    expect(f0).toBeGreaterThan(0);
    expect(F(imp.definition, imp.options)).toBeCloseTo(f0, 6);
  });

  it("writes an earlier stage as a stage before the model's, whose stress history the model's layers keep", () => {
    const clay = { kind: "shansep" as const, unitWeight: 16, ratio: 0.25, exponent: 0.85, pop: 5, yieldFromEarlierStage: true };
    const now: SlopeDefinition = {
      ...dike,
      materials: dike.materials.map((q) => (q.name === "Clay" ? { ...q, model: clay } : q)),
      earlierStage: { ...dike, materials: dike.materials.map((q) => (q.name === "Clay" ? { ...q, model: clay } : q)), waterTable: { mode: "custom", value: [[0, 5], [40, 5]] }, udls: [], lineLoads: [] },
    };
    const f0 = F(now, { method: "Bishop" });
    const { docs } = modelToStixDocuments(model(now));
    const scenario = docs.get("scenarios/scenario.json")!;
    expect((scenario.Stages as Json[]).map((g) => g.Label)).toEqual(["Earlier stage", "Stage 2"]);
    // the clay's state point is in the earlier stage only
    expect(((docs.get("states/states.json")!.StatePoints as Json[]) ?? []).length).toBe(1);
    expect(((docs.get("states/states_1.json")!.StatePoints as Json[]) ?? []).length).toBe(0);
    const imp = stixToDefinition(reread(docs), 0, "x.stix");
    expect(imp.definition.earlierStage).toBeDefined();
    expect(F(imp.definition, imp.options)).toBeCloseTo(f0, 6);
  });

  it("writes B̄ as the degree of consolidation under the weight of the fill and reads it back", () => {
    const bbar: SlopeDefinition = {
      ...dike,
      udls: [],
      materials: dike.materials.map((q) =>
        q.name === "Clay" ? { ...q, model: { kind: "mohr-coulomb" as const, unitWeight: 16, cohesion: 8, frictionAngle: 22, bBar: 0.8 } } : q.name === "Dike" ? { ...q, model: { ...q.model!, bBarLoad: true } } : q,
      ),
    };
    const f0 = F(bbar, { method: "Bishop" });
    expect(f0).toBeLessThan(F({ ...bbar, materials: bbar.materials.map((q) => ({ ...q, model: { ...q.model!, bBar: undefined } })) }, { method: "Bishop" }));
    const { docs } = modelToStixDocuments(model(bbar));
    const loads = docs.get("loads/loads.json")!.LayerLoads as { Consolidations: { Degree: number }[] }[];
    expect(loads.some((l) => l.Consolidations.some((c) => Math.abs(c.Degree - 20) < 1e-9))).toBe(true);
    const imp = stixToDefinition(reread(docs), 0, "x.stix");
    const byName = Object.fromEntries(imp.definition.materials.map((q) => [q.name, q.model]));
    expect(byName.Clay).toMatchObject({ bBar: expect.closeTo(0.8, 9) });
    expect(byName.Dike).toMatchObject({ bBarLoad: true });
    expect(F(imp.definition, imp.options)).toBeCloseTo(f0, 6);
  });

  it("writes the model's unit weight of water and takes the file's back into the model", () => {
    const waterOf = (docs: Map<string, Json>) =>
      [...docs.entries()].filter(([k]) => k.startsWith("waternets/")).map(([, d]) => d.UnitWeightWater);
    const plain = modelToStixDocuments(model(dike)).docs;
    expect(waterOf(plain)).toEqual([9.807]);
    expect(stixToDefinition(reread(plain), 0, "x.stix").options.waterUnitWeight).toBeUndefined();
    const m = model(dike);
    m.options = { ...m.options, waterUnitWeight: 9.82 };
    const docs = modelToStixDocuments(m).docs;
    expect(waterOf(docs)).toEqual([9.82]);
    const imp = stixToDefinition(reread(docs), 0, "x.stix");
    expect(imp.options.waterUnitWeight).toBe(9.82);
    expect(imp.notes.join(" ")).not.toMatch(/unit weight of water/);
    expect(F(imp.definition, imp.options)).toBeCloseTo(F(dike, { method: "Bishop", waterUnitWeight: 9.82 }), 6);
  });

  it("writes a waternet with its head and reference lines", () => {
    const wn: SlopeDefinition = {
      ...dike,
      waternet: {
        headLines: [{ id: "p", points: [[0, 9], [16, 9], [28, 5.5], [40, 5.5]] }, { id: "a", points: [[0, 9], [40, 9]] }],
        referenceLines: [{ points: [[0, 2], [40, 2]], topHeadLineId: "a", bottomHeadLineId: "a" }],
        phreaticLineId: "p",
      },
    };
    const f0 = F(wn, { method: "Bishop" });
    expect(f0).not.toBeCloseTo(F(dike, { method: "Bishop" }), 3);
    const imp = stixToDefinition(reread(modelToStixDocuments(model(wn)).docs), 0, "x.stix");
    expect(imp.definition.waternet?.referenceLines).toHaveLength(1);
    expect(F(imp.definition, imp.options)).toBeCloseTo(f0, 6);
  });

  it("writes a region around a lens as pieces without holes that do not overlap the lens, every layer clockwise", () => {
    const lens: SlopeDefinition = {
      ...dike,
      materials: [...dike.materials, { name: "Lens", model: { kind: "mohr-coulomb", unitWeight: 19, cohesion: 0, frictionAngle: 36 } }],
      materialBoundaries: [...dike.materialBoundaries!, { coordinates: [[4, 3], [10, 3], [10, 5], [4, 5], [4, 3]], materialName: "" }],
      regionAssignments: [...dike.regionAssignments!, { point: [7, 4], materialName: "Lens" }],
    };
    const f0 = F(lens, { method: "Bishop" });
    const { docs, notes } = modelToStixDocuments(model(lens));
    expect(notes.join(" ")).not.toMatch(/hole/);
    const layers = docs.get("geometries/geometry.json")!.Layers as { Label: string; Points: { X: number; Z: number }[] }[];
    const area2 = (pts: { X: number; Z: number }[]) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.X * q.Z - q.X * p.Z; }, 0);
    // clockwise: a negative signed area (Z up)
    expect(layers.every((l) => area2(l.Points) < 0)).toBe(true);
    // the layers tile the outline (no overlap): their areas add up to it
    const outline = dike.coordinates.map(([X, Z]) => ({ X, Z }));
    expect(layers.reduce((s, l) => s - area2(l.Points) / 2, 0)).toBeCloseTo(Math.abs(area2(outline)) / 2, 9);
    // the clay around the lens is in two pieces, the lens one layer of 12 m²
    expect(layers.filter((l) => l.Label.startsWith("Clay")).length).toBe(2);
    expect(-area2(layers.find((l) => l.Label.startsWith("Lens"))!.Points) / 2).toBeCloseTo(12, 9);
    const imp = stixToDefinition(reread(docs), 0, "x.stix");
    expect(F(imp.definition, imp.options)).toBeCloseTo(f0, 6);
  });

  it("writes the layer of a model with one region clockwise", () => {
    const one: SlopeDefinition = { coordinates: [[0, 0], [30, 0], [30, 5], [12, 10], [0, 10]], materials: [{ name: "Clay", model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 8, frictionAngle: 25 } }] };
    const layers = modelToStixDocuments(model(one)).docs.get("geometries/geometry.json")!.Layers as { Points: { X: number; Z: number }[] }[];
    expect(layers).toHaveLength(1);
    const pts = layers[0].Points;
    expect(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.X * q.Z - q.X * p.Z; }, 0)).toBeLessThan(0);
  });
});

describe(".stix import", () => {
  const docsOf = (def: SlopeDefinition, method?: "Morgenstern-Price") => modelToStixDocuments(model(def, method)).docs;

  it("reduces c and φ of the advanced Mohr-Coulomb model by its dilatancy (Davis): ψ = 0 gives c·cos φ and tan φ* = sin φ", () => {
    const docs = docsOf(dike);
    const soils = docs.get("soils.json")!.Soils as Json[];
    const d = soils.find((s) => s.Name === "Dike")!;
    (d.MohrCoulombAdvancedShearStrengthModel as Json).Dilatancy = 0;
    const imp = stixToDefinition(reread(docs), 0, "x.stix");
    const m = imp.definition.materials.find((q) => q.name === "Dike")!.model as { cohesion: number; frictionAngle: number };
    expect(m.cohesion).toBeCloseTo(4 * Math.cos(Math.PI / 6), 9);
    expect(Math.tan((m.frictionAngle * Math.PI) / 180)).toBeCloseTo(0.5, 9);
    expect(imp.notes.join(" ")).toMatch(/dilatancy ψ = 0°/);
  });

  it("calculates the stage named like the calculation in a file from before 2024", () => {
    const docs = docsOf(dike);
    const sc = docs.get("scenarios/scenario.json")!;
    const stage = (sc.Stages as Json[])[0];
    sc.Stages = [{ ...stage, Id: "s1", Label: "Own" }, { ...stage, Id: "s2", Label: "Last", LoadsId: "none" }];
    (sc.Calculations as Json[])[0].Label = "Own";
    docs.get("projectinfo.json")!.ApplicationModified = "Program 2023.01";
    // before 2024: the stage "Own" (with the loads); later: the last stage (without them)
    const old = stixToDefinition(reread(docs), 0, "x.stix");
    expect(old.definition.udls).toHaveLength(1);
    docs.get("projectinfo.json")!.ApplicationModified = "Program 2025.01";
    expect(stixToDefinition(reread(docs), 0, "x.stix").definition.udls).toHaveLength(0);
  });

  it("slides the way the file's slip plane falls, and notes pore pressures from a mesh", () => {
    const docs = docsOf({ ...dike, customSearchPlanes: undefined, customSurfaces: [{ points: [[14, 8.67], [20, 3], [26, 3], [30, 6]] }] }, "Morgenstern-Price");
    const settings = docs.get("calculationsettings/calculationsettings.json")!;
    expect(settings.AnalysisType).toBe("Spencer");
    expect(stixToDefinition(reread(docs), 0, "x.stix").definition.orientation).toBe("ltr");
    settings.Spencer = { ...(settings.Spencer as Json), SlipPlane: [{ X: 14, Z: 6 }, { X: 20, Z: 3 }, { X: 26, Z: 3 }, { X: 28.5, Z: 9 }] };
    expect(stixToDefinition(reread(docs), 0, "x.stix").definition.orientation).toBe("rtl");
    ((docs.get("scenarios/scenario.json")!.Stages as Json[])[0]).WaterDefinitionType = "WaterMesh";
    expect(stixToDefinition(reread(docs), 0, "x.stix").notes.join(" ")).toMatch(/pore pressures from a mesh/);
  });

  it("takes the phreatic level from the top head line of the uppermost reference line when the file names none", () => {
    const docs = docsOf({
      ...dike,
      waternet: {
        headLines: [
          { id: "low", points: [[0, 4], [40, 4]] },
          { id: "high", points: [[0, 7], [40, 6]] },
        ],
        referenceLines: [
          { points: [[0, 1], [40, 1]], topHeadLineId: "low", bottomHeadLineId: "low" },
          { points: [[0, 3], [40, 3]], topHeadLineId: "high", bottomHeadLineId: "low" },
        ],
        phreaticLineId: "low",
      },
    });
    delete docs.get("waternets/waternets.json")!.PhreaticLineId;
    const imp = stixToDefinition(reread(docs), 0, "x.stix");
    const wt = imp.definition.waterTable!;
    expect(wt.mode).toBe("custom");
    expect((wt.value as [number, number][]).map((p) => p[1])).toEqual(expect.arrayContaining([7, 6]));
    expect(imp.notes.join(" ")).toMatch(/has no phreatic line; the phreatic level .* is taken from head line ".*" \(the top head line of the uppermost reference line\)/);
  });

  it("leaves out a reference line without head lines", () => {
    const docs = docsOf({
      ...dike,
      waternet: { headLines: [{ id: "p", points: [[0, 9], [40, 9]] }], referenceLines: [{ points: [[0, 2], [40, 2]], topHeadLineId: "p", bottomHeadLineId: "p" }], phreaticLineId: "p" },
    });
    const wn = docs.get("waternets/waternets.json")!;
    (wn.ReferenceLines as Json[])[0].TopHeadLineId = null;
    (wn.ReferenceLines as Json[])[0].BottomHeadLineId = null;
    const r = stixToDefinition(reread(docs), 0, "x.stix").definition.waternet!.referenceLines[0];
    expect(r.topHeadLineId).toBeUndefined();
    expect(r.bottomHeadLineId).toBeUndefined();
  });
});
