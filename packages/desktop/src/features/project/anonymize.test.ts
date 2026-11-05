/**
 * File › Save as anonymized…: anonymizeProject on a copy of the project,
 * every option, the archive written from it, and moving to a local origin
 * (every coordinate kind by the same shift, and the same factor of safety
 * from the engine before and after).
 */
import { describe, expect, it } from "vitest";
import { runAnalysis } from "@cslope/engine";
import { BENCHMARK_MODELS, mirrorModelEntry } from "../../store/benchmarks";
import { buildSlopeDTOFromModel, cloneData } from "../../store/helpers";
import { PROJECT_FILE_VERSION, type ProjectFile } from "../../store/persistence";
import type { BackgroundImage, ModelEntry, ReferenceCircle, ReferencePolyline } from "../../store/types";
import { openZip } from "../../utils/zip";
import {
  anonymizedFileName,
  anonymizeProject,
  DEFAULT_ANONYMIZE_OPTIONS,
  replaceFreeText,
  shiftExpression,
  shiftModel,
  summaryLines,
  writeAnonymizedArchive,
  type AnonymizeOptions,
} from "./anonymize";
import { openProject, type ProjectAsset } from "./cslp";

const NONE: AnonymizeOptions = {
  projectInfo: false,
  renameModels: false,
  renameMaterials: false,
  renameObjects: false,
  removeDrawings: false,
  textAnnotations: "keep",
  removeResults: false,
  localOrigin: "none",
};

/** A 1 × 1 PNG. */
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

const ASSET: ProjectAsset = {
  id: "asset-1",
  mime: "image/png",
  originalName: "Smith Holdings site plan.png",
  addedAt: "2024-03-01T10:00:00.000Z",
  data: () => PNG,
};
const UNUSED_ASSET: ProjectAsset = { ...ASSET, id: "asset-2", originalName: "old borehole log.png" };

const BACKGROUND: BackgroundImage = {
  id: "bg-1",
  assetId: "asset-1",
  name: "Smith site plan",
  calibration: {
    mode: "axes",
    points: [{ source: [10, 20], model: [1210, 95] }],
    axes: { x: [{ source: [0, 0], value: 1200 }, { source: [100, 0], value: 1300 }], y: [{ source: [0, 0], value: 90 }, { source: [0, 100], value: 110 }] },
  },
  transform: { a: 1, b: 0, c: 0, d: -1, e: 1200, f: 120 },
  opacity: 0.5,
  visible: true,
  order: 0,
  hiddenLayers: ["SMITH-TITLE"],
};

const RESULT = {
  minFOS: 1.234,
  maxFOS: 2,
  criticalSurface: { cx: 1250, cy: 140, radius: 40, fos: 1.234, entryPoint: [1220, 112], exitPoint: [1280, 100] },
  allSurfaces: [],
  criticalSlices: [{ baseMaterial: { name: "Smith clay" } }],
  method: "Bishop",
  elapsedMs: 1,
  warnings: [{ code: "x", message: "Smith clay has no water line" }],
};

/** The layered example with everything a project may say about its client. */
function richModel(): ModelEntry {
  const base = cloneData(BENCHMARK_MODELS.find((m) => m.id === "example-arai-tagyo-layered")!);
  const m = shiftModel(base, 1200, 80);
  return {
    ...m,
    id: "smith-section-a",
    name: "Smith Holdings, section A",
    projectInfo: {
      title: "Smith Holdings retaining wall",
      subtitle: "Section A",
      client: "Smith Holdings Ltd",
      projectNumber: "P-4711",
      revision: "B",
      author: "Jane Doe",
      checker: "John Roe",
      date: "2024-03-01",
      description: "Stability of the cut at 12 Main Street",
      canvasWidth: 1200,
      canvasHeight: 900,
    },
    importNotes: ["Smith clay: its depth range is not written."],
    materials: m.materials.map((mat, i) => (i === 0 ? { ...mat, name: "Smith clay" } : mat)),
    piezometricLine: {
      enabled: true,
      lines: [{ id: "pl-1", name: "Groundwater Main Street", color: "#3b82f6", coordinates: [[1200, 108], [1248, 108], [1278, 94], [1296, 94]] }],
      activeLineId: "pl-1",
      materialAssignment: {},
    },
    reinforcements: [
      {
        id: "r-1", label: "Anchor row Smith", type: "anchor", x1: 1260, y1: 105, x2: 1240, y2: 98, tensileCapacity: 100, spacing: 2,
        pullout: "none", bondStrength: 0, bondedLength: 0, adhesion: 0, interfaceFriction: 0, end1Capacity: 0, end2Capacity: 0, direction: "axial", application: "active",
      },
    ],
    backgrounds: [BACKGROUND],
    locks: { backgrounds: ["bg-1"], exterior: true },
    parameters: [{ id: "p-1", name: "H", expression: "35" }],
    options: { ...m.options, sgi3d: { enabled: false, length: 15, overstrongF2D: null, excludeMaterials: ["Smith clay", "Lower"] } },
    resultViewSettings: {
      ...m.resultViewSettings!,
      annotations: [
        { id: "t-1", type: "text", x: 0.1, y: 0.1, text: "Smith Holdings — FOS = #FOS (#Method)" },
        { id: "t-2", type: "text", x: 0.1, y: 0.2, text: "Client: Smith" },
        { id: "t-3", type: "material-table", x: 0.5, y: 0.5 },
        { id: "ref-1", type: "reference", shape: "polyline", label: "Smith's consultant", points: [[1210, 115], [1250, 100]] },
        { id: "ref-2", type: "reference", shape: "circle", cx: 1250, cy: 140, radius: 40 },
      ],
      viewLock: { bottomLeft: [1190, 70], topRight: [1310, 130] },
    },
    editViewOffset: [120, -40],
    editViewScale: 8,
    runState: "done",
    result: cloneData(RESULT) as unknown as ModelEntry["result"],
  };
}

function richProject(): ProjectFile {
  const second: ModelEntry = { ...richModel(), id: "smith-section-b", name: "Smith Holdings, section B", backgrounds: undefined, locks: undefined, runState: "idle", result: null };
  return { version: PROJECT_FILE_VERSION, activeModelId: "smith-section-b", models: [richModel(), second], units: "SI", created: "2024-03-01T10:00:00.000Z" };
}

const NOW = new Date("2026-11-05T12:00:00.000Z");

describe("anonymizeProject", () => {
  it("leaves the project it is given unchanged", () => {
    const file = richProject();
    const before = JSON.stringify(file);
    const assets = [ASSET];
    anonymizeProject(file, { ...DEFAULT_ANONYMIZE_OPTIONS, removeResults: true, localOrigin: "xy" }, assets, NOW);
    expect(JSON.stringify(file)).toBe(before);
    expect(assets[0].originalName).toBe("Smith Holdings site plan.png");
  });

  it("changes nothing with every option off (except the file's dates)", () => {
    const file = richProject();
    const { file: out } = anonymizeProject(file, NONE, [ASSET], NOW);
    expect(out.models).toEqual(file.models);
    expect(out.created).toBeUndefined();
  });

  it("removes the project information and the import notes", () => {
    const { file, summary } = anonymizeProject(richProject(), { ...NONE, projectInfo: true });
    for (const m of file.models) {
      const info = m.projectInfo!;
      for (const key of ["title", "subtitle", "client", "projectNumber", "revision", "author", "checker", "date", "description"] as const) {
        expect(info[key]).toBe("");
      }
      expect(info.canvasWidth).toBe(1200);
      expect(m.importNotes).toBeUndefined();
    }
    expect(summary.projectInfoCleared).toBe(2);
    expect(summary.importNotesRemoved).toBe(2);
    expect(JSON.stringify(file)).not.toMatch(/Jane Doe|P-4711|Main Street, 12|12 Main Street/);
  });

  it("names the models Model 1, 2, … with new ids, the active one following", () => {
    const { file, summary } = anonymizeProject(richProject(), { ...NONE, renameModels: true });
    expect(file.models.map((m) => m.name)).toEqual(["Model 1", "Model 2"]);
    expect(file.models.map((m) => m.id)).toEqual(["model-1", "model-2"]);
    expect(file.activeModelId).toBe("model-2");
    expect(summary.modelsRenamed).toBe(2);
  });

  it("names the materials Material 1, 2, … keeping their parameters, and the names that refer to them", () => {
    const project = richProject();
    const { file, summary } = anonymizeProject(project, { ...NONE, renameMaterials: true });
    const m = file.models[0];
    expect(m.materials.map((x) => x.name)).toEqual(["Material 1", "Material 2", "Material 3"]);
    expect(m.materials.map((x) => x.model)).toEqual(project.models[0].materials.map((x) => x.model));
    expect(m.materials.map((x) => x.color)).toEqual(project.models[0].materials.map((x) => x.color));
    expect(m.options.sgi3d!.excludeMaterials).toEqual(["Material 1", "Material 3"]);
    expect(summary.materialsRenamed).toBe(6);
    // The result's names and messages follow; the method is not a name.
    const result = m.result as unknown as typeof RESULT;
    expect(result.criticalSlices[0].baseMaterial.name).toBe("Material 1");
    expect(result.warnings[0].message).toBe("Material 1 has no water line");
    expect(result.method).toBe("Bishop");
  });

  it("renames an earlier stage's materials consistently, and the head lines of a waternet", () => {
    const model = richModel();
    model.earlierStage = {
      coordinates: model.coordinates,
      materials: [{ name: "Smith clay", model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 5, frictionAngle: 30 } }, { name: "Old fill" }],
      regionAssignments: [{ point: [1230, 100], materialName: "Old fill" }],
      materialBoundaries: [{ coordinates: [[1200, 100], [1296, 90]], materialName: "Smith clay" }],
      topRegionMaterialName: "Old fill",
    };
    model.waternet = {
      headLines: [{ id: "PL Smith", points: [[1200, 105], [1296, 95]] }],
      referenceLines: [{ points: [[1200, 90], [1296, 85]], topHeadLineId: "PL Smith" }],
      phreaticLineId: "PL Smith",
    };
    const project: ProjectFile = { version: PROJECT_FILE_VERSION, activeModelId: model.id, models: [model], units: "SI" };
    const { file } = anonymizeProject(project, { ...NONE, renameMaterials: true, renameObjects: true });
    const stage = file.models[0].earlierStage!;
    expect(stage.materials.map((x) => x.name)).toEqual(["Material 1", "Material 4"]);
    expect(stage.regionAssignments![0].materialName).toBe("Material 4");
    expect(stage.materialBoundaries![0].materialName).toBe("Material 1");
    expect(stage.topRegionMaterialName).toBe("Material 4");
    const w = file.models[0].waternet!;
    expect(w.headLines[0].id).toBe("Head line 1");
    expect(w.referenceLines[0].topHeadLineId).toBe("Head line 1");
    expect(w.phreaticLineId).toBe("Head line 1");
  });

  it("gives water lines, labels, reference lines and drawings generic names", () => {
    const { file, summary } = anonymizeProject(richProject(), { ...NONE, renameObjects: true });
    const m = file.models[0];
    expect(m.piezometricLine.lines[0].name).toBe("Water line 1");
    expect(m.reinforcements![0].label).toBeUndefined();
    const ref = m.resultViewSettings!.annotations.find((a) => a.id === "ref-1") as ReferencePolyline;
    expect(ref.label).toBe("Reference line 1");
    expect(m.backgrounds![0].name).toBe("Drawing 1");
    expect(summary.objectsRenamed).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(file.models.map((x) => ({ ...x, projectInfo: null, importNotes: null, result: null, resultViewSettings: { annotations: x.resultViewSettings!.annotations.filter((a) => a.type !== "text") } })))).not.toMatch(/Main Street|Anchor row|consultant|site plan/);
  });

  it("removes the drawings, their locks and their files", async () => {
    const { file, assets, summary } = anonymizeProject(richProject(), { ...NONE, removeDrawings: true }, [ASSET, UNUSED_ASSET], NOW);
    expect(file.models[0].backgrounds).toBeUndefined();
    expect(file.models[0].locks).toEqual({ exterior: true });
    expect(assets).toEqual([]);
    expect(summary.drawingsRemoved).toBe(1);
    expect(summary.filesRemoved).toBe(2);
    const { bytes } = await writeAnonymizedArchive(richProject(), { ...NONE, removeDrawings: true }, [ASSET, UNUSED_ASSET], NOW);
    const names = openZip(bytes).entries().map((e) => e.name);
    expect(names.some((n) => n.startsWith("assets/"))).toBe(false);
    expect(names.some((n) => n.endsWith("backgrounds.json"))).toBe(false);
  });

  it("keeps a drawing's file without its original name and date, and drops unused files", async () => {
    const { assets, summary } = anonymizeProject(richProject(), NONE, [ASSET, UNUSED_ASSET], NOW);
    expect(assets.map((a) => [a.id, a.originalName, a.addedAt])).toEqual([["asset-1", "", NOW.toISOString()]]);
    expect(summary.filesRemoved).toBe(1);
    expect(summary.unchanged.join("\n")).toMatch(/1 drawing file/);
    expect(summary.unchanged.join("\n")).toMatch(/1 hidden layer name/);
    const { bytes } = await writeAnonymizedArchive(richProject(), NONE, [ASSET, UNUSED_ASSET], NOW);
    const opened = await openProject(bytes);
    expect(opened.assets.map((a) => [a.id, a.originalName])).toEqual([["asset-1", ""]]);
    const index = new TextDecoder().decode(await openZip(bytes).read("assets/index.json"));
    expect(index).not.toMatch(/Smith Holdings site plan|old borehole|2024-03-01/);
  });

  it("replaces the free text of text annotations and keeps their variables", () => {
    expect(replaceFreeText("Calculated FOS: #FOS")).toBe("Text #FOS");
    expect(replaceFreeText("Smith Holdings — FOS = #FOS (#Method)")).toBe("Text #FOS (#Method)");
    expect(replaceFreeText("#FOS")).toBe("#FOS");
    expect(replaceFreeText("Smith Ltd")).toBe("Text");
    expect(replaceFreeText("H = {{H}} m\\nSmith")).toBe("Text {{H}} Text\\nText");
    expect(replaceFreeText(" — ")).toBe(" — ");
    expect(replaceFreeText("")).toBe("");

    const replaced = anonymizeProject(richProject(), { ...NONE, textAnnotations: "replace" });
    const texts = replaced.file.models[0].resultViewSettings!.annotations.filter((a) => a.type === "text").map((a) => a.text);
    expect(texts).toEqual(["Text #FOS (#Method)", "Text"]);
    expect(replaced.summary.textAnnotationsReplaced).toBe(4);

    const deleted = anonymizeProject(richProject(), { ...NONE, textAnnotations: "delete" });
    const left = deleted.file.models[0].resultViewSettings!.annotations;
    expect(left.map((a) => a.id)).toEqual(["t-3", "ref-1", "ref-2"]);
    expect(deleted.summary.textAnnotationsDeleted).toBe(4);

    const kept = anonymizeProject(richProject(), { ...NONE, textAnnotations: "keep" });
    expect(kept.summary.unchanged.join("\n")).toMatch(/4 text annotations/);
  });

  it("keeps the results by default and removes them when asked", async () => {
    const kept = anonymizeProject(richProject(), DEFAULT_ANONYMIZE_OPTIONS);
    expect(kept.file.models[0].runState).toBe("done");
    expect(kept.file.models[0].result!.minFOS).toBe(1.234);
    const { bytes } = await writeAnonymizedArchive(richProject(), DEFAULT_ANONYMIZE_OPTIONS, [], NOW);
    expect(openZip(bytes).has("models/model-1/result.json")).toBe(true);

    const removed = anonymizeProject(richProject(), { ...NONE, removeResults: true });
    expect(removed.file.models[0].runState).toBe("idle");
    expect(removed.file.models[0].result).toBeNull();
    expect(removed.summary.resultsRemoved).toBe(1);
    const written = await writeAnonymizedArchive(richProject(), { ...NONE, removeResults: true }, [], NOW);
    expect(openZip(written.bytes).entries().some((e) => e.name.endsWith("result.json"))).toBe(false);
  });

  it("writes an archive dated now, without a thumbnail and without the default content's names", async () => {
    const { bytes } = await writeAnonymizedArchive(richProject(), DEFAULT_ANONYMIZE_OPTIONS, [ASSET], NOW);
    const zip = openZip(bytes);
    expect(zip.has("thumbnail.png")).toBe(false);
    const manifest = JSON.parse(new TextDecoder().decode(await zip.read("manifest.json")));
    expect(manifest.created).toBe(NOW.toISOString());
    expect(manifest.modified).toBe(NOW.toISOString());
    const opened = await openProject(bytes);
    expect(opened.file.models.map((m) => m.name)).toEqual(["Model 1", "Model 2"]);
    // Names left: none of the client's, other than in the parameters (none here).
    let text = "";
    for (const e of zip.entries()) if (e.name.endsWith(".json")) text += new TextDecoder().decode(await zip.read(e.name));
    expect(text).not.toMatch(/Smith|Jane|John|P-4711|Main Street|consultant|Anchor row/);
  });

  it("offers <name>-anonymized.cslp and summarizes what is done", () => {
    expect(anonymizedFileName("Dike 4.cslp")).toBe("Dike 4-anonymized.cslp");
    expect(anonymizedFileName("")).toBe("cslope-project-anonymized.cslp");
    const { summary } = anonymizeProject(richProject(), { ...DEFAULT_ANONYMIZE_OPTIONS, localOrigin: "xy" }, [ASSET], NOW);
    const lines = summaryLines(summary, { ...DEFAULT_ANONYMIZE_OPTIONS, localOrigin: "xy" });
    expect(lines.join("\n")).toMatch(/Model 1 moved by -1200 m in x and -80 m in y/);
    expect(summary.unchanged.join("\n")).toMatch(/2 parameters: their names and expressions/);
  });
});

describe("moving to a local origin", () => {
  it("wraps an expression with the shift", () => {
    expect(shiftExpression("H*2", -1200.5)).toBe("(H*2) - 1200.5");
    expect(shiftExpression("H", 3)).toBe("(H) + 3");
    expect(shiftExpression("", 3)).toBe("");
    expect(shiftExpression(undefined, 3)).toBeUndefined();
    expect(shiftExpression("H", 0)).toBe("H");
    expect(shiftExpression("H", 1e-7)).toBe("(H) + 0.0000001");
  });

  it("moves every kind of coordinate by the same shift", () => {
    const model = richModel();
    model.coordinateExpressions = [{ x: "1200" }, { y: "H + 80" }];
    model.materialBoundaries[0].coordinateExpressions = [{ x: "1272" }];
    model.piezometricLine.lines[0].coordinateExpressions = [{ y: "108" }];
    model.piezometricLine.rapidDrawdown = { waterBefore: [[1200, 112], [1296, 112]] };
    model.materials = [
      { ...model.materials[0], model: { kind: "s-f-datum", unitWeight: 18, suRef: 30, yRef: 115, rate: 1.5 }, modelExpressions: { yRef: "H + 80", suRef: "30" }, depthRange: [115, 80] },
      { ...model.materials[1], model: { kind: "undrained", unitWeight: 18, undrainedShearStrength: 20, suRefDepth: 100, suRateOfChange: 1 } },
      { ...model.materials[2], model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 5, frictionAngle: 30, cohesionRateOfChange: 0.5, aboveWater: { kind: "s-f-datum", unitWeight: 17, suRef: 10, yRef: 110, rate: 1 } } },
      { id: "m4", name: "Columns", color: "#000", model: { kind: "lime-cement-columns", unitWeight: 17, soilSu: 10, suRateOfChange: 1, columnSu: 100, areaRatio: 0.2 } },
      { id: "m5", name: "Spatial", color: "#000", model: { kind: "spatial-mohr-coulomb", unitWeight: 17, dataPoints: [[1210, 100, 5, 30, 18]] } },
      { id: "m6", name: "Shansep", color: "#000", model: { kind: "shansep", unitWeight: 17, ratio: 0.25, ocrByElevation: [[100, 1.5]] } },
    ];
    model.udls = [{ id: "u", magnitude: 10, x1: 1205, x2: 1230, expressions: { x1: "1205", magnitude: "10" } }];
    model.lineLoads = [{ id: "l", magnitude: 10, x: 1240, angle: 30, y: 112, expressions: { x: "1240" } }];
    model.piles = [{ id: "p", type: "pile", x1: 1270, y1: 96, x2: 1270, y2: 85, mode: "force", force: 10, diameter: 0.6, spacing: 2, shearCapacity: 0, momentCapacity: 0, angle: 0, application: "active" }];
    model.customSearchPlanes = [{ id: "c1", cx: 1250, cy: 140, radius: 40 }, { id: "c2", cx: 0, cy: 0, radius: 0, points: [[1220, 112], [1250, 95], [1280, 95]] }];
    model.blockSearchObjects = [{ id: "b", points: [[1230, 100], [1260, 92]] }];
    model.waternet = { headLines: [{ id: "h", points: [[1200, 105]] }], referenceLines: [{ points: [[1200, 90]], topHeadLineId: "h" }] };
    model.earlierStage = {
      coordinates: [[1200, 80], [1200, 110], [1296, 110], [1296, 80]],
      materials: [{ name: "A", model: { kind: "s-f-datum", unitWeight: 18, suRef: 30, yRef: 110, rate: 1 } }, { name: "B", cohesionRefDepth: 100, cohesionRateOfChange: 1 }],
      waterTable: { mode: "height", value: 105 },
      udls: [{ magnitude: 5, x1: 1210, x2: 1220 }],
      lineLoads: [{ magnitude: 5, x: 1215, y: 110 }],
      customSurfaces: [{ points: [[1210, 110], [1250, 90]], axis: [1240, 130] }],
      analysisLimits: { entryLeftX: 1200, entryRightX: 1240, exitLeftX: 1260, exitRightX: 1296 },
    };
    const project: ProjectFile = { version: PROJECT_FILE_VERSION, activeModelId: model.id, models: [model], units: "SI" };
    const { file, summary } = anonymizeProject(project, { ...NONE, localOrigin: "xy" });
    const m = file.models[0];
    const dx = -1200;
    const dy = -80;
    expect(summary.shifted).toEqual([{ model: model.name, dx, dy }]);
    const moved = (a: [number, number][] | undefined, b: [number, number][] | undefined) => expect(a).toEqual(b!.map(([x, y]) => [x + dx, y + dy]));
    moved(m.coordinates, model.coordinates);
    expect(Math.min(...m.coordinates.map((c) => c[0]))).toBe(0);
    expect(Math.min(...m.coordinates.map((c) => c[1]))).toBe(0);
    expect(m.coordinateExpressions).toEqual([{ x: "(1200) - 1200" }, { y: "(H + 80) - 80" }]);
    moved(m.materialBoundaries[0].coordinates, model.materialBoundaries[0].coordinates);
    expect(m.materialBoundaries[0].coordinateExpressions).toEqual([{ x: "(1272) - 1200" }]);
    expect(m.materialBoundaries[1].coordinateExpressions).toBeUndefined();
    expect(m.regionMaterials.map((r) => r.point)).toEqual(model.regionMaterials.map((r) => [r.point[0] + dx, r.point[1] + dy]));
    moved(m.piezometricLine.lines[0].coordinates, model.piezometricLine.lines[0].coordinates);
    expect(m.piezometricLine.lines[0].coordinateExpressions).toEqual([{ y: "(108) - 80" }]);
    moved(m.piezometricLine.rapidDrawdown!.waterBefore, model.piezometricLine.rapidDrawdown.waterBefore);
    // Materials: datum, reference levels (an unset one with a rate is set), data points, OCR by elevation.
    expect(m.materials[0].model).toMatchObject({ yRef: 35 });
    expect(m.materials[0].modelExpressions).toEqual({ yRef: "(H + 80) - 80", suRef: "30" });
    expect(m.materials[0].depthRange).toEqual([35, 0]);
    expect(m.materials[1].model).toMatchObject({ suRefDepth: 20 });
    expect(m.materials[2].model).toMatchObject({ cohesionRefDepth: -80, aboveWater: { yRef: 30 } });
    expect(m.materials[3].model).toMatchObject({ suRefDepth: -80 });
    expect(m.materials[4].model).toMatchObject({ dataPoints: [[10, 20, 5, 30, 18]] });
    expect(m.materials[5].model).toMatchObject({ ocrByElevation: [[20, 1.5]] });
    // Loads, reinforcement, piles.
    expect(m.udls[0]).toMatchObject({ x1: 5, x2: 30, expressions: { x1: "(1205) - 1200", magnitude: "10" } });
    expect(m.lineLoads[0]).toMatchObject({ x: 40, y: 32, angle: 30, expressions: { x: "(1240) - 1200" } });
    expect(m.reinforcements![0]).toMatchObject({ x1: 60, y1: 25, x2: 40, y2: 18 });
    expect(m.piles![0]).toMatchObject({ x1: 70, y1: 16, x2: 70, y2: 5 });
    // Search: limits, custom circle and polyline, block objects.
    expect(m.analysisLimits).toMatchObject({ entryLeftX: model.analysisLimits.entryLeftX + dx, exitRightX: model.analysisLimits.exitRightX + dx });
    expect(m.customSearchPlanes[0]).toMatchObject({ cx: 50, cy: 60, radius: 40 });
    expect(m.customSearchPlanes[1].points).toEqual([[20, 32], [50, 15], [80, 15]]);
    expect(m.blockSearchObjects![0].points).toEqual([[30, 20], [60, 12]]);
    // Imported water and earlier stage.
    expect(m.waternet!.headLines[0].points).toEqual([[0, 25]]);
    expect(m.waternet!.referenceLines[0].points).toEqual([[0, 10]]);
    const stage = m.earlierStage!;
    expect(stage.coordinates).toEqual([[0, 0], [0, 30], [96, 30], [96, 0]]);
    expect(stage.materials[0].model).toMatchObject({ yRef: 30 });
    expect(stage.materials[1].cohesionRefDepth).toBe(20);
    expect(stage.waterTable).toEqual({ mode: "height", value: 25 });
    expect(stage.udls![0]).toMatchObject({ x1: 10, x2: 20 });
    expect(stage.lineLoads![0]).toMatchObject({ x: 15, y: 30 });
    expect(stage.customSurfaces![0]).toEqual({ points: [[10, 30], [50, 10]], axis: [40, 50] });
    expect(stage.analysisLimits).toEqual({ entryLeftX: 0, entryRightX: 40, exitLeftX: 60, exitRightX: 96 });
    // Drawings, reference lines, the locked view.
    const bg = m.backgrounds![0];
    expect(bg.transform).toMatchObject({ e: 0, f: 40 });
    expect(bg.calibration.points[0].model).toEqual([10, 15]);
    expect(bg.calibration.axes!.x.map((t) => t.value)).toEqual([0, 100]);
    expect(bg.calibration.axes!.y.map((t) => t.value)).toEqual([10, 30]);
    const annotations = m.resultViewSettings!.annotations;
    expect((annotations.find((a) => a.id === "ref-1") as ReferencePolyline).points).toEqual([[10, 35], [50, 20]]);
    expect(annotations.find((a) => a.id === "ref-2") as ReferenceCircle).toMatchObject({ cx: 50, cy: 60, radius: 40 });
    expect(m.resultViewSettings!.viewLock).toEqual({ bottomLeft: [-10, -10], topRight: [110, 50] });
    // The views are fitted again; the results (in the old coordinates) removed.
    expect(m.editViewOffset).toBeUndefined();
    expect(m.editViewScale).toBeUndefined();
    expect(m.runState).toBe("idle");
    expect(m.result).toBeNull();
    expect(summary.resultsRemoved).toBe(1);
  });

  it("moves x only by default of the y option", () => {
    const { file } = anonymizeProject(richProject(), { ...NONE, localOrigin: "x" });
    expect(Math.min(...file.models[0].coordinates.map((c) => c[0]))).toBe(0);
    expect(Math.min(...file.models[0].coordinates.map((c) => c[1]))).toBe(80);
  });

  it("does not move a model it cannot move exactly", () => {
    const model = richModel();
    model.materials[0] = { ...model.materials[0], model: { kind: "from-the-future", unitWeight: 18 } as unknown as ModelEntry["materials"][0]["model"] };
    const { file, summary } = anonymizeProject({ version: PROJECT_FILE_VERSION, activeModelId: model.id, models: [model], units: "SI" }, { ...NONE, localOrigin: "x" });
    expect(file.models[0].coordinates).toEqual(model.coordinates);
    expect(summary.shiftBlocked).toEqual([{ model: model.name, reason: 'material model "from-the-future" is not known to this version' }]);
  });
});

// ── The factor of safety of a moved model ───────────────────────────

/**
 * The layered example (search limits) with an S = f(datum) layer, an
 * undrained layer whose Su grows below a reference level, a c′ growing
 * with depth below the default reference level (0), a water line, a
 * distributed load, a line load and a nail.
 */
function analysisModel(): ModelEntry {
  const m = cloneData(BENCHMARK_MODELS.find((x) => x.id === "example-arai-tagyo-layered")!);
  m.materials = [
    { ...m.materials[0], model: { kind: "s-f-datum", unitWeight: 18.82, suRef: 35, yRef: 35, rate: 1.2 } },
    { ...m.materials[1], model: { kind: "undrained", unitWeight: 18.82, undrainedShearStrength: 15, suRefDepth: 30, suRateOfChange: 0.8 } },
    { ...m.materials[2], model: { kind: "mohr-coulomb", unitWeight: 18.82, frictionAngle: 35, cohesion: 50, cohesionRateOfChange: 2 } },
  ];
  m.piezometricLine = {
    enabled: true,
    lines: [{ id: "w", name: "Water", color: "#00f", coordinates: [[0, 28], [48, 28], [78, 14], [96, 14]] }],
    activeLineId: "w",
    materialAssignment: {},
  };
  m.udls = [{ id: "u", magnitude: 20, x1: 5, x2: 30 }];
  m.lineLoads = [{ id: "l", magnitude: 40, x: 40 }];
  m.reinforcements = [
    {
      id: "n", type: "nail", x1: 70, y1: 20, x2: 60, y2: 16, tensileCapacity: 80, spacing: 1.5, pullout: "bond", bondStrength: 20, bondedLength: 0,
      adhesion: 0, interfaceFriction: 0, end1Capacity: 0, end2Capacity: 0, direction: "axial", application: "active",
    },
  ];
  m.options = { ...m.options, method: "Bishop", slices: 30, iterations: 300, refinedIterations: 150, nonCircularOptimization: false };
  return m;
}

const fos = (model: ModelEntry) => runAnalysis(buildSlopeDTOFromModel(model), model.options).minFOS;

function movedBack(model: ModelEntry, localOrigin: AnonymizeOptions["localOrigin"]): ModelEntry {
  const project: ProjectFile = { version: PROJECT_FILE_VERSION, activeModelId: model.id, models: [model], units: "SI" };
  return anonymizeProject(project, { ...DEFAULT_ANONYMIZE_OPTIONS, localOrigin }).file.models[0];
}

describe("the factor of safety of a model moved to a local origin", () => {
  it.each([
    ["left to right", (m: ModelEntry) => m],
    ["right to left", (m: ModelEntry) => mirrorModelEntry(m)],
  ])("is the same (%s)", (_, orient) => {
    const original = orient(analysisModel());
    // At real coordinates (a chainage and a level), then moved back.
    const far = shiftModel(original, 6543.21, 101.37);
    const local = movedBack(far, "xy");
    const localX = movedBack(far, "x");
    expect(Math.min(...local.coordinates.map((c) => c[0]))).toBe(0);
    expect(Math.min(...local.coordinates.map((c) => c[1]))).toBe(0);
    const f0 = fos(original);
    expect(f0).toBeGreaterThan(0.3);
    expect(f0).toBeLessThan(5);
    expect(Math.abs(fos(far) - f0)).toBeLessThan(1e-6);
    expect(Math.abs(fos(local) - f0)).toBeLessThan(1e-6);
    expect(Math.abs(fos(localX) - f0)).toBeLessThan(1e-6);
  });
});
