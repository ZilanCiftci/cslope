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
