/**
 * The Rust engine as WebAssembly (ARCHITECTURE.md §3.2): one asynchronous
 * start, then a synchronous API.
 *
 *   await initEngine();              // Node/Bun: reads src/wasm from disk
 *   await initEngine(bytes);         // the app's main thread
 *   initEngineSync(engineModule());  // a worker, given the compiled module
 *
 * The modules of src/ call the exports through `engine()` (src/facade has
 * the helpers). The app starts the engine in main.tsx and posts the
 * compiled module to its workers; the tests start the testing build in
 * their setup file.
 */
import * as glue from "./wasm/cslope_wasm.js";

/** The wasm bytes, or the module compiled from them. */
export type WasmSource = BufferSource | WebAssembly.Module;

/** The exports of the engine (the testing build adds `__test_call`). */
export type EngineExports = typeof glue;

const NOT_READY = "The cSlope engine is not initialised: call initEngine() first.";
const BROKEN = "The cSlope engine stopped after an internal error (see the console); it restarts on the next call, and objects made before must be built again.";

let compiled: WebAssembly.Module | undefined;
let exportsProxy: EngineExports | undefined;
let broken = false;
let epoch = 0;

function isModule(source: WasmSource): source is WebAssembly.Module {
  // also a module from another realm (instanceof would not see it)
  return Object.prototype.toString.call(source) === "[object WebAssembly.Module]";
}

/**
 * The bytes as a Uint8Array of this realm. jsdom replaces the typed-array
 * constructors, and WebAssembly rejects a buffer from another realm, so
 * the bytes are copied (once per start, about 1 MB).
 */
function ownBytes(source: BufferSource): Uint8Array<ArrayBuffer> {
  const view = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer as ArrayBuffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source as ArrayBuffer);
  const copy = new Uint8Array(view.length);
  copy.set(view);
  return copy;
}

function compile(source: WasmSource): WebAssembly.Module {
  return isModule(source) ? source : new WebAssembly.Module(ownBytes(source));
}

/** A trap (a panic in Rust) leaves the instance unusable: note it. */
function guard<F extends (...a: never[]) => unknown>(f: F): F {
  return ((...args: never[]) => {
    if (broken) restart();
    try {
      return f(...args);
    } catch (e) {
      if (e instanceof WebAssembly.RuntimeError) broken = true;
      throw e;
    }
  }) as F;
}

function wrap(): EngineExports {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(glue)) {
    out[k] = typeof v === "function" && k !== "default" && k !== "initSync" && k !== "__wbg_reset" ? guard(v as (...a: never[]) => unknown) : v;
  }
  return out as EngineExports;
}

function instantiate(module: WebAssembly.Module): void {
  glue.initSync({ module });
  compiled = module;
  exportsProxy ??= wrap();
  broken = false;
  epoch++;
}

/** A new instance from the compiled module, after a trap. */
function restart(): void {
  if (!compiled) throw new Error(NOT_READY);
  console.error(BROKEN);
  glue.__wbg_reset();
  instantiate(compiled);
}

/**
 * Starts the engine synchronously (a worker given `engineModule()`, the
 * tests given the bytes). A second call is a no-op.
 */
export function initEngineSync(source: WasmSource): void {
  if (compiled) return;
  instantiate(compile(source));
}

/**
 * Starts the engine. Without a source it reads `src/wasm/cslope_wasm_bg.wasm`
 * from disk (Node and Bun scripts). The bytes are compiled asynchronously,
 * which a browser's main thread needs for a module of this size.
 */
export async function initEngine(source?: WasmSource): Promise<void> {
  if (compiled) return;
  let module: WebAssembly.Module;
  if (source === undefined) {
    // node:fs by a variable name, so that bundlers for the browser leave it
    // alone (and the engine needs no Node types); the file name too, or
    // Vite would emit the file as an asset
    const fs = "node:fs/promises";
    const file = "./wasm/cslope_wasm_bg.wasm";
    const { readFile } = (await import(/* @vite-ignore */ fs)) as { readFile(path: URL): Promise<Uint8Array<ArrayBuffer>> };
    const bytes = await readFile(new URL(file, import.meta.url));
    module = await WebAssembly.compile(ownBytes(bytes));
  } else {
    module = isModule(source) ? source : await WebAssembly.compile(ownBytes(source));
  }
  if (!compiled) instantiate(module);
}

/** The compiled module, to post to workers (`initEngineSync` there). */
export function engineModule(): WebAssembly.Module {
  if (!compiled) throw new Error(NOT_READY);
  return compiled;
}

export function isEngineReady(): boolean {
  return compiled !== undefined;
}

/**
 * The instance number: it changes when the engine restarts after a trap,
 * so the facade can refuse handles made by an earlier instance.
 */
export function engineEpoch(): number {
  return epoch;
}

/** The engine's exports (for the facade). */
export function engine(): EngineExports {
  if (!exportsProxy) throw new Error(NOT_READY);
  return exportsProxy;
}
