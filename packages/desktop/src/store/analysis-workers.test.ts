/**
 * Threads of an analysis: the evaluator workers a run starts besides its
 * analysis worker, how they are connected, kept between runs and stopped,
 * and how runs at the same time share the cores.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "./app-store";
import { executeModelAnalysis, executeReliability } from "./slices/analysisSlice";
import {
  ANALYSIS_THREADS_KEY,
  WORKER_IDLE_MS,
  analysisThreads,
  idleWorkerCount,
  setAnalysisThreads,
  stopIdleWorkers,
  threadsPerRun,
} from "./analysis-workers";

type Data = { type: string; result?: unknown; error?: string; port?: unknown; evaluators?: unknown[] };

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<Data>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  posted: Data[] = [];
  transferred: unknown[][] = [];
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(msg: Data, transfer: unknown[] = []) {
    this.posted.push(msg);
    this.transferred.push(transfer);
  }
  terminate() {
    this.terminated = true;
  }
  complete(minFOS: number) {
    this.onmessage?.({ data: { type: "analysis-complete", result: { minFOS } } } as MessageEvent<Data>);
  }
}

const originalWorker = globalThis.Worker;
const store = () => useAppStore.getState();
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const model = () => ({ ...store().models[0], ...store() }) as never;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  FakeWorker.instances = [];
  Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: FakeWorker });
  store().newProject();
});

afterEach(() => {
  store().cancelAnalysis();
  stopIdleWorkers();
  setAnalysisThreads(1);
  localStorage.removeItem(ANALYSIS_THREADS_KEY);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: originalWorker });
});

describe("threads of an analysis", () => {
  it("one per core by default, at most eight; the setting and the override take precedence", () => {
    setAnalysisThreads(null);
    vi.stubGlobal("navigator", { ...navigator, hardwareConcurrency: 4 });
    expect(analysisThreads()).toBe(4);
    vi.stubGlobal("navigator", { ...navigator, hardwareConcurrency: 32 });
    expect(analysisThreads()).toBe(8);
    vi.stubGlobal("navigator", { ...navigator, hardwareConcurrency: 1 });
    expect(analysisThreads()).toBe(1);
    localStorage.setItem(ANALYSIS_THREADS_KEY, "3");
    expect(analysisThreads()).toBe(3);
    setAnalysisThreads(2);
    expect(analysisThreads()).toBe(2);
    setAnalysisThreads(0);
    expect(analysisThreads()).toBe(1);
  });

  it("runs at the same time share them", () => {
    setAnalysisThreads(4);
    expect(threadsPerRun(1)).toBe(4);
    expect(threadsPerRun(2)).toBe(2);
    expect(threadsPerRun(3)).toBe(1);
    expect(threadsPerRun(8)).toBe(1);
  });
});

describe("evaluator workers", () => {
  it("one thread starts the analysis worker alone, as before", () => {
    executeModelAnalysis(model(), undefined, 1);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].posted[0].evaluators).toBeUndefined();
  });

  it("connects each evaluator to the analysis worker by its own channel", () => {
    executeModelAnalysis(model(), undefined, 3);
    const [coordinator, ...evaluators] = FakeWorker.instances;
    expect(evaluators).toHaveLength(2);
    const request = coordinator.posted[0];
    expect(request.type).toBe("run-analysis");
    expect(request.evaluators).toHaveLength(2);
    // (ports compared by identity)
    const ports = request.evaluators!;
    expect(coordinator.transferred[0].length).toBe(2);
    ports.forEach((port, i) => expect(coordinator.transferred[0][i] === port).toBe(true));
    for (const e of evaluators) {
      expect(e.posted[0].type).toBe("serve-evaluator");
      expect(e.posted[0].port).toBeInstanceOf(MessagePort);
      expect(e.transferred[0].length === 1 && e.transferred[0][0] === e.posted[0].port).toBe(true);
      // the other end of a channel than the analysis worker's
      expect(ports.includes(e.posted[0].port)).toBe(false);
    }
    expect(new Set(ports).size).toBe(2);
  });

  it("keeps the workers of a completed run for the next, then stops them when idle", async () => {
    const first = executeModelAnalysis(model(), undefined, 3);
    const [coordinator, e1, e2] = FakeWorker.instances;
    coordinator.complete(1.3);
    expect((await first.promise).minFOS).toBe(1.3);
    expect([coordinator, e1, e2].map((w) => w.terminated)).toEqual([false, false, false]);
    expect(coordinator.onmessage).toBeNull();
    expect(idleWorkerCount()).toBe(3);

    // no new worker: the same three, the analysis worker again first
    const second = executeModelAnalysis(model(), undefined, 3);
    expect(FakeWorker.instances).toHaveLength(3);
    expect(coordinator.posted.map((m) => m.type)).toEqual(["run-analysis", "run-analysis"]);
    expect(e1.posted.map((m) => m.type)).toEqual(["serve-evaluator", "serve-evaluator"]);
    expect(idleWorkerCount()).toBe(0);
    coordinator.complete(1.4);
    expect((await second.promise).minFOS).toBe(1.4);
    expect(idleWorkerCount()).toBe(3);
    vi.advanceTimersByTime(WORKER_IDLE_MS);
    expect(idleWorkerCount()).toBe(0);
    expect([coordinator, e1, e2].map((w) => w.terminated)).toEqual([true, true, true]);
  });

  it("a run with one thread keeps its worker for the next run too", async () => {
    const run = executeModelAnalysis(model(), undefined, 1);
    const [w] = FakeWorker.instances;
    w.complete(1.2);
    await run.promise;
    expect(w.terminated).toBe(false);
    expect(idleWorkerCount()).toBe(1);
    const second = executeModelAnalysis(model(), undefined, 1);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(w.posted.map((m) => m.type)).toEqual(["run-analysis", "run-analysis"]);
    w.complete(1.3);
    expect((await second.promise).minFOS).toBe(1.3);
    expect(idleWorkerCount()).toBe(1);
  });

  it("a failed run's worker is stopped, not kept", async () => {
    const run = executeModelAnalysis(model(), undefined, 1);
    const [w] = FakeWorker.instances;
    w.onmessage?.({ data: { type: "analysis-error", error: "no surfaces" } } as MessageEvent<Data>);
    await expect(run.promise).rejects.toThrow("no surfaces");
    expect(w.terminated).toBe(true);
    expect(idleWorkerCount()).toBe(0);
  });

  it("cancelling stops every worker of the run at once", async () => {
    const run = executeModelAnalysis(model(), undefined, 4);
    const outcome = run.promise.catch((e: Error) => e.name);
    run.cancel();
    expect(FakeWorker.instances.map((w) => w.terminated)).toEqual([true, true, true, true]);
    expect(await outcome).toBe("AnalysisCancelledError");
    expect(idleWorkerCount()).toBe(0);
  });

  it("an evaluator that fails ends the run with its error", async () => {
    const run = executeModelAnalysis(model(), undefined, 2);
    const [coordinator, evaluator] = FakeWorker.instances;
    evaluator.onerror?.({ message: "out of memory" } as ErrorEvent);
    await expect(run.promise).rejects.toThrow("out of memory");
    expect([coordinator.terminated, evaluator.terminated]).toEqual([true, true]);
  });

  it("a probabilistic analysis gets evaluators too", () => {
    const variable = { material: 0, field: "cohesion", sd: 1 } as never;
    executeReliability(model(), [variable], { method: "monte-carlo", samples: 500 }, undefined, 3);
    const [coordinator, ...evaluators] = FakeWorker.instances;
    expect(coordinator.posted[0]).toMatchObject({ type: "run-reliability" });
    expect(coordinator.posted[0].evaluators).toHaveLength(2);
    expect(evaluators).toHaveLength(2);
  });

  it("Run all shares the cores: two models on four get two threads each", async () => {
    setAnalysisThreads(null);
    vi.stubGlobal("navigator", { ...navigator, hardwareConcurrency: 4 });
    store().addModel("B");
    const run = store().runAllAnalyses();
    await flush();
    const coordinators = FakeWorker.instances.filter((w) => w.posted[0]?.type === "run-analysis");
    const evaluators = FakeWorker.instances.filter((w) => w.posted[0]?.type === "serve-evaluator");
    expect(coordinators).toHaveLength(2);
    expect(evaluators).toHaveLength(2);
    for (const c of coordinators) expect(c.posted[0].evaluators).toHaveLength(1);
    coordinators.forEach((c, i) => c.complete(1 + i));
    await run;
    expect(store().models.map((m) => m.runState)).toEqual(["done", "done"]);
    expect(idleWorkerCount()).toBe(4);
  });

  it("Run all of more models than cores runs on one worker per core, each reused for the queue", async () => {
    setAnalysisThreads(null);
    vi.stubGlobal("navigator", { ...navigator, hardwareConcurrency: 2 });
    for (const name of ["B", "C", "D", "E"]) store().addModel(name);
    const run = store().runAllAnalyses();
    await flush();
    expect(FakeWorker.instances).toHaveLength(2);
    for (let i = 0; i < 3; i++) {
      const busy = FakeWorker.instances.filter((w) => w.onmessage !== null);
      expect(busy.length).toBeGreaterThan(0);
      busy[0].complete(1);
      await flush();
    }
    expect(FakeWorker.instances).toHaveLength(2);
    for (const w of FakeWorker.instances) if (w.onmessage) w.complete(1);
    await run;
    expect(store().models.map((m) => m.runState)).toEqual(["done", "done", "done", "done", "done"]);
    expect(FakeWorker.instances.flatMap((w) => w.posted).filter((m) => m.type === "run-analysis")).toHaveLength(5);
    expect(idleWorkerCount()).toBe(2);
    expect(FakeWorker.instances.map((w) => w.terminated)).toEqual([false, false]);
  });
});
