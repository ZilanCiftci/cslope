import { describe, expect, it, vi } from "vitest";
import { AnalysisClient, CancelledError, type WorkerLike } from "./client";
import type { AnalysisDocument } from "./document";
import type { WorkerRequest, WorkerResponse } from "./messages";

const doc: AnalysisDocument = {
  format: "cslope-analysis",
  formatVersion: 1,
  definition: { coordinates: [], materials: [] },
  options: {},
};

/** A worker that records its requests and lets the test answer them. */
function fakeWorker() {
  const requests: WorkerRequest[] = [];
  const worker: WorkerLike & { requests: WorkerRequest[]; answer(m: WorkerResponse): void; terminated: boolean } = {
    requests,
    terminated: false,
    onmessage: null,
    onerror: null,
    postMessage: (m) => requests.push(m),
    answer: (m) => worker.onmessage?.({ data: m } as MessageEvent<WorkerResponse>),
    terminate: () => {
      worker.terminated = true;
    },
  };
  return worker;
}

function client() {
  const workers: ReturnType<typeof fakeWorker>[] = [];
  const engine = {} as WebAssembly.Module;
  const loadEngine = vi.fn(() => Promise.resolve(engine));
  const c = new AnalysisClient({
    loadEngine,
    createWorker: () => {
      const w = fakeWorker();
      workers.push(w);
      return w;
    },
  });
  return { c, workers, engine, loadEngine };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("AnalysisClient", () => {
  it("loads the engine once and gives the module to the worker", async () => {
    const { c, workers, engine, loadEngine } = client();
    const run = c.run(doc);
    await tick();
    expect(loadEngine).toHaveBeenCalledTimes(1);
    expect(workers).toHaveLength(1);
    expect(workers[0].requests).toEqual([{ type: "run", id: "1", engine, document: doc }]);
    workers[0].answer({ type: "complete", id: "1", result: { minFOS: 1.2 } as never, summary: { fos: 1.2 } as never, warnings: [] });
    await expect(run).resolves.toMatchObject({ kind: "complete", summary: { fos: 1.2 } });
    expect(c.running).toBe(false);
    // The next run reuses the worker (the engine is loaded in it).
    const second = c.run(doc);
    await tick();
    expect(loadEngine).toHaveBeenCalledTimes(1);
    expect(workers).toHaveLength(1);
    workers[0].answer({ type: "invalid", id: "2", issues: [{ path: "/definition", code: "x", message: "m", severity: "error" }] });
    await expect(second).resolves.toMatchObject({ kind: "invalid" });
  });

  it("forwards progress and ignores answers of another run", async () => {
    const { c, workers } = client();
    const progress: number[] = [];
    const run = c.run(doc, (n) => progress.push(n));
    await tick();
    workers[0].answer({ type: "progress", id: "1", surfaces: 10 });
    workers[0].answer({ type: "progress", id: "9", surfaces: 99 });
    workers[0].answer({ type: "progress", id: "1", surfaces: 20 });
    workers[0].answer({ type: "complete", id: "1", result: {} as never, summary: {} as never, warnings: [] });
    await run;
    expect(progress).toEqual([10, 20]);
  });

  it("cancels a run by ending the worker, and starts a new one for the next run", async () => {
    const { c, workers } = client();
    const run = c.run(doc);
    await tick();
    expect(c.running).toBe(true);
    c.cancel();
    expect(workers[0].terminated).toBe(true);
    await expect(run).rejects.toBeInstanceOf(CancelledError);
    expect(c.running).toBe(false);
    const next = c.run(doc);
    await tick();
    expect(workers).toHaveLength(2);
    workers[1].answer({ type: "complete", id: "2", result: {} as never, summary: {} as never, warnings: [] });
    await expect(next).resolves.toMatchObject({ kind: "complete" });
  });

  it("a new run cancels the one going on", async () => {
    const { c, workers } = client();
    const first = c.run(doc);
    await tick();
    const second = c.run(doc);
    await expect(first).rejects.toBeInstanceOf(CancelledError);
    await tick();
    expect(workers).toHaveLength(2);
    workers[1].answer({ type: "complete", id: "2", result: {} as never, summary: {} as never, warnings: [] });
    await expect(second).resolves.toMatchObject({ kind: "complete" });
  });

  it("rejects with the worker's error, and with a failure of the worker itself", async () => {
    const { c, workers } = client();
    const run = c.run(doc);
    await tick();
    workers[0].answer({ type: "error", id: "1", error: "No valid slip surface was found." });
    await expect(run).rejects.toThrow("No valid slip surface was found.");
    const crash = c.run(doc);
    await tick();
    workers[0].onerror?.({ message: "worker script failed" } as ErrorEvent);
    await expect(crash).rejects.toThrow("worker script failed");
    expect(workers[0].terminated).toBe(true);
  });

  it("tries to load the engine again after a failure", async () => {
    const loadEngine = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({} as WebAssembly.Module);
    const c = new AnalysisClient({ loadEngine, createWorker: fakeWorker });
    await expect(c.ready()).rejects.toThrow("offline");
    await expect(c.ready()).resolves.toBeDefined();
    expect(loadEngine).toHaveBeenCalledTimes(2);
  });
});
