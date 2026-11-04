/**
 * Helpers of the engine's TypeScript API (the facade). Each module of src/
 * keeps the TypeScript types and data of the engine and implements its
 * functions by calling the Rust engine (`engine()`, WebAssembly): this
 * directory has what they share (value conversion, handles, slices in bulk,
 * material identity). ARCHITECTURE.md §3 and PORTING.md ("The limit
 * equilibrium facade", "FE facade") describe the boundary.
 */
import { engine } from "../engine";

export { engine as wasm };

/** A list of numbers from the engine (a Float64Array) as an array. */
export function list(values: ArrayLike<number>): number[] {
  return Array.from(values);
}

/** A point from the engine (a Float64Array of two) as a tuple. */
export function pt(values: ArrayLike<number>): [number, number] {
  return [values[0], values[1]];
}

/** `undefined` from the engine's `Option` as `null`. */
export function orNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * A value from the engine (a copy) with the parts that equal the input's
 * replaced by the input's own objects, so that, as in TypeScript, what a
 * function leaves unchanged keeps its identity (`toCanonicalSlopeDefinition`
 * of a left-to-right definition keeps its coordinates). The top level is
 * the engine's object, unless `whole` and it equals the input (a function
 * that returns its argument itself when it has nothing to change).
 */
export function shareUnchanged<T>(input: unknown, output: T, whole = false): T {
  if (whole && same(input, output)) return input as T;
  if (typeof output !== "object" || output === null || typeof input !== "object" || input === null) return output;
  const out = output as Record<string, unknown>;
  const inp = input as Record<string, unknown>;
  for (const k of Object.keys(out)) {
    if (!(k in inp)) continue;
    if (same(inp[k], out[k])) out[k] = inp[k];
    else if (!Array.isArray(out[k])) shareUnchanged(inp[k], out[k]);
  }
  return output;
}

const NO_TESTING =
  "needs the testing build of the engine (packages/engine/src/wasm-testing, `bun packages/engine-rs/tools/build-wasm.ts testing`)";

/**
 * Calls an internal engine function of the testing build (`__test_call`).
 * `name` is "<module path>::<TypeScript name>"; `args` lists every
 * parameter (undefined for an omitted optional one).
 */
export function testCall<T>(name: string, args: unknown[]): T {
  return testingEngine(name).__test_call(name, args) as T;
}

/** The exports only the testing build has. */
export interface TestingExports {
  __test_call(name: string, args: unknown): unknown;
  __test_functions(): string[];
  engine_panic_for_test(): void;
}

/** The testing build's exports; `what` names the caller in the error without it. */
export function testingEngine(what = "This"): TestingExports {
  const e = engine() as unknown as Partial<TestingExports>;
  if (!e.__test_call) throw new Error(`${what} ${NO_TESTING}`);
  return e as TestingExports;
}
