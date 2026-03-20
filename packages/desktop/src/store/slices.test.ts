import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";
import { INITIAL_MODEL } from "./slices/modelsSlice";
import type { ModelEntry } from "./types";

function clone<T>(value: T): T {
  const sc = globalThis.structuredClone as ((v: T) => T) | undefined;
  return sc ? sc(value) : JSON.parse(JSON.stringify(value));
}

function resetStoreState() {
  const baseModel = clone(INITIAL_MODEL);
  useAppStore.setState({
    activeModelId: baseModel.id,
    models: [baseModel],
    mode: "edit",
    orientation: baseModel.orientation,
    projectInfo: clone(baseModel.projectInfo),
    coordinates: clone(baseModel.coordinates),
    materials: clone(baseModel.materials),
    materialBoundaries: [],
    regionMaterials: [],
    piezometricLine: clone(baseModel.piezometricLine),
    udls: [],
    lineLoads: [],
    customSearchPlanes: [],
    customPlanesOnly: false,
    options: clone(baseModel.options),
    analysisLimits: clone(baseModel.analysisLimits),
    runState: "idle",
    progress: 0,
    result: null,
    errorMessage: null,
    editViewOffset: [0, 0],
    editViewScale: 0,
    resultViewOffset: [0, 0],
    resultViewScale: 0,
  });
}

describe("store slices", () => {
  beforeEach(() => {
    resetStoreState();
  });

  it("geometrySlice actions add/insert/remove coordinates and sync active model", () => {
    const store = useAppStore.getState();
    const startLen = store.coordinates.length;

    store.addCoordinate([30, 2]);
    let next = useAppStore.getState();
    expect(next.coordinates).toHaveLength(startLen + 1);
    expect(next.coordinates[next.coordinates.length - 1]).toEqual([30, 2]);
    expect(next.models[0].coordinates).toHaveLength(startLen + 1);

    next.insertCoordinateAt(1, [99, 99]);
    next = useAppStore.getState();
    expect(next.coordinates[1]).toEqual([99, 99]);
    expect(next.models[0].coordinates[1]).toEqual([99, 99]);

    next.removeCoordinate(1);
    next = useAppStore.getState();
    expect(next.coordinates[1]).not.toEqual([99, 99]);
    expect(next.coordinates).toHaveLength(startLen + 1);
    expect(next.models[0].coordinates).toHaveLength(startLen + 1);
  });

  it("modelsSlice supports add, switch, and duplicate model workflows", () => {
    const initial = useAppStore.getState();
    const initialId = initial.activeModelId;

    initial.addModel("Model B");
    let next = useAppStore.getState();
    expect(next.models).toHaveLength(2);
    expect(next.activeModelId).not.toBe(initialId);
    expect(next.models.find((m) => m.id === next.activeModelId)?.name).toBe(
      "Model B",
    );

    const modelBId = next.activeModelId;
    next.setProjectInfo({ title: "B title" });
    next.switchModel(initialId);
    next = useAppStore.getState();
    expect(next.activeModelId).toBe(initialId);
    expect(next.projectInfo.title).not.toBe("B title");

    next.switchModel(modelBId);
    next = useAppStore.getState();
    expect(next.projectInfo.title).toBe("B title");

    next.duplicateModel(modelBId);
    next = useAppStore.getState();
    expect(next.models).toHaveLength(3);

    const copy = next.models.find((m) => m.id === next.activeModelId);
    expect(copy).toBeDefined();
    expect(copy?.id).not.toBe(modelBId);
    expect(copy?.name).toContain("(copy)");
  });

  it("modelsSlice reorders models while keeping active model", () => {
    const store = useAppStore.getState();
    const firstModelId = store.activeModelId;

    store.addModel("Model B");
    store.addModel("Model C");

    let next = useAppStore.getState();
    const modelCId = next.activeModelId;
    const modelBId = next.models.find((m) => m.name === "Model B")?.id;
    expect(modelBId).toBeDefined();

    next.reorderModels(modelCId, firstModelId, "before");
    next = useAppStore.getState();
    expect(next.models.map((m) => m.id)[0]).toBe(modelCId);

    next.reorderModels(firstModelId, modelBId!, "after");
    next = useAppStore.getState();
    const ids = next.models.map((m) => m.id);
    expect(ids.indexOf(firstModelId)).toBeGreaterThan(ids.indexOf(modelBId!));
    expect(next.activeModelId).toBe(modelCId);
  });

  it("analysisSlice runAllAnalyses guard keeps state idle when no models", async () => {
    useAppStore.setState({
      models: [],
      activeModelId: "",
      runState: "running",
      progress: 0.5,
      result: null,
      errorMessage: "old",
    });

    await useAppStore.getState().runAllAnalyses();

    const next = useAppStore.getState();
    expect(next.runState).toBe("idle");
    expect(next.progress).toBe(0);
    expect(next.result).toBeNull();
    expect(next.errorMessage).toBeNull();
  });

  // ── layoutSlice ──────────────────────────────────────────────────

  it("layoutSlice setMode switches between edit and results", () => {
    const store = useAppStore.getState();
    expect(store.mode).toBe("edit");

    store.setMode("result");
    expect(useAppStore.getState().mode).toBe("result");

    store.setMode("edit");
    expect(useAppStore.getState().mode).toBe("edit");
  });

  it("layoutSlice toggleExplorer toggles open/closed", () => {
    const initial = useAppStore.getState().explorerOpen;

    useAppStore.getState().toggleExplorer();
    expect(useAppStore.getState().explorerOpen).toBe(!initial);

    useAppStore.getState().toggleExplorer();
    expect(useAppStore.getState().explorerOpen).toBe(initial);
  });

  it("layoutSlice toggleSidebar toggles open/closed", () => {
    const initial = useAppStore.getState().sidebarOpen;

    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarOpen).toBe(!initial);

    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarOpen).toBe(initial);
  });

  it("layoutSlice setActiveSection changes section", () => {
    useAppStore.getState().setActiveSection("Materials");
    expect(useAppStore.getState().activeSection).toBe("Materials");

    useAppStore.getState().setActiveSection("Exterior Boundary");
    expect(useAppStore.getState().activeSection).toBe("Exterior Boundary");
  });

  it("layoutSlice setSnapToGrid changes snap setting", () => {
    useAppStore.getState().setSnapToGrid(false);
    expect(useAppStore.getState().snapToGrid).toBe(false);

    useAppStore.getState().setSnapToGrid(true);
    expect(useAppStore.getState().snapToGrid).toBe(true);
  });

  it("layoutSlice setGridSnapSize clamps to minimum 0.01", () => {
    useAppStore.getState().setGridSnapSize(2);
    expect(useAppStore.getState().gridSnapSize).toBe(2);

    useAppStore.getState().setGridSnapSize(0.001);
    expect(useAppStore.getState().gridSnapSize).toBeCloseTo(0.01);
  });

  it("layoutSlice setExplorerLocation changes location", () => {
    useAppStore.getState().setExplorerLocation("right");
    expect(useAppStore.getState().explorerLocation).toBe("right");

    useAppStore.getState().setExplorerLocation("left");
    expect(useAppStore.getState().explorerLocation).toBe("left");
  });

  it("layoutSlice setPropertiesLocation changes location", () => {
    useAppStore.getState().setPropertiesLocation("left");
    expect(useAppStore.getState().propertiesLocation).toBe("left");

    useAppStore.getState().setPropertiesLocation("right");
    expect(useAppStore.getState().propertiesLocation).toBe("right");
  });

  it("layoutSlice setTheme changes theme", () => {
    useAppStore.getState().setTheme("dark");
    expect(useAppStore.getState().theme).toBe("dark");

    useAppStore.getState().setTheme("light");
    expect(useAppStore.getState().theme).toBe("light");
  });

  it("layoutSlice toggleTheme flips between light and dark", () => {
    useAppStore.getState().setTheme("light");
    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe("dark");

    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe("light");
  });

  // ── loadsSlice ──────────────────────────────────────────────────

  it("loadsSlice can add and remove UDLs", () => {
    const store = useAppStore.getState();
    expect(store.udls).toHaveLength(0);

    store.addUdl();
    let next = useAppStore.getState();
    expect(next.udls).toHaveLength(1);
    expect(next.udls[0].magnitude).toBeDefined();

    const udlId = next.udls[0].id;
    next.removeUdl(udlId);
    next = useAppStore.getState();
    expect(next.udls).toHaveLength(0);
  });

  it("loadsSlice can update a UDL", () => {
    useAppStore.getState().addUdl();
    const udlId = useAppStore.getState().udls[0].id;

    useAppStore.getState().updateUdl(udlId, { magnitude: 42 });
    const next = useAppStore.getState();
    expect(next.udls[0].magnitude).toBe(42);
  });

  it("loadsSlice can add and remove line loads", () => {
    const store = useAppStore.getState();
    expect(store.lineLoads).toHaveLength(0);

    store.addLineLoad();
    let next = useAppStore.getState();
    expect(next.lineLoads).toHaveLength(1);

    const lineLoadId = next.lineLoads[0].id;
    next.removeLineLoad(lineLoadId);
    next = useAppStore.getState();
    expect(next.lineLoads).toHaveLength(0);
  });

  it("loadsSlice can update a line load", () => {
    useAppStore.getState().addLineLoad();
    const llId = useAppStore.getState().lineLoads[0].id;

    useAppStore.getState().updateLineLoad(llId, { magnitude: 99 });
    const next = useAppStore.getState();
    expect(next.lineLoads[0].magnitude).toBe(99);
  });

  // ── viewportSlice ───────────────────────────────────────────────

  it("viewportSlice sets edit view offset and scale", () => {
    useAppStore.getState().setEditViewOffset([10, 20]);
    expect(useAppStore.getState().editViewOffset).toEqual([10, 20]);

    useAppStore.getState().setEditViewScale(2.5);
    expect(useAppStore.getState().editViewScale).toBe(2.5);
  });

  it("viewportSlice sets result view offset and scale", () => {
    useAppStore.getState().setResultViewOffset([30, 40]);
    expect(useAppStore.getState().resultViewOffset).toEqual([30, 40]);

    useAppStore.getState().setResultViewScale(1.5);
    expect(useAppStore.getState().resultViewScale).toBe(1.5);
  });

  // ── modelsSlice: deleteModel ────────────────────────────────────

  it("modelsSlice deleteModel removes a model and switches to another", () => {
    const store = useAppStore.getState();
    store.addModel("Model B");
    let next = useAppStore.getState();
    expect(next.models).toHaveLength(2);

    const modelBId = next.activeModelId;
    next.deleteModel(modelBId);
    next = useAppStore.getState();
    expect(next.models).toHaveLength(1);
    expect(next.activeModelId).not.toBe(modelBId);
  });

  it("modelsSlice deleteModel does nothing when only one model", () => {
    const store = useAppStore.getState();
    expect(store.models).toHaveLength(1);
    store.deleteModel(store.activeModelId);
    expect(useAppStore.getState().models).toHaveLength(1);
  });

  // ── modelsSlice: renameModel ──────────────────────────────────

  it("modelsSlice renameModel changes model name", () => {
    const store = useAppStore.getState();
    const id = store.activeModelId;
    store.renameModel(id, "Renamed");
    expect(useAppStore.getState().models[0].name).toBe("Renamed");
  });

  // ── modelsSlice: newProject ─────────────────────────────────────

  it("modelsSlice newProject resets to single default model", () => {
    const store = useAppStore.getState();
    store.addModel("Extra");
    expect(useAppStore.getState().models).toHaveLength(2);

    useAppStore.getState().newProject();
    const next = useAppStore.getState();
    expect(next.models).toHaveLength(1);
    expect(next.runState).toBe("idle");
  });

  // ── modelsSlice: loadProject ─────────────────────────────────────

  it("modelsSlice loadProject loads provided models", () => {
    const store = useAppStore.getState();
    const model1 = clone(store.models[0]);
    model1.id = "lp-1";
    model1.name = "Loaded 1";
    const model2 = clone(store.models[0]);
    model2.id = "lp-2";
    model2.name = "Loaded 2";

    store.loadProject({ models: [model1, model2], activeModelId: "lp-2" });
    const next = useAppStore.getState();
    expect(next.models).toHaveLength(2);
    expect(next.activeModelId).toBe("lp-2");
  });

  it("modelsSlice loadProject falls back to first model when activeModelId not found", () => {
    const store = useAppStore.getState();
    const model1 = clone(store.models[0]);
    model1.id = "lp-1";

    store.loadProject({ models: [model1], activeModelId: "nonexistent" });
    const next = useAppStore.getState();
    expect(next.activeModelId).toBe("lp-1");
  });

  it("modelsSlice loadProject does nothing with empty models array", () => {
    const store = useAppStore.getState();
    const prevId = store.activeModelId;
    store.loadProject({ models: [], activeModelId: "" });
    expect(useAppStore.getState().activeModelId).toBe(prevId);
  });

  // ── modelsSlice: loadBenchmarks ─────────────────────────────────

  it("modelsSlice loadBenchmarks loads benchmark models", () => {
    useAppStore.getState().loadBenchmarks();
    const next = useAppStore.getState();
    expect(next.models.length).toBeGreaterThan(0);
    expect(next._pendingFitToScreen).toBe(true);
  });

  // ── modelsSlice: saveCurrentModel ──────────────────────────────

  it("modelsSlice saveCurrentModel persists current state to active model", () => {
    const store = useAppStore.getState();
    store.setProjectInfo({ title: "Saved Title" });
    store.saveCurrentModel();
    const next = useAppStore.getState();
    const model = next.models.find((m) => m.id === next.activeModelId);
    expect(model?.projectInfo?.title).toBe("Saved Title");
  });

  // ── modelsSlice: setProjectInfo ─────────────────────────────────

  it("modelsSlice setProjectInfo updates both top-level and model", () => {
    const store = useAppStore.getState();
    store.setProjectInfo({ title: "T", subtitle: "S" });
    const next = useAppStore.getState();
    expect(next.projectInfo.title).toBe("T");
    expect(next.projectInfo.subtitle).toBe("S");
    const model = next.models.find((m) => m.id === next.activeModelId);
    expect(model?.projectInfo?.title).toBe("T");
  });

  // ── geometrySlice: materials ────────────────────────────────────

  it("geometrySlice addMaterial adds a new material with sequential name", () => {
    const store = useAppStore.getState();
    const startLen = store.materials.length;
    store.addMaterial();
    const next = useAppStore.getState();
    expect(next.materials).toHaveLength(startLen + 1);
    expect(next.materials[startLen].name).toContain("Material");
  });

  it("geometrySlice removeMaterial removes a material and cleans regionMaterials", () => {
    const store = useAppStore.getState();
    store.addMaterial();
    let next = useAppStore.getState();
    const matId = next.materials[1].id;

    // Assign region to this material
    next.setRegionMaterial([5, 5], matId);
    next = useAppStore.getState();
    expect(
      next.regionMaterials.find((a) => a.materialId === matId),
    ).toBeDefined();

    next.removeMaterial(matId);
    next = useAppStore.getState();
    expect(next.materials).toHaveLength(1);
    expect(
      next.regionMaterials.find((a) => a.materialId === matId),
    ).toBeUndefined();
  });

  it("geometrySlice updateMaterial patches a material", () => {
    const store = useAppStore.getState();
    const matId = store.materials[0].id;
    store.updateMaterial(matId, {
      model: {
        kind: "mohr-coulomb",
        unitWeight: 18,
        frictionAngle: 0,
        cohesion: 99,
      },
    });
    const updated = useAppStore.getState().materials[0];
    expect(updated.model.kind).toBe("mohr-coulomb");
    expect(
      updated.model.kind === "mohr-coulomb" ? updated.model.cohesion : -1,
    ).toBe(99);
  });

  it("geometrySlice setMaterials replaces entire array", () => {
    const store = useAppStore.getState();
    const newMats = [{ ...store.materials[0], name: "Replaced" }];
    store.setMaterials(newMats);
    expect(useAppStore.getState().materials[0].name).toBe("Replaced");
  });

  // ── geometrySlice: material boundaries ──────────────────────────

  it("geometrySlice addMaterialBoundary adds a boundary", () => {
    const store = useAppStore.getState();
    store.addMaterialBoundary([
      [0, 5],
      [25, 5],
    ]);
    const next = useAppStore.getState();
    expect(next.materialBoundaries).toHaveLength(1);
    expect(next.materialBoundaries[0].coordinates).toEqual([
      [0, 5],
      [25, 5],
    ]);
  });

  it("geometrySlice updateMaterialBoundary patches a boundary", () => {
    const store = useAppStore.getState();
    store.addMaterialBoundary([
      [0, 5],
      [25, 5],
    ]);
    const bndId = useAppStore.getState().materialBoundaries[0].id;
    store.updateMaterialBoundary(bndId, {
      coordinates: [
        [0, 3],
        [25, 3],
      ],
    });
    expect(useAppStore.getState().materialBoundaries[0].coordinates).toEqual([
      [0, 3],
      [25, 3],
    ]);
  });

  it("geometrySlice removeMaterialBoundary removes boundary and cleans regionMaterials", () => {
    const store = useAppStore.getState();
    store.addMaterialBoundary([
      [0, 5],
      [25, 5],
    ]);
    const bndId = useAppStore.getState().materialBoundaries[0].id;
    useAppStore.getState().removeMaterialBoundary(bndId);
    expect(useAppStore.getState().materialBoundaries).toHaveLength(0);
  });

  it("geometrySlice addBoundaryPoint appends point to boundary", () => {
    const store = useAppStore.getState();
    store.addMaterialBoundary([
      [0, 5],
      [25, 5],
    ]);
    const bndId = useAppStore.getState().materialBoundaries[0].id;
    useAppStore.getState().addBoundaryPoint(bndId, [50, 5]);
    expect(
      useAppStore.getState().materialBoundaries[0].coordinates,
    ).toHaveLength(3);
  });

  it("geometrySlice insertBoundaryPointAt inserts point at index", () => {
    const store = useAppStore.getState();
    store.addMaterialBoundary([
      [0, 5],
      [25, 5],
    ]);
    const bndId = useAppStore.getState().materialBoundaries[0].id;
    useAppStore.getState().insertBoundaryPointAt(bndId, 1, [12, 8]);
    const coords = useAppStore.getState().materialBoundaries[0].coordinates;
    expect(coords).toHaveLength(3);
    expect(coords[1]).toEqual([12, 8]);
  });

  it("geometrySlice updateBoundaryPoint changes a point", () => {
    const store = useAppStore.getState();
    store.addMaterialBoundary([
      [0, 5],
      [25, 5],
    ]);
    const bndId = useAppStore.getState().materialBoundaries[0].id;
    useAppStore.getState().updateBoundaryPoint(bndId, 0, [1, 7]);
    expect(useAppStore.getState().materialBoundaries[0].coordinates[0]).toEqual(
      [1, 7],
    );
  });

  it("geometrySlice removeBoundaryPoint removes a point from boundary", () => {
    const store = useAppStore.getState();
    store.addMaterialBoundary([
      [0, 5],
      [12, 5],
      [25, 5],
    ]);
    const bndId = useAppStore.getState().materialBoundaries[0].id;
    useAppStore.getState().removeBoundaryPoint(bndId, 1);
    expect(
      useAppStore.getState().materialBoundaries[0].coordinates,
    ).toHaveLength(2);
  });

  it("geometrySlice setRegionMaterial assigns a material to a region point", () => {
    const store = useAppStore.getState();
    const matId = store.materials[0].id;
    store.setRegionMaterial([5, 5], matId);
    const rm = useAppStore.getState().regionMaterials;
    expect(rm).toHaveLength(1);
    expect(rm[0].point).toEqual([5, 5]);
    expect(rm[0].materialId).toBe(matId);
  });

  // ── geometrySlice: piezometric line ─────────────────────────────

  it("geometrySlice addPiezoLine adds a piezometric line", () => {
    const store = useAppStore.getState();
    store.addPiezoLine([
      [0, 3],
      [25, 3],
    ]);
    const next = useAppStore.getState();
    expect(next.piezometricLine.lines).toHaveLength(1);
    expect(next.piezometricLine.enabled).toBe(true);
    expect(next.piezometricLine.activeLineId).toBe(
      next.piezometricLine.lines[0].id,
    );
  });

  it("geometrySlice removePiezoLine removes a line and updates active", () => {
    const store = useAppStore.getState();
    store.addPiezoLine([
      [0, 3],
      [25, 3],
    ]);
    const lineId = useAppStore.getState().piezometricLine.lines[0].id;
    useAppStore.getState().removePiezoLine(lineId);
    const next = useAppStore.getState();
    expect(next.piezometricLine.lines).toHaveLength(0);
    expect(next.piezometricLine.enabled).toBe(false);
  });

  it("geometrySlice renamePiezoLine renames a line", () => {
    useAppStore.getState().addPiezoLine();
    const lineId = useAppStore.getState().piezometricLine.lines[0].id;
    useAppStore.getState().renamePiezoLine(lineId, "WT-1");
    expect(useAppStore.getState().piezometricLine.lines[0].name).toBe("WT-1");
  });

  it("geometrySlice setActivePiezoLine changes the active line", () => {
    useAppStore.getState().addPiezoLine();
    useAppStore.getState().addPiezoLine();
    const lines = useAppStore.getState().piezometricLine.lines;
    useAppStore.getState().setActivePiezoLine(lines[0].id);
    expect(useAppStore.getState().piezometricLine.activeLineId).toBe(
      lines[0].id,
    );
  });

  it("geometrySlice addPiezoPoint appends a point to active line", () => {
    useAppStore.getState().addPiezoLine([
      [0, 3],
      [10, 3],
    ]);
    useAppStore.getState().addPiezoPoint([20, 3]);
    const lines = useAppStore.getState().piezometricLine.lines;
    expect(lines[0].coordinates).toHaveLength(3);
  });

  it("geometrySlice setPiezoCoordinate updates a point on the active line", () => {
    useAppStore.getState().addPiezoLine([
      [0, 3],
      [10, 3],
    ]);
    useAppStore.getState().setPiezoCoordinate(0, [1, 5]);
    const coords = useAppStore.getState().piezometricLine.lines[0].coordinates;
    expect(coords[0]).toEqual([1, 5]);
  });

  it("geometrySlice insertPiezoPointAt inserts a point at index", () => {
    useAppStore.getState().addPiezoLine([
      [0, 3],
      [20, 3],
    ]);
    useAppStore.getState().insertPiezoPointAt(1, [10, 5]);
    const coords = useAppStore.getState().piezometricLine.lines[0].coordinates;
    expect(coords).toHaveLength(3);
    expect(coords[1]).toEqual([10, 5]);
  });

  it("geometrySlice removePiezoPoint removes a point from active line", () => {
    useAppStore.getState().addPiezoLine([
      [0, 3],
      [10, 3],
      [20, 3],
    ]);
    useAppStore.getState().removePiezoPoint(1);
    expect(
      useAppStore.getState().piezometricLine.lines[0].coordinates,
    ).toHaveLength(2);
  });

  it("geometrySlice setPiezoMaterialAssignment assigns piezo line to material", () => {
    useAppStore.getState().addPiezoLine();
    const lineId = useAppStore.getState().piezometricLine.lines[0].id;
    const matId = useAppStore.getState().materials[0].id;
    useAppStore.getState().setPiezoMaterialAssignment(matId, lineId);
    expect(
      useAppStore.getState().piezometricLine.materialAssignment[matId],
    ).toBe(lineId);
  });

  it("geometrySlice enablePiezoWithDefault creates a default line from coordinates", () => {
    useAppStore.getState().enablePiezoWithDefault();
    const next = useAppStore.getState();
    expect(next.piezometricLine.enabled).toBe(true);
    expect(next.piezometricLine.lines).toHaveLength(1);
    expect(next.piezometricLine.lines[0].coordinates).toHaveLength(2);
  });

  it("geometrySlice enablePiezoWithDefault does nothing if lines already exist", () => {
    useAppStore.getState().addPiezoLine([
      [0, 3],
      [25, 3],
    ]);
    useAppStore.getState().enablePiezoWithDefault();
    expect(useAppStore.getState().piezometricLine.lines).toHaveLength(1);
  });

  // ── geometrySlice: setCoordinate / setCoordinates ────────────────

  it("geometrySlice setCoordinate updates a single coordinate", () => {
    const store = useAppStore.getState();
    store.setCoordinate(0, [99, 99]);
    expect(useAppStore.getState().coordinates[0]).toEqual([99, 99]);
    expect(useAppStore.getState().models[0].coordinates[0]).toEqual([99, 99]);
  });

  it("geometrySlice setCoordinates replaces the full array", () => {
    const newCoords: [number, number][] = [
      [0, 0],
      [10, 10],
      [20, 0],
    ];
    useAppStore.getState().setCoordinates(newCoords);
    expect(useAppStore.getState().coordinates).toEqual(newCoords);
  });

  // ── geometrySlice: orientation ────────────────────────────────────

  it("geometrySlice setOrientation changes orientation and syncs model", () => {
    useAppStore.getState().setOrientation("rtl");
    const next = useAppStore.getState();
    expect(next.orientation).toBe("rtl");
    expect(next.models[0].orientation).toBe("rtl");
  });

  // ── geometrySlice: point selection ────────────────────────────────

  it("geometrySlice setSelectedPoint sets and clears index", () => {
    useAppStore.getState().setSelectedPoint(3);
    expect(useAppStore.getState().selectedPointIndex).toBe(3);

    useAppStore.getState().setSelectedPoint(null);
    expect(useAppStore.getState().selectedPointIndex).toBeNull();
  });

  it("geometrySlice setAssigningMaterial sets material id for assignment", () => {
    const matId = useAppStore.getState().materials[0].id;
    useAppStore.getState().setAssigningMaterial(matId);
    expect(useAppStore.getState().assigningMaterialId).toBe(matId);

    useAppStore.getState().setAssigningMaterial(null);
    expect(useAppStore.getState().assigningMaterialId).toBeNull();
  });

  it("geometrySlice setSelectedRegionKey sets region key", () => {
    useAppStore.getState().setSelectedRegionKey("top");
    expect(useAppStore.getState().selectedRegionKey).toBe("top");

    useAppStore.getState().setSelectedRegionKey(null);
    expect(useAppStore.getState().selectedRegionKey).toBeNull();
  });

  // ── analysisSlice ────────────────────────────────────────────────────

  it("analysisSlice invalidateAnalysis resets run state", () => {
    useAppStore.setState({
      runState: "done",
      progress: 1,
      result: { minFOS: 1.2 } as never,
      errorMessage: "some error",
    });

    useAppStore.getState().invalidateAnalysis();
    const s = useAppStore.getState();
    expect(s.runState).toBe("idle");
    expect(s.progress).toBe(0);
    expect(s.result).toBeNull();
    expect(s.errorMessage).toBeNull();
  });

  it("analysisSlice setAnalysisLimits merges patch and syncs model", () => {
    const initial = useAppStore.getState().analysisLimits;
    useAppStore.getState().setAnalysisLimits({ entryLeftX: 5 });

    const updated = useAppStore.getState().analysisLimits;
    expect(updated.entryLeftX).toBe(5);
    // other fields unchanged
    expect(updated.entryRightX).toBe(initial.entryRightX);

    // synced to model
    const model = useAppStore.getState().models[0];
    expect(model.analysisLimits.entryLeftX).toBe(5);
  });

  it("analysisSlice setAnalysisLimits invalidates analysis", () => {
    useAppStore.setState({ runState: "done", result: { minFOS: 1 } as never });
    useAppStore.getState().setAnalysisLimits({ entryRightX: 20 });
    expect(useAppStore.getState().runState).toBe("idle");
    expect(useAppStore.getState().result).toBeNull();
  });

  it("analysisSlice setOptions merges patch and syncs model", () => {
    useAppStore.getState().setOptions({ slices: 50 });
    expect(useAppStore.getState().options.slices).toBe(50);
    const model = useAppStore.getState().models[0];
    expect(model.options.slices).toBe(50);
  });

  it("analysisSlice setOptions invalidates analysis", () => {
    useAppStore.setState({ runState: "done", result: { minFOS: 1 } as never });
    useAppStore.getState().setOptions({ method: "Bishop" });
    expect(useAppStore.getState().runState).toBe("idle");
  });

  it("analysisSlice addCustomSearchPlane adds and syncs", () => {
    expect(useAppStore.getState().customSearchPlanes).toHaveLength(0);
    useAppStore.getState().addCustomSearchPlane();
    const planes = useAppStore.getState().customSearchPlanes;
    expect(planes).toHaveLength(1);
    expect(planes[0]).toHaveProperty("cx");
    expect(planes[0]).toHaveProperty("cy");
    expect(planes[0]).toHaveProperty("radius");

    const model = useAppStore.getState().models[0];
    expect(model.customSearchPlanes).toHaveLength(1);
  });

  it("analysisSlice updateCustomSearchPlane patches plane and syncs", () => {
    useAppStore.getState().addCustomSearchPlane();
    const id = useAppStore.getState().customSearchPlanes[0].id;

    useAppStore.getState().updateCustomSearchPlane(id, { cx: 15, cy: 20 });
    const updated = useAppStore.getState().customSearchPlanes[0];
    expect(updated.cx).toBe(15);
    expect(updated.cy).toBe(20);

    const model = useAppStore.getState().models[0];
    expect(model.customSearchPlanes[0].cx).toBe(15);
  });

  it("analysisSlice removeCustomSearchPlane removes and syncs", () => {
    useAppStore.getState().addCustomSearchPlane();
    useAppStore.getState().addCustomSearchPlane();
    expect(useAppStore.getState().customSearchPlanes).toHaveLength(2);

    const id = useAppStore.getState().customSearchPlanes[0].id;
    useAppStore.getState().removeCustomSearchPlane(id);
    expect(useAppStore.getState().customSearchPlanes).toHaveLength(1);

    const model = useAppStore.getState().models[0];
    expect(model.customSearchPlanes).toHaveLength(1);
  });

  it("analysisSlice setCustomPlanesOnly sets value and syncs", () => {
    expect(useAppStore.getState().customPlanesOnly).toBe(false);
    useAppStore.getState().setCustomPlanesOnly(true);
    expect(useAppStore.getState().customPlanesOnly).toBe(true);

    const model = useAppStore.getState().models[0];
    expect(model.customPlanesOnly).toBe(true);
  });

  it("analysisSlice runAnalysis handles worker startup failures", () => {
    const originalWorker = globalThis.Worker;
    const brokenWorker = function BrokenWorker() {
      throw new Error("Worker init failed");
    } as unknown as typeof Worker;

    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      writable: true,
      value: brokenWorker,
    });

    try {
      useAppStore.getState().runAnalysis();
      const s = useAppStore.getState();
      expect(s.runState).toBe("error");
      expect(s.errorMessage).toContain("Worker init failed");
      expect(s.progress).toBe(0);
    } finally {
      if (originalWorker === undefined) {
        delete (globalThis as { Worker?: unknown }).Worker;
      } else {
        Object.defineProperty(globalThis, "Worker", {
          configurable: true,
          writable: true,
          value: originalWorker,
        });
      }
    }
  });

  it("analysisSlice runAllAnalyses handles worker startup failures", async () => {
    const originalWorker = globalThis.Worker;
    const brokenWorker = function BrokenWorker() {
      throw new Error("Worker init failed");
    } as unknown as typeof Worker;

    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      writable: true,
      value: brokenWorker,
    });

    try {
      await useAppStore.getState().runAllAnalyses();
      const s = useAppStore.getState();
      expect(s.runState).toBe("error");
      expect(s.errorMessage).toContain("Worker init failed");
    } finally {
      if (originalWorker === undefined) {
        delete (globalThis as { Worker?: unknown }).Worker;
      } else {
        Object.defineProperty(globalThis, "Worker", {
          configurable: true,
          writable: true,
          value: originalWorker,
        });
      }
    }
  });

  // ── resultViewSlice ──────────────────────────────────────────────────

  it("resultViewSlice setResultViewSettings merges patch into settings", () => {
    const initial = useAppStore.getState().resultViewSettings;
    expect(initial.showSlices).toBe(true);

    useAppStore.getState().setResultViewSettings({ showSlices: false });
    const updated = useAppStore.getState().resultViewSettings;
    expect(updated.showSlices).toBe(false);
    // other fields unchanged
    expect(updated.surfaceDisplay).toBe(initial.surfaceDisplay);
    expect(updated.fosFilterMax).toBe(initial.fosFilterMax);
  });

  it("resultViewSlice setResultViewSettings syncs to active model", () => {
    useAppStore.getState().setResultViewSettings({ showGrid: false });
    const model = useAppStore.getState().models[0];
    expect(model.resultViewSettings?.showGrid).toBe(false);
  });

  it("resultViewSlice addAnnotation adds a text annotation", () => {
    const before = useAppStore.getState().resultViewSettings.annotations.length;
    useAppStore.getState().addAnnotation("text");
    const after = useAppStore.getState().resultViewSettings.annotations;
    expect(after).toHaveLength(before + 1);
    const added = after[after.length - 1];
    expect(added.type).toBe("text");
    expect(added.text).toBe("Annotation");
    expect(added.x).toBe(0.5);
    expect(added.y).toBe(0.5);
  });

  it("resultViewSlice addAnnotation adds non-text annotation types", () => {
    for (const type of [
      "input-params",
      "output-params",
      "material-table",
      "color-bar",
    ] as const) {
      useAppStore.getState().addAnnotation(type);
      const annos = useAppStore.getState().resultViewSettings.annotations;
      const last = annos[annos.length - 1];
      expect(last.type).toBe(type);
      expect(last.text).toBeUndefined();
    }
  });

  it("resultViewSlice addAnnotation syncs to model", () => {
    useAppStore.getState().addAnnotation("color-bar");
    const model = useAppStore.getState().models[0];
    const annos = model.resultViewSettings?.annotations ?? [];
    expect(annos.some((a) => a.type === "color-bar")).toBe(true);
  });

  it("resultViewSlice updateAnnotation patches an existing annotation", () => {
    useAppStore.getState().addAnnotation("text");
    const annos = useAppStore.getState().resultViewSettings.annotations;
    const id = annos[annos.length - 1].id;

    useAppStore.getState().updateAnnotation(id, { x: 0.9, fontSize: 20 });
    const updated = useAppStore
      .getState()
      .resultViewSettings.annotations.find((a) => a.id === id)!;
    expect(updated.x).toBe(0.9);
    expect(updated.fontSize).toBe(20);
    expect(updated.y).toBe(0.5); // unchanged
  });

  it("resultViewSlice removeAnnotation removes annotation and deselects it", () => {
    useAppStore.getState().addAnnotation("text");
    const annos = useAppStore.getState().resultViewSettings.annotations;
    const id = annos[annos.length - 1].id;

    // select it first
    useAppStore.getState().setSelectedAnnotations([id]);
    expect(useAppStore.getState().selectedAnnotationIds).toContain(id);

    useAppStore.getState().removeAnnotation(id);
    const remaining = useAppStore.getState().resultViewSettings.annotations;
    expect(remaining.find((a) => a.id === id)).toBeUndefined();
    expect(useAppStore.getState().selectedAnnotationIds).not.toContain(id);
  });

  it("resultViewSlice setSelectedAnnotations replaces selection", () => {
    useAppStore.getState().setSelectedAnnotations(["a", "b"]);
    expect(useAppStore.getState().selectedAnnotationIds).toEqual(["a", "b"]);

    useAppStore.getState().setSelectedAnnotations(["c"]);
    expect(useAppStore.getState().selectedAnnotationIds).toEqual(["c"]);
  });

  it("resultViewSlice toggleAnnotationSelection in single-select mode", () => {
    useAppStore.getState().setSelectedAnnotations(["x", "y"]);
    useAppStore.getState().toggleAnnotationSelection("z", false);
    expect(useAppStore.getState().selectedAnnotationIds).toEqual(["z"]);
  });

  it("resultViewSlice toggleAnnotationSelection additive adds and removes", () => {
    useAppStore.getState().setSelectedAnnotations(["a"]);

    // add "b"
    useAppStore.getState().toggleAnnotationSelection("b", true);
    expect(useAppStore.getState().selectedAnnotationIds).toEqual(["a", "b"]);

    // remove "a"
    useAppStore.getState().toggleAnnotationSelection("a", true);
    expect(useAppStore.getState().selectedAnnotationIds).toEqual(["b"]);
  });

  it("resultViewSlice alignAnnotations left aligns x to minimum", () => {
    // add 3 annotations with different x positions
    useAppStore.getState().addAnnotation("text");
    useAppStore.getState().addAnnotation("text");
    useAppStore.getState().addAnnotation("text");
    const annos = useAppStore.getState().resultViewSettings.annotations;
    const ids = annos.slice(-3).map((a) => a.id);

    useAppStore.getState().updateAnnotation(ids[0], { x: 0.2 });
    useAppStore.getState().updateAnnotation(ids[1], { x: 0.5 });
    useAppStore.getState().updateAnnotation(ids[2], { x: 0.8 });

    useAppStore.getState().setSelectedAnnotations(ids);
    useAppStore.getState().alignAnnotations("left");

    const aligned = useAppStore.getState().resultViewSettings.annotations;
    for (const id of ids) {
      expect(aligned.find((a) => a.id === id)!.x).toBe(0.2);
    }
  });

  it("resultViewSlice alignAnnotations right aligns x to maximum", () => {
    useAppStore.getState().addAnnotation("text");
    useAppStore.getState().addAnnotation("text");
    const annos = useAppStore.getState().resultViewSettings.annotations;
    const ids = annos.slice(-2).map((a) => a.id);

    useAppStore.getState().updateAnnotation(ids[0], { x: 0.1 });
    useAppStore.getState().updateAnnotation(ids[1], { x: 0.7 });

    useAppStore.getState().setSelectedAnnotations(ids);
    useAppStore.getState().alignAnnotations("right");

    const aligned = useAppStore.getState().resultViewSettings.annotations;
    for (const id of ids) {
      expect(aligned.find((a) => a.id === id)!.x).toBe(0.7);
    }
  });

  it("resultViewSlice alignAnnotations top aligns y to minimum", () => {
    useAppStore.getState().addAnnotation("text");
    useAppStore.getState().addAnnotation("text");
    const annos = useAppStore.getState().resultViewSettings.annotations;
    const ids = annos.slice(-2).map((a) => a.id);

    useAppStore.getState().updateAnnotation(ids[0], { y: 0.3 });
    useAppStore.getState().updateAnnotation(ids[1], { y: 0.9 });

    useAppStore.getState().setSelectedAnnotations(ids);
    useAppStore.getState().alignAnnotations("top");

    const aligned = useAppStore.getState().resultViewSettings.annotations;
    for (const id of ids) {
      expect(aligned.find((a) => a.id === id)!.y).toBe(0.3);
    }
  });

  it("resultViewSlice alignAnnotations bottom aligns y to maximum", () => {
    useAppStore.getState().addAnnotation("text");
    useAppStore.getState().addAnnotation("text");
    const annos = useAppStore.getState().resultViewSettings.annotations;
    const ids = annos.slice(-2).map((a) => a.id);

    useAppStore.getState().updateAnnotation(ids[0], { y: 0.1 });
    useAppStore.getState().updateAnnotation(ids[1], { y: 0.6 });

    useAppStore.getState().setSelectedAnnotations(ids);
    useAppStore.getState().alignAnnotations("bottom");

    const aligned = useAppStore.getState().resultViewSettings.annotations;
    for (const id of ids) {
      expect(aligned.find((a) => a.id === id)!.y).toBe(0.6);
    }
  });

  it("resultViewSlice alignAnnotations center-h averages x", () => {
    useAppStore.getState().addAnnotation("text");
    useAppStore.getState().addAnnotation("text");
    const annos = useAppStore.getState().resultViewSettings.annotations;
    const ids = annos.slice(-2).map((a) => a.id);

    useAppStore.getState().updateAnnotation(ids[0], { x: 0.2 });
    useAppStore.getState().updateAnnotation(ids[1], { x: 0.8 });

    useAppStore.getState().setSelectedAnnotations(ids);
    useAppStore.getState().alignAnnotations("center-h");

    const aligned = useAppStore.getState().resultViewSettings.annotations;
    for (const id of ids) {
      expect(aligned.find((a) => a.id === id)!.x).toBe(0.5);
    }
  });

  it("resultViewSlice alignAnnotations center-v averages y", () => {
    useAppStore.getState().addAnnotation("text");
    useAppStore.getState().addAnnotation("text");
    const annos = useAppStore.getState().resultViewSettings.annotations;
    const ids = annos.slice(-2).map((a) => a.id);

    useAppStore.getState().updateAnnotation(ids[0], { y: 0.0 });
    useAppStore.getState().updateAnnotation(ids[1], { y: 1.0 });

    useAppStore.getState().setSelectedAnnotations(ids);
    useAppStore.getState().alignAnnotations("center-v");

    const aligned = useAppStore.getState().resultViewSettings.annotations;
    for (const id of ids) {
      expect(aligned.find((a) => a.id === id)!.y).toBe(0.5);
    }
  });

  it("resultViewSlice alignAnnotations is no-op with fewer than 2 selected", () => {
    useAppStore.getState().addAnnotation("text");
    const annos = useAppStore.getState().resultViewSettings.annotations;
    const id = annos[annos.length - 1].id;
    useAppStore.getState().updateAnnotation(id, { x: 0.3 });

    useAppStore.getState().setSelectedAnnotations([id]);
    useAppStore.getState().alignAnnotations("left");

    const after = useAppStore
      .getState()
      .resultViewSettings.annotations.find((a) => a.id === id)!;
    expect(after.x).toBe(0.3); // unchanged
  });

  // ── canvasToolbarSlice ───────────────────────────────────────────────

  it("canvasToolbarSlice setCanvasToolbar sets and clears toolbar", () => {
    expect(useAppStore.getState().canvasToolbar).toBeNull();

    const toolbar = {
      zoomBoxActive: false,
      panActive: false,
      zoomPercent: 100,
      onFitToScreen: () => {},
      onZoomIn: () => {},
      onZoomOut: () => {},
      onSetZoomPercent: () => {},
      onToggleZoomBox: () => {},
      onTogglePan: () => {},
    };

    useAppStore.getState().setCanvasToolbar(toolbar);
    expect(useAppStore.getState().canvasToolbar).toBe(toolbar);

    useAppStore.getState().setCanvasToolbar(null);
    expect(useAppStore.getState().canvasToolbar).toBeNull();
  });

  it("canvasToolbarSlice setCursorWorld sets and clears cursor position", () => {
    expect(useAppStore.getState().cursorWorld).toBeNull();

    useAppStore.getState().setCursorWorld([10.5, 3.2]);
    expect(useAppStore.getState().cursorWorld).toEqual([10.5, 3.2]);

    useAppStore.getState().setCursorWorld(null);
    expect(useAppStore.getState().cursorWorld).toBeNull();
  });

  // ── modelsSlice: addModel with default name ──────────────────────

  it("modelsSlice addModel uses default name when none provided", () => {
    const store = useAppStore.getState();
    const prevCount = store.models.length;
    store.addModel();
    const next = useAppStore.getState();
    expect(next.models).toHaveLength(prevCount + 1);
    const newModel = next.models.find((m) => m.id === next.activeModelId);
    expect(newModel?.name).toContain("Untitled");
  });

  // ── modelsSlice: switchModel with legacy viewOffset fields ──────

  it("modelsSlice switchModel applies mapModelToState defaults for missing fields", () => {
    const store = useAppStore.getState();
    // Create a minimal model entry with legacy/missing optional fields
    const legacyModel = {
      id: "legacy-1",
      name: "Legacy",
      coordinates: [
        [0, 0],
        [10, 10],
        [20, 0],
      ] as [number, number][],
      materials: clone(store.materials),
      materialBoundaries: [],
      regionMaterials: [],
      piezometricLine: clone(store.piezometricLine),
      udls: [],
      lineLoads: [],
      customSearchPlanes: [],
      customPlanesOnly: false,
      options: clone(store.options),
      analysisLimits: clone(store.analysisLimits),
      // Legacy fields: viewOffset/viewScale instead of edit/result variants
      viewOffset: [5, 10] as [number, number],
      viewScale: 2.5,
      // No mode, orientation, projectInfo, resultViewSettings, etc.
    };
    useAppStore.setState({
      models: [...store.models, legacyModel as ModelEntry],
    });

    // Switch to the legacy model — exercises ?? fallbacks in mapModelToState
    useAppStore.getState().switchModel("legacy-1");
    const next = useAppStore.getState();
    expect(next.activeModelId).toBe("legacy-1");
    expect(next.mode).toBe("edit"); // ?? "edit"
    expect(next.orientation).toBe("ltr"); // ?? "ltr"
    expect(next.editViewOffset).toEqual([5, 10]); // ?? viewOffset
    expect(next.editViewScale).toBe(2.5); // ?? viewScale
    expect(next.resultViewOffset).toEqual([5, 10]);
    expect(next.resultViewScale).toBe(2.5);
    expect(next.runState).toBe("idle"); // ?? "idle"
    expect(next.progress).toBe(0); // ?? 0
    expect(next.result).toBeNull(); // ?? null
    expect(next.errorMessage).toBeNull(); // ?? null
    expect(next.resultViewSettings).toBeDefined();
  });

  // ── modelsSlice: duplicateModel with rich data ────────────────────

  it("modelsSlice duplicateModel deep-copies resultViewSettings and viewLock", () => {
    const store = useAppStore.getState();
    const id = store.activeModelId;

    // Set up rich result view settings with viewLock and annotations
    useAppStore.getState().addAnnotation("text");
    useAppStore.getState().addAnnotation("color-bar");
    const annos = useAppStore.getState().resultViewSettings.annotations;
    expect(annos.length).toBeGreaterThanOrEqual(2);

    useAppStore.getState().setResultViewSettings({
      viewLock: { enabled: true, bottomLeft: [1, 2], topRight: [3, 4] },
    });
    expect(useAppStore.getState().resultViewSettings.viewLock).toBeDefined();

    // Set viewport offsets to exercise the copy branches
    useAppStore.getState().setEditViewOffset([11, 22]);
    useAppStore.getState().setEditViewScale(3.0);
    useAppStore.getState().setResultViewOffset([33, 44]);
    useAppStore.getState().setResultViewScale(4.0);

    // Save and duplicate
    useAppStore.getState().saveCurrentModel();
    useAppStore.getState().duplicateModel(id);

    const next = useAppStore.getState();
    const copy = next.models.find((m) => m.id === next.activeModelId);
    expect(copy).toBeDefined();
    expect(copy!.id).not.toBe(id);
    expect(copy!.name).toContain("(copy)");

    // Verify deep copy of resultViewSettings
    expect(copy!.resultViewSettings).toBeDefined();
    expect(copy!.resultViewSettings!.annotations).toHaveLength(annos.length);
    expect(copy!.resultViewSettings!.viewLock).toBeDefined();
    expect(copy!.resultViewSettings!.viewLock!.bottomLeft).toEqual([1, 2]);
    expect(copy!.resultViewSettings!.viewLock!.topRight).toEqual([3, 4]);

    // Verify viewport offsets are deep-copied
    expect(copy!.editViewOffset).toEqual([11, 22]);
    expect(copy!.editViewScale).toBe(3.0);
    expect(copy!.resultViewOffset).toEqual([33, 44]);
    expect(copy!.resultViewScale).toBe(4.0);

    // Verify independence (mutation doesn't affect original)
    copy!.resultViewSettings!.viewLock!.bottomLeft[0] = 999;
    const original = next.models.find((m) => m.id === id);
    expect(original!.resultViewSettings?.viewLock?.bottomLeft[0]).not.toBe(999);
  });

  it("modelsSlice duplicateModel copies regionMaterials with remapped IDs", () => {
    const store = useAppStore.getState();
    const id = store.activeModelId;

    // Add a material boundary and assign regions
    store.addMaterial();
    const mats = useAppStore.getState().materials;
    const mat2Id = mats[1].id;
    useAppStore.getState().addMaterialBoundary([
      [5, 5],
      [15, 5],
    ]);

    useAppStore.getState().setRegionMaterial([10, 3], mat2Id);
    useAppStore.getState().setRegionMaterial([10, 7], mats[0].id);

    useAppStore.getState().saveCurrentModel();
    useAppStore.getState().duplicateModel(id);

    const next = useAppStore.getState();
    const copy = next.models.find((m) => m.id === next.activeModelId);
    expect(copy).toBeDefined();
    // Region materials should exist with remapped material IDs
    expect(copy!.regionMaterials.length).toBeGreaterThan(0);
    // Material IDs should be remapped (not equal to originals)
    for (const a of copy!.regionMaterials) {
      expect(a.materialId).not.toBe(mat2Id);
      expect(a.materialId).not.toBe(mats[0].id);
    }
  });

  // ── modelsSlice: loadProject with saved viewport ────────────────

  it("modelsSlice loadProject sets _pendingFitToScreen false when viewport is saved", () => {
    const store = useAppStore.getState();
    const model = clone(store.models[0]);
    model.id = "vp-saved";
    model.editViewScale = 2.5;
    model.editViewOffset = [10, 20];

    store.loadProject({ models: [model], activeModelId: "vp-saved" });
    const next = useAppStore.getState();
    expect(next._pendingFitToScreen).toBe(false);
    expect(next.editViewScale).toBe(2.5);
  });

  it("modelsSlice loadProject sets _pendingFitToScreen true when no viewport saved", () => {
    const store = useAppStore.getState();
    const model = clone(store.models[0]);
    model.id = "vp-none";
    model.editViewScale = undefined;
    model.resultViewScale = undefined;
    model.viewScale = undefined;

    store.loadProject({ models: [model], activeModelId: "vp-none" });
    const next = useAppStore.getState();
    expect(next._pendingFitToScreen).toBe(true);
  });

  // ── modelsSlice: deleteModel active vs non-active ────────────────

  it("modelsSlice deleteModel non-active model keeps active unchanged", () => {
    const store = useAppStore.getState();
    store.addModel("Model X");
    const modelXId = useAppStore.getState().activeModelId;

    // Switch back to initial
    const initialId = store.models[0].id;
    useAppStore.getState().switchModel(initialId);
    expect(useAppStore.getState().activeModelId).toBe(initialId);

    // Delete non-active model
    useAppStore.getState().deleteModel(modelXId);
    const next = useAppStore.getState();
    expect(next.models).toHaveLength(1);
    expect(next.activeModelId).toBe(initialId);
  });

  // ── modelsSlice: duplicateModel with UDLs and line loads ─────────

  it("modelsSlice duplicateModel copies udls and lineLoads with new IDs", () => {
    const store = useAppStore.getState();
    store.addUdl();
    store.addLineLoad();
    store.saveCurrentModel();

    const id = store.activeModelId;
    useAppStore.getState().duplicateModel(id);
    const next = useAppStore.getState();
    const copy = next.models.find((m) => m.id === next.activeModelId);

    expect(copy!.udls).toHaveLength(1);
    expect(copy!.lineLoads).toHaveLength(1);
    // IDs should be different from originals
    const orig = next.models.find((m) => m.id === id);
    expect(copy!.udls[0].id).not.toBe(orig!.udls[0].id);
    expect(copy!.lineLoads[0].id).not.toBe(orig!.lineLoads[0].id);
  });

  // ── modelsSlice: duplicateModel piezometric line ─────────────────

  it("modelsSlice duplicateModel copies piezometric lines with remapped IDs", () => {
    const store = useAppStore.getState();
    store.addPiezoLine();
    const lines = useAppStore.getState().piezometricLine.lines;
    expect(lines).toHaveLength(1);

    store.saveCurrentModel();
    const id = store.activeModelId;
    useAppStore.getState().duplicateModel(id);

    const next = useAppStore.getState();
    const copy = next.models.find((m) => m.id === next.activeModelId);
    expect(copy!.piezometricLine.lines).toHaveLength(1);
    expect(copy!.piezometricLine.lines[0].id).not.toBe(lines[0].id);
  });

  // ── geometrySlice: boundary management ───────────────────────────

  it("geometrySlice removeMaterialBoundary removes boundary and cleans up", () => {
    const store = useAppStore.getState();
    store.addMaterialBoundary([
      [5, 5],
      [15, 5],
    ]);
    let next = useAppStore.getState();
    expect(next.materialBoundaries).toHaveLength(1);
    const bndId = next.materialBoundaries[0].id;

    next.removeMaterialBoundary(bndId);
    next = useAppStore.getState();
    expect(next.materialBoundaries).toHaveLength(0);
  });

  // ── loadsSlice: UDL and line load management ─────────────────────

  it("loadsSlice addUdl adds default UDL and syncs to model", () => {
    useAppStore.getState().addUdl();
    const next = useAppStore.getState();
    expect(next.udls).toHaveLength(1);
    expect(next.udls[0].magnitude).toBeDefined();
    expect(next.models[0].udls).toHaveLength(1);
  });

  it("loadsSlice updateUdl patches a UDL", () => {
    useAppStore.getState().addUdl();
    const udlId = useAppStore.getState().udls[0].id;
    useAppStore.getState().updateUdl(udlId, { magnitude: 50 });
    expect(useAppStore.getState().udls[0].magnitude).toBe(50);
  });

  it("loadsSlice removeUdl removes a UDL", () => {
    useAppStore.getState().addUdl();
    const udlId = useAppStore.getState().udls[0].id;
    useAppStore.getState().removeUdl(udlId);
    expect(useAppStore.getState().udls).toHaveLength(0);
  });

  it("loadsSlice addLineLoad adds default line load and syncs to model", () => {
    useAppStore.getState().addLineLoad();
    const next = useAppStore.getState();
    expect(next.lineLoads).toHaveLength(1);
    expect(next.lineLoads[0].magnitude).toBeDefined();
    expect(next.models[0].lineLoads).toHaveLength(1);
  });

  it("loadsSlice updateLineLoad patches a line load", () => {
    useAppStore.getState().addLineLoad();
    const llId = useAppStore.getState().lineLoads[0].id;
    useAppStore.getState().updateLineLoad(llId, { magnitude: 75 });
    expect(useAppStore.getState().lineLoads[0].magnitude).toBe(75);
  });

  it("loadsSlice removeLineLoad removes a line load", () => {
    useAppStore.getState().addLineLoad();
    const llId = useAppStore.getState().lineLoads[0].id;
    useAppStore.getState().removeLineLoad(llId);
    expect(useAppStore.getState().lineLoads).toHaveLength(0);
  });

  // ── layoutSlice: theme, sidebar, explorer ────────────────────────

  it("layoutSlice toggleTheme switches between dark and light", () => {
    useAppStore.getState().setTheme("light");
    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe("dark");
    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe("light");
  });

  it("layoutSlice toggleSidebar toggles sidebar open state", () => {
    const initial = useAppStore.getState().sidebarOpen;
    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarOpen).toBe(!initial);
    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarOpen).toBe(initial);
  });

  it("layoutSlice setActiveSection changes active section", () => {
    useAppStore.getState().setActiveSection("materials");
    expect(useAppStore.getState().activeSection).toBe("materials");
    useAppStore.getState().setActiveSection(null);
    expect(useAppStore.getState().activeSection).toBeNull();
  });

  it("layoutSlice setExplorerLocation and setPropertiesLocation", () => {
    useAppStore.getState().setExplorerLocation("right");
    expect(useAppStore.getState().explorerLocation).toBe("right");
    useAppStore.getState().setPropertiesLocation("left");
    expect(useAppStore.getState().propertiesLocation).toBe("left");
  });

  // ── geometrySlice: orientation ─────────────────────────────────────

  it("geometrySlice setOrientation changes orientation and syncs", () => {
    useAppStore.getState().setOrientation("rtl");
    const next = useAppStore.getState();
    expect(next.orientation).toBe("rtl");
    expect(next.models[0].orientation).toBe("rtl");
  });

  // ── geometrySlice: piezometric line management ──────────────────

  it("geometrySlice addPiezometricLine adds line and syncs", () => {
    useAppStore.getState().addPiezoLine();
    const next = useAppStore.getState();
    expect(next.piezometricLine.lines).toHaveLength(1);
    expect(next.models[0].piezometricLine.lines).toHaveLength(1);
  });

  it("geometrySlice removePiezoLine removes line", () => {
    useAppStore.getState().addPiezoLine();
    const lineId = useAppStore.getState().piezometricLine.lines[0].id;
    useAppStore.getState().removePiezoLine(lineId);
    expect(useAppStore.getState().piezometricLine.lines).toHaveLength(0);
  });
});
