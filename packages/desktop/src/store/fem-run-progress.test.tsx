/**
 * A single run with the finite element analysis: the limit equilibrium
 * result shown while the finite elements run, their stage reaching the store
 * (and the status bar), and Cancel during them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DEFAULT_FEM_SETTINGS, type AnalysisResult } from "@cslope/engine";
import { useAppStore } from "./app-store";
import { stopIdleWorkers } from "./analysis-workers";
import { StatusBar } from "../components/StatusBar";

type Data = { type: string; result?: unknown; progress?: number; stage?: string; error?: string };

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<Data>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  posted: unknown[] = [];
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data: Data) {
    this.onmessage?.({ data } as MessageEvent<Data>);
  }
}

const originalWorker = globalThis.Worker;
const store = () => useAppStore.getState();
const le = { minFOS: 1.4, method: "Morgenstern-Price" } as unknown as AnalysisResult;
const withFem = { ...le, fem: { factorOfSafety: 1.35 } } as unknown as AnalysisResult;

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function statusBar() {
  const s = store();
  return render(
    <StatusBar
      mode="result"
      runState={s.runState}
      result={s.result}
      runStage={s.runStage}
      runStartedAt={s.runStartedAt}
      snapToGrid={false}
      gridSnapSize={1}
      setSnapToGrid={() => {}}
      setGridSnapSize={() => {}}
      coordinateCount={4}
      cursorWorld={null}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  FakeWorker.instances = [];
  Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: FakeWorker });
  store().newProject();
  store().setOptions({ fem: { ...DEFAULT_FEM_SETTINGS, enabled: true } });
});

afterEach(() => {
  store().cancelAnalysis();
  stopIdleWorkers();
  vi.useRealTimers();
  Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: originalWorker });
});

describe("a run with the finite element analysis", () => {
  it("shows the limit equilibrium result while the finite elements run, then the whole result", async () => {
    store().runAnalysis();
    expect(store().runStartedAt).not.toBeNull();
    const [w] = FakeWorker.instances;
    w.emit({ type: "analysis-partial", result: le });
    expect(store().runState).toBe("running");
    expect(store().result).toMatchObject({ minFOS: 1.4 });
    // the model's entry gets nothing until the run is done
    expect(store().models.find((m) => m.id === store().activeModelId)!.result ?? null).toBeNull();
    w.emit({ type: "analysis-complete", result: withFem });
    await flush();
    expect(store().runState).toBe("done");
    expect(store().result).toMatchObject({ minFOS: 1.4, fem: { factorOfSafety: 1.35 } });
    expect(store().runStage).toBeNull();
    expect(store().runStartedAt).toBeNull();
  });

  it("brings the stage and the trials to the store and the status bar", () => {
    store().runAnalysis();
    const [w] = FakeWorker.instances;
    w.emit({ type: "analysis-progress", progress: 0.3, stage: "Finite elements: strength reduction" });
    w.emit({ type: "analysis-progress", progress: 0.31, stage: "Finite elements: strength reduction, trial F = 1.23 (5)" });
    expect(store().runStage).toBe("Finite elements: strength reduction, trial F = 1.23 (5)");
    statusBar();
    expect(screen.getByTestId("status-run-stage")).toHaveTextContent("strength reduction, trial F = 1.23 (5)");
    expect(screen.getByTestId("status-run-elapsed")).toBeInTheDocument();
    // a progress message without a stage keeps the last one
    w.emit({ type: "analysis-progress", progress: 0.5 });
    expect(store().runStage).toBe("Finite elements: strength reduction, trial F = 1.23 (5)");
    w.emit({ type: "analysis-progress", progress: 0.7, stage: "Finite elements: lower bound, mesh 2 of up to 4" });
    expect(store().runStage).toBe("Finite elements: lower bound, mesh 2 of up to 4");
  });

  it("cancels during the finite elements: the worker stops and nothing of the run stays", async () => {
    store().runAnalysis();
    const [w] = FakeWorker.instances;
    w.emit({ type: "analysis-partial", result: le });
    w.emit({ type: "analysis-progress", progress: 0.6, stage: "Finite elements: upper bound, mesh 1 of up to 4" });
    store().cancelAnalysis();
    expect(w.terminated).toBe(true);
    expect(store().runState).toBe("idle");
    expect(store().result).toBeNull();
    expect(store().runStage).toBeNull();
    expect(store().runStartedAt).toBeNull();
    // late messages of the stopped run are ignored
    w.emit({ type: "analysis-progress", progress: 0.8, stage: "late" });
    w.emit({ type: "analysis-complete", result: withFem });
    await flush();
    expect(store().runState).toBe("idle");
    expect(store().result).toBeNull();
    expect(store().runStage).toBeNull();
    // and the next run starts afresh
    store().runAnalysis();
    expect(store().runState).toBe("running");
    expect(store().runStage).toBeNull();
  });

  it("drops the limit equilibrium result of a run whose model was edited", () => {
    store().runAnalysis();
    const [w] = FakeWorker.instances;
    const [x, y] = store().coordinates[1];
    store().setCoordinate(1, [x + 0.5, y]); // cancels the run
    w.emit({ type: "analysis-partial", result: le });
    expect(store().result).toBeNull();
  });
});

describe("the finite element analysis of a model facing left", () => {
  it("is given the model in its own coordinates, the limit equilibrium the canonical one", () => {
    store().setCoordinates([[0, 0], [0, 5], [10, 10], [20, 10], [20, 0]]);
    store().setOrientation("rtl");
    store().runAnalysis();
    const [w] = FakeWorker.instances;
    const request = w.posted[0] as { slope: { coordinates: number[][] }; femSlope: { coordinates: number[][]; orientation: string } };
    expect(request.femSlope.orientation).toBe("rtl");
    expect(request.femSlope.coordinates).toEqual(store().coordinates);
    // the limit equilibrium's definition is mirrored to slide to the right
    expect(request.slope.coordinates).toEqual(store().coordinates.map(([x, y]) => [20 - x, y]));
  });

  it("is not given a second definition without finite elements", () => {
    store().setOptions({ fem: undefined });
    store().runAnalysis();
    expect(FakeWorker.instances[0].posted[0]).not.toHaveProperty("femSlope");
  });
});
