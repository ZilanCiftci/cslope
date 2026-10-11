import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";
import { INITIAL_MODEL } from "./slices/modelsSlice";

type FakeMsg = MessageEvent<{ type: string; result?: unknown }>;

class FakeWorker {
  onmessage: ((event: FakeMsg) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  static instances: FakeWorker[] = [];
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage() {}
  terminate() {
    this.terminated = true;
  }
  emitComplete(result: unknown) {
    this.onmessage?.({ data: { type: "analysis-complete", result } } as FakeMsg);
  }
}

const originalWorker = globalThis.Worker;

function resetStore() {
  const m = structuredClone(INITIAL_MODEL);
  useAppStore.setState({
    activeModelId: m.id,
    models: [m],
    mode: "edit",
    orientation: m.orientation,
    projectInfo: structuredClone(m.projectInfo),
    coordinates: structuredClone(m.coordinates),
    materials: structuredClone(m.materials),
    materialBoundaries: [],
    regionMaterials: [],
    piezometricLine: structuredClone(m.piezometricLine),
    udls: [],
    lineLoads: [],
    customSearchPlanes: [],
    customPlanesOnly: false,
    options: structuredClone(m.options),
    analysisLimits: structuredClone(m.analysisLimits),
    runState: "idle",
    progress: 0,
    result: null,
    errorMessage: null,
  });
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("run lifecycle (round 5)", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: FakeWorker });
    resetStore();
  });
  afterEach(() => {
    useAppStore.getState().cancelAnalysis();
    Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: originalWorker });
  });

  it("a single Run works for a model that uses parameters", () => {
    useAppStore.setState({
      parameters: [{ id: "p", name: "H", expression: "10" }],
      materials: useAppStore
        .getState()
        .materials.map((m, i) => (i === 0 ? { ...m, modelExpressions: { unitWeight: "H*2" } } : m)),
    });
    useAppStore.getState().runAnalysis();
    expect(useAppStore.getState().runState).toBe("running");
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("Run All does not bring back a result after the active model was edited", async () => {
    const a = useAppStore.getState().activeModelId;
    useAppStore.getState().addModel("B");
    useAppStore.getState().switchModel(a);
    const runAll = useAppStore.getState().runAllAnalyses();
    await flush();
    FakeWorker.instances[0].emitComplete({ minFOS: 1.5 });
    await flush();
    const [x, y] = useAppStore.getState().coordinates[1];
    useAppStore.getState().setCoordinate(1, [x + 1, y]);
    FakeWorker.instances[1].emitComplete({ minFOS: 2 });
    await runAll;
    expect(useAppStore.getState().result).toBeNull();
  });

  it("running model B does not leave model A stuck on running", async () => {
    const a = useAppStore.getState().activeModelId;
    useAppStore.getState().addModel("B");
    const b = useAppStore.getState().activeModelId;
    useAppStore.getState().switchModel(a);
    useAppStore.getState().runAnalysis();
    useAppStore.getState().switchModel(b);
    useAppStore.getState().runAnalysis();
    FakeWorker.instances[1].emitComplete({ minFOS: 2 });
    await flush();
    useAppStore.getState().switchModel(a);
    expect(useAppStore.getState().runState).not.toBe("running");
  });

  it("a second Run All stops the workers of the first", async () => {
    const a = useAppStore.getState().activeModelId;
    useAppStore.getState().addModel("B");
    useAppStore.getState().switchModel(a);
    const r1 = useAppStore.getState().runAllAnalyses();
    await flush();
    const r2 = useAppStore.getState().runAllAnalyses();
    await flush();
    expect(FakeWorker.instances.slice(0, 2).every((w) => w.terminated)).toBe(true);
    useAppStore.getState().cancelAnalysis();
    await r1;
    await r2;
  });

  it("deleting a model stops its run", () => {
    const a = useAppStore.getState().activeModelId;
    useAppStore.getState().addModel("B");
    useAppStore.getState().switchModel(a);
    useAppStore.getState().runAnalysis();
    useAppStore.getState().deleteModel(a);
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });
});
