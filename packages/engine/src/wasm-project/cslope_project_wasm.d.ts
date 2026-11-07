/* tslint:disable */
/* eslint-disable */

/**
 * The `.cslp` project of a definition (JSON, in model coordinates) and
 * the result of its last analysis (JSON, or `null`: none; a result of
 * other input must not be given), with `args` (JSON: `{ id?, name,
 * options?, date?, modified, appVersion, generator, engine? }`). Returns
 * `{ bytes: Uint8Array, resultSaved: boolean }`: the result is left out
 * when the model would not read back as the definition. Throws an `Error`
 * with the reason when the definition cannot be made a model.
 */
export function project_from_definition(definition: string, result: string, args: string): any;

/**
 * Runs once when the module is instantiated: a panic (which aborts: the
 * instance traps) first writes its message to `console.error`.
 */
export function start(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly project_from_definition: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly start: () => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;

/** Forgets the instance (added by build-wasm.ts), so that initSync can instantiate again after a trap. */
export function __wbg_reset(): void;
