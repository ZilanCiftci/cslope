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
});
