import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundImage } from "../../store/types";

const image = { tag: "raster" } as unknown as CanvasImageSource;
const rasterFor = vi.fn();
vi.mock("./drawing-cache", () => ({
  rasterFor: (...args: unknown[]) => rasterFor(...args),
  placementExtent: (p: BackgroundImage) => p.crop ?? { x0: 0, y0: 0, x1: 400, y1: 300 },
  peekSource: () => null,
  vectorsFor: () => null,
}));

const { DARK_INVERT_FILTER, drawUnderlays, placementCanvasCorners, worldToCanvasAffine } = await import("./draw-underlays");
const { drawPdfUnderlays } = await import("./pdf-underlay");

/** A context that records what is done to it. */
function fakeContext() {
  const calls: { name: string; args: unknown[]; alpha: number; op: string; filter: string }[] = [];
  const ctx: Record<string, unknown> = { globalAlpha: 1, globalCompositeOperation: "source-over", filter: "none" };
  for (const name of ["save", "restore", "transform", "setTransform", "beginPath", "rect", "clip", "drawImage"]) {
    ctx[name] = (...args: unknown[]) =>
      calls.push({ name, args, alpha: ctx.globalAlpha as number, op: ctx.globalCompositeOperation as string, filter: ctx.filter as string });
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const placement = (over: Partial<BackgroundImage> = {}): BackgroundImage => ({
  id: "d1",
  assetId: "sheet",
  page: 2,
  crop: { x0: 10, y0: 20, x1: 210, y1: 120 },
  calibration: { mode: "drawing", points: [] },
  transform: { a: 0.1, b: 0, c: 0, d: -0.05, e: -1, f: 6 },
  opacity: 0.4,
  visible: true,
  order: 0,
  ...over,
});

// world → canvas: 20 px per m, origin at (100, 300), y down
const toCanvas = (x: number, y: number): [number, number] => [100 + 20 * x, 300 - 20 * y];

beforeEach(() => {
  rasterFor.mockReset();
  rasterFor.mockReturnValue({ image, width: 800, height: 600, region: { x0: 0, y0: 0, x1: 400, y1: 300 }, scale: 2 });
});

describe("drawing the placed drawings", () => {
  it("applies the placement's affine composed with the view, clips to the crop, at its opacity", () => {
    const { ctx, calls } = fakeContext();
    drawUnderlays(ctx, [placement()], toCanvas, { pixelRatio: 2 });
    const transform = calls.find((c) => c.name === "transform")!;
    // source → canvas: a = 20·0.1, d = −20·−0.05, e = 100 + 20·−1, f = 300 − 20·6
    expect(transform.args).toEqual([2, 0, 0, 1, 80, 180]);
    expect(calls.find((c) => c.name === "rect")!.args).toEqual([10, 20, 200, 100]);
    const draw = calls.find((c) => c.name === "drawImage")!;
    expect(draw.args).toEqual([image, 0, 0, 400, 300]);
    expect(draw.alpha).toBe(0.4);
    expect(draw.op).toBe("source-over");
    // the raster asked for: device pixels per source unit (√|det| × pixel ratio), page and crop
    expect(rasterFor).toHaveBeenCalledWith(expect.objectContaining({ assetId: "sheet", page: 2 }), Math.sqrt(2 * 1) * 2);
    // drawn inside save/restore
    expect(calls[0].name).toBe("save");
    expect(calls[calls.length - 1].name).toBe("restore");
  });

  it("draws nothing hidden, fully transparent, filtered out, or not ready yet; the rest in their order", () => {
    const { ctx, calls } = fakeContext();
    drawUnderlays(ctx, [placement({ visible: false }), placement({ id: "d2", opacity: 0 })], toCanvas);
    expect(calls).toEqual([]);
    drawUnderlays(ctx, [placement({ showInResults: false })], toCanvas, { include: (p) => p.visible && p.showInResults === true });
    expect(calls).toEqual([]);
    rasterFor.mockReturnValueOnce(null);
    drawUnderlays(ctx, [placement()], toCanvas);
    expect(calls).toEqual([]);
    drawUnderlays(ctx, [placement({ id: "top", order: 5, opacity: 0.9 }), placement({ id: "under", order: 1, opacity: 0.2 })], toCanvas);
    expect(calls.filter((c) => c.name === "drawImage").map((c) => c.alpha)).toEqual([0.2, 0.9]);
  });

  it("inverts an image or PDF drawing in the dark theme, unless its switch is off", () => {
    const filterOf = (p: BackgroundImage, dark: boolean) => {
      const { ctx, calls } = fakeContext();
      drawUnderlays(ctx, [p], toCanvas, { dark });
      return calls.find((c) => c.name === "drawImage")!.filter;
    };
    expect(filterOf(placement(), true)).toBe(DARK_INVERT_FILTER);
    expect(filterOf(placement({ invertInDark: true }), true)).toBe(DARK_INVERT_FILTER);
    expect(filterOf(placement({ invertInDark: false }), true)).toBe("none");
    expect(filterOf(placement(), false)).toBe("none");
  });

  it("finds the view's affine and a placement's corners on the canvas", () => {
    expect(worldToCanvasAffine(toCanvas)).toEqual({ a: 20, b: 0, c: 0, d: -20, e: 100, f: 300 });
    expect(placementCanvasCorners(placement(), toCanvas)).toEqual([
      [100 + 20 * (0.1 * 10 - 1), 300 - 20 * (-0.05 * 20 + 6)],
      [100 + 20 * (0.1 * 210 - 1), 300 - 20 * (-0.05 * 20 + 6)],
      [100 + 20 * (0.1 * 210 - 1), 300 - 20 * (-0.05 * 120 + 6)],
      [100 + 20 * (0.1 * 10 - 1), 300 - 20 * (-0.05 * 120 + 6)],
    ]);
  });
});

describe("the drawings in the PDF export", () => {
  it("adds one image over the plot frame, each drawing composed through its transform at its opacity", () => {
    const pdf = { addImage: vi.fn() };
    const raster = { image, width: 800, height: 600, region: { x0: 0, y0: 0, x1: 400, y1: 300 }, scale: 2 };
    const frame = { x: 20, y: 15, w: 250, h: 160 };
    const drawn = drawPdfUnderlays(pdf, [{ placement: placement(), raster }], (x, y) => [50 + 4 * x, 100 - 4 * y], frame, 2);
    expect(drawn).toBe(true);
    expect(pdf.addImage).toHaveBeenCalledTimes(1);
    const [canvas, format, x, y, w, h, , compression] = pdf.addImage.mock.calls[0];
    expect([format, x, y, w, h, compression]).toEqual(["PNG", 20, 15, 250, 160, "FAST"]);
    expect([(canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height]).toEqual([500, 320]);
  });

  it("adds nothing without drawings", () => {
    const pdf = { addImage: vi.fn() };
    expect(drawPdfUnderlays(pdf, [], (x, y) => [x, y], { x: 0, y: 0, w: 10, h: 10 })).toBe(false);
    expect(pdf.addImage).not.toHaveBeenCalled();
  });
});
