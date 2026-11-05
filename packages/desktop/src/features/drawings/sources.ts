/**
 * Drawing sources: what a drawing file is, page by page, in its own
 * units, and rasters of it. One adapter per kind of file:
 *
 *   image   PNG, JPEG (decoded by the browser), TIFF (UTIF.js, page per
 *           image of the file); units: pixels
 *   pdf     PDF pages (pdf.js, in a worker); units: points (1/72 in)
 *
 * A later vector adapter (DWG/DXF) slots in beside them: it gives page
 * sizes in its units and rasters of regions, as these do.
 *
 * Source coordinates have the origin at the top left of the page and y
 * downwards (the page as it is seen; a PDF page's /Rotate applied).
 */
import type { Crop } from "./transform";

export type SourceKind = "image" | "pdf";
export type SourceUnit = "px" | "pt";

/** The size of a page in source units. */
export interface PageSize {
  width: number;
  height: number;
}

/** A raster of part of a page: `image` covers `region` (source units) at `scale` pixels per unit. */
export interface Raster {
  image: CanvasImageSource;
  width: number;
  height: number;
  region: Crop;
  scale: number;
}

export interface DrawingSource {
  kind: SourceKind;
  unit: SourceUnit;
  pageCount: number;
  /** The size of a page (1-based), once known (the first page's always is). */
  pageSize(page: number): PageSize | null;
  /** The size of a page, read if needed. */
  loadPageSize(page: number): Promise<PageSize>;
  /**
   * A raster of a page's region at about `scale` pixels per source unit
   * (an image: the decoded image itself, whatever is asked).
   */
  render(page: number, scale: number, region?: Crop): Promise<Raster>;
  /** True when render() gives the same raster at every scale (an image). */
  fixedResolution: boolean;
  dispose(): void;
}

/** The kinds of drawing file the app places, by type. */
export const DRAWING_MIME: Record<string, SourceKind> = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/tiff": "image",
  "application/pdf": "pdf",
};

/** The file chooser's accept list. */
export const DRAWING_ACCEPT = ".png,.jpg,.jpeg,.tif,.tiff,.pdf,image/png,image/jpeg,image/tiff,application/pdf";

/** The type of a drawing file, from its first bytes (the name's extension is not trusted), or null. */
export function sniffDrawingMime(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a))) {
    return "image/tiff";
  }
  // "%PDF-" within the first kB (a header may come before it).
  const head = new TextDecoder("latin1").decode(b.subarray(0, Math.min(1024, b.length)));
  if (head.includes("%PDF-")) return "application/pdf";
  return null;
}

/** The largest raster side and area made (a GPU texture and memory bound). */
export const MAX_RASTER_SIDE = 8192;
export const MAX_RASTER_PIXELS = 40e6;

/** The scale a raster of a `w` × `h` region can have, at most `scale`, within the raster bounds. */
export function boundedScale(w: number, h: number, scale: number): number {
  let s = Math.max(scale, 1e-6);
  s = Math.min(s, MAX_RASTER_SIDE / Math.max(w, 1), MAX_RASTER_SIDE / Math.max(h, 1));
  if (w * h * s * s > MAX_RASTER_PIXELS) s = Math.sqrt(MAX_RASTER_PIXELS / Math.max(w * h, 1));
  return s;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// ── Images ──────────────────────────────────────────────────────────

/** An image page: the decoded picture. */
function imageSource(pages: { image: CanvasImageSource; width: number; height: number; close?: () => void }[]): DrawingSource {
  return {
    kind: "image",
    unit: "px",
    pageCount: pages.length,
    fixedResolution: true,
    pageSize: (page) => {
      const p = pages[page - 1];
      return p ? { width: p.width, height: p.height } : null;
    },
    loadPageSize: async (page) => {
      const p = pages[page - 1];
      if (!p) throw new Error(`The image has no page ${page}.`);
      return { width: p.width, height: p.height };
    },
    render: async (page) => {
      const p = pages[page - 1];
      if (!p) throw new Error(`The image has no page ${page}.`);
      return { image: p.image, width: p.width, height: p.height, region: { x0: 0, y0: 0, x1: p.width, y1: p.height }, scale: 1 };
    },
    dispose: () => {
      for (const p of pages) p.close?.();
    },
  };
}

async function decodeBrowserImage(bytes: Uint8Array, mime: string): Promise<DrawingSource> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
  return imageSource([{ image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }]);
}

interface UtifIfd {
  width?: number;
  height?: number;
  t256?: number[];
  t257?: number[];
}
interface Utif {
  decode(buffer: ArrayBuffer): UtifIfd[];
  decodeImage(buffer: ArrayBuffer, ifd: UtifIfd, ifds?: UtifIfd[]): void;
  toRGBA8(ifd: UtifIfd): Uint8Array;
}

async function decodeTiff(bytes: Uint8Array): Promise<DrawingSource> {
  const UTIF = ((await import("utif")) as unknown as { default: Utif }).default;
  const buffer = bytes.slice().buffer;
  // Every image of the file with a size is a page (thumbnails are sub-IFDs).
  const ifds = UTIF.decode(buffer).filter((d) => (d.t256?.[0] ?? 0) > 0 && (d.t257?.[0] ?? 0) > 0);
  if (ifds.length === 0) throw new Error("The TIFF file holds no image.");
  const pages = [];
  for (const ifd of ifds) {
    UTIF.decodeImage(buffer, ifd);
    const w = ifd.width ?? 0;
    const h = ifd.height ?? 0;
    if (!(w > 0 && h > 0) || w * h > MAX_RASTER_PIXELS * 4) throw new Error("The TIFF image is too large to show.");
    const rgba = UTIF.toRGBA8(ifd);
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error("No 2D canvas.");
    const pixels = new Uint8ClampedArray(w * h * 4);
    pixels.set(rgba.subarray(0, w * h * 4));
    ctx.putImageData(new ImageData(pixels, w, h), 0, 0);
    pages.push({ image: canvas as CanvasImageSource, width: w, height: h });
  }
  return imageSource(pages);
}

// ── PDF ─────────────────────────────────────────────────────────────

type PdfJs = typeof import("pdfjs-dist");
let pdfjs: Promise<PdfJs> | null = null;

/** pdf.js, its worker started once (a module worker of the app's own bundle: the CSP's worker-src 'self'). */
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= import("pdfjs-dist").then((lib) => {
    if (!lib.GlobalWorkerOptions.workerPort) {
      lib.GlobalWorkerOptions.workerPort = new Worker(new URL("./pdf.worker.ts", import.meta.url), { type: "module" });
    }
    return lib;
  });
  return pdfjs;
}

async function openPdf(bytes: Uint8Array): Promise<DrawingSource> {
  const lib = await loadPdfJs();
  // pdf.js takes over (detaches) the buffer it is given: a copy.
  const task = lib.getDocument({ data: bytes.slice(), useSystemFonts: true, disableAutoFetch: true });
  const doc = await task.promise;
  const sizes = new Map<number, PageSize>();
  const pageSize = async (n: number): Promise<PageSize> => {
    const known = sizes.get(n);
    if (known) return known;
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const size = { width: vp.width, height: vp.height };
    sizes.set(n, size);
    return size;
  };
  await pageSize(1);
  return {
    kind: "pdf",
    unit: "pt",
    pageCount: doc.numPages,
    fixedResolution: false,
    pageSize: (n) => sizes.get(n) ?? null,
    loadPageSize: pageSize,
    render: async (n, scale, region) => {
      const page = await doc.getPage(n);
      const full = await pageSize(n);
      const r = region ?? { x0: 0, y0: 0, x1: full.width, y1: full.height };
      const rw = r.x1 - r.x0;
      const rh = r.y1 - r.y0;
      const s = boundedScale(rw, rh, scale);
      const w = Math.max(1, Math.round(rw * s));
      const h = Math.max(1, Math.round(rh * s));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const viewport = page.getViewport({ scale: s });
      await page.render({ canvas, viewport, transform: [1, 0, 0, 1, -r.x0 * s, -r.y0 * s], background: "white" }).promise;
      return { image: canvas, width: w, height: h, region: r, scale: s };
    },
    dispose: () => {
      void task.destroy();
    },
  };
}

/** Open a drawing file of type `mime`. */
export async function openDrawingSource(bytes: Uint8Array, mime: string): Promise<DrawingSource> {
  switch (mime) {
    case "image/png":
    case "image/jpeg":
      return decodeBrowserImage(bytes, mime);
    case "image/tiff":
      return decodeTiff(bytes);
    case "application/pdf":
      return openPdf(bytes);
    default:
      throw new Error(`Drawings of type ${mime} cannot be shown.`);
  }
}
