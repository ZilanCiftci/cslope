/**
 * The DWG reader worker's handling of a request (dwg.worker.ts), apart from
 * the worker so that it can be tested in-process.
 */
import type { DwgWorkerRequest, DwgWorkerResponse } from "./dwg-reader";

/**
 * What the worker does with a request: starts the reader (`start`, once;
 * again on the next request if it failed, and the worker says it is
 * broken), then reads the file.
 */
export function dwgRequestHandler(
  start: () => Promise<unknown>,
  read: { drawing: (bytes: Uint8Array) => string; vectors: (bytes: Uint8Array) => string },
): (request: DwgWorkerRequest) => Promise<DwgWorkerResponse> {
  let ready: Promise<unknown> | undefined;
  return async (request) => {
    try {
      ready ??= start();
      await ready;
    } catch (err) {
      ready = undefined;
      return { ok: false, error: `The DWG reader could not be started${err instanceof Error && err.message ? `: ${err.message}` : ""}.`, trapped: false, broken: true };
    }
    try {
      return { ok: true, json: request instanceof Uint8Array ? read.drawing(request) : read.vectors(request.bytes) };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        trapped: err instanceof WebAssembly.RuntimeError,
      };
    }
  };
}
