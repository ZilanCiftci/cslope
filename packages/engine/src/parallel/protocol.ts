/**
 * Messages between a coordinator (the thread running a search) and its
 * evaluators (workers that evaluate trial surfaces for it). Everything is
 * plain data, sent by structured clone, which keeps every number exactly.
 */

import type { AnalysisOptions } from "../types/analysis";
import type { SlopeDefinition } from "../types/slope-definition";
import type { SearchPlane } from "../model/slope";
import type { RandomVariable } from "../model/reliability";

/** To an evaluator. */
export type ToEvaluator =
  /**
   * A slope the jobs with this key refer to, built (when first used) as
   * the coordinator built its own: buildSlope(def), then the options.
   */
  | {
      type: "context";
      key: number;
      def: SlopeDefinition;
      options: Partial<AnalysisOptions>;
      /** Monte Carlo samples: the random variables. */
      variables?: RandomVariable[];
      mpSolver: "iterative" | "march";
    }
  | { type: "drop-context"; key: number }
  /** Evaluate the planes (without their slices) as evaluatePlanes does. */
  | { type: "planes"; job: number; key: number; planes: SearchPlane[] }
  /** F of each set of values on the context's surface (monteCarloSampler). */
  | { type: "samples"; job: number; key: number; values: number[][] }
  /** The coordinator is done: forget every context. */
  | { type: "detach" };

/** From an evaluator. */
export type FromEvaluator =
  /** The planes as evaluated, in the order sent, without their slices. */
  | { type: "planes-done"; job: number; planes: SearchPlane[] }
  | { type: "samples-done"; job: number; fos: (number | null)[] }
  | { type: "job-error"; job: number; error: string };

/**
 * One side of a channel: a MessagePort or a worker, adapted (webEndpoint
 * for the browser's ports and workers).
 */
export interface Endpoint<In, Out> {
  send(message: Out): void;
  listen(handler: (message: In) => void): void;
  close?(): void;
}

/** The coordinator's end of the channel to one evaluator. */
export type CoordinatorEndpoint = Endpoint<FromEvaluator, ToEvaluator>;
/** An evaluator's end of the channel to its coordinator. */
export type EvaluatorEndpoint = Endpoint<ToEvaluator, FromEvaluator>;

/** Something with postMessage and onmessage: a MessagePort or a Worker. */
export interface MessageTarget {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
  close?(): void;
}

/** An endpoint over a browser MessagePort or Worker. */
export function webEndpoint<In, Out>(target: MessageTarget): Endpoint<In, Out> {
  return {
    send: (message) => target.postMessage(message),
    listen: (handler) => {
      target.onmessage = (event: MessageEvent) => handler(event.data as In);
    },
    close: () => target.close?.(),
  };
}

/** A plane as sent between threads: its slices are left out. */
export function planeWithoutSlices(plane: SearchPlane): SearchPlane {
  return { ...plane, slices: null };
}

/**
 * Sets `target` to the plane an evaluator returned, as evaluatePlanes
 * would have set it in place (fields it deleted are deleted), without the
 * slices. The object stays the same: the search keeps references to it.
 */
export function applyEvaluatedPlane(target: SearchPlane, evaluated: SearchPlane): void {
  const t = target as unknown as Record<string, unknown>;
  for (const key of Object.keys(t)) {
    if (!(key in evaluated)) delete t[key];
  }
  Object.assign(target, evaluated);
  target.slices = null;
}
