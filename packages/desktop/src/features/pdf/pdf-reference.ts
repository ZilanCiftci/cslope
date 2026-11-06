/**
 * Reference annotations in the PDF: the lines under the result's surfaces
 * and their labels after the critical surface, as the canvas draws them
 * (features/canvas/reference-draw.ts), in paper millimetres. Vector, in
 * the annotation's colour (the PDF has no theme: the light default).
 */

import type { jsPDF } from "jspdf";
import type { Annotation, ReferenceAnnotation, ResultLayerStyles } from "../../store/types";
import { fosLabelLayoutPdf } from "./pdf-drawing";
import {
  isReferenceAnnotation,
  referenceDashPattern,
  referenceLabelAnchor,
  referenceWidth,
  referenceWorldPoints,
} from "../annotations/reference";
import { LabelLayout, pointLabelCandidates, type Box } from "../canvas/label-layout";
import {
  REFERENCE_LABEL_FONT_PX,
  REFERENCE_LABEL_GAP_PX,
  REFERENCE_LABEL_LINE_HEIGHT,
  REFERENCE_LABEL_PAD_PX,
} from "../canvas/reference-draw";
import { REFERENCE_ANNOTATION_COLOR } from "../rendering/style-spec";
import { surfaceYAtX } from "../view/surface";
import { surfacePoints, type DrawableSurface } from "../../utils/arc";
import { setSansFont } from "./pdf-fonts";
import { buildPolylinePath, parseColor, pdfPath, type PdfTransform } from "./pdf-helpers";

const MM_PER_PT = 0.3528;

/** A reference annotation as drawn: its points (mm) and colour. */
export interface DrawnReferencePdf {
  anno: ReferenceAnnotation;
  pts: [number, number][];
  color: [number, number, number];
}

/** Draws the lines of the reference annotations; returns them for the label pass. */
export function drawReferenceLinesPdf(
  pdf: jsPDF,
  tf: PdfTransform,
  annotations: readonly Annotation[],
  coordinates: [number, number][],
): DrawnReferencePdf[] {
  const drawn: DrawnReferencePdf[] = [];
  const groundYAt = (x: number) => surfaceYAtX(coordinates, x);
  for (const anno of annotations.filter(isReferenceAnnotation)) {
    const pts = referenceWorldPoints(anno, groundYAt).map(([x, y]) => tf.worldToPdf(x, y));
    const color = parseColor(anno.color ?? REFERENCE_ANNOTATION_COLOR.hex);
    if (pts.length >= 2) {
      const width = referenceWidth(anno);
      pdf.setDrawColor(...color);
      pdf.setLineWidth(width * tf.mmPerPx);
      pdf.setLineJoin("round");
      pdf.setLineCap(anno.dash === "dotted" ? "round" : "butt");
      pdf.setLineDashPattern(
        referenceDashPattern(anno.dash, width).map((d) => d * tf.mmPerPx),
        0,
      );
      pdfPath(pdf, buildPolylinePath(pts, false), "S");
      pdf.setLineDashPattern([], 0);
      pdf.setLineCap("butt");
      pdf.setLineJoin("miter");
    }
    drawn.push({ anno, pts, color });
  }
  return drawn;
}

/** What the labels keep clear of, besides the reference lines themselves. */
export interface ReferenceLabelContextPdf {
  coordinates: [number, number][];
  materialBoundaries?: readonly { coordinates: [number, number][] }[];
  waterLines?: readonly { coordinates: [number, number][] }[];
  /** The critical surface and whether its FOS label is drawn. */
  criticalSurface?: (DrawableSurface & { fos: number }) | null;
  showFosLabel?: boolean;
  /** The FOS label's style (layerStyles.fosLabel): its box is kept clear as drawn. */
  fosLabelStyle?: ResultLayerStyles["fosLabel"];
  /** The custom surfaces drawn (dashed) and their FOS labels' boxes (mm). */
  customSurfaces?: readonly DrawableSurface[];
  customLabelBoxes?: readonly Box[];
  /** The plot area (mm). */
  bounds: Box;
}

/**
 * Draws the labels as the canvas does: at the polyline's midpoint or the
 * circle's lowest point, just below it, moved around the anchor to the
 * first free place (the lines, the FOS label, each other); drawn at the
 * first candidate when none is free. Text in the line's colour on a white
 * plate.
 */
export function drawReferenceLabelsPdf(
  pdf: jsPDF,
  tf: PdfTransform,
  drawn: readonly DrawnReferencePdf[],
  ctx: ReferenceLabelContextPdf,
): Box[] {
  if (!drawn.some((d) => d.anno.label?.trim())) return [];
  const layout = new LabelLayout(ctx.bounds);
  const z = tf.mmPerPx;
  for (const d of drawn) {
    for (let i = 1; i < d.pts.length; i++) {
      layout.reserveSegment([d.pts[i - 1][0], d.pts[i - 1][1], d.pts[i][0], d.pts[i][1]], 2 * z);
    }
  }
  const toPdf = (pts: readonly [number, number][]) => pts.map(([x, y]) => tf.worldToPdf(x, y));
  if (ctx.coordinates.length >= 3) layout.reservePolyline(toPdf(ctx.coordinates), 2 * z, true);
  for (const b of ctx.materialBoundaries ?? []) layout.reservePolyline(toPdf(b.coordinates), 2 * z);
  for (const l of ctx.waterLines ?? []) layout.reservePolyline(toPdf(l.coordinates), 2 * z);
  if (ctx.criticalSurface) {
    const cs = ctx.criticalSurface;
    layout.reservePolyline(toPdf(surfacePoints(cs)), 3 * z);
    if (ctx.showFosLabel) {
      // The FOS label's plate, as drawCriticalSurface draws it.
      layout.reserve(fosLabelLayoutPdf(pdf, tf, cs, 0, ctx.fosLabelStyle).box);
    }
  }
  for (const s of ctx.customSurfaces ?? []) layout.reservePolyline(toPdf(surfacePoints(s)), 2 * z);
  for (const b of ctx.customLabelBoxes ?? []) layout.reserve(b);

  const fontMm = REFERENCE_LABEL_FONT_PX * z;
  pdf.setFontSize(fontMm / MM_PER_PT);
  setSansFont(pdf, "normal");
  const placed: Box[] = [];
  for (const d of drawn) {
    const text = d.anno.label?.trim();
    if (!text || d.pts.length === 0) continue;
    const world: [number, number][] = d.anno.shape === "polyline" ? d.anno.points : [[d.anno.cx, d.anno.cy - d.anno.radius]];
    const anchor = referenceLabelAnchor(d.anno, world);
    if (!anchor) continue;
    const [ax, ay] = tf.worldToPdf(anchor[0], anchor[1]);
    const pad = REFERENCE_LABEL_PAD_PX * z;
    const w = pdf.getTextWidth(text) + pad * 2;
    const h = fontMm * REFERENCE_LABEL_LINE_HEIGHT;
    const box = layout.place(pointLabelCandidates(ax, ay, w, h, [0, 1], REFERENCE_LABEL_GAP_PX * z), true);
    if (!box) continue;
    pdf.setFillColor(255, 255, 255);
    pdf.rect(box.left, box.top, w, h, "F");
    pdf.setTextColor(...d.color);
    // The baseline sits about a third of the font size below the middle.
    pdf.text(text, box.left + pad, box.top + h / 2 + fontMm * 0.35);
    placed.push(box);
  }
  pdf.setTextColor(0, 0, 0);
  return placed;
}
