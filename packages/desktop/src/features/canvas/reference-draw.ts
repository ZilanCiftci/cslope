/**
 * Reference annotations on the canvas: the lines (under the result's
 * surfaces, above the soil) and their labels (after the FOS label, placed
 * clear of the lines and the FOS label through the label layout). The PDF
 * mirrors this in features/pdf/pdf-reference.ts.
 */

import type { Annotation, ReferenceAnnotation } from "../../store/types";
import {
  isReferenceAnnotation,
  referenceDashPattern,
  referenceLabelAnchor,
  referenceWidth,
  referenceWorldPoints,
  type GroundYAt,
} from "../annotations/reference";
import { POINT_COLOR_HOVER } from "./constants";
import { boxAround, pointLabelCandidates, type Box, type LabelLayout, type Seg } from "./label-layout";
import { referenceHitId } from "./reference-geometry";
import type { PointHit } from "./types";

/** Label text size (paper px at zoom 1), under the FOS label's 12 bold. */
export const REFERENCE_LABEL_FONT_PX = 11;
/** Padding of the label's plate (paper px). */
export const REFERENCE_LABEL_PAD_PX = 3;
/** Line height of the label as a factor of the font size. */
export const REFERENCE_LABEL_LINE_HEIGHT = 1.3;
/** Opacity of the plate under a label (the paper colour). */
export const REFERENCE_LABEL_PLATE_ALPHA = 0.85;
/** Radius of a selected annotation's handles (canvas px). */
export const REFERENCE_HANDLE_RADIUS = 5;
/** The selection colour, as the other annotations' outline. */
export const REFERENCE_SELECTION_COLOR = "#0078d4";
/** Gap between the label and its anchor point (paper px). */
export const REFERENCE_LABEL_GAP_PX = 3;

export interface ReferenceSceneParams {
  annotations: readonly Annotation[];
  mode: "edit" | "result";
  toC: (x: number, y: number) => [number, number];
  groundYAt: GroundYAt;
  paperZoom: number;
  /** The theme's reference colour, for annotations without one of their own. */
  defaultColor: string;
}

/** A reference annotation as drawn: its points and colour in canvas px. */
export interface DrawnReference {
  anno: ReferenceAnnotation;
  pts: [number, number][];
  color: string;
}

/**
 * The reference annotations a view shows: all of them in the result view,
 * those marked `showInEdit` in the edit view.
 */
export function visibleReferences(annotations: readonly Annotation[], mode: "edit" | "result"): ReferenceAnnotation[] {
  return annotations.filter(isReferenceAnnotation).filter((a) => mode === "result" || a.showInEdit === true);
}

function strokePolyline(ctx: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
}

/**
 * Draws the lines; returns what was drawn for the label pass and the
 * label layout (the segments other labels keep clear of). A selected
 * annotation (result view) shows its handles: a polyline's vertices, a
 * circle's centre with a cross and, when the circle is clipped, its
 * hidden part as a faint ring; the handle or line under the pointer is
 * highlighted.
 */
export function drawReferenceLines(
  ctx: CanvasRenderingContext2D,
  p: ReferenceSceneParams & {
    selectedIds?: readonly string[];
    hoverHit?: PointHit | null;
    /** Outline colour of the handles (the active stroke colour). */
    handleStroke?: string;
  },
): DrawnReference[] {
  const drawn: DrawnReference[] = [];
  const z = p.paperZoom;
  const hoverId = referenceHitId(p.hoverHit ?? null);
  for (const anno of visibleReferences(p.annotations, p.mode)) {
    const pts = referenceWorldPoints(anno, p.groundYAt).map(([x, y]) => p.toC(x, y));
    const color = anno.color ?? p.defaultColor;
    const width = referenceWidth(anno) * z;
    const selected = p.mode === "result" && (p.selectedIds?.includes(anno.id) ?? false);
    const hovered = p.mode === "result" && hoverId === anno.id;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = anno.dash === "dotted" ? "round" : "butt";
    if (pts.length >= 2) {
      if (hovered && (p.hoverHit?.kind === "referenceLine" || (p.hoverHit?.kind === "referenceCircle" && p.hoverHit.handle === "rim"))) {
        ctx.setLineDash([]);
        ctx.strokeStyle = POINT_COLOR_HOVER;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = width + 5;
        strokePolyline(ctx, pts);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(referenceDashPattern(anno.dash, referenceWidth(anno)).map((d) => d * z));
      strokePolyline(ctx, pts);
    }
    if (selected) {
      ctx.setLineDash([]);
      ctx.lineCap = "butt";
      if (anno.shape === "circle") {
        const [cx, cy] = p.toC(anno.cx, anno.cy);
        const [ex] = p.toC(anno.cx + anno.radius, anno.cy);
        const r = Math.abs(ex - cx);
        if ((anno.clip ?? "ground") === "ground") {
          // The whole circle, faint: what a rim drag resizes.
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.3;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }
        const hover = p.hoverHit?.kind === "referenceCircle" && p.hoverHit.annoId === anno.id && p.hoverHit.handle === "centre";
        drawHandle(ctx, cx, cy, hover, p.handleStroke ?? color, true);
      } else {
        anno.points.forEach(([x, y], i) => {
          const [px, py] = p.toC(x, y);
          const hover = p.hoverHit?.kind === "referenceVertex" && p.hoverHit.annoId === anno.id && p.hoverHit.pointIndex === i;
          drawHandle(ctx, px, py, hover, p.handleStroke ?? color, false);
        });
      }
    }
    ctx.restore();
    drawn.push({ anno, pts, color });
  }
  return drawn;
}

function drawHandle(ctx: CanvasRenderingContext2D, px: number, py: number, hover: boolean, stroke: string, cross: boolean) {
  const r = REFERENCE_HANDLE_RADIUS;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fillStyle = hover ? POINT_COLOR_HOVER : REFERENCE_SELECTION_COLOR;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (cross) {
    const arm = r + 3;
    ctx.beginPath();
    ctx.moveTo(px - arm, py);
    ctx.lineTo(px + arm, py);
    ctx.moveTo(px, py - arm);
    ctx.lineTo(px, py + arm);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** The segments of the drawn lines (what labels keep clear of). */
export function referenceSegments(drawn: readonly DrawnReference[]): Seg[] {
  const out: Seg[] = [];
  for (const d of drawn) {
    for (let i = 1; i < d.pts.length; i++) out.push([d.pts[i - 1][0], d.pts[i - 1][1], d.pts[i][0], d.pts[i][1]]);
  }
  return out;
}

/** The label font at a paper zoom. */
export function referenceLabelFont(paperZoom: number): string {
  return `${REFERENCE_LABEL_FONT_PX * paperZoom}px sans-serif`;
}

/**
 * Draws the labels: each at its anchor (the polyline's midpoint, the
 * circle's lowest point), just below it like the FOS label beside the
 * centre, moved around the anchor to the first place the layout has free
 * (the lines, the FOS label and what the caller reserved); a label with
 * no free place is drawn at the first candidate anyway (it is the user's
 * own text). Text in the line's colour on a plate of the paper colour.
 */
export function drawReferenceLabels(
  ctx: CanvasRenderingContext2D,
  drawn: readonly DrawnReference[],
  p: { toC: (x: number, y: number) => [number, number]; paperZoom: number; layout: LabelLayout; plate: string },
): Box[] {
  const z = p.paperZoom;
  const placed: Box[] = [];
  ctx.save();
  ctx.font = referenceLabelFont(z);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const d of drawn) {
    const text = d.anno.label?.trim();
    if (!text) continue;
    // Nothing drawn (a clipped circle above the ground): no label either.
    const world: [number, number][] =
      d.anno.shape === "polyline" ? d.anno.points : d.pts.length ? [[d.anno.cx, d.anno.cy - d.anno.radius]] : [];
    const anchor = referenceLabelAnchor(d.anno, world);
    if (!anchor) continue;
    const [ax, ay] = p.toC(anchor[0], anchor[1]);
    const pad = REFERENCE_LABEL_PAD_PX * z;
    const w = ctx.measureText(text).width + pad * 2;
    const h = REFERENCE_LABEL_FONT_PX * REFERENCE_LABEL_LINE_HEIGHT * z;
    const candidates = pointLabelCandidates(ax, ay, w, h, [0, 1], REFERENCE_LABEL_GAP_PX * z);
    const box = p.layout.place(candidates, true);
    if (!box) continue;
    ctx.globalAlpha = REFERENCE_LABEL_PLATE_ALPHA;
    ctx.fillStyle = p.plate;
    ctx.fillRect(box.left, box.top, w, h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = d.color;
    ctx.fillText(text, box.left + pad, box.top + h / 2 + 0.5);
    placed.push(box);
  }
  ctx.restore();
  return placed;
}

/** A box around a handle, for layouts that keep labels off the handles. */
export function referenceHandleBox(px: number, py: number): Box {
  return boxAround(px, py, REFERENCE_HANDLE_RADIUS + 3);
}
