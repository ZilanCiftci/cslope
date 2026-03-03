import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";
import { INITIAL_MODEL } from "./slices/modelsSlice";

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
    regionMaterials: {},
    piezometricLine: clone(baseModel.piezometricLine),
    udls: [],
    lineLoads: [],
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

    store.setMode("results");
    expect(useAppStore.getState().mode).toBe("results");

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
    expect(model?.projectInfo.title).toBe("Saved Title");
  });

  // ── modelsSlice: setProjectInfo ─────────────────────────────────

  it("modelsSlice setProjectInfo updates both top-level and model", () => {
    const store = useAppStore.getState();
    store.setProjectInfo({ title: "T", subtitle: "S" });
    const next = useAppStore.getState();
    expect(next.projectInfo.title).toBe("T");
    expect(next.projectInfo.subtitle).toBe("S");
    const model = next.models.find((m) => m.id === next.activeModelId);
    expect(model?.projectInfo.title).toBe("T");
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
    next.setRegionMaterial("below-test", matId);
    next = useAppStore.getState();
    expect(next.regionMaterials["below-test"]).toBe(matId);

    next.removeMaterial(matId);
    next = useAppStore.getState();
    expect(next.materials).toHaveLength(1);
    expect(next.regionMaterials["below-test"]).toBeUndefined();
  });

  it("geometrySlice updateMaterial patches a material", () => {
    const store = useAppStore.getState();
    const matId = store.materials[0].id;
    store.updateMaterial(matId, { cohesion: 99 });
    expect(useAppStore.getState().materials[0].cohesion).toBe(99);
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

  it("geometrySlice setRegionMaterial assigns a material to a region key", () => {
    const store = useAppStore.getState();
    const matId = store.materials[0].id;
    store.setRegionMaterial("top", matId);
    expect(useAppStore.getState().regionMaterials["top"]).toBe(matId);
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
});
