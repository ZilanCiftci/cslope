/**
 * DWG reader worker: runs the DWG reader's WebAssembly (packages/dwg-rs,
 * built on acadrust) off the main thread, so that a large or damaged
 * drawing cannot freeze the window. The worker and its WebAssembly are
 * loaded on the first DWG import only. A panic in the reader traps the
 * instance; the worker says so, and the client (dwg-reader.ts) discards it.
 */

import init, { readDwg } from "../../dwg-wasm/cslope_dwg.js";
import wasmBase64 from "../../dwg-wasm/cslope_dwg_bg.wasm?base64";
import type { DwgWorkerResponse } from "./dwg-reader";

let ready: Promise<unknown> | undefined;

function base64Bytes(base64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

self.onmessage = async (event: MessageEvent<Uint8Array>) => {
  let response: DwgWorkerResponse;
  try {
    ready ??= init({ module_or_path: base64Bytes(wasmBase64) });
    await ready;
    response = { ok: true, json: readDwg(event.data) };
  } catch (err) {
    response = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      trapped: err instanceof WebAssembly.RuntimeError,
    };
  }
  self.postMessage(response);
};
