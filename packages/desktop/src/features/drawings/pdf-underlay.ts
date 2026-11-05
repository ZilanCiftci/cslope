/**
 * The placed drawings in the PDF export: those shown in results, drawn as
 * one image over the soil fills and under the grid and the lines, clipped
 * to the plot frame, as the result view draws them (a sheet at each
 * drawing's opacity). The drawings are composed on a transparent canvas
 * covering the plot frame at print resolution, each through its
 * placement's transform and clipped to its crop.
 */
import type { BackgroundImage } from "../../store/types";
import { sortedBackgrounds } from "../../store/slices/backgroundsSlice";
import { placementExtent, renderPlacement } from "./drawing-cache";
import type { Raster } from "./sources";
import { compose, type Affine } from "./transform";

/** A placement and its raster for the export. */
export interface PdfUnderlay {
  placement: BackgroundImage;
  raster: Raster;
}

/** Raster resolution of a PDF page in the export: 300 dpi of its own sheet. */
const PDF_PAGE_SCALE = 300 / 72;
/** The export's image resolution on the paper (pixels per mm, 150 dpi). */
export const UNDERLAY_PX_PER_MM = 150 / 25.4;

/** The rasters of the drawings shown in results (rendered now; a drawing that cannot be read is left out). */
export async function pdfUnderlays(backgrounds: readonly BackgroundImage[]): Promise<PdfUnderlay[]> {
  const out: PdfUnderlay[] = [];
  for (const placement of sortedBackgrounds(backgrounds)) {
    if (!placement.visible || placement.showInResults !== true || placement.opacity <= 0) continue;
    try {
      out.push({ placement, raster: await renderPlacement(placement, PDF_PAGE_SCALE) });
    } catch {
      // (left out of the export, as it is missing on the canvas)
    }
  }
  return out;
}

interface PdfLike {
  addImage(image: HTMLCanvasElement | string, format: string, x: number, y: number, w: number, h: number, alias?: string, compression?: "NONE" | "FAST" | "MEDIUM" | "SLOW"): unknown;
}

/**
 * Draw the underlays into `pdf` over the plot frame (`frame`, mm on the
 * page), `worldToPdf` mapping the model to the page (mm).
 */
export function drawPdfUnderlays(
  pdf: PdfLike,
  underlays: readonly PdfUnderlay[],
  worldToPdf: (x: number, y: number) => [number, number],
  frame: { x: number; y: number; w: number; h: number },
  pxPerMm = UNDERLAY_PX_PER_MM,
): boolean {
  if (underlays.length === 0 || typeof document === "undefined") return false;
  const w = Math.max(1, Math.round(frame.w * pxPerMm));
  const h = Math.max(1, Math.round(frame.h * pxPerMm));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  // model → page mm → canvas px
  const [ex, ey] = worldToPdf(0, 0);
  const [ax, ay] = worldToPdf(1, 0);
  const [cx, cy] = worldToPdf(0, 1);
  const world: Affine = {
    a: (ax - ex) * pxPerMm,
    b: (ay - ey) * pxPerMm,
    c: (cx - ex) * pxPerMm,
    d: (cy - ey) * pxPerMm,
    e: (ex - frame.x) * pxPerMm,
    f: (ey - frame.y) * pxPerMm,
  };
  let drawn = false;
  for (const { placement, raster } of underlays) {
    const extent = placement.crop ?? placementExtent(placement) ?? raster.region;
    const m = compose(world, placement.transform);
    ctx.save();
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.beginPath();
    ctx.rect(extent.x0, extent.y0, extent.x1 - extent.x0, extent.y1 - extent.y0);
    ctx.clip();
    ctx.globalAlpha = placement.opacity;
    ctx.imageSmoothingQuality = "high";
    const r = raster.region;
    ctx.drawImage(raster.image, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.restore();
    drawn = true;
  }
  // (compressed: jsPDF stores a PNG uncompressed by default)
  if (drawn) pdf.addImage(canvas, "PNG", frame.x, frame.y, frame.w, frame.h, undefined, "FAST");
  return drawn;
}
