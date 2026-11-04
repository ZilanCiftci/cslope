/**
 * Helpers of the model modules over the engine: slices and planes in and out of
 * the engine, written back onto the caller's objects where TypeScript
 * changes them in place.
 */
import type { Slice } from "../types/geometry";
import type { SearchPlane } from "../model/slope";
import type { Slope as TsSlope } from "../model/slope";
import type { PlaneSteps } from "../model/steps";
import { wasm } from "./internal";
import { Slope } from "../model/slope";
import { decodeSlices, type PlanesWire, type SlicesWire } from "./slice-codec";

/** The facade's slope of a slope argument (typed as the original's). */
export function facadeSlope(slope: TsSlope | Slope): Slope {
  return slope as unknown as Slope;
}

/** The handle of a slope argument. */
export function h(slope: TsSlope | Slope): number {
  return facadeSlope(slope)._h;
}

/** Sets `target`'s fields to `source`'s, deleting those it does not have. */
function replaceFields(target: object, source: object, keep: readonly string[]): void {
  const t = target as Record<string, unknown>;
  for (const k of Object.keys(t)) if (!keep.includes(k) && !(k in source)) delete t[k];
  for (const [k, v] of Object.entries(source)) if (!keep.includes(k)) t[k] = v;
}

/**
 * Writes slices the engine returned onto the caller's slices (TypeScript's
 * solvers change them in place); the materials stay the caller's.
 */
export function writeBackSlices(target: Slice[], out: SlicesWire): void {
  const raw = decodeSlices(out);
  for (let i = 0; i < target.length && i < raw.length; i++) replaceFields(target[i], raw[i], ["baseMaterial"]);
}

/**
 * Writes planes the engine evaluated onto the caller's planes, as
 * evaluatePlanes changes them in place (its slices as new objects).
 */
export function writeBackPlanes(slope: Slope, target: SearchPlane[], out: PlanesWire): void {
  const planes = slope._planes(out);
  for (let i = 0; i < target.length && i < planes.length; i++) replaceFields(target[i], planes[i], []);
}

/** `{ result, slices }` of a call that changes the slices. */
export interface WithSlices<T> {
  result: T;
  slices: SlicesWire;
}

/** Calls `f` with the slices for the engine and writes them back. */
export function onSlices<T>(slope: TsSlope | Slope, slices: Slice[], f: (wire: SlicesWire) => WithSlices<T>): T {
  const r = f(facadeSlope(slope)._slicesOut(slices));
  writeBackSlices(slices, r.slices);
  return r.result;
}

/**
 * The engine's steps as a generator: each batch is yielded as planes of
 * this slope, evaluated in place by the driver and handed back to the
 * engine on the next resume.
 */
export function* engineSteps<T>(slope: TsSlope | Slope, steps: number, done: (r: { fos?: number | null; planes?: PlanesWire }) => T): PlaneSteps<T> {
  const s = facadeSlope(slope);
  try {
    let back: PlanesWire | undefined;
    for (;;) {
      const r = wasm().steps_resume(steps, back) as { done: boolean; batch?: PlanesWire; fos?: number | null; planes?: PlanesWire };
      if (r.done) return done(r);
      const batch = s._planes(r.batch!);
      yield batch;
      back = s._planesOut(batch);
    }
  } finally {
    wasm().steps_free(steps);
  }
}

/**
 * The engine's side of a caller's evaluate function: planes in, the planes
 * as `evaluate` left them out. The slope's materials get their objects
 * first, as the engine holds the slope while it calls this.
 */
export function bridge(slope: Slope, evaluate: (planes: SearchPlane[]) => void): (wire: PlanesWire) => PlanesWire {
  slope._bindMaterials();
  return (wire) => {
    const planes = slope._planes(wire);
    evaluate(planes);
    return slope._planesOut(planes);
  };
}

export { Slope };
