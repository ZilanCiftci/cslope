/**
 * Drawing the placed drawings on a canvas: each visible placement's
 * raster through its affine transform (source → model → canvas, one
 * ctx.transform), clipped to its crop, at its opacity.
 *
 * Where: above the material fills and below the grid and every line and
 * point of the model (draw.ts), as a sheet at its opacity. Below the fills
 * the drawing would be hidden inside the model, where it matters. Above
 * them, two ways were tried: multiplied (the drawing's white paper
 * transparent, its lines darkening what is under them) keeps the fill
 * colours, but on a dark fill (the starter model's) or the dark theme's
 * canvas its black lines vanish; drawn as a sheet, the paper lightens the
 * fills by the opacity and the lines stay darker than everything around
 * them, on any fill and in both themes. So: a sheet, half transparent by
 * default; the opacity slider trades the drawing against the fills. The
 * model's own lines and points are drawn over it and stay sharp.
 *
 * A DWG or DXF drawing has no sheet: its line work is drawn as lines (one
 * cached path per zoom, vector-render.ts) in the theme's drawing ink, its
 * hidden layers left out, at its opacity, clipped to its crop.
 *
 * In the dark theme an image or PDF drawing is drawn inverted (unless its
 * "Invert in dark theme" is off): its white page turns as dark as the
 * sheet and its black lines light, as the model's ink; the hue is turned
 * back, so a red line stays red. The light theme and the exports draw it
 * as it is.
 */
import type { BackgroundImage } from "../../store/types";
import { peekSource, placementExtent, rasterFor, vectorsFor } from "./drawing-cache";
import { hiddenLayerSet } from "./vectors";
import { drawVectorTexts, vectorPath } from "./vector-render";
import { PRINT_INK } from "../canvas/ink";
import { sortedBackgrounds } from "../../store/slices/backgroundsSlice";
import { compose, cropCorners, determinant, type Affine, type Pt } from "./transform";

type WorldToCanvas = (wx: number, wy: number) => Pt;

/** The model → canvas transform of a (linear) world-to-canvas mapping. */
export function worldToCanvasAffine(toCanvas: WorldToCanvas): Affine {
  const [ex, ey] = toCanvas(0, 0);
  const [ax, ay] = toCanvas(1, 0);
  const [cx, cy] = toCanvas(0, 1);
  return { a: ax - ex, b: ay - ey, c: cx - ex, d: cy - ey, e: ex, f: ey };
}

export interface UnderlayOptions {
  /** The compositing (default: a sheet over what is drawn, "source-over"). */
  blend?: GlobalCompositeOperation;
  /** Device pixels per canvas unit (the raster resolution asked for follows it). */
  pixelRatio?: number;
  /** Which placements to draw (default: the visible ones). */
  include?: (p: BackgroundImage) => boolean;
  /** The colour of a DWG or DXF drawing's lines (the theme's drawing ink). */
  ink?: string;
  /** The dark theme: an image or PDF drawing is inverted unless its invertInDark is false. */
  dark?: boolean;
}

/** The filter that inverts a drawing's raster in the dark theme (lightness only: the hue is turned back). */
export const DARK_INVERT_FILTER = "invert(1) hue-rotate(180deg)";

/** Whether a placement's raster is drawn inverted (the dark theme, unless it is switched off). */
export function invertsInDark(p: Pick<BackgroundImage, "invertInDark">, dark: boolean): boolean {
  return dark && p.invertInDark !== false;
}

/** Draw the placements (in their order) on `ctx`, whose current transform maps canvas units to the device. */
export function drawUnderlays(
  ctx: CanvasRenderingContext2D,
  placements: readonly BackgroundImage[],
  toCanvas: WorldToCanvas,
  { blend = "source-over", pixelRatio = 1, include = (p) => p.visible, ink = PRINT_INK.drawingInk, dark = false }: UnderlayOptions = {},
): void {
  if (placements.length === 0) return;
  const world = worldToCanvasAffine(toCanvas);
  for (const p of sortedBackgrounds(placements)) {
    if (!include(p) || p.opacity <= 0) continue;
    const m = compose(world, p.transform);
    // Canvas pixels per source unit, for the raster's resolution.
    const scale = Math.sqrt(Math.abs(determinant(m))) * pixelRatio;
    if (!(scale > 0) || !Number.isFinite(scale)) continue;
    if (peekSource(p.assetId)?.kind === "vector") {
      drawVectorPlacement(ctx, p, m, ink);
      continue;
    }
    const raster = rasterFor(p, scale);
    const extent = placementExtent(p);
    if (!raster || !extent) continue;
    ctx.save();
    ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.beginPath();
    ctx.rect(extent.x0, extent.y0, extent.x1 - extent.x0, extent.y1 - extent.y0);
    ctx.clip();
    ctx.globalAlpha = p.opacity;
    ctx.globalCompositeOperation = blend;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (invertsInDark(p, dark)) ctx.filter = DARK_INVERT_FILTER;
    const r = raster.region;
    ctx.drawImage(raster.image, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.restore();
  }
}

/** A DWG or DXF placement's line work through `m` (source → canvas), clipped to its crop. */
function drawVectorPlacement(ctx: CanvasRenderingContext2D, p: BackgroundImage, m: Affine, ink: string): void {
  const drawing = vectorsFor(p.assetId, p.page ?? 1);
  const extent = placementExtent(p);
  if (!drawing || !extent) return;
  const hidden = hiddenLayerSet(drawing, p.hiddenLayers);
  ctx.save();
  // The crop, in canvas units.
  const corners = cropCorners(m, extent);
  ctx.beginPath();
  corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha = p.opacity;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.translate(m.e, m.f);
  ctx.stroke(vectorPath(drawing, hidden, m));
  ctx.translate(-m.e, -m.f);
  drawVectorTexts(ctx, drawing, hidden, m, ink);
  ctx.restore();
}

/** The corners of a placement's shown region on the canvas (null until its size is known). */
export function placementCanvasCorners(p: BackgroundImage, toCanvas: WorldToCanvas): Pt[] | null {
  const extent = placementExtent(p);
  if (!extent) return null;
  return cropCorners(p.transform, extent).map(([x, y]) => toCanvas(x, y));
}
