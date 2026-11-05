import { describe, expect, it } from "vitest";
import { isLegacyEntry, normalizeBackgrounds, placementLabel, translateCalibration } from "./placement";
import { imageSize } from "./image-size";
import { boundedScale, MAX_RASTER_PIXELS, MAX_RASTER_SIDE, MAX_TIFF_PIXELS, openDrawingSource, sniffDrawingMime, tiffTooLarge } from "./sources";

const entry = {
  id: "drawing-1",
  assetId: "a1",
  name: "Section A-A",
  page: 2,
  crop: { x0: 10, y0: 20, x1: 300, y1: 200 },
  calibration: { mode: "axes", points: [], axes: { x: [{ source: [1, 2], value: 0 }], y: [{ source: [1, 2], value: 5 }], reuseFrom: "m/d" } },
  transform: { a: 0.1, b: 0, c: 0, d: -0.05, e: 1, f: 2 },
  opacity: 0.4,
  visible: false,
  order: 3,
  showInResults: true,
};

describe("backgrounds.json read", () => {
  it("reads an entry of this form as it is", () => {
    expect(normalizeBackgrounds([entry])).toEqual([entry]);
  });

  it("validates each member: unusable entries dropped, the rest defaulted or clamped", () => {
    const out = normalizeBackgrounds([
      { ...entry, id: "bad id!", crop: { x0: 5, y0: 5, x1: 5, y1: 9 }, page: 0, opacity: -1, name: " ", calibration: { mode: "warp" }, showInResults: "yes" },
      { ...entry, id: "drawing-1", transform: { a: 1, b: 2, c: 2, d: 4, e: 0, f: 0 } },
      { ...entry, transform: { a: "1" } },
      { ...entry, assetId: "../x" },
      "not an object",
      { ...entry, crop: { x0: 300, y0: 200, x1: 10, y1: 20 } },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      id: "drawing-1",
      assetId: "a1",
      calibration: { mode: "drawing", points: [] },
      transform: entry.transform,
      opacity: 0,
      visible: false,
      order: 3,
    });
    // ids made unique; a reversed crop normalized
    expect(out[1].id).toBe("drawing-1-1");
    expect(out[1].crop).toEqual({ x0: 10, y0: 20, x1: 300, y1: 200 });
    expect(normalizeBackgrounds({})).toEqual([]);
  });

  it("converts an entry of the first form with its image's size", () => {
    const old = { assetId: "a1", transform: { originX: 0, originY: 0, scale: 0.1, rotationDeg: 0, mirrored: false }, opacity: 0.6, visible: true, order: 0 };
    expect(isLegacyEntry(old)).toBe(true);
    expect(isLegacyEntry(entry)).toBe(false);
    const [b] = normalizeBackgrounds([old], () => ({ width: 200, height: 100 }));
    expect(b).toEqual({ id: "drawing-1", assetId: "a1", calibration: { mode: "drawing", points: [] }, transform: { a: 0.1, b: 0, c: 0, d: -0.1, e: 0, f: 10 }, opacity: 0.6, visible: true, order: 0 });
    // without a size, the top-left corner is at the origin
    expect(normalizeBackgrounds([old])[0].transform.f).toBe(0);
    expect(normalizeBackgrounds([{ ...old, transform: { ...old.transform, scale: -1 } }])).toEqual([]);
  });
});

describe("placement helpers", () => {
  it("moves a calibration with its drawing", () => {
    const moved = translateCalibration(
      { mode: "axes", points: [{ source: [1, 1], model: [2, 3] }], axes: { x: [{ source: [0, 0], value: 1 }], y: [{ source: [0, 0], value: 2 }] } },
      10,
      -1,
    );
    expect(moved.points[0].model).toEqual([12, 2]);
    expect(moved.axes?.x[0].value).toBe(11);
    expect(moved.axes?.y[0].value).toBe(1);
  });

  it("names a placement by its name, else the file and page", () => {
    expect(placementLabel({ name: "Mine" }, "x.pdf")).toBe("Mine");
    expect(placementLabel({ page: 2 }, "x.pdf")).toBe("x.pdf, page 2");
    expect(placementLabel({}, "x.png")).toBe("x.png");
    expect(placementLabel({})).toBe("Drawing");
  });
});

describe("drawing files", () => {
  const bytes = (...v: number[]) => new Uint8Array(v);

  it("tells the type by the first bytes", () => {
    expect(sniffDrawingMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffDrawingMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffDrawingMime(bytes(0x49, 0x49, 0x2a, 0))).toBe("image/tiff");
    expect(sniffDrawingMime(bytes(0x4d, 0x4d, 0, 0x2a))).toBe("image/tiff");
    expect(sniffDrawingMime(new TextEncoder().encode("\n%PDF-1.7\n"))).toBe("application/pdf");
    expect(sniffDrawingMime(new TextEncoder().encode("GIF89a"))).toBeNull();
  });

  it("reads an image's size from its header", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47]);
    new DataView(png.buffer).setUint32(16, 640);
    new DataView(png.buffer).setUint32(20, 480);
    expect(imageSize(png)).toEqual({ width: 640, height: 480 });
    // JPEG: an APP0 segment, then SOF0 (height, width)
    const jpg = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x01, 0x00, 0x02, 0x00, 3, 0, 0);
    expect(imageSize(jpg)).toEqual({ width: 512, height: 256 });
    const gif = new Uint8Array(10);
    gif.set(new TextEncoder().encode("GIF89a"));
    new DataView(gif.buffer).setUint16(6, 30, true);
    new DataView(gif.buffer).setUint16(8, 20, true);
    expect(imageSize(gif)).toEqual({ width: 30, height: 20 });
    // TIFF (little-endian): one IFD with ImageWidth (SHORT) and ImageLength (LONG)
    const tif = new Uint8Array(8 + 2 + 24);
    const dv = new DataView(tif.buffer);
    tif.set([0x49, 0x49, 0x2a, 0]);
    dv.setUint32(4, 8, true);
    dv.setUint16(8, 2, true);
    dv.setUint16(10, 256, true);
    dv.setUint16(12, 3, true);
    dv.setUint16(18, 1200, true);
    dv.setUint16(22, 257, true);
    dv.setUint16(24, 4, true);
    dv.setUint32(30, 900, true);
    expect(imageSize(tif)).toEqual({ width: 1200, height: 900 });
    expect(imageSize(bytes(1, 2, 3))).toBeNull();
  });

  it("bounds a raster's size", () => {
    expect(boundedScale(100, 100, 2)).toBe(2);
    expect(boundedScale(10000, 10, 2) * 10000).toBeLessThanOrEqual(MAX_RASTER_SIDE);
    const s = boundedScale(5000, 5000, 4);
    expect(5000 * 5000 * s * s).toBeLessThanOrEqual(MAX_RASTER_PIXELS + 1);
  });
});

/** A little-endian TIFF with the given tags (LONG values), its data left out. */
function tiffOf(tags: Record<number, number[]>): Uint8Array {
  const ids = Object.keys(tags).map(Number).sort((a, b) => a - b);
  const ifdAt = 8;
  let extraAt = ifdAt + 2 + ids.length * 12 + 4;
  const out = new Uint8Array(extraAt + ids.reduce((n, id) => n + (tags[id].length > 1 ? tags[id].length * 4 : 0), 0) + 16);
  const v = new DataView(out.buffer);
  out.set([0x49, 0x49, 0x2a, 0]);
  v.setUint32(4, ifdAt, true);
  v.setUint16(ifdAt, ids.length, true);
  ids.forEach((id, i) => {
    const at = ifdAt + 2 + i * 12;
    const values = tags[id];
    v.setUint16(at, id, true);
    v.setUint16(at + 2, 4, true); // LONG
    v.setUint32(at + 4, values.length, true);
    if (values.length === 1) v.setUint32(at + 8, values[0], true);
    else {
      v.setUint32(at + 8, extraAt, true);
      values.forEach((x, k) => v.setUint32(extraAt + k * 4, x, true));
      extraAt += values.length * 4;
    }
  });
  return out;
}

describe("TIFF drawings", () => {
  it("refuses an image whose header declares too many pixels, before decoding it", async () => {
    const strip = (w: number, h: number, bits: number[] = [8]) =>
      tiffOf({ 256: [w], 257: [h], 258: bits, 259: [1], 262: [1], 273: [8], 277: [bits.length], 278: [h], 279: [16] });
    // 30000 × 30000: 900 MP (3.6 GB as RGBA) declared in a file of a hundred bytes
    const bomb = strip(30000, 30000);
    expect(bomb.length).toBeLessThan(300);
    await expect(openDrawingSource(bomb, "image/tiff")).rejects.toThrow(/too large to show \(30000 × 30000 pixels, 900 MP; at most 60 MP\)/);
    // the samples' bits count too, as the decoder takes them
    await expect(openDrawingSource(strip(100, 100, new Array(64).fill(8)), "image/tiff")).rejects.toThrow(/512 bits per pixel/);
    expect(tiffTooLarge({ t256: [7000], t257: [8000], t258: [8, 8, 8] })).toBeNull();
    expect(tiffTooLarge({ t256: [7000], t257: [8000], t258: [32, 32, 32, 32] })).toMatch(/128 bits per pixel/);
    expect(tiffTooLarge({ t256: [100], t257: [100], t259: [1], t262: [32803], t278: [100], t279: [1e9] })).toMatch(/bits per pixel/);
    expect(tiffTooLarge({ t256: [0], t257: [100] })).toMatch(/too large/);
    expect(MAX_TIFF_PIXELS).toBeLessThanOrEqual(60e6);
  });
});
