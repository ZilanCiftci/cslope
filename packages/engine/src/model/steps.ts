/**
 * A search written as steps: a generator that yields each batch of trial
 * surfaces it needs evaluated and reads their factors of safety when it
 * resumes. The surfaces of one batch are independent of each other, so a
 * driver may evaluate them in any order or at once; the search itself, and
 * so its result, does not change with the driver.
 *
 * - runStepsSync evaluates each batch in turn (analyseSlope, the default).
 * - runStepsAsync awaits an evaluator, e.g. a pool of workers that splits
 *   the batch (src/parallel).
 * - inParallel runs independent searches in lockstep and evaluates their
 *   batches together (the seeds of the non-circular optimisation).
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts): the drivers and
 * the lockstep combinator are plain generator code over the engine's
 * steps (facade/wire.ts `engineSteps`), the same as TypeScript's.
 */
import type { SearchPlane } from "./slope";

/** Steps of a search with result T: each yield is a batch to evaluate in place. */
export type PlaneSteps<T> = Generator<SearchPlane[], T, void>;

/** Evaluates planes in place (sets fos, null when invalid). */
export type Evaluate = (planes: SearchPlane[]) => void;

/** Evaluates planes in place, asynchronously. */
export type AsyncEvaluate = (planes: SearchPlane[]) => Promise<void>;

/** Runs the steps, evaluating each batch with `evaluate`. */
export function runStepsSync<T>(steps: PlaneSteps<T>, evaluate: Evaluate): T {
  for (let r = steps.next(); ; r = steps.next()) {
    if (r.done) return r.value;
    if (r.value.length > 0) evaluate(r.value);
  }
}

/** Runs the steps, awaiting `evaluate` on each batch. */
export async function runStepsAsync<T>(steps: PlaneSteps<T>, evaluate: AsyncEvaluate): Promise<T> {
  for (let r = steps.next(); ; r = steps.next()) {
    if (r.done) return r.value;
    if (r.value.length > 0) await evaluate(r.value);
  }
}

/**
 * Independent searches in lockstep: the batches each yields at one step
 * are evaluated together, and the results come back in the order of
 * `searches`. A search must not read the surfaces of another.
 */
export function* inParallel<T>(searches: PlaneSteps<T>[]): PlaneSteps<T[]> {
  const results = new Array<T>(searches.length);
  let waiting: { index: number; batch: SearchPlane[] }[] = [];
  const advance = (index: number) => {
    const r = searches[index].next();
    if (r.done) results[index] = r.value;
    else waiting.push({ index, batch: r.value });
  };
  for (let i = 0; i < searches.length; i++) advance(i);
  while (waiting.length > 0) {
    const step = waiting;
    waiting = [];
    yield step.flatMap((s) => s.batch);
    for (const s of step) advance(s.index);
  }
  return results;
}
