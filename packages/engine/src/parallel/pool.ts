/**
 * The coordinator side of a parallel search: the search runs here as
 * steps (model/steps.ts) and each batch of surfaces is split into chunks,
 * evaluated by the evaluators and, between their replies, by the
 * coordinator itself. The results are put back in the original order, so
 * the minimum, its ties and every count are those of the sequential run.
 *
 * Nothing is shared but data: an evaluator builds the slope from the same
 * definition and options, and evaluates each surface on its own.
 */

import type { AnalysisOptions } from "../types/analysis";
import type { SlopeDefinition } from "../types/slope-definition";
import type { SearchPlane, Slope } from "../model/slope";
import { analyseSlopeAsync, evaluatePlanes, getMorgensternPriceSolver } from "../model/solvers";
import type { RandomVariable, ReliabilityRunner, ReliabilityStep } from "../model/reliability";
import { applyEvaluatedPlane, planeWithoutSlices, type CoordinatorEndpoint, type FromEvaluator, type ToEvaluator } from "./protocol";

export interface EvaluatorPoolOptions {
  /** The coordinator evaluates chunks as well (default true). */
  local?: boolean;
  /** Chunks per thread and batch (default 6; 1 is clearly slower, 3 and 6 about equal, 6 better on a busy machine): smaller chunks balance better, larger cost fewer messages. */
  chunksPerThread?: number;
  /** Batches smaller than this are evaluated by the coordinator alone (default 2). */
  minBatch?: number;
}

/** Chunks each evaluator holds at once: the next is ready when one comes back. */
const IN_FLIGHT = 2;

interface Job {
  resolve: (message: FromEvaluator) => void;
  reject: (error: Error) => void;
}

/** Lets the replies that have arrived be handled (a macrotask, not clamped as timers are). */
function nextTask(): Promise<void> {
  if (typeof MessageChannel === "undefined") return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}

/** The evaluators of one coordinator. */
export class EvaluatorPool {
  private readonly endpoints: CoordinatorEndpoint[];
  private readonly local: boolean;
  private readonly chunksPerThread: number;
  private readonly minBatch: number;
  private readonly jobs = new Map<number, Job>();
  /** The contexts each evaluator has been sent. */
  private readonly known: Set<number>[];
  private readonly contexts = new Map<number, Extract<ToEvaluator, { type: "context" }>>();
  private nextJob = 1;
  private nextKey = 1;
  private closed = false;
  /** Surfaces evaluated through the pool so far (all threads). */
  evaluated = 0;

  constructor(endpoints: CoordinatorEndpoint[], options: EvaluatorPoolOptions = {}) {
    this.endpoints = endpoints;
    this.local = options.local ?? true;
    this.chunksPerThread = Math.max(1, options.chunksPerThread ?? 6);
    this.minBatch = Math.max(1, options.minBatch ?? 2);
    this.known = endpoints.map(() => new Set<number>());
    endpoints.forEach((endpoint) =>
      endpoint.listen((message) => {
        const job = this.jobs.get(message.job);
        if (!job) return; // a chunk of a batch that failed
        this.jobs.delete(message.job);
        if (message.type === "job-error") job.reject(new Error(message.error));
        else job.resolve(message);
      }),
    );
  }

  /** Threads evaluating: the evaluators and the coordinator. */
  get threads(): number {
    return this.endpoints.length + (this.local || this.endpoints.length === 0 ? 1 : 0);
  }

  /**
   * analyseSlope of `slope` (built from `def` with `options`, as
   * buildAnalysisSlope does) with its surfaces spread over the pool.
   */
  async analyse(slope: Slope, def: SlopeDefinition, options: Partial<AnalysisOptions>): Promise<number | null> {
    const key = this.addContext(def, options);
    try {
      return await analyseSlopeAsync(slope, (planes) => this.evaluatePlanes(key, slope, planes));
    } finally {
      this.dropContext(key);
    }
  }

  /** F of each set of values of a Monte Carlo step, spread over the pool, in order. */
  async samples(step: Extract<ReliabilityStep, { kind: "samples" }>): Promise<(number | null)[]> {
    const key = this.addContext(step.def, step.options, step.variables);
    const out = new Array<number | null>(step.values.length);
    try {
      await this.distribute(
        step.values.length,
        key,
        (job, start, end) => ({ type: "samples", job, key, values: step.values.slice(start, end) }),
        (start, end) => {
          for (let i = start; i < end; i++) out[i] = step.sampler(step.values[i]);
        },
        (start, _end, reply) => {
          if (reply.type !== "samples-done") throw new Error("Evaluator: unexpected reply.");
          reply.fos.forEach((fos, i) => (out[start + i] = fos));
        },
        step.progress,
      );
    } finally {
      this.dropContext(key);
    }
    return out;
  }

  /** Runs the steps of a reliability analysis on the pool (analyseReliabilityAsync). */
  reliabilityRunner(): ReliabilityRunner {
    return {
      analyse: async (step) => {
        await this.analyse(step.slope, step.def, step.options);
      },
      samples: (step) => this.samples(step),
    };
  }

  /** Tells the evaluators the coordinator is done; pending batches fail. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const endpoint of this.endpoints) endpoint.send({ type: "detach" });
    const error = new Error("The evaluator pool was closed.");
    for (const job of this.jobs.values()) job.reject(error);
    this.jobs.clear();
  }

  private addContext(def: SlopeDefinition, options: Partial<AnalysisOptions>, variables?: RandomVariable[]): number {
    const key = this.nextKey++;
    this.contexts.set(key, { type: "context", key, def, options, variables, mpSolver: getMorgensternPriceSolver() });
    return key;
  }

  private dropContext(key: number): void {
    this.contexts.delete(key);
    if (this.closed) return;
    this.endpoints.forEach((endpoint, e) => {
      if (this.known[e].delete(key)) endpoint.send({ type: "drop-context", key });
    });
  }

  private evaluatePlanes(key: number, slope: Slope, planes: SearchPlane[]): Promise<void> {
    this.evaluated += planes.length;
    return this.distribute(
      planes.length,
      key,
      (job, start, end) => ({ type: "planes", job, key, planes: planes.slice(start, end).map(planeWithoutSlices) }),
      (start, end) => {
        const chunk = planes.slice(start, end);
        evaluatePlanes(slope, chunk);
        // as an evaluator returns them: the result does not depend on who evaluated what
        for (const plane of chunk) plane.slices = null;
      },
      (start, _end, reply) => {
        if (reply.type !== "planes-done") throw new Error("Evaluator: unexpected reply.");
        reply.planes.forEach((plane, i) => applyEvaluatedPlane(planes[start + i], plane));
      },
    );
  }

  /**
   * Evaluates items [0, count) in chunks: the evaluators take chunks in
   * turn (IN_FLIGHT each), the coordinator takes the next whenever it is
   * free. `local` and `apply` write each chunk's results at its indices.
   */
  private distribute(
    count: number,
    key: number,
    message: (job: number, start: number, end: number) => ToEvaluator,
    local: (start: number, end: number) => void,
    apply: (start: number, end: number, reply: FromEvaluator) => void,
    progress?: (done: number) => void,
  ): Promise<void> {
    if (this.closed) return Promise.reject(new Error("The evaluator pool was closed."));
    if (count === 0) return Promise.resolve();
    if (this.endpoints.length === 0 || (this.local && count < this.minBatch)) {
      local(0, count);
      progress?.(count);
      return Promise.resolve();
    }
    const size = Math.max(1, Math.ceil(count / (this.threads * this.chunksPerThread)));
    const chunks: [number, number][] = [];
    for (let start = 0; start < count; start += size) chunks.push([start, Math.min(count, start + size)]);

    return new Promise<void>((resolve, reject) => {
      let next = 0;
      let finished = 0;
      let done = 0;
      let failed = false;
      const inFlight = this.endpoints.map(() => 0);
      const fail = (error: unknown) => {
        if (failed) return;
        failed = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const finish = (chunk: [number, number]) => {
        finished++;
        done += chunk[1] - chunk[0];
        progress?.(done);
        if (finished === chunks.length) resolve();
      };
      const dispatch = () => {
        for (let e = 0; e < this.endpoints.length; e++) {
          while (!failed && !this.closed && inFlight[e] < IN_FLIGHT && next < chunks.length) {
            const chunk = chunks[next++];
            const job = this.nextJob++;
            inFlight[e]++;
            this.jobs.set(job, {
              resolve: (reply) => {
                inFlight[e]--;
                if (failed) return;
                try {
                  apply(chunk[0], chunk[1], reply);
                } catch (error) {
                  fail(error);
                  return;
                }
                finish(chunk);
                dispatch();
              },
              reject: fail,
            });
            this.ensureContext(e, key);
            this.endpoints[e].send(message(job, chunk[0], chunk[1]));
          }
        }
      };
      dispatch();
      if (!this.local) return;
      void (async () => {
        while (!failed && next < chunks.length) {
          if (this.closed) {
            fail(new Error("The evaluator pool was closed."));
            return;
          }
          const chunk = chunks[next++];
          try {
            local(chunk[0], chunk[1]);
          } catch (error) {
            fail(error);
            return;
          }
          finish(chunk);
          // the replies that came in meanwhile, and their next chunks
          await nextTask();
          dispatch();
        }
      })();
    });
  }

  private ensureContext(e: number, key: number): void {
    if (this.known[e].has(key)) return;
    const context = this.contexts.get(key);
    if (!context) throw new Error(`No context ${key}.`);
    this.known[e].add(key);
    this.endpoints[e].send(context);
  }
}
