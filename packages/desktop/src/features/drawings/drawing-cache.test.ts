/**
 * The drawing cache follows the project: opening another project or
 * starting a new one (adoptProjectAssets) drops the opened files (each
 * disposed: a PDF's document in the pdf.js worker, decoded images), the
 * rasters and the line work of the previous one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingSource } from "./sources";

const disposed: string[] = [];
const opened: string[] = [];

vi.mock("./sources", async (orig) => ({
  ...(await orig<typeof import("./sources")>()),
  openDrawingSource: async (bytes: Uint8Array): Promise<DrawingSource> => {
    const name = new TextDecoder().decode(bytes);
    opened.push(name);
    return {
      kind: "image",
      unit: "px",
      pageCount: 1,
      fixedResolution: true,
      pageSize: () => ({ width: 10, height: 10 }),
      loadPageSize: async () => ({ width: 10, height: 10 }),
      render: async () => ({ image: {} as CanvasImageSource, width: 10, height: 10, region: { x0: 0, y0: 0, x1: 10, y1: 10 }, scale: 1 }),
      vectors: async () => null,
      texts: async () => [],
      dispose: () => disposed.push(name),
    };
  },
}));

const { adoptProjectAssets } = await import("./asset-registry");
const { drawingSource, peekSource, setAssetLoader } = await import("./drawing-cache");

afterEach(() => {
  adoptProjectAssets([]);
  disposed.length = 0;
  opened.length = 0;
});

describe("the drawing cache across projects", () => {
  it("is cleared, its opened files disposed, when another project's drawings are adopted", async () => {
    let project = "first";
    setAssetLoader(async (id) => ({ bytes: new TextEncoder().encode(`${project}:${id}`), mime: "image/png" }));
    await drawingSource("a1");
    expect(peekSource("a1")).not.toBeNull();
    expect(opened).toEqual(["first:a1"]);

    project = "second";
    adoptProjectAssets([]);
    expect(disposed).toEqual(["first:a1"]);
    // The same id in the next project is opened afresh.
    expect(peekSource("a1")).toBeNull();
    await drawingSource("a1");
    expect(opened).toEqual(["first:a1", "second:a1"]);
  });

  it("disposes a file that finishes opening after the cache was cleared", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    setAssetLoader(async (id) => {
      await gate;
      return { bytes: new TextEncoder().encode(`late:${id}`), mime: "image/png" };
    });
    const pending = drawingSource("b1");
    adoptProjectAssets([]);
    release();
    await pending;
    expect(disposed).toEqual(["late:b1"]);
  });
});
