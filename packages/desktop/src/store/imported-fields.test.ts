/**
 * Fields that come from imported .stix files and have no editor in the
 * app: pore pressure from head and reference lines (waternet), an earlier
 * construction stage, excess pore pressure under loads and a separate
 * strength above the water line. They must reach the analysis and survive
 * save/load, model switching, undo and duplication.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { toCanonicalSlopeDefinition, type MaterialModel, type SlopeDefinition } from "@cslope/engine";
import { modelFromDefinition } from "./definition-model";
import { buildSlopeDTO, buildSlopeDTOFromModel } from "./helpers";
import { useAppStore } from "./app-store";
import { parseProjectFile, serializeProject } from "./persistence";
import { mirrorModelEntry } from "./benchmarks";
import { performUndo } from "./selectors";
import { buildAnalysisSummary } from "../features/export/analysisSummary";
import type { ModelEntry } from "./types";

const store = () => useAppStore.getState();

const clayBelow: MaterialModel = {
  kind: "shansep",
  unitWeight: 17,
  ratio: 0.25,
  exponent: 0.8,
  pop: 10,
  yieldFromEarlierStage: true,
  aboveWater: { kind: "mohr-coulomb", unitWeight: 17, cohesion: 2, frictionAngle: 30 },
};

const sand: MaterialModel = { kind: "mohr-coulomb", unitWeight: 19, cohesion: 0, frictionAngle: 34 };

function definition(orientation: "ltr" | "rtl" = "ltr"): SlopeDefinition {
  return {
    orientation,
    coordinates: [
      [0, 0],
      [0, 10],
      [10, 10],
      [20, 5],
      [30, 5],
      [30, 0],
    ],
    materials: [
      { name: "Clay", model: clayBelow },
      { name: "Sand", model: sand },
    ],
    materialBoundaries: [{ coordinates: [[0, 4], [30, 4]], materialName: "" }],
    regionAssignments: [
      { point: [5, 2], materialName: "Clay" },
      { point: [5, 7], materialName: "Sand" },
    ],
    waterTable: { mode: "custom", value: [[0, 8], [30, 4]] },
    udls: [
      {
        magnitude: 20,
        x1: 2,
        x2: 8,
        excessPorePressure: [
          { material: "Clay", ratio: 0.6 },
          { material: "Unknown", ratio: 0.5 },
        ],
      },
    ],
    waternet: {
      headLines: [
        { id: "PL1", points: [[0, 8], [30, 4]] },
        { id: "PL2", points: [[0, 9], [30, 6]] },
      ],
      referenceLines: [{ points: [[0, 4], [30, 4]], topHeadLineId: "PL1", bottomHeadLineId: "PL2" }],
      phreaticLineId: "PL1",
    },
    earlierStage: {
      coordinates: [
        [0, 0],
        [0, 8],
        [30, 5],
        [30, 0],
      ],
      materials: [{ name: "Clay", model: { kind: "mohr-coulomb", unitWeight: 17, cohesion: 5, frictionAngle: 25 } }],
      waterTable: { mode: "custom", value: [[0, 7], [30, 4]] },
    },
  };
}

function importedModel(id = "imp", orientation: "ltr" | "rtl" = "ltr"): ModelEntry {
  return modelFromDefinition(definition(orientation), { id, name: "Imported" });
}

describe("definition → app model → definition", () => {
  it("keeps the waternet and the earlier stage as they are, in model coordinates", () => {
    const def = definition();
    const model = importedModel();
    expect(model.waternet).toEqual(def.waternet);
    expect(model.earlierStage).toEqual(def.earlierStage);
    // A copy: editing the definition afterwards does not change the model.
    expect(model.waternet).not.toBe(def.waternet);

    const built = buildSlopeDTOFromModel(model);
    const canonical = toCanonicalSlopeDefinition(def);
    expect(built.waternet).toEqual(canonical.waternet);
    expect(built.earlierStage).toEqual(canonical.earlierStage);
  });

  it("mirrors both with the model for a right-to-left slope", () => {
    const def = definition("rtl");
    const built = buildSlopeDTOFromModel(importedModel("imp", "rtl"));
    const canonical = toCanonicalSlopeDefinition(def);
    expect(built.waternet).toEqual(canonical.waternet);
    expect(built.earlierStage).toEqual(canonical.earlierStage);
    expect(built.waternet!.headLines[0].points[0]).toEqual([30, 8]);
  });

  it("refers to load materials by id, and back by the engine's name", () => {
    const model = importedModel();
    const clayId = model.materials[0].id;
    // The unknown material is dropped on import.
    expect(model.udls[0].excessPorePressure).toEqual([{ materialId: clayId, ratio: 0.6 }]);
    expect(buildSlopeDTOFromModel(model).udls![0].excessPorePressure).toEqual([{ material: "Clay", ratio: 0.6 }]);
  });

  it("uses the unique engine name of a material whose name is repeated", () => {
    const model = importedModel();
    model.materials[1].name = "Clay";
    model.udls[0].excessPorePressure = [{ materialId: model.materials[1].id, ratio: 0.3 }];
    const built = buildSlopeDTOFromModel(model);
    expect(built.materials.map((m) => m.name)).toEqual(["Clay", "Clay (2)"]);
    expect(built.udls![0].excessPorePressure).toEqual([{ material: "Clay (2)", ratio: 0.3 }]);
  });

  it("drops excess pore pressure of a deleted material", () => {
    const model = importedModel();
    model.udls[0].excessPorePressure = [
      { materialId: "gone", ratio: 0.4 },
      { materialId: model.materials[0].id, ratio: 0.2 },
    ];
    expect(buildSlopeDTOFromModel(model).udls![0].excessPorePressure).toEqual([{ material: "Clay", ratio: 0.2 }]);
    model.udls[0].excessPorePressure = [{ materialId: "gone", ratio: 0.4 }];
    expect(buildSlopeDTOFromModel(model).udls![0]).not.toHaveProperty("excessPorePressure");
  });

  it("keeps the strength above the water line and the SHANSEP stress history", () => {
    const built = buildSlopeDTOFromModel(importedModel());
    expect(built.materials[0].model).toEqual(clayBelow);
  });

  it("leaves all of them out of a model without them", () => {
    const def = definition();
    delete def.waternet;
    delete def.earlierStage;
    def.udls = [{ magnitude: 20, x1: 2, x2: 8 }];
    const model = modelFromDefinition(def, { id: "plain", name: "Plain" });
    expect(model).not.toHaveProperty("waternet");
    expect(model).not.toHaveProperty("earlierStage");
    expect(model.udls[0]).not.toHaveProperty("excessPorePressure");
    const built = buildSlopeDTOFromModel(model);
    expect(built).not.toHaveProperty("waternet");
    expect(built).not.toHaveProperty("earlierStage");
    expect(built.udls![0]).not.toHaveProperty("excessPorePressure");
  });

  it("mirrors both when a model entry is mirrored (the same analysis)", () => {
    const model = importedModel();
    const mirrored = mirrorModelEntry(model);
    expect(mirrored.waternet!.headLines[0].points).toEqual([[30, 8], [0, 4]]);
    const a = buildSlopeDTOFromModel(model);
    const b = buildSlopeDTOFromModel(mirrored);
    expect(b.waternet).toEqual(a.waternet);
    expect(b.earlierStage!.coordinates).toEqual(a.earlierStage!.coordinates);
  });
});

describe("in the store", () => {
  beforeEach(() => {
    store().newProject();
  });

  function loadImported() {
    store().loadProject({ models: [importedModel("imp"), { ...importedModel("other"), waternet: undefined, earlierStage: undefined }], activeModelId: "imp" });
  }

  it("reaches the analysis from the active model", () => {
    loadImported();
    expect(store().waternet).toEqual(definition().waternet);
    const dto = buildSlopeDTO(store());
    expect(dto.waternet).toEqual(definition().waternet);
    expect(dto.earlierStage).toEqual(toCanonicalSlopeDefinition(definition()).earlierStage);
    expect(dto.udls![0].excessPorePressure).toEqual([{ material: "Clay", ratio: 0.6 }]);
  });

  it("follows the active model when switching", () => {
    loadImported();
    store().switchModel("other");
    expect(store().waternet).toBeUndefined();
    expect(store().earlierStage).toBeUndefined();
    expect(buildSlopeDTO(store())).not.toHaveProperty("waternet");
    store().switchModel("imp");
    expect(store().waternet).toEqual(definition().waternet);
    expect(store().models.find((m) => m.id === "imp")!.earlierStage).toEqual(definition().earlierStage);
  });

  it("survives save and load", () => {
    loadImported();
    store().saveCurrentModel();
    const loaded = parseProjectFile(JSON.stringify(serializeProject(store())));
    const m = loaded.models.find((x) => x.id === "imp")!;
    const original = importedModel("imp");
    expect(m.waternet).toEqual(original.waternet);
    expect(m.earlierStage).toEqual(original.earlierStage);
    expect(m.udls[0].excessPorePressure).toEqual(original.udls[0].excessPorePressure);
    expect(m.materials[0].model).toEqual(clayBelow);
    expect(buildSlopeDTOFromModel(m)).toEqual(buildSlopeDTOFromModel({ ...original, options: m.options }));
    // The model without them stays without them.
    const other = loaded.models.find((x) => x.id === "other")!;
    expect(other).not.toHaveProperty("waternet");
    expect(other).not.toHaveProperty("earlierStage");
  });

  it("loads an older file without them", () => {
    store().saveCurrentModel();
    const raw = JSON.parse(JSON.stringify(serializeProject(store())));
    for (const m of raw.models) {
      delete m.waternet;
      delete m.earlierStage;
    }
    const loaded = parseProjectFile(JSON.stringify(raw));
    expect(loaded.models[0]).not.toHaveProperty("waternet");
    expect(loaded.models[0]).not.toHaveProperty("earlierStage");
    store().loadProject(loaded);
    expect(store().waternet).toBeUndefined();
  });

  it("drops malformed entries on load instead of failing", () => {
    loadImported();
    store().saveCurrentModel();
    const raw = JSON.parse(JSON.stringify(serializeProject(store())));
    const m = raw.models[0];
    m.waternet = { headLines: "x" };
    m.earlierStage = { coordinates: 3 };
    m.udls[0].excessPorePressure = [{ materialId: 3, ratio: 0.5 }, { materialId: m.materials[0].id, ratio: "a" }];
    m.materials[0].model.aboveWater = "drained";
    const loaded = parseProjectFile(JSON.stringify(raw)).models[0];
    expect(loaded).not.toHaveProperty("waternet");
    expect(loaded).not.toHaveProperty("earlierStage");
    expect(loaded.udls[0]).not.toHaveProperty("excessPorePressure");
    expect(loaded.materials[0].model).not.toHaveProperty("aboveWater");
    expect(loaded.materials[0].model).toMatchObject({ pop: 10, yieldFromEarlierStage: true });
  });

  it("cleans the earlier stage on load: assignments and loads of dropped materials, non-finite numbers", () => {
    loadImported();
    store().saveCurrentModel();
    const raw = JSON.parse(JSON.stringify(serializeProject(store())));
    const stage = raw.models[0].earlierStage;
    stage.materials.push({ name: "Broken", model: { kind: "mohr-coulomb", unitWeight: -1, cohesion: 0, frictionAngle: 0 } });
    stage.regionAssignments = [
      { point: [5, 2], materialName: "Clay" },
      { point: [5, 7], materialName: "Broken" },
    ];
    stage.waterTable = { mode: "custom", value: [[0, 7], [30, "x"], [15, 5]] };
    stage.udls = [
      { magnitude: 10, x1: 0, x2: 5, excessPorePressure: [{ material: "Clay", ratio: 0.5 }, { material: "Broken", ratio: 0.5 }] },
      { magnitude: "a", x1: 0, x2: 5 },
      { magnitude: 10, x1: 3, x2: 3 },
    ];
    const loaded = parseProjectFile(JSON.stringify(raw)).models[0].earlierStage!;
    expect(loaded.materials.map((m) => m.name)).toEqual(["Clay"]);
    expect(loaded.regionAssignments).toEqual([{ point: [5, 2], materialName: "Clay" }]);
    expect(loaded.waterTable).toEqual({ mode: "custom", value: [[0, 7], [15, 5]] });
    expect(loaded.udls).toEqual([{ magnitude: 10, x1: 0, x2: 5, excessPorePressure: [{ material: "Clay", ratio: 0.5 }] }]);
    stage.waterTable = { mode: "height", value: null };
    expect(parseProjectFile(JSON.stringify(raw)).models[0].earlierStage).not.toHaveProperty("waterTable");
  });

  it("keeps the material names of the earlier stage's boundaries (a stage assigned by boundary)", () => {
    loadImported();
    store().saveCurrentModel();
    const raw = JSON.parse(JSON.stringify(serializeProject(store())));
    const stage = raw.models[0].earlierStage;
    stage.materialBoundaries = [
      { coordinates: [[0, 4], [30, 4]], materialName: "Clay" },
      { coordinates: [[0, 3], [30, 3]], materialName: "Missing" },
    ];
    const loaded = parseProjectFile(JSON.stringify(raw)).models[0].earlierStage!;
    expect(loaded.materialBoundaries?.map((b) => b.materialName)).toEqual(["Clay", ""]);
  });

  it("keeps a model's import notes through save and load", () => {
    loadImported();
    useAppStore.setState((s) => ({ models: s.models.map((m) => (m.id === "imp" ? { ...m, importNotes: ["Imported from a.stix.", "A note."] } : m)) }));
    store().saveCurrentModel();
    const raw = JSON.parse(JSON.stringify(serializeProject(store())));
    const loaded = parseProjectFile(JSON.stringify(raw));
    expect(loaded.models.find((m) => m.id === "imp")!.importNotes).toEqual(["Imported from a.stix.", "A note."]);
    expect(loaded.models.find((m) => m.id === "other")).not.toHaveProperty("importNotes");
    raw.models[0].importNotes = ["ok", 3];
    expect(parseProjectFile(JSON.stringify(raw)).models[0].importNotes).toEqual(["ok"]);
  });

  it("keeps them through an edit and its undo", () => {
    loadImported();
    const udl = store().udls[0];
    store().updateUdl(udl.id, { magnitude: 30 });
    expect(store().udls[0].excessPorePressure).toEqual(udl.excessPorePressure);
    performUndo();
    expect(store().udls[0].magnitude).toBe(20);
    expect(store().udls[0].excessPorePressure).toEqual(udl.excessPorePressure);
    expect(store().waternet).toEqual(definition().waternet);
    expect(store().earlierStage).toEqual(definition().earlierStage);
  });

  it("copies them to a duplicated model, with the copy's material ids", () => {
    loadImported();
    store().duplicateModel("imp");
    const copy = store().models[store().models.length - 1];
    expect(store().activeModelId).toBe(copy.id);
    expect(copy.waternet).toEqual(definition().waternet);
    expect(copy.earlierStage).toEqual(definition().earlierStage);
    const source = store().models.find((m) => m.id === "imp")!;
    expect(copy.waternet).not.toBe(source.waternet);
    expect(copy.earlierStage).not.toBe(source.earlierStage);
    expect(copy.udls[0].excessPorePressure).toEqual([{ materialId: copy.materials[0].id, ratio: 0.6 }]);
    expect(copy.materials[0].id).not.toBe(source.materials[0].id);
    expect(buildSlopeDTO(store()).udls![0].excessPorePressure).toEqual([{ material: "Clay", ratio: 0.6 }]);
  });

  it("are named in the analysis summary", () => {
    loadImported();
    const s = store();
    const text = JSON.stringify(
      buildAnalysisSummary({
        result: { minFOS: 1.2, maxFOS: 2, criticalSurface: null, allSurfaces: [], method: "Bishop", elapsedMs: 1 } as never,
        options: s.options,
        analysisLimits: s.analysisLimits,
        orientation: s.orientation,
        piezometricLine: s.piezometricLine,
        materials: s.materials,
        udls: s.udls,
        lineLoads: s.lineLoads,
        waternet: s.waternet,
        earlierStage: s.earlierStage,
      }),
    );
    expect(text).toContain("2 head lines and 1 reference line");
    expect(text).toContain("earlier construction stage");
    expect(text).toContain("not consolidated: excess pore pressure 0.6 × q in Clay");
    expect(text).toContain("above the water line Mohr-Coulomb");
    expect(text).toContain("from the earlier stage + POP 10 kPa");
  });
});

describe("removing them", () => {
  beforeEach(() => {
    store().newProject();
    store().loadProject({ models: [importedModel("imp"), importedModel("other")], activeModelId: "imp" });
  });

  const active = () => store().models.find((m) => m.id === "imp")!;

  it("removes the waternet from the active model only, as one undoable step", () => {
    store().removeWaternet();
    expect(store().waternet).toBeUndefined();
    expect(active()).not.toHaveProperty("waternet");
    expect(buildSlopeDTO(store())).not.toHaveProperty("waternet");
    // The other model and the earlier stage keep theirs.
    expect(store().models.find((m) => m.id === "other")!.waternet).toEqual(definition().waternet);
    expect(store().earlierStage).toEqual(definition().earlierStage);
    performUndo();
    expect(store().waternet).toEqual(definition().waternet);
    expect(buildSlopeDTO(store()).waternet).toEqual(definition().waternet);
  });

  it("removes the earlier stage and the yield stress from it, as one undoable step", () => {
    const sandBefore = store().materials[1];
    // The flag on the strength above the water line goes too.
    store().updateMaterial(store().materials[0].id, {
      model: { ...clayBelow, aboveWater: { ...clayBelow, aboveWater: undefined } },
    });
    store().removeEarlierStage();
    expect(store().earlierStage).toBeUndefined();
    expect(active()).not.toHaveProperty("earlierStage");
    const clay = store().materials[0].model;
    expect(clay).toMatchObject({ kind: "shansep", pop: 10 });
    expect((clay as { yieldFromEarlierStage?: boolean }).yieldFromEarlierStage).toBeUndefined();
    expect((clay.aboveWater as { yieldFromEarlierStage?: boolean }).yieldFromEarlierStage).toBeUndefined();
    // Materials without it are left as they are.
    expect(store().materials[1]).toBe(sandBefore);
    expect(active().materials).toEqual(store().materials);
    expect(buildSlopeDTO(store())).not.toHaveProperty("earlierStage");
    expect(store().waternet).toEqual(definition().waternet);
    performUndo();
    expect(store().earlierStage).toEqual(definition().earlierStage);
    expect(store().materials[0].model).toMatchObject({ yieldFromEarlierStage: true, aboveWater: { yieldFromEarlierStage: true } });
  });

  it("does nothing without them", () => {
    store().newProject();
    const before = useAppStore.temporal.getState().pastStates.length;
    store().removeWaternet();
    store().removeEarlierStage();
    expect(useAppStore.temporal.getState().pastStates.length).toBe(before);
  });
});
