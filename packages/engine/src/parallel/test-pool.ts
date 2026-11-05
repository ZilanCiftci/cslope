/**
 * Test helpers for the parallel search (not used by the engine): a pool of
 * in-process evaluators behind channels that deliver in order per channel
 * but after random delays, so that chunks complete in shuffled order, and
 * an exact (bit-for-bit) comparison of results.
 */
import { expect } from "vitest";
import type { AnalysisOptions } from "../types/analysis";
import type { SlopeDefinition } from "../types/slope-definition";
import type { SearchPlane, Slope } from "../model/slope";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import { analyseSlopeSteps, evaluatePlanes } from "../model/solvers";
import { runStepsSync } from "../model/steps";
import { VERIFICATION_CASES } from "../verification/cases";
import { buildAnalysisSlope, serveEvaluator } from "./evaluator";
import { EvaluatorPool, type EvaluatorPoolOptions } from "./pool";
import type { CoordinatorEndpoint, EvaluatorEndpoint, FromEvaluator, ToEvaluator } from "./protocol";

/** Deterministic random numbers for the delays. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One direction of a channel: in order, each message after a random delay, cloned. */
function lane<T>(rand: () => number) {
  let handler: (message: T) => void = () => {};
  let chain = Promise.resolve();
  return {
    send(message: T) {
      const copy = structuredClone(message);
      const ms = Math.floor(rand() * 3);
      chain = chain.then(() => new Promise<void>((resolve) => setTimeout(() => (handler(copy), resolve()), ms)));
    },
    listen(h: (message: T) => void) {
      handler = h;
    },
  };
}

/** A pool of `n` in-process evaluators; counts the planes and samples sent to them. */
export function fakePool(n: number, seed: number, options: EvaluatorPoolOptions = {}) {
  const rand = random(seed);
  const sent = { planes: 0, samples: 0 };
  const endpoints: CoordinatorEndpoint[] = [];
  for (let i = 0; i < n; i++) {
    const down = lane<ToEvaluator>(rand);
    const up = lane<FromEvaluator>(rand);
    const evaluator: EvaluatorEndpoint = { send: up.send, listen: down.listen };
    serveEvaluator(evaluator);
    endpoints.push({
      send: (m) => {
        if (m.type === "planes") sent.planes += m.planes.length;
        if (m.type === "samples") sent.samples += m.values.length;
        down.send(m);
      },
      listen: up.listen,
    });
  }
  return { pool: new EvaluatorPool(endpoints, options), sent };
}

/** Null when exactly equal: the same keys and every number the same bits (slices left out). */
export function sameBits(a: unknown, b: unknown, path = "", skip = new Set(["slices"])): string | null {
  if (typeof a === "number" && typeof b === "number") return Object.is(a, b) ? null : `${path}: ${a} != ${b}`;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return a === b ? null : `${path}: ${String(a)} != ${String(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array and object`;
  const ka = Object.keys(a).filter((k) => !skip.has(k)).sort();
  const kb = Object.keys(b).filter((k) => !skip.has(k)).sort();
  if (ka.join() !== kb.join()) return `${path}: keys ${ka.join()} != ${kb.join()}`;
  for (const k of ka) {
    const d = sameBits((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, skip);
    if (d) return d;
  }
  return null;
}

export interface Run {
  fos: number | null;
  slope: Slope;
  /** Surfaces evaluated. */
  evaluated: number;
}

/** The sequential analysis, counting the surfaces evaluated. */
export function sequential(def: SlopeDefinition, options: Partial<AnalysisOptions>): Run {
  const slope = buildAnalysisSlope(def, options);
  let evaluated = 0;
  const fos = runStepsSync(analyseSlopeSteps(slope), (planes) => {
    evaluated += planes.length;
    evaluatePlanes(slope, planes);
  });
  return { fos, slope, evaluated };
}

/** The analysis on a fake pool of `n` evaluators. */
export async function parallel(
  def: SlopeDefinition,
  options: Partial<AnalysisOptions>,
  n: number,
  seed: number,
  poolOptions?: EvaluatorPoolOptions,
): Promise<Run & { sent: { planes: number; samples: number } }> {
  const { pool, sent } = fakePool(n, seed, poolOptions);
  const slope = buildAnalysisSlope(def, options);
  const fos = await pool.analyse(slope, def, options);
  pool.close();
  return { fos, slope, evaluated: pool.evaluated, sent };
}

/** The same result: FOS, count, every plane in order and the critical slices. */
export function expectSame(seq: Run, par: Run): void {
  expect(Object.is(par.fos, seq.fos)).toBe(true);
  expect(par.evaluated).toBe(seq.evaluated);
  expect(par.slope.search.length).toBe(seq.slope.search.length);
  expect(sameBits(seq.slope.search, par.slope.search)).toBeNull();
  const critical = (s: Slope): SearchPlane | undefined => s.search.find((p) => p.fos != null);
  const a = critical(seq.slope);
  const b = critical(par.slope);
  expect(b?.slices?.length).toBe(a?.slices?.length);
  // the critical slices, restored by the coordinator, as the sequential run has them
  expect(sameBits(a?.slices, b?.slices, "slices", new Set())).toBeNull();
}

/** A verification problem's definition, canonical. */
export function problem(id: string): SlopeDefinition {
  const c = VERIFICATION_CASES.find((v) => v.id === id);
  if (!c) throw new Error(id);
  return toCanonicalSlopeDefinition(c.definition);
}

/** Shorter searches than the verification runs: the comparison is the point, not the minimum. */
export const SHORT: Partial<AnalysisOptions> = { iterations: 300, refinedIterations: 200 };
