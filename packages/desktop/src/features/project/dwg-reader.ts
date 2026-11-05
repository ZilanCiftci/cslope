/**
 * Reads a DWG file in the DWG reader worker (dwg.worker.ts), which is
 * started on the first call. One file at a time; a reader that traps
 * (a panic in acadrust) or takes too long is discarded, and the next file
 * gets a new one.
 */

import type { DxfPolyline, DxfSegment } from "../../utils/dxf";
import type { NeutralVectors } from "../drawings/vectors";
import { ownBytes } from "../../utils/zip";

/** What the reader returns (packages/dwg-rs/src/lib.rs, `Drawing`). */
export interface DwgDrawing {
  /** The file's version code, e.g. "AC1032". */
  version: string;
  insunits: number;
  polylines: DxfPolyline[];
  segments: DxfSegment[];
  skipped: Record<string, number>;
  /** Polylines whose arc segments were read as straight lines. */
  bulgedPolylines: number;
  /** Entities in paper space (layouts), which are not read. */
  paperSpaceEntities: number;
  layers: string[];
  /** Problems the reader recovered from. */
  warnings: string[];
}

/** What the worker is sent: a file to import (its bytes), or one to read as line work (an underlay). */
export type DwgWorkerRequest = Uint8Array | { vectors: true; bytes: Uint8Array };

export type DwgWorkerResponse =
  | { ok: true; json: string }
  | { ok: false; error: string; trapped: boolean };

/** Longest a file may take to read. */
export const DWG_READ_TIMEOUT_MS = 60_000;

let worker: Worker | undefined;
let queue: Promise<unknown> = Promise.resolve();

let createWorker = (): Worker =>
  new Worker(new URL("./dwg.worker.ts", import.meta.url), { type: "module" });

/** For tests: a stand-in for the worker. */
export function setDwgWorkerFactory(factory: () => Worker): void {
  createWorker = factory;
  discard();
}

function discard(): void {
  worker?.terminate();
  worker = undefined;
}

function readOnce<T>(request: DwgWorkerRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const w = (worker ??= createWorker());
    const timer = setTimeout(() => {
      discard();
      reject(new Error(`Reading the DWG file took more than ${DWG_READ_TIMEOUT_MS / 1000} seconds; the file may be damaged.`));
    }, DWG_READ_TIMEOUT_MS);
    w.onmessage = (event: MessageEvent<DwgWorkerResponse>) => {
      clearTimeout(timer);
      const r = event.data;
      if (r.ok) {
        resolve(JSON.parse(r.json) as T);
        return;
      }
      if (r.trapped) {
        discard();
        reject(new Error("The DWG reader failed on this file: it may be damaged, or use a part of the format the reader does not handle."));
      } else {
        reject(new Error(r.error));
      }
    };
    w.onerror = (event: ErrorEvent) => {
      clearTimeout(timer);
      discard();
      reject(new Error(`The DWG reader could not be started${event.message ? `: ${event.message}` : ""}.`));
    };
    w.postMessage(request);
  });
}

/** The drawing of a DWG file; rejects with the reason it cannot be read. */
export function readDwgFile(bytes: Uint8Array): Promise<DwgDrawing> {
  const result = queue.then(() => readOnce<DwgDrawing>(ownBytes(bytes)));
  queue = result.catch(() => undefined);
  return result;
}

/**
 * The line work of a DWG file (an underlay: curves as polylines, blocks
 * expanded, texts; packages/dwg-rs/src/vectors.rs); rejects with the
 * reason it cannot be read.
 */
export function readDwgVectorsFile(bytes: Uint8Array): Promise<NeutralVectors> {
  const result = queue.then(() => readOnce<NeutralVectors>({ vectors: true, bytes: ownBytes(bytes) }));
  queue = result.catch(() => undefined);
  return result;
}
