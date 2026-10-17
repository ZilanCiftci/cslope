import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAppStore, isProjectDirty, markProjectClean } from "./app-store";
import { performRedo, performUndo } from "./selectors";
import { parseProjectFile, serializeProject } from "./persistence";
import { clampMinorTicks } from "../utils/ruler";

type FakeMsg = MessageEvent<{ type: string; result?: unknown; error?: string }>;
class FakeWorker {
  onmessage: ((event: FakeMsg) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  static instances: FakeWorker[] = [];
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage() {}
  terminate() {}
  emitComplete(result: unknown) {
    this.onmessage?.({ data: { type: "analysis-complete", result } } as FakeMsg);
  }
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

beforeEach(() => {
  FakeWorker.instances = [];
  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
  useAppStore.getState().newProject();
});
afterEach(() => useAppStore.getState().cancelAnalysis());

describe("undo history", () => {
  it("keeps real edits when the result paper is panned and zoomed", () => {
    const s = useAppStore.getState();
    s.updateMaterial(s.materials[0].id, { name: "Edited" });
    for (let i = 0; i < 60; i++) {
      const pf = useAppStore.getState().resultViewSettings.paperFrame;
      useAppStore.getState().setResultViewSettings({ paperFrame: { ...pf, offsetX: i + 1, offsetY: i, zoom: 1 + i / 100 } });
    }
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(1);
    performUndo();
    expect(useAppStore.getState().materials[0].name).not.toBe("Edited");
  });

  it("makes the view-lock update part of the edit that grew the model, and keeps redo", () => {
    const st = useAppStore.getState();
    const xs = st.coordinates.map((c) => c[0]);
    const ys = st.coordinates.map((c) => c[1]);
    st.setResultViewSettings({
      viewLock: { bottomLeft: [Math.min(...xs) - 1, Math.min(...ys) - 1], topRight: [Math.max(...xs) + 1, Math.max(...ys) + 1] },
    });
    useAppStore.temporal.getState().clear();
    const idx = st.coordinates.findIndex((c) => c[0] === Math.max(...xs));
    const c = useAppStore.getState().coordinates[idx];
    useAppStore.getState().setCoordinate(idx, [c[0] + 50, c[1]]);
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(1);
    useAppStore.getState().setOptions({ slices: 41 });
    while (useAppStore.temporal.getState().pastStates.length) performUndo();
    performRedo();
    performRedo();
    expect(useAppStore.getState().options.slices).toBe(41);
    expect(useAppStore.getState().coordinates[idx][0]).toBe(c[0] + 50);
  });
});

describe("unsaved changes", () => {
  it("does not count zooming or panning the result paper", () => {
    markProjectClean(useAppStore.getState());
    const pf = useAppStore.getState().resultViewSettings.paperFrame;
    useAppStore.getState().setResultViewSettings({ paperFrame: { ...pf, zoom: 1.7, offsetX: 30 } });
    expect(isProjectDirty(useAppStore.getState())).toBe(false);
    useAppStore.getState().setResultViewSettings({ paperFrame: { ...pf, landscape: !pf.landscape } });
    expect(isProjectDirty(useAppStore.getState())).toBe(true);
  });

  it("does not count switching between the benchmark models", () => {
    useAppStore.getState().loadBenchmarks();
    const ids = useAppStore.getState().models.map((m) => m.id);
    useAppStore.getState().switchModel(ids[1]);
    useAppStore.getState().switchModel(ids[0]);
    expect(isProjectDirty(useAppStore.getState())).toBe(false);
  });
});

describe("runs", () => {
  it("keeps a newer single run on the active model when Run All finishes", async () => {
    const st = useAppStore.getState();
    const a = st.activeModelId;
    st.addModel("B");
    st.switchModel(a);
    void useAppStore.getState().runAllAnalyses();
    await flush();
    const [wa, wb] = FakeWorker.instances;
    wa.emitComplete({ minFOS: 1.1, allSurfaces: [] });
    await flush();
    useAppStore.getState().setOptions({ slices: 33 });
    useAppStore.getState().runAnalysis();
    FakeWorker.instances[2].emitComplete({ minFOS: 2.2, allSurfaces: [] });
    await flush();
    wb.emitComplete({ minFOS: 3.3, allSurfaces: [] });
    await flush();
    const s = useAppStore.getState();
    expect(s.result).toMatchObject({ minFOS: 2.2 });
    // The model's entry (the explorer) has it too.
    expect(s.models.find((m) => m.id === a)?.result).toMatchObject({ minFOS: 2.2 });
  });
});

describe("loading a damaged or crafted project file", () => {
  const withModel = (patch: Record<string, unknown>) => {
    const file = JSON.parse(JSON.stringify(serializeProject(useAppStore.getState())));
    Object.assign(file.models[0], patch);
    return parseProjectFile(JSON.stringify(file));
  };

  it("drops a result or an error message the app cannot show", () => {
    for (const patch of [
      { runState: "error", mode: "result", errorMessage: { x: 1 } },
      { runState: "done", mode: "result", result: {} },
      { runState: "done", result: { minFOS: "1.2", allSurfaces: [], criticalSlices: [], criticalSurface: null } },
    ]) {
      const m = withModel(patch).models[0];
      expect(m.runState).toBe("idle");
      expect(m.result).toBeNull();
      expect(m.errorMessage).toBeNull();
    }
    const ok = withModel({ runState: "done", result: { minFOS: 1.2, allSurfaces: [], criticalSlices: [], criticalSurface: null } });
    expect(ok.models[0].result).toMatchObject({ minFOS: 1.2 });
    expect(withModel({ runState: "error", errorMessage: "No surface" }).models[0].errorMessage).toBe("No surface");
  });

  it("gives two models with one id distinct ids", () => {
    const file = JSON.parse(JSON.stringify(serializeProject(useAppStore.getState())));
    file.models.push({ ...file.models[0], name: "Copy" });
    const ids = parseProjectFile(JSON.stringify(file)).models.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the development lengths of an element whose pullout is another kind", () => {
    const element = {
      id: "r1", type: "nail", x1: 1, y1: 9, x2: 8, y2: 7, tensileCapacity: 100, spacing: 1.5,
      pullout: "bond", bondStrength: 15, bondedLength: 0, adhesion: 0, interfaceFriction: 0,
      developmentLength1: 1, developmentLength2: 2, end1Capacity: 50, end2Capacity: 0, direction: "axial", application: "passive",
    };
    const r = withModel({ reinforcements: [element] }).models[0].reinforcements![0];
    expect(r.developmentLength1).toBe(1);
    expect(r.developmentLength2).toBe(2);
  });

  it("limits the minor ruler ticks to a whole number from 0 to 20", () => {
    const view = useAppStore.getState().resultViewSettings;
    const m = withModel({ resultViewSettings: { ...view, minorTicks: 1e16 } }).models[0];
    expect(m.resultViewSettings?.minorTicks).toBe(20);
    expect(clampMinorTicks(2.6)).toBe(3);
    expect(clampMinorTicks(-4)).toBe(0);
    expect(clampMinorTicks(Number.NaN)).toBe(0);
  });
});
