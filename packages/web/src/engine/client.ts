/**
 * The page's side of the analysis worker: loads the engine once, runs one
 * document at a time and cancels a run by ending the worker (a run is
 * synchronous in there). The next run starts a new worker and gives it
 * the compiled module again.
 */
import type { AnalysisResult, ResultSummary, ValidationIssue } from "@cslope/engine";
import type { AnalysisDocument } from "./document";
import { loadEngineModule } from "./engine-module";
import type { WorkerRequest, WorkerResponse } from "./messages";

/** What a run gave: the result, or the document's errors. */
export type RunOutcome =
  | { kind: "complete"; result: AnalysisResult; summary: ResultSummary; warnings: ValidationIssue[] }
  | { kind: "invalid"; issues: ValidationIssue[] };

/** The worker as the client uses it (a real Worker, or a fake in tests). */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror?: ((event: MessageEvent) => void) | null;
  terminate(): void;
}

export interface AnalysisClientOptions {
  /** How the engine module is loaded (default: loadEngineModule). */
  loadEngine?: () => Promise<WebAssembly.Module>;
  /** How a worker is made (default: the bundled analysis worker). */
  createWorker?: () => WorkerLike;
}

/** The error a cancelled run rejects with. */
export class CancelledError extends Error {
  constructor() {
    super("The analysis was cancelled.");
    this.name = "CancelledError";
  }
}

function createAnalysisWorker(): WorkerLike {
  return new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
}

interface Pending {
  id: string;
  resolve: (outcome: RunOutcome) => void;
  reject: (error: Error) => void;
  onProgress?: (surfaces: number) => void;
}

export class AnalysisClient {
  private readonly loadEngine: () => Promise<WebAssembly.Module>;
  private readonly createWorker: () => WorkerLike;
  private engine: Promise<WebAssembly.Module> | null = null;
  private worker: WorkerLike | null = null;
  private pending: Pending | null = null;
  private nextId = 1;
  /**
   * Counts the runs asked for and the cancels: a run that was waiting for
   * the engine goes on only when nothing came after it.
   */
  private generation = 0;

  constructor({ loadEngine = loadEngineModule, createWorker = createAnalysisWorker }: AnalysisClientOptions = {}) {
    this.loadEngine = loadEngine;
    this.createWorker = createWorker;
  }

  /** The engine, fetched and compiled on the first call. */
  ready(): Promise<WebAssembly.Module> {
    this.engine ??= this.loadEngine().catch((err: unknown) => {
      this.engine = null; // the next call tries again
      throw err;
    });
    return this.engine;
  }

  /** Whether a run is going on. */
  get running(): boolean {
    return this.pending !== null;
  }

  /**
   * Runs a document; `onProgress` gets the trial surfaces evaluated so far.
   * A run going on is cancelled first.
   */
  async run(document: AnalysisDocument, onProgress?: (surfaces: number) => void): Promise<RunOutcome> {
    this.cancel();
    const generation = this.generation;
    const engine = await this.ready();
    // Another run or a cancel came while the engine loaded: this one is stale.
    if (generation !== this.generation) throw new CancelledError();
    const id = String(this.nextId++);
    return new Promise<RunOutcome>((resolve, reject) => {
      this.pending = { id, resolve, reject, onProgress };
      const worker = this.worker ?? this.startWorker();
      worker.postMessage({ type: "run", id, engine, document });
    });
  }

  /** Stops the run going on, or waiting for the engine, if any: its promise rejects with CancelledError. */
  cancel(): void {
    this.generation++;
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.worker?.terminate();
    this.worker = null;
    pending.reject(new CancelledError());
  }

  private startWorker(): WorkerLike {
    const worker = this.createWorker();
    worker.onmessage = (event) => this.receive(event.data);
    worker.onerror = (event) => this.fail(event.message || "The analysis worker failed.");
    worker.onmessageerror = () => this.fail("The answer of the analysis worker could not be read.");
    this.worker = worker;
    return worker;
  }

  private receive(message: WorkerResponse): void {
    const pending = this.pending;
    if (!pending) return;
    // The worker could not read the request (it answers without the id).
    if (message.type === "error" && message.id === "unknown") return this.fail(message.error);
    if (message.id !== pending.id) return; // an answer of a cancelled run
    switch (message.type) {
      case "progress":
        pending.onProgress?.(message.surfaces);
        return;
      case "invalid":
        this.pending = null;
        pending.resolve({ kind: "invalid", issues: message.issues });
        return;
      case "complete":
        this.pending = null;
        pending.resolve({ kind: "complete", result: message.result, summary: message.summary, warnings: message.warnings });
        return;
      case "error":
        this.pending = null;
        pending.reject(new Error(message.error));
        return;
    }
  }

  private fail(message: string): void {
    const pending = this.pending;
    this.pending = null;
    this.worker?.terminate();
    this.worker = null;
    pending?.reject(new Error(message));
  }
}
