import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisResult } from "@cslope/engine";
import { useAppStore } from "./app-store";
import { executeReliability } from "./slices/analysisSlice";
import { ANALYSIS_TIMEOUT_MS } from "../constants";

type Data = { type: string; result?: unknown; progress?: number; error?: string };

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
  complete(minFOS: number) {
    this.emit({ type: "analysis-complete", result: { minFOS } });
  }
  fail(message: string) {
    this.onerror?.({ message } as ErrorEvent);
  }
}

const originalWorker = globalThis.Worker;
const store = () => useAppStore.getState();
const result = (fos: number) => ({ minFOS: fos }) as unknown as AnalysisResult;

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

/** Two models, A active. */
function twoModels() {
  const a = store().activeModelId;
  store().addModel("B");
  const b = store().activeModelId;
  store().switchModel(a);
  return { a, b };
}

const entry = (id: string) => store().models.find((m) => m.id === id)!;

function nudgeCoordinate() {
  const [x, y] = store().coordinates[1];
  store().setCoordinate(1, [x + 0.5, y]);
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  FakeWorker.instances = [];
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value: FakeWorker,
  });
  store().newProject();
});

afterEach(() => {
  store().cancelAnalysis();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value: originalWorker,
  });
});

describe("single run", () => {
  it("posts the model and options to the worker and stores the result", async () => {
    store().runAnalysis();
    expect(store().runState).toBe("running");
    expect(store().progress).toBeCloseTo(0.02);
    const [w] = FakeWorker.instances;
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0]).toMatchObject({
      type: "run-analysis",
      options: store().options,
    });
    w.complete(1.4);
    await flush();
    expect(store().runState).toBe("done");
    expect(store().progress).toBe(1);
    expect(store().result).toEqual(result(1.4));
    expect(entry(store().activeModelId).runState).not.toBe("running");
    expect(w.terminated).toBe(true);
  });

  it("advances a simulated progress bar up to 95 % and stops it when done", async () => {
    store().runAnalysis();
    vi.advanceTimersByTime(120);
    const p1 = store().progress;
    expect(p1).toBeGreaterThan(0.02);
    vi.advanceTimersByTime(120 * 200);
    expect(store().progress).toBeCloseTo(0.95, 5);
    FakeWorker.instances[0].complete(1);
    await flush();
    expect(store().progress).toBe(1);
    vi.advanceTimersByTime(1200);
    expect(store().progress).toBe(1);
  });

  it("the simulated progress stops when the run state changes elsewhere", () => {
    store().runAnalysis();
    useAppStore.setState({ runState: "idle", progress: 0.3 });
    vi.advanceTimersByTime(600);
    expect(store().progress).toBe(0.3);
  });

  it("clamps worker progress and never moves it backwards", async () => {
    store().runAnalysis();
    const [w] = FakeWorker.instances;
    w.emit({ type: "analysis-progress", progress: 0.5 });
    expect(store().progress).toBe(0.5);
    w.emit({ type: "analysis-progress", progress: 0.3 });
    expect(store().progress).toBe(0.5);
    w.emit({ type: "analysis-progress", progress: 7 });
    expect(store().progress).toBe(0.95);
    w.emit({ type: "analysis-progress", progress: -1 });
    expect(store().progress).toBe(0.95);
    // Unknown messages are ignored.
    w.emit({ type: "something-else" });
    expect(store().runState).toBe("running");
  });

  it("shows the worker's error message", async () => {
    store().runAnalysis();
    FakeWorker.instances[0].emit({ type: "analysis-error", error: "No valid surfaces" });
    await flush();
    expect(store().runState).toBe("error");
    expect(store().errorMessage).toBe("No valid surfaces");
    expect(store().progress).toBe(0);
    expect(store().result).toBeNull();
  });

  it("reports a worker that fails to start, with a fallback message", async () => {
    store().runAnalysis();
    FakeWorker.instances[0].fail("");
    await flush();
    expect(store().errorMessage).toBe("The analysis worker failed to start.");

    store().runAnalysis();
    FakeWorker.instances[1].fail("SyntaxError in worker");
    await flush();
    expect(store().errorMessage).toBe("SyntaxError in worker");
  });

  it("ignores messages that arrive after the run settled", async () => {
    store().runAnalysis();
    const [w] = FakeWorker.instances;
    w.complete(1.2);
    await flush();
    w.emit({ type: "analysis-error", error: "late" });
    w.fail("late");
    w.emit({ type: "analysis-progress", progress: 0.1 });
    await flush();
    expect(store().runState).toBe("done");
    expect(store().result).toEqual(result(1.2));
    expect(store().progress).toBe(1);
  });

  it("times out after the base budget for the default search size", async () => {
    store().runAnalysis();
    const [w] = FakeWorker.instances;
    vi.advanceTimersByTime(ANALYSIS_TIMEOUT_MS - 1);
    await flush();
    expect(store().runState).toBe("running");
    vi.advanceTimersByTime(1);
    await flush();
    expect(store().runState).toBe("error");
    expect(store().errorMessage).toBe(
      `Analysis timed out after ${ANALYSIS_TIMEOUT_MS / 1000} seconds.`,
    );
    expect(w.terminated).toBe(true);
    // A completion after the timeout changes nothing.
    w.complete(1);
    await flush();
    expect(store().runState).toBe("error");
  });

  it("gives larger searches proportionally more time", async () => {
    store().setOptions({ iterations: 3000, refinedIterations: 0 });
    store().runAnalysis();
    vi.advanceTimersByTime(ANALYSIS_TIMEOUT_MS * 1.5);
    await flush();
    expect(store().runState).toBe("running");
    vi.advanceTimersByTime(ANALYSIS_TIMEOUT_MS * 0.5);
    await flush();
    expect(store().errorMessage).toBe(
      `Analysis timed out after ${(ANALYSIS_TIMEOUT_MS * 2) / 1000} seconds.`,
    );
  });

  it("smaller searches keep the base budget", async () => {
    store().setOptions({ iterations: 10, refinedIterations: 0 });
    store().runAnalysis();
    vi.advanceTimersByTime(ANALYSIS_TIMEOUT_MS);
    await flush();
    expect(store().runState).toBe("error");
  });

  it("does not start a worker when an expression cannot be evaluated", () => {
    useAppStore.setState({
      coordinateExpressions: store().coordinates.map((_, i) =>
        i === 0 ? { x: "missing" } : {},
      ),
    });
    store().runAnalysis();
    expect(FakeWorker.instances).toHaveLength(0);
    expect(store().runState).toBe("error");
    expect(store().progress).toBe(0);
    expect(store().errorMessage).toMatch(
      /^Cannot run: 1 expression\(s\) cannot be evaluated — Exterior boundary point 1 x "missing"/,
    );
    // No simulated progress keeps running.
    vi.advanceTimersByTime(1000);
    expect(store().progress).toBe(0);
  });

  it("cancel stops the worker and leaves the state idle", async () => {
    store().runAnalysis();
    const [w] = FakeWorker.instances;
    store().cancelAnalysis();
    expect(w.terminated).toBe(true);
    await flush();
    expect(store().runState).toBe("idle");
    expect(store().errorMessage).toBeNull();
    w.complete(1);
    await flush();
    expect(store().result).toBeNull();
  });

  it("a second Run replaces the first; only the second result counts", async () => {
    store().runAnalysis();
    store().runAnalysis();
    const [first, second] = FakeWorker.instances;
    expect(first.terminated).toBe(true);
    second.complete(2);
    await flush();
    expect(store().result).toEqual(result(2));
  });

  it("stores the result on the model it was started for after a switch", async () => {
    const { a, b } = twoModels();
    store().runAnalysis();
    store().switchModel(b);
    // Progress of model A does not move model B's bar.
    FakeWorker.instances[0].emit({ type: "analysis-progress", progress: 0.6 });
    expect(store().progress).not.toBe(0.6);
    FakeWorker.instances[0].complete(1.7);
    await flush();
    expect(store().result).toBeNull();
    expect(entry(a)).toMatchObject({ runState: "done", progress: 1, result: result(1.7) });
    store().switchModel(a);
    expect(store().result).toEqual(result(1.7));
  });

  it("stores an error on the model it was started for after a switch", async () => {
    const { a, b } = twoModels();
    store().runAnalysis();
    store().switchModel(b);
    FakeWorker.instances[0].emit({ type: "analysis-error", error: "bad" });
    await flush();
    expect(entry(a)).toMatchObject({ runState: "error", errorMessage: "bad", progress: 0 });
    expect(store().errorMessage).toBeNull();
  });

  it("drops the result of a model edited and switched away from while running", async () => {
    const { a, b } = twoModels();
    store().runAnalysis();
    // Edit model A's stored entry directly (as a dialog sync would).
    useAppStore.setState((s) => ({
      models: s.models.map((m) =>
        m.id === a
          ? { ...m, coordinates: m.coordinates.map(([x, y]) => [x + 1, y] as [number, number]) }
          : m,
      ),
    }));
    useAppStore.setState({ activeModelId: b });
    FakeWorker.instances[0].complete(1.1);
    await flush();
    expect(entry(a)).toMatchObject({ runState: "idle", result: null });
  });

  it("forgets the result of a model deleted while it ran", async () => {
    const { a, b } = twoModels();
    store().runAnalysis();
    const [w] = FakeWorker.instances;
    // Remove the entry without going through deleteModel (which cancels).
    useAppStore.setState((s) => ({
      activeModelId: b,
      models: s.models.filter((m) => m.id !== a),
    }));
    w.complete(1);
    await flush();
    expect(store().models.map((m) => m.id)).toEqual([b]);
    expect(store().models[0].result ?? null).toBeNull();
  });

  it("discards a result whose inputs changed while the model stayed active", async () => {
    store().runAnalysis();
    const [w] = FakeWorker.instances;
    // Change the inputs without invalidating (as an undo might).
    const [x, y] = store().coordinates[1];
    useAppStore.setState({
      coordinates: store().coordinates.map((c, i) => (i === 1 ? [x + 1, y] : c)),
    });
    w.complete(1.5);
    await flush();
    expect(store().runState).toBe("idle");
    expect(store().result).toBeNull();
  });

  it("editing the model cancels its run", () => {
    store().runAnalysis();
    nudgeCoordinate();
    expect(FakeWorker.instances[0].terminated).toBe(true);
    expect(store().runState).toBe("idle");
  });

  it("editing another model leaves a run alone", () => {
    const { b } = twoModels();
    store().runAnalysis();
    store().switchModel(b);
    nudgeCoordinate();
    expect(FakeWorker.instances[0].terminated).toBe(false);
  });
});

describe("Run All", () => {
  it("runs every model and shows the active model's result", async () => {
    const { a, b } = twoModels();
    const run = store().runAllAnalyses();
    await flush();
    expect(store().runState).toBe("running");
    expect(FakeWorker.instances).toHaveLength(2);
    expect(entry(a).runState).toBe("running");
    FakeWorker.instances[1].emit({ type: "analysis-progress", progress: 0.4 });
    expect(entry(b).progress).toBe(0.4);
    FakeWorker.instances[0].complete(1.1);
    FakeWorker.instances[1].complete(2.2);
    await run;
    expect(entry(a)).toMatchObject({ runState: "done", result: result(1.1) });
    expect(entry(b)).toMatchObject({ runState: "done", result: result(2.2) });
    expect(store()).toMatchObject({ runState: "done", progress: 1, result: result(1.1) });
  });

  it("the batch progress is the mean of the models' progress", async () => {
    twoModels();
    const run = store().runAllAnalyses();
    await flush();
    // Both models start at 8 %.
    expect(store().progress).toBeCloseTo(0.08, 5);
    vi.advanceTimersByTime(120);
    expect(store().progress).toBeGreaterThan(0.08);
    FakeWorker.instances[0].complete(1);
    await flush();
    const half = store().progress;
    expect(half).toBeGreaterThan(0.5);
    expect(half).toBeLessThan(1);
    // Simulated progress tops out at 95 % for the model still running.
    vi.advanceTimersByTime(120 * 500);
    expect(store().progress).toBeCloseTo((1 + 0.95) / 2, 5);
    FakeWorker.instances[1].complete(2);
    await run;
    expect(store().progress).toBe(1);
  });

  it("records per-model worker errors and the active model's error", async () => {
    const { a, b } = twoModels();
    const run = store().runAllAnalyses();
    await flush();
    FakeWorker.instances[0].emit({ type: "analysis-error", error: "A failed" });
    FakeWorker.instances[1].emit({ type: "analysis-error", error: "B failed" });
    await run;
    expect(entry(a)).toMatchObject({ runState: "error", errorMessage: "A failed" });
    expect(entry(b)).toMatchObject({ runState: "error", errorMessage: "B failed" });
    expect(store()).toMatchObject({ runState: "error", errorMessage: "A failed", result: null });
  });

  it("a model with a broken expression fails without a worker; the others still run", async () => {
    const { a, b } = twoModels();
    store().switchModel(b);
    useAppStore.setState({
      coordinateExpressions: store().coordinates.map((_, i) => (i === 0 ? { y: "nope" } : {})),
    });
    store().switchModel(a);
    const run = store().runAllAnalyses();
    await flush();
    expect(FakeWorker.instances).toHaveLength(1);
    FakeWorker.instances[0].complete(1.3);
    await run;
    expect(entry(a)).toMatchObject({ runState: "done" });
    expect(entry(b).runState).toBe("error");
    expect(entry(b).errorMessage).toMatch(/^Cannot run: .*"nope"/);
  });

  it("a broken active model shows its error in the flat state", async () => {
    twoModels();
    useAppStore.setState({
      coordinateExpressions: store().coordinates.map((_, i) => (i === 0 ? { y: "nope" } : {})),
    });
    const run = store().runAllAnalyses();
    await flush();
    FakeWorker.instances[0].complete(1);
    await run;
    expect(store().runState).toBe("error");
    expect(store().errorMessage).toMatch(/^Cannot run:/);
  });

  it("runs no more models at once than there are cores", async () => {
    vi.stubGlobal("navigator", { ...navigator, hardwareConcurrency: 1 });
    const { a } = twoModels();
    store().addModel("C");
    store().switchModel(a);
    const run = store().runAllAnalyses();
    await flush();
    expect(FakeWorker.instances).toHaveLength(1);
    FakeWorker.instances[0].complete(1);
    await flush();
    expect(FakeWorker.instances).toHaveLength(2);
    FakeWorker.instances[1].complete(2);
    await flush();
    FakeWorker.instances[2].complete(3);
    await run;
    expect(store().models.map((m) => m.runState)).toEqual(["done", "done", "done"]);
  });

  it("falls back to four parallel runs when the core count is unknown", async () => {
    vi.stubGlobal("navigator", { ...navigator, hardwareConcurrency: 0 });
    const { a } = twoModels();
    for (const name of ["C", "D", "E"]) store().addModel(name);
    store().switchModel(a);
    const run = store().runAllAnalyses();
    await flush();
    expect(FakeWorker.instances).toHaveLength(4);
    for (const w of FakeWorker.instances) w.complete(1);
    await flush();
    expect(FakeWorker.instances).toHaveLength(5);
    FakeWorker.instances[4].complete(1);
    await run;
  });

  it("drops the result of a background model edited while it ran", async () => {
    const { a, b } = twoModels();
    const run = store().runAllAnalyses();
    await flush();
    useAppStore.setState((s) => ({
      models: s.models.map((m) =>
        m.id === b ? { ...m, coordinates: m.coordinates.map(([x, y]) => [x, y + 1] as [number, number]) } : m,
      ),
    }));
    FakeWorker.instances[0].complete(1);
    FakeWorker.instances[1].complete(2);
    await run;
    expect(entry(a).runState).toBe("done");
    expect(entry(b)).toMatchObject({ runState: "idle", result: null });
  });

  it("a model deleted mid-batch is not resurrected", async () => {
    vi.stubGlobal("navigator", { ...navigator, hardwareConcurrency: 1 });
    const { a, b } = twoModels();
    const run = store().runAllAnalyses();
    await flush();
    // Remove B before its turn comes.
    useAppStore.setState((s) => ({ models: s.models.filter((m) => m.id !== b) }));
    FakeWorker.instances[0].complete(1);
    await run;
    expect(FakeWorker.instances).toHaveLength(1);
    expect(store().models.map((m) => m.id)).toEqual([a]);
  });

  it("ends idle when the active model disappeared during the batch", async () => {
    const { a, b } = twoModels();
    const run = store().runAllAnalyses();
    await flush();
    useAppStore.setState((s) => ({
      activeModelId: "gone",
      models: s.models.filter((m) => m.id !== "gone"),
    }));
    FakeWorker.instances[0].complete(1);
    FakeWorker.instances[1].complete(2);
    await run;
    expect(store().runState).toBe("idle");
    expect(store().progress).toBe(1);
    expect(entry(a).runState).toBe("done");
    expect(entry(b).runState).toBe("done");
  });

  it("cancel mid-batch leaves no model running and drops late results", async () => {
    const { a, b } = twoModels();
    const run = store().runAllAnalyses();
    await flush();
    store().cancelAnalysis();
    await run;
    expect(FakeWorker.instances.every((w) => w.terminated)).toBe(true);
    expect(entry(a).runState).toBe("idle");
    expect(entry(b).runState).toBe("idle");
    expect(store().runState).toBe("idle");
    FakeWorker.instances[0].complete(9);
    await flush();
    expect(entry(a).result ?? null).toBeNull();
  });

  it("a timed-out model reports the timeout; the others finish", async () => {
    const { a, b } = twoModels();
    const run = store().runAllAnalyses();
    await flush();
    FakeWorker.instances[1].complete(2);
    await flush();
    vi.advanceTimersByTime(ANALYSIS_TIMEOUT_MS);
    await run;
    expect(entry(a).runState).toBe("error");
    expect(entry(a).errorMessage).toMatch(/timed out/);
    expect(entry(b).runState).toBe("done");
  });

  it("a superseded batch does not write results or errors", async () => {
    const { a } = twoModels();
    const first = store().runAllAnalyses();
    await flush();
    const [w1] = FakeWorker.instances;
    const second = store().runAllAnalyses();
    await flush();
    await first;
    // The first batch's workers were cancelled: results ignored.
    w1.complete(42);
    await flush();
    expect(entry(a).result ?? null).toBeNull();
    FakeWorker.instances[2].complete(1);
    FakeWorker.instances[3].complete(2);
    await second;
    expect(entry(a).result).toEqual(result(1));
  });

  it("with no models Run All just resets the displayed run", async () => {
    useAppStore.setState({ models: [], runState: "error", progress: 0.5, errorMessage: "old" });
    await store().runAllAnalyses();
    expect(FakeWorker.instances).toHaveLength(0);
    expect(store()).toMatchObject({ runState: "idle", progress: 0, result: null, errorMessage: null });
  });

  it("resetAllAnalyses clears every model and returns to edit mode", async () => {
    const { a, b } = twoModels();
    const run = store().runAllAnalyses();
    await flush();
    FakeWorker.instances[0].complete(1);
    FakeWorker.instances[1].complete(2);
    await run;
    useAppStore.setState({ mode: "result" });
    store().resetAllAnalyses();
    expect(store()).toMatchObject({ mode: "edit", runState: "idle", result: null, progress: 0 });
    for (const id of [a, b]) {
      expect(entry(id)).toMatchObject({ runState: "idle", result: null, mode: "edit" });
    }
  });

  it("reset clears only the displayed run", async () => {
    store().runAnalysis();
    FakeWorker.instances[0].complete(1);
    await flush();
    store().reset();
    expect(store()).toMatchObject({ runState: "idle", progress: 0, result: null, errorMessage: null });
  });
});

describe("executeReliability time budget", () => {
  const model = () => ({ ...store().models[0], ...store() }) as never;
  const timesOutAfter = async (seconds: number, run: () => { promise: Promise<unknown> }) => {
    const { promise } = run();
    const outcome = promise.then(
      () => "resolved",
      (e: Error) => e.message,
    );
    vi.advanceTimersByTime(seconds * 1000 - 1);
    await flush();
    vi.advanceTimersByTime(1);
    expect(await outcome).toBe(`Analysis timed out after ${seconds} seconds.`);
  };
  const variable = { materialIndex: 0, field: "cohesion", mean: 10, sd: 1 } as never;

  it("Taylor with search runs 1 + 2n analyses", async () => {
    await timesOutAfter(60 * 5, () =>
      executeReliability(model(), [variable, variable], { method: "taylor" } as never),
    );
  });

  it("Taylor without search runs two analyses", async () => {
    await timesOutAfter(60 * 2, () =>
      executeReliability(model(), [variable, variable, variable], {
        method: "taylor",
        search: false,
      } as never),
    );
  });

  it("Monte Carlo grows with the samples (default 1000)", async () => {
    await timesOutAfter(60 * 3, () =>
      executeReliability(model(), [variable], { method: "monte-carlo" } as never),
    );
    await timesOutAfter(60 * 5, () =>
      executeReliability(model(), [variable], { method: "monte-carlo", samples: 2000 } as never),
    );
  });

  it("reports reliability progress up to 100 % and resolves with the result", async () => {
    const onProgress = vi.fn();
    const { promise } = executeReliability(
      model(),
      [variable],
      { method: "monte-carlo" } as never,
      onProgress,
    );
    const w = FakeWorker.instances.at(-1)!;
    expect(w.posted[0]).toMatchObject({ type: "run-reliability", variables: [variable] });
    w.emit({ type: "analysis-progress", progress: 1.5 });
    expect(onProgress).toHaveBeenCalledWith(1);
    w.emit({ type: "reliability-complete", result: { pf: 0.01 } });
    await expect(promise).resolves.toEqual({ pf: 0.01 });
  });

  it("cancelling rejects with a cancellation and stops the worker", async () => {
    const handle = executeReliability(model(), [variable], { method: "taylor" } as never);
    const w = FakeWorker.instances.at(-1)!;
    handle.cancel();
    handle.cancel(); // idempotent
    await expect(handle.promise).rejects.toThrow("Analysis cancelled");
    expect(w.terminated).toBe(true);
  });
});
