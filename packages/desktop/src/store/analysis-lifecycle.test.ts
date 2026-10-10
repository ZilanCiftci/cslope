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

describe("analysis run lifecycle", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      writable: true,
      value: FakeWorker as unknown as typeof Worker,
    });
    resetStore();
  });

  afterEach(() => {
    useAppStore.getState().cancelAnalysis();
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      writable: true,
      value: originalWorker,
    });
  });

  it("stores a single-run result on the model it was started for", async () => {
    const store = useAppStore.getState();
    const modelA = store.activeModelId;
    store.runAnalysis();
    store.addModel("Model B");
    const modelB = useAppStore.getState().activeModelId;

    FakeWorker.instances[0].emitComplete({ minFOS: 1.23 });
    await flush();

    const s = useAppStore.getState();
    expect(s.activeModelId).toBe(modelB);
    expect(s.result).toBeNull();
    expect(s.runState).not.toBe("done");
    const a = s.models.find((m) => m.id === modelA)!;
    expect(a.runState).toBe("done");
    expect(a.result).toEqual({ minFOS: 1.23 });
  });

  it("cancels and discards a run when its inputs are edited", async () => {
    const store = useAppStore.getState();
    store.runAnalysis();
    const [x, y] = store.coordinates[1];
    store.setCoordinate(1, [x + 1, y]);
    expect(FakeWorker.instances[0].terminated).toBe(true);

    FakeWorker.instances[0].emitComplete({ minFOS: 9.99 });
    await flush();
    expect(useAppStore.getState().runState).toBe("idle");
    expect(useAppStore.getState().result).toBeNull();
  });

  it("cancel stops every worker of a Run All and lets it finish", async () => {
    const store = useAppStore.getState();
    store.addModel("Model B");
    const runAll = useAppStore.getState().runAllAnalyses();
    await flush();
    expect(FakeWorker.instances.length).toBe(2);

    useAppStore.getState().cancelAnalysis();
    expect(FakeWorker.instances.every((w) => w.terminated)).toBe(true);
    await runAll; // must not hang

    const s = useAppStore.getState();
    expect(s.runState).toBe("idle");
    expect(s.models.every((m) => m.runState !== "running")).toBe(true);
    expect(s.models.every((m) => !m.result)).toBe(true);
  });

  it("Run All drops the result of a model edited while it ran", async () => {
    const runAll = useAppStore.getState().runAllAnalyses();
    await flush();
    const [x, y] = useAppStore.getState().coordinates[1];
    useAppStore.getState().setCoordinate(1, [x + 1, y]);

    FakeWorker.instances[0].emitComplete({ minFOS: 4.56 });
    await runAll;
    expect(useAppStore.getState().result).toBeNull();
    expect(useAppStore.getState().models[0].result ?? null).toBeNull();
  });
});
