/// <reference types="node" />
/**
 * DWG import: the committed DWG reader (src/dwg-wasm, packages/dwg-rs) on a
 * small drawing that acadrust wrote (fixtures/slope-section.dwg, made by
 * packages/dwg-rs/tests/read.rs `write_fixture`), run in-process in place of
 * the worker; and the reader client's handling of a trap and of a reader
 * that does not answer.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as glue from "../../dwg-wasm/cslope_dwg.js";
import { useAppStore } from "../../store/app-store";
import { DWG_READ_TIMEOUT_MS, readDwgFile, setDwgWorkerFactory, type DwgWorkerResponse } from "./dwg-reader";
import { importDwg } from "./importDwg";
import { dwgRequestHandler } from "./dwg-worker-handler";

// (vitest runs from packages/desktop; under jsdom import.meta.url is not a file URL)
const file = (path: string) => new Uint8Array(readFileSync(join(process.cwd(), path)));

/** A stand-in for a Worker that answers each message with `answer`. */
function fakeWorker(answer: (bytes: Uint8Array) => DwgWorkerResponse | undefined) {
  const w = {
    onmessage: null as ((e: { data: DwgWorkerResponse }) => void) | null,
    onerror: null,
    terminate: vi.fn(),
    postMessage(bytes: Uint8Array) {
      const r = answer(bytes);
      if (r) queueMicrotask(() => w.onmessage?.({ data: r }));
    },
  };
  return w;
}

/** What dwg.worker.ts does, in this thread. */
const inProcess = (bytes: Uint8Array): DwgWorkerResponse => {
  try {
    return { ok: true, json: glue.readDwg(bytes) };
  } catch (err) {
    return { ok: false, error: (err as Error).message, trapped: err instanceof WebAssembly.RuntimeError };
  }
};

describe("importDwg", () => {
  beforeAll(() => {
    glue.initSync({ module: file("src/dwg-wasm/cslope_dwg_bg.wasm") });
  });
  afterEach(() => vi.useRealTimers());

  it("adds a model with the outline, the chained boundary and the water line", async () => {
    setDwgWorkerFactory(() => fakeWorker(inProcess) as unknown as Worker);
    useAppStore.getState().newProject();
    const message = await importDwg(file("src/features/project/fixtures/slope-section.dwg"), "slope-section.dwg");
    const s = useAppStore.getState();
    expect(s.models.find((m) => m.id === s.activeModelId)!.name).toBe("slope-section");
    expect(s.coordinates).toHaveLength(6);
    expect(s.orientation).toBe("rtl");
    // Two LINEs on one layer, chained into one boundary.
    expect(s.materialBoundaries).toHaveLength(1);
    expect(s.materialBoundaries[0].coordinates).toHaveLength(3);
    expect(s.piezometricLine.lines).toHaveLength(1);
    expect(message).toContain("1 ARC");
    expect(message).toContain("AutoCAD 2004 (AC1018)");
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it("rejects a file that is not a DWG drawing, with the reason", async () => {
    setDwgWorkerFactory(() => fakeWorker(inProcess) as unknown as Worker);
    await expect(importDwg(new TextEncoder().encode("0\nSECTION\n"), "x.dwg")).rejects.toThrow(/Not a DWG file/);
  });

  it("discards a reader that trapped and starts a new one for the next file", async () => {
    const workers: ReturnType<typeof fakeWorker>[] = [];
    let trap = true;
    setDwgWorkerFactory(() => {
      const w = fakeWorker((bytes) => (trap ? { ok: false, error: "unreachable", trapped: true } : inProcess(bytes)));
      workers.push(w);
      return w as unknown as Worker;
    });
    await expect(readDwgFile(new Uint8Array([1]))).rejects.toThrow(/may be damaged/);
    expect(workers[0].terminate).toHaveBeenCalled();
    trap = false;
    const d = await readDwgFile(file("src/features/project/fixtures/slope-section.dwg"));
    expect(workers).toHaveLength(2);
    expect(d.version).toBe("AC1018");
    expect(d.insunits).toBe(6);
  });

  it("a reader that cannot be started is started again on the next request, and its worker is replaced", async () => {
    let starts = 0;
    const handle = dwgRequestHandler(
      async () => {
        if (++starts === 1) throw new Error("no memory");
      },
      { drawing: () => "{}", vectors: () => "[]" },
    );
    const first = await handle(new Uint8Array([1]));
    expect(first).toEqual({ ok: false, error: "The DWG reader could not be started: no memory.", trapped: false, broken: true });
    expect(await handle(new Uint8Array([1]))).toEqual({ ok: true, json: "{}" });
    expect(await handle({ vectors: true, bytes: new Uint8Array([1]) })).toEqual({ ok: true, json: "[]" });
    expect(starts).toBe(2);

    // the client discards a broken worker and starts a new one for the next file
    const workers: ReturnType<typeof fakeWorker>[] = [];
    setDwgWorkerFactory(() => {
      const w = fakeWorker((bytes) => (workers.length === 1 ? first : inProcess(bytes)));
      workers.push(w);
      return w as unknown as Worker;
    });
    await expect(readDwgFile(new Uint8Array([1]))).rejects.toThrow("The DWG reader could not be started: no memory.");
    expect(workers[0].terminate).toHaveBeenCalled();
    expect((await readDwgFile(file("src/features/project/fixtures/slope-section.dwg"))).version).toBe("AC1018");
    expect(workers).toHaveLength(2);
  });

  it("gives up on a reader that does not answer", async () => {
    vi.useFakeTimers();
    const w = fakeWorker(() => undefined);
    setDwgWorkerFactory(() => w as unknown as Worker);
    const read = readDwgFile(new Uint8Array([1]));
    const failed = expect(read).rejects.toThrow(/took more than/);
    await vi.advanceTimersByTimeAsync(DWG_READ_TIMEOUT_MS + 1);
    await failed;
    expect(w.terminate).toHaveBeenCalled();
  });
});
