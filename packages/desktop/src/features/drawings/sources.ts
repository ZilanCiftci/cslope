/**
 * Drawing sources: what a drawing file is, page by page, in its own
 * units, and rasters of it. One adapter per kind of file:
 *
 *   image   PNG, JPEG (decoded by the browser), TIFF (UTIF.js, page per
 *           image of the file); units: pixels
 *   pdf     PDF pages (pdf.js, in a worker); units: points (1/72 in);
 *           a page's vector paths and texts read when asked (pdf-vectors.ts)
 *   vector  a DWG or DXF drawing's model space as line work (vectors.ts):
 *           one page, the extent of the drawing; units: the drawing's
 *
 * Source coordinates have y downwards (the page as it is seen; a PDF
 * page's /Rotate applied). An image's and a PDF page's origin is the top
 * left corner; a DWG or DXF drawing's is the drawing's own origin (its
 * page starts at the extent's corner, `x0`, `y0`).
 */
import type { Crop } from "./transform";
import { readDxfVectors } from "../../utils/dxf";
import { fromDrawingCoordinates, type NeutralVectors, type VectorDrawing, type VectorText } from "./vectors";
import { pathsFromOperatorList, pdfVectorDrawing, textsFromContent, type PdfOps } from "./pdf-vectors";
import { vectorPath, drawVectorTexts } from "./vector-render";

export type SourceKind = "image" | "pdf" | "vector";
/** Pixels, PDF points, or the drawing units of a DWG or DXF file. */
export type SourceUnit = "px" | "pt" | "du";

/** The size of a page in source units (and its top-left corner, when not 0, 0). */
export interface PageSize {
  width: number;
  height: number;
  x0?: number;
  y0?: number;
}

/** A page as a rectangle of source coordinates. */
export function pageRect(s: PageSize): Crop {
  const x0 = s.x0 ?? 0;
  const y0 = s.y0 ?? 0;
  return { x0, y0, x1: x0 + s.width, y1: y0 + s.height };
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
   * (an image: the decoded image itself, whatever is asked). A DWG or DXF
   * drawing's layers named in `hiddenLayers` are left out.
   */
  render(page: number, scale: number, region?: Crop, hiddenLayers?: readonly string[]): Promise<Raster>;
  /** True when render() gives the same raster at every scale (an image). */
  fixedResolution: boolean;
  /**
   * The line work of a page (source coordinates): a DWG or DXF drawing's,
   * or a PDF page's vector paths (read on the first call, then kept);
   * null for an image, an empty drawing for a scanned page.
   */
  vectors(page: number): Promise<VectorDrawing | null>;
  /** The texts of a page (to name a section after), none for an image. */
  texts(page: number): Promise<VectorText[]>;
  dispose(): void;
}

/** A DWG file's type (IANA image/vnd.dwg); a DXF file's (image/vnd.dxf). */
export const DWG_MIME = "image/vnd.dwg";
export const DXF_MIME = "image/vnd.dxf";

/** The kinds of drawing file the app places, by type. */
export const DRAWING_MIME: Record<string, SourceKind> = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/tiff": "image",
  "application/pdf": "pdf",
  [DWG_MIME]: "vector",
  [DXF_MIME]: "vector",
};

/** The file chooser's accept list. */
export const DRAWING_ACCEPT = ".png,.jpg,.jpeg,.tif,.tiff,.pdf,.dwg,.dxf,image/png,image/jpeg,image/tiff,application/pdf";

/** What a drawing file of a type is called ("PDF", "DWG", …). */
export function drawingKindName(mime: string): string {
  const names: Record<string, string> = {
    "application/pdf": "PDF",
    "image/tiff": "TIFF",
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    [DWG_MIME]: "DWG",
    [DXF_MIME]: "DXF",
  };
  return names[mime] ?? "file";
}

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
  // DWG: a version code "AC1009" … "AC1032".
  if (/^AC10\d\d/.test(head)) return DWG_MIME;
  // ASCII DXF: (comments, then) group 0 SECTION.
  if (/^\uFEFF?\s*(999\s*\r?\n[^\n]*\r?\n\s*)*0\s*\r?\n\s*SECTION\s*\r?\n/.test(head)) return DXF_MIME;
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
    vectors: async () => null,
    texts: async () => [],
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
  /** Width, height, bits per sample, samples per pixel. */
  t256?: number[];
  t257?: number[];
  t258?: number[];
  t277?: number[];
  /** Compression, photometric interpretation, rows per strip, strip byte counts. */
  t259?: number[];
  t262?: number[];
  t278?: number[];
  t279?: number[];
}

/**
 * The largest TIFF image decoded (pixels), and all the pages of a file
 * together: each page is decoded whole into memory (its samples, then
 * RGBA, then a canvas), so a header declaring a huge image is refused
 * before anything is decoded.
 */
export const MAX_TIFF_PIXELS = 60e6;
export const MAX_TIFF_TOTAL_PIXELS = 100e6;

/** Why a TIFF image of these tags is not decoded, or null. */
export function tiffTooLarge(ifd: UtifIfd): string | null {
  const w = ifd.t256?.[0] ?? 0;
  const h = ifd.t257?.[0] ?? 0;
  // Bits per pixel as UTIF.decodeImage takes them (it allocates height × width × that).
  let bitsPerPixel = ifd.t258 ? Math.min(32, ifd.t258[0] ?? 0) * ifd.t258.length : (ifd.t277?.[0] ?? 1);
  if ((ifd.t259?.[0] ?? 1) === 1 && ifd.t279 && ifd.t278 && ifd.t262?.[0] === 32803) {
    bitsPerPixel = Math.round(((ifd.t279[0] ?? 0) * 8) / (w * (ifd.t278[0] ?? 0)));
  }
  const mp = (n: number) => `${Math.round(n / 1e6)} MP`;
  if (!(w > 0 && h > 0) || w * h > MAX_TIFF_PIXELS) {
    return `The TIFF image is too large to show (${w} × ${h} pixels, ${mp(w * h)}; at most ${mp(MAX_TIFF_PIXELS)}).`;
  }
  // (the decoded samples, before they are made RGBA)
  if (!(bitsPerPixel > 0) || bitsPerPixel > 128 || (w * h * bitsPerPixel) / 8 > MAX_TIFF_PIXELS * 4) {
    return `The TIFF image is too large to show (${w} × ${h} pixels at ${bitsPerPixel} bits per pixel).`;
  }
  return null;
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
  // The sizes the tags declare, checked before anything is decoded.
  let total = 0;
  for (const ifd of ifds) {
    const why = tiffTooLarge(ifd);
    if (why) throw new Error(why);
    total += ifd.t256![0] * ifd.t257![0];
  }
  if (total > MAX_TIFF_TOTAL_PIXELS) {
    throw new Error(`The TIFF file's pages are too large to show together (${Math.round(total / 1e6)} MP; at most ${Math.round(MAX_TIFF_TOTAL_PIXELS / 1e6)} MP).`);
  }
  const pages = [];
  for (const ifd of ifds) {
    UTIF.decodeImage(buffer, ifd);
    const w = ifd.width ?? 0;
    const h = ifd.height ?? 0;
    // (the decoded size must be the declared one)
    if (!(w > 0 && h > 0) || w !== ifd.t256![0] || h !== ifd.t257![0]) throw new Error("The TIFF image is damaged.");
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
  // The texts and the vector paths of a page, read when first asked (pdf.js
  // parses the page in its worker) and kept.
  const textsOf = new Map<number, Promise<VectorText[]>>();
  const vectorsOf = new Map<number, Promise<VectorDrawing>>();
  const pageTexts = (n: number): Promise<VectorText[]> => {
    let known = textsOf.get(n);
    if (!known) {
      known = (async () => {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 }).transform as [number, number, number, number, number, number];
        const content = await page.getTextContent();
        return textsFromContent(content.items, base);
      })();
      textsOf.set(n, known);
    }
    return known;
  };
  const pageVectors = (n: number): Promise<VectorDrawing> => {
    let known = vectorsOf.get(n);
    if (!known) {
      known = (async () => {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 }).transform as [number, number, number, number, number, number];
        const list = await page.getOperatorList();
        const paths = pathsFromOperatorList(list, lib.OPS as unknown as PdfOps, base);
        const texts = await pageTexts(n).catch(() => []);
        return pdfVectorDrawing(paths, texts);
      })();
      vectorsOf.set(n, known);
    }
    return known;
  };
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
    vectors: pageVectors,
    texts: pageTexts,
    dispose: () => {
      void task.destroy();
    },
  };
}

// ── DWG and DXF ─────────────────────────────────────────────────────

/** The line colour of a DWG or DXF drawing's rasters (thumbnails, the Place drawing window, the PDF export). */
const VECTOR_RASTER_INK = "#2b2f33";

/** A raster of a drawing's line work over `region` at about `scale` pixels per unit (transparent where there is none). */
export function renderVectorRaster(drawing: VectorDrawing, scale: number, region: Crop, hiddenLayers?: readonly string[]): Raster {
  const rw = region.x1 - region.x0;
  const rh = region.y1 - region.y0;
  const s = boundedScale(rw, rh, scale);
  const w = Math.max(1, Math.round(rw * s));
  const h = Math.max(1, Math.round(rh * s));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const hidden = new Set<number>();
    if (hiddenLayers?.length) drawing.layers.forEach((name, i) => hiddenLayers.includes(name) && hidden.add(i));
    ctx.save();
    ctx.translate(-region.x0 * s, -region.y0 * s);
    ctx.strokeStyle = VECTOR_RASTER_INK;
    ctx.lineWidth = Math.max(1, Math.min(w, h) / 1500);
    ctx.lineJoin = "round";
    ctx.stroke(vectorPath(drawing, hidden, { a: s, b: 0, c: 0, d: s }));
    ctx.restore();
    drawVectorTexts(ctx, drawing, hidden, { a: s, b: 0, c: 0, d: s, e: -region.x0 * s, f: -region.y0 * s }, VECTOR_RASTER_INK);
  }
  return { image: canvas, width: w, height: h, region, scale: s };
}

/** Text of a DXF file: UTF-8 (AutoCAD 2007 and later), else Windows-1252 (earlier ones). */
function dxfText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** The line work of a DWG file (read in the DWG reader's worker) or a DXF file. */
export async function readVectorFile(bytes: Uint8Array, mime: string): Promise<VectorDrawing> {
  let neutral: NeutralVectors;
  const kind = mime === DWG_MIME ? "DWG" : "DXF";
  if (mime === DWG_MIME) {
    const { readDwgVectorsFile } = await import("../project/dwg-reader");
    neutral = await readDwgVectorsFile(bytes);
  } else {
    neutral = readDxfVectors(dxfText(bytes));
  }
  const drawing = fromDrawingCoordinates(neutral, kind);
  if (drawing.paths.length === 0 && drawing.texts.length === 0) {
    throw new Error(`The ${kind} drawing's model space has nothing to show.`);
  }
  return drawing;
}

/** A DWG or DXF drawing as a source: one page, the extent of its line work. */
export function vectorSource(drawing: VectorDrawing): DrawingSource {
  const e = drawing.extent;
  const size: PageSize = { width: e.x1 - e.x0, height: e.y1 - e.y0, x0: e.x0, y0: e.y0 };
  return {
    kind: "vector",
    unit: "du",
    pageCount: 1,
    fixedResolution: false,
    pageSize: (n) => (n === 1 ? size : null),
    loadPageSize: async (n) => {
      if (n !== 1) throw new Error(`The drawing has no page ${n}.`);
      return size;
    },
    render: async (_n, scale, region, hiddenLayers) => renderVectorRaster(drawing, scale, region ?? pageRect(size), hiddenLayers),
    vectors: async () => drawing,
    texts: async () => drawing.texts,
    dispose: () => {},
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
    case DWG_MIME:
    case DXF_MIME:
      return vectorSource(await readVectorFile(bytes, mime));
    default:
      throw new Error(`Drawings of type ${mime} cannot be shown.`);
  }
}
