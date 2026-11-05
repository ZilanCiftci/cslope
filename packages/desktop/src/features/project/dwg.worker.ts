/**
 * DWG reader worker: runs the DWG reader's WebAssembly (packages/dwg-rs,
 * built on acadrust) off the main thread, so that a large or damaged
 * drawing cannot freeze the window. The worker and its WebAssembly are
 * loaded on the first DWG import only. A panic in the reader traps the
 * instance; the worker says so, and the client (dwg-reader.ts) discards it.
 * A reader that cannot be started is tried again on the next request, and
 * the worker says it is broken (the client replaces it).
 */

import init, { readDwg, readDwgVectors } from "../../dwg-wasm/cslope_dwg.js";
import wasmBase64 from "../../dwg-wasm/cslope_dwg_bg.wasm?base64";
import type { DwgWorkerRequest } from "./dwg-reader";
import { dwgRequestHandler } from "./dwg-worker-handler";

function base64Bytes(base64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const handle = dwgRequestHandler(() => init({ module_or_path: base64Bytes(wasmBase64) }), { drawing: readDwg, vectors: readDwgVectors });

self.onmessage = async (event: MessageEvent<DwgWorkerRequest>) => {
  self.postMessage(await handle(event.data));
};
