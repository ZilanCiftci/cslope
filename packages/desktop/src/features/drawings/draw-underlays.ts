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
 */
import type { BackgroundImage } from "../../store/types";
import { placementExtent, rasterFor } from "./drawing-cache";
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
}

/** Draw the placements (in their order) on `ctx`, whose current transform maps canvas units to the device. */
export function drawUnderlays(
  ctx: CanvasRenderingContext2D,
  placements: readonly BackgroundImage[],
  toCanvas: WorldToCanvas,
  { blend = "source-over", pixelRatio = 1, include = (p) => p.visible }: UnderlayOptions = {},
): void {
  if (placements.length === 0) return;
  const world = worldToCanvasAffine(toCanvas);
  for (const p of sortedBackgrounds(placements)) {
    if (!include(p) || p.opacity <= 0) continue;
    const m = compose(world, p.transform);
    // Canvas pixels per source unit, for the raster's resolution.
    const scale = Math.sqrt(Math.abs(determinant(m))) * pixelRatio;
    if (!(scale > 0) || !Number.isFinite(scale)) continue;
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
    const r = raster.region;
    ctx.drawImage(raster.image, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.restore();
  }
}

/** The corners of a placement's shown region on the canvas (null until its size is known). */
export function placementCanvasCorners(p: BackgroundImage, toCanvas: WorldToCanvas): Pt[] | null {
  const extent = placementExtent(p);
  if (!extent) return null;
  return cropCorners(p.transform, extent).map(([x, y]) => toCanvas(x, y));
}
