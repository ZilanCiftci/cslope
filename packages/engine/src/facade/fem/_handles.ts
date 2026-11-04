/**
 * Helpers of the fem modules over the engine (ARCHITECTURE.md §2.2, §3.1):
 * the slope argument, size fields as engine data behind a function, the
 * facade's FeModel (an engine handle with lazily read typed-array fields),
 * and the option values that do not cross as data (callbacks, size fields,
 * solver binaries).
 */
import { engineEpoch } from "../../engine";
import { testCall, wasm } from "../internal";
import type { Slope } from "../../model/slope";
import type { FeModel } from "../../fem/model";

// ── slopes ───────────────────────────────────────────────────────────────

/** The slope argument of the FE exports: the engine slope's handle (the model facade's `Slope._h`). */
export function slopeRef(slope: Slope): { $slope: number } {
  const s = slope as unknown as { _h?: unknown };
  if (typeof s._h === "number") return { $slope: s._h };
  throw new Error("The finite element analysis needs a slope of the engine (buildSlope).");
}

// ── size fields ──────────────────────────────────────────────────────────

/** A size field as TypeScript has it: a function with its smallest value. */
export type SizeFieldFn = ((x: number, y: number) => number) & { min?: number };

interface SizeFieldHandle {
  handle: number;
  epoch: number;
}
const SIZE_FIELD = Symbol("cslope.sizeField");
const sizeFinalizer = new FinalizationRegistry<SizeFieldHandle>((h) => {
  if (h.epoch === engineEpoch()) wasm().size_field_free(h.handle);
});

/** The engine's size field `handle` as a function (x, y) => size with `min`. */
export function sizeFieldOf(handle: number): SizeFieldFn {
  const h: SizeFieldHandle = { handle, epoch: engineEpoch() };
  const fn = ((x: number, y: number) => wasm().size_field_at(live(h), x, y)) as SizeFieldFn & { [SIZE_FIELD]: SizeFieldHandle };
  const min = wasm().size_field_min(handle);
  if (min !== undefined) fn.min = min;
  Object.defineProperty(fn, SIZE_FIELD, { value: h });
  sizeFinalizer.register(fn, h);
  return fn;
}

function live(h: SizeFieldHandle): number {
  if (h.epoch !== engineEpoch()) throw new Error("The engine was restarted after an internal error; build the model again.");
  return h.handle;
}

/**
 * The engine handle of a size field option (undefined: none). Only the
 * engine's size fields (refinedSizeField, a result's sizeField) cross; a
 * JavaScript function has no counterpart in the engine (PORTING.md, FE
 * model: the size field is data).
 */
export function sizeFieldHandle(sf: unknown): number | undefined {
  if (sf === undefined || sf === null) return undefined;
  const h = (sf as { [SIZE_FIELD]?: SizeFieldHandle })[SIZE_FIELD];
  if (h) return live(h);
  throw new TypeError("sizeField must be a size field of the engine (refinedSizeField or a result's sizeField): the engine does not call JavaScript size functions.");
}

// ── options ──────────────────────────────────────────────────────────────

/** Fields of the options that are not data: passed on separately or not at all. */
const NOT_DATA = new Set(["sizeField", "onTrial", "onLevel", "onProgress", "clarabelWasm", "warmStart", "resume"]);

/** The options without the fields that are not data (callbacks, size fields, binaries, states). */
export function dataOptions<T extends object>(options: T | undefined): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(options ?? {})) if (!NOT_DATA.has(k) && typeof v !== "function") out[k] = v;
  return out as Partial<T>;
}

// ── FE models ────────────────────────────────────────────────────────────

const MODEL = Symbol("cslope.feModel");
interface ModelHandle {
  handle: number;
  epoch: number;
}
const modelFinalizer = new FinalizationRegistry<ModelHandle>((h) => {
  if (h.epoch === engineEpoch()) testCall("fem/model::$free", [h.handle]);
});

/** The fields of FeModel, read from the engine on first access. */
const MODEL_FIELDS = [
  "x", "y", "nodeCount", "cornerCount", "el", "elementCount", "materials", "elMaterial", "elE", "elNu", "elPsi", "elElastic",
  "gp", "gpX", "gpY", "gpC", "gpCu", "gpPhi", "gpU", "eq", "eqCount", "K", "f", "stress0", "loadNorm", "elInactive",
  "surfaceEdges", "triangulation", "sizeField", "seepage", "gpHoekBrown", "partialFactors", "gpC0", "gpPhi0", "piles",
  "warnings", "bars",
] as const;

/**
 * The facade's FeModel: the engine's model behind a handle, whose fields
 * (copies) are read when first used and kept until the engine changes the
 * model (`modelChanged`: the trials set the Hoek–Brown points' strength, as
 * TypeScript's runTrial does). Changing a field's array here does not
 * change the engine's model.
 */
class EngineFeModel {
  readonly [MODEL]: ModelHandle;
  private cache = new Map<string, unknown>();
  constructor(handle: number) {
    this[MODEL] = { handle, epoch: engineEpoch() };
    modelFinalizer.register(this, this[MODEL]);
  }
  /** @internal */ read(name: string): unknown {
    if (!this.cache.has(name)) {
      const v = testCall<unknown>("fem/model::$field", [modelHandle(this as unknown as FeModel), name]);
      this.cache.set(name, name === "sizeField" ? sizeFieldOf(v as number) : v);
    }
    return this.cache.get(name);
  }
  /** @internal */ changed(): void {
    this.cache.clear();
  }
}
for (const name of MODEL_FIELDS) {
  Object.defineProperty(EngineFeModel.prototype, name, {
    enumerable: true,
    get(this: EngineFeModel) {
      return this.read(name);
    },
  });
}

/** A model handle from the engine as the facade's FeModel. */
export function feModelOf(handle: number): FeModel {
  return new EngineFeModel(handle) as unknown as FeModel;
}

/** The engine handle of a facade FeModel. */
export function modelHandle(model: FeModel): number {
  const h = (model as unknown as { [MODEL]?: ModelHandle })[MODEL];
  if (!h) throw new TypeError("The model must come from buildFeModel or prepareFeModel of the engine.");
  if (h.epoch !== engineEpoch()) throw new Error("The engine was restarted after an internal error; build the model again.");
  return h.handle;
}

/** Drops the cached fields of a model the engine has changed. */
export function modelChanged(model: FeModel): void {
  (model as unknown as EngineFeModel).changed?.();
}

/** Throws for a module function that is not exported to the facade. */
export function notExported(name: string): never {
  throw new Error(
    `${name} is not exported to the facade: an internal kernel of the engine, tested in Rust (packages/engine-rs/crates/cslope-engine/tests).`,
  );
}
