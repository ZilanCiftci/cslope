import { jsPDF } from "jspdf";
import { PDF_SANS, setSansFont } from "./pdf-fonts";
import type { ReinforcementForce } from "@cslope/engine";
import type { PileRow, ReinforcementRow } from "../../store/types";
import {
  bondedSpan,
  layoutReinforcementForces,
  type ForceLabelContext,
} from "../canvas/reinforcement-draw";
import {
  arrowEdges,
  formatMagnitude,
  formatRange,
  groupTouchingStrips,
  loadHeightFraction,
  placeLabel,
  type Box,
} from "../rendering/overlay-layout";
import { piezoObstacles, piezoSymbolLayout, type PiezoScene } from "../rendering/piezo-layout";
import { layoutLimitMarkers, layoutRangeDots } from "../rendering/search-markers";
import { fosColor, fosScaleRange, fosTickLabel } from "../../utils/fos-color";

/** "≥" (in the embedded font). */
const PDF_GE = "≥ ";
import {
  fosLabelAnchor,
  sameSurface,
  surfaceBaseYAt,
  surfacePoints,
  type DrawableSurface,
} from "../../utils/arc";
import { computeRegions } from "../../utils/regions";
import {
  computeRulerStep,
  formatRulerLabel,
  resolveTickStep,
} from "../../utils/ruler";
import {
  ARROW_HEAD_LEN_PX,
  ARROW_HEAD_PX,
  ARROW_HEIGHT_PX,
  HATCH_SPACING_PX,
} from "../canvas/constants";
import { buildMaterialTableData } from "../canvas/helpers";
import {
  ANNOTATION_DEFAULT_FONT_FAMILY,
  ANNOTATION_DEFAULT_FONT_SIZE,
  ANNOTATION_DEFAULT_TEXT_COLOR,
  ANNOTATION_LINE_HEIGHT,
  ANNOTATION_SCALE_DIVISOR,
  COLOR_BAR_NUM_TICKS,
  CRACK_WATER_OPACITY,
  CRACK_WATER_WIDTH_PX,
  CRITICAL_SURFACE_COLOR,
  ENTRY_DOT_COLOR,
  ENTRY_EXIT_DOT_RADIUS_PX,
  EXIT_DOT_COLOR,
  FAILURE_MASS_COLOR,
  FAILURE_MASS_FILL_OPACITY,
  FOS_LABEL_BG_COLOR,
  LINE_LOAD_COLOR,
  MARKER_COLOR,
  MIN_SLIP_MASS_BAND_OPACITY,
  MIN_SLIP_MASS_PX,
  PIEZO_BAR_GAP1_PX,
  PIEZO_BAR_GAP2_PX,
  PIEZO_BAR_W_PX,
  PIEZO_COLOR,
  POND_COLOR,
  POND_OPACITY,
  PIEZO_TRI_HALF_PX,
  PIEZO_TRI_H_PX,
  SLICE_LINE_ON_DARK_COLOR,
  SLICE_LINE_OPACITY,
  SLICE_LINE_WIDTH_PX,
  SLIP_SURFACE_OPACITY,
  UDL_LOAD_COLOR,
  MODEL_HATCH_PATTERNS,
} from "../rendering/style-spec";
import { drawPdfHatch, drawPdfHatchLabel } from "../rendering/hatch";
import { freeWaterPolygons, mainPiezoLine, piezoExtensions } from "../../utils/piezo";
import type { AnalysisOptions, AnalysisResult } from "@cslope/engine";
import type {
  AnalysisLimitsState,
  Annotation,
  MaterialBoundaryRow,
  MaterialRow,
  ParameterDef,
  ProjectInfo,
  PiezometricLineState,
  RegionMaterials,
  ResultViewSettings,
} from "../../store/types";
import {
  buildPolylinePath,
  mapFont,
  mapFontStyle,
  parseColor,
  pdfPath,
  resetOpacity,
  setOpacity,
  type PathOp,
  type PdfTransform,
} from "./pdf-helpers";
import { surfaceYAtX } from "../view/surface";
import {
  groundBetween,
  groundProfile,
  isDarkFill,
  meanThickness,
  sliceLines,
  slipMassPolygon,
  splitVerticalByRegion,
  tensionCrackFace,
} from "../../utils/slip-mass";
import { resolveAnnotationText } from "../annotations/resolveAnnotationText";
import { getMaterialTableColumnWidthPx } from "../annotations/materialTableLayout";
import { anchoredTopLeft } from "../annotations/anchorPosition";
import { computeSlicePlotData } from "../annotations/slicePlotData";

export function drawGrid(
  pdf: jsPDF,
  tf: PdfTransform,
  viewScale: number,
  clip: { x: number; y: number; w: number; h: number },
  gridSpacing?: number,
) {
  const [originPdfX, originPdfY] = tf.worldToPdf(0, 0);
  const worldPerMm = 1 / (viewScale * tf.mmPerPx);

  const worldLeft = (clip.x - originPdfX) * worldPerMm;
  const worldRight = (clip.x + clip.w - originPdfX) * worldPerMm;
  const worldTop = (originPdfY - clip.y) * worldPerMm;
  const worldBottom = (originPdfY - (clip.y + clip.h)) * worldPerMm;

  // The ruler's major-tick spacing (drawRulerFrame, same frame), so the
  // grid lines run through the labelled ticks as on the canvas; the
  // separately rounded automatic steps used to differ.
  const gridStep = resolveTickStep(
    gridSpacing,
    computeRulerStep(worldRight - worldLeft, clip.w, tf.paperW, [
      worldLeft,
      worldRight,
    ]),
  );

  pdf.setDrawColor(220, 220, 220);
  pdf.setLineWidth(0.1);

  const startX = Math.floor(worldLeft / gridStep) * gridStep;
  const startY = Math.floor(worldBottom / gridStep) * gridStep;

  for (let gx = startX; gx <= worldRight; gx += gridStep) {
    const [px] = tf.worldToPdf(gx, 0);
    if (px >= clip.x && px <= clip.x + clip.w) {
      pdf.line(px, clip.y, px, clip.y + clip.h);
    }
  }

  for (let gy = startY; gy <= worldTop; gy += gridStep) {
    const [, py] = tf.worldToPdf(0, gy);
    if (py >= clip.y && py <= clip.y + clip.h) {
      pdf.line(clip.x, py, clip.x + clip.w, py);
    }
  }

  pdf.setDrawColor(180, 180, 180);
  pdf.setLineWidth(0.3);
  const [axX] = tf.worldToPdf(0, 0);
  const [, axY] = tf.worldToPdf(0, 0);
  if (axX >= clip.x && axX <= clip.x + clip.w) {
    pdf.line(axX, clip.y, axX, clip.y + clip.h);
  }
  if (axY >= clip.y && axY <= clip.y + clip.h) {
    pdf.line(clip.x, axY, clip.x + clip.w, axY);
  }
}

export function drawRulerFrame(
  pdf: jsPDF,
  tf: PdfTransform,
  viewScale: number,
  innerFrame: { x: number; y: number; w: number; h: number },
  gridSpacing?: number,
  minorTicks?: number,
) {
  const TICK_LEN = 2.0;
  const MINI_TICK = 1.0;
  const FONT_SIZE = 9;

  const [originPdfX, originPdfY] = tf.worldToPdf(0, 0);
  const worldPerMm = 1 / (viewScale * tf.mmPerPx);

  const worldLeft = (innerFrame.x - originPdfX) * worldPerMm;
  const worldRight = (innerFrame.x + innerFrame.w - originPdfX) * worldPerMm;
  const worldTop = (originPdfY - innerFrame.y) * worldPerMm;
  const worldBottom = (originPdfY - (innerFrame.y + innerFrame.h)) * worldPerMm;

  const worldSpan = worldRight - worldLeft;
  const rulerStep = resolveTickStep(
    gridSpacing,
    computeRulerStep(worldSpan, innerFrame.w, tf.paperW, [
      worldLeft,
      worldRight,
    ]),
  );
  const minorTickCount = minorTicks ?? 0;

  pdf.setFontSize(FONT_SIZE);
  setSansFont(pdf, "normal");
  pdf.setTextColor(50, 50, 50);
  pdf.setDrawColor(50, 50, 50);

  const ifx = innerFrame.x;
  const ify = innerFrame.y;
  const ifw = innerFrame.w;
  const ifh = innerFrame.h;

  const btmY = ify + ifh;
  const xStart = Math.ceil(worldLeft / rulerStep) * rulerStep;
  for (let gx = xStart; gx <= worldRight; gx += rulerStep) {
    const [px] = tf.worldToPdf(gx, 0);
    if (px < ifx || px > ifx + ifw) continue;
    pdf.setLineWidth(0.2);
    pdf.line(px, btmY, px, btmY + TICK_LEN);
    const label = formatRulerLabel(gx, rulerStep);
    pdf.text(label, px, btmY + TICK_LEN + FONT_SIZE * 0.35 + 1.0, {
      align: "center",
    });
  }

  if (minorTickCount > 0) {
    const xMinorStep = rulerStep / (minorTickCount + 1);
    const xMinorStart = Math.ceil(worldLeft / xMinorStep) * xMinorStep;
    for (let gx = xMinorStart; gx <= worldRight; gx += xMinorStep) {
      const [px] = tf.worldToPdf(gx, 0);
      if (px < ifx || px > ifx + ifw) continue;
      if (Math.abs(gx / rulerStep - Math.round(gx / rulerStep)) < 0.001)
        continue;
      pdf.setLineWidth(0.15);
      pdf.line(px, btmY, px, btmY + MINI_TICK);
    }
  }

  const yStart = Math.ceil(worldBottom / rulerStep) * rulerStep;
  for (let gy = yStart; gy <= worldTop; gy += rulerStep) {
    const [, py] = tf.worldToPdf(0, gy);
    if (py < ify || py > ify + ifh) continue;
    pdf.setLineWidth(0.2);
    pdf.line(ifx, py, ifx - TICK_LEN, py);
    const label = formatRulerLabel(gy, rulerStep);
    pdf.text(label, ifx - TICK_LEN - 1.0, py + FONT_SIZE * 0.12, {
      align: "right",
    });
  }

  if (minorTickCount > 0) {
    const yMinorStep = rulerStep / (minorTickCount + 1);
    const yMinorStart = Math.ceil(worldBottom / yMinorStep) * yMinorStep;
    for (let gy = yMinorStart; gy <= worldTop; gy += yMinorStep) {
      const [, py] = tf.worldToPdf(0, gy);
      if (py < ify || py > ify + ifh) continue;
      if (Math.abs(gy / rulerStep - Math.round(gy / rulerStep)) < 0.001)
        continue;
      pdf.setLineWidth(0.15);
      pdf.line(ifx, py, ifx - MINI_TICK, py);
    }
  }

  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.4);
  pdf.rect(ifx, ify, ifw, ifh, "S");
}

export function drawMaterialRegions(
  pdf: jsPDF,
  tf: PdfTransform,
  coordinates: [number, number][],
  materials: MaterialRow[],
  materialBoundaries: MaterialBoundaryRow[],
  regionMaterials: RegionMaterials,
  showSoilColor?: boolean,
) {
  const colorEnabled = showSoilColor !== false;
  const defaultMatId = materials[0]?.id ?? "";
  const regions = computeRegions(
    coordinates,
    materialBoundaries,
    regionMaterials,
    defaultMatId,
  );

  // Clip to model polygon so material colors cannot bleed outside the model
  pdf.saveGraphicsState();
  // Round joins (restored with the state): no mitre spikes at sharp toes.
  pdf.setLineJoin("round");
  const clipPts = coordinates.map(([wx, wy]) => tf.worldToPdf(wx, wy));
  const clipOps: PathOp[] = buildPolylinePath(clipPts, true);
  pdfPath(pdf, clipOps, "");
  pdf.clip();
  (pdf as unknown as { discardPath?: () => void }).discardPath?.();

  for (const region of regions) {
    const mat = materials.find((m) => m.id === region.materialId);
    if (!mat || region.px.length < 3) continue;

    const outerPts = region.px.map((_, i) =>
      tf.worldToPdf(region.px[i], region.py[i]),
    );
    const ops: PathOp[] = buildPolylinePath(outerPts, true);

    if (region.holes) {
      for (const hole of region.holes) {
        if (hole.px.length < 3) continue;
        const holePts = hole.px.map((_, i) =>
          tf.worldToPdf(hole.px[i], hole.py[i]),
        );
        ops.push(...buildPolylinePath(holePts, true));
      }
    }

    if (colorEnabled) {
      const [r, g, b] = parseColor(mat.color);
      pdf.setFillColor(r, g, b);

      // Opaque, like the canvas and the material table swatches.
      pdfPath(pdf, ops, region.holes ? "f*" : "f");
    }

    // Region border stroke
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.15);
    pdfPath(pdf, ops, "S");

    // ── Hatch pattern overlay for special model kinds ──
    const modelKind = mat.model?.kind;
    const hatchPattern = modelKind
      ? MODEL_HATCH_PATTERNS[modelKind]
      : undefined;
    if (colorEnabled && hatchPattern) {
      // Clip to region polygon for hatch (even-odd so holes stay clear,
      // as on the canvas).
      pdf.saveGraphicsState();
      pdfPath(pdf, ops, "");
      if (region.holes) pdf.clip("evenodd");
      else pdf.clip();
      (pdf as unknown as { discardPath?: () => void }).discardPath?.();

      setOpacity(pdf, 0.45);
      drawPdfHatch(pdf, outerPts, hatchPattern, tf.mmPerPx);
      resetOpacity(pdf);

      pdf.restoreGraphicsState();

      // Label at centroid
      if (hatchPattern.label) {
        drawPdfHatchLabel(pdf, outerPts, hatchPattern.label, tf.mmPerPx);
      }
    }
  }

  // Restore state to remove model polygon clip
  pdf.restoreGraphicsState();
}

export function drawClosedPolyline(
  pdf: jsPDF,
  tf: PdfTransform,
  coords: [number, number][],
  color: [number, number, number],
  lineWidth: number,
) {
  if (coords.length < 3) return;
  const pts = coords.map(([wx, wy]) => tf.worldToPdf(wx, wy));
  const ops = buildPolylinePath(pts, true);
  pdf.setDrawColor(...color);
  pdf.setLineWidth(lineWidth);
  // Round joins: a mitre at a sharp toe sticks out far past the corner.
  pdf.setLineJoin("round");
  pdfPath(pdf, ops, "S");
  pdf.setLineJoin("miter");
}

export function drawOpenPolyline(
  pdf: jsPDF,
  tf: PdfTransform,
  coords: [number, number][],
  color: [number, number, number],
  lineWidth: number,
) {
  if (coords.length < 2) return;
  const pts = coords.map(([wx, wy]) => tf.worldToPdf(wx, wy));
  const ops = buildPolylinePath(pts, false);
  pdf.setDrawColor(...color);
  pdf.setLineWidth(lineWidth);
  pdf.setLineJoin("round");
  pdfPath(pdf, ops, "S");
  pdf.setLineJoin("miter");
}

/** Load label above (cx, bottom); moved up past labels placed before it, left out when there is no room. */
function drawLoadLabelPdf(pdf: jsPDF, text: string, cx: number, bottom: number, placed: Box[]) {
  pdf.setFontSize(9);
  setSansFont(pdf, "bold");
  const tw = pdf.getTextWidth(text);
  const lh = 9 * MM_PER_PT * 1.15;
  const candidates: Box[] = [0, 1, 2, 3].map((k) => ({
    left: cx - tw / 2,
    top: bottom - lh * (k + 1),
    right: cx + tw / 2,
    bottom: bottom - lh * k,
  }));
  const box = placeLabel(candidates, placed, [], 0.5);
  if (box) pdf.text(text, cx, box.bottom, { align: "center" });
}

/**
 * UDLs as on the canvas: strips that touch end to end are one load with
 * arrows at its ends (and at a readable spacing), a hatched band over the
 * ground stepping between strips of different size, and one label;
 * heights follow the magnitude relative to the largest load. `placed`
 * collects the load labels so line-load labels can keep clear of them.
 */
export function drawUdlLoads(
  pdf: jsPDF,
  tf: PdfTransform,
  udls: { x1: number; x2: number; magnitude: number }[],
  coordinates: [number, number][],
  placed: Box[] = [],
) {
  // Same proportions as the canvas arrows.
  const arrowH = ARROW_HEIGHT_PX * tf.mmPerPx;
  const headW = ARROW_HEAD_PX * tf.mmPerPx;
  const headL = ARROW_HEAD_LEN_PX * tf.mmPerPx;
  const onModel = udls.filter((u) => surfaceYAtX(coordinates, u.x1) !== null && surfaceYAtX(coordinates, u.x2) !== null);
  const qMaxAll = Math.max(0, ...onModel.map((u) => Math.abs(u.magnitude)));
  const groundAt = (x: number) => tf.worldToPdf(x, surfaceYAtX(coordinates, x)!);

  for (const g of groupTouchingStrips(onModel)) {
    const strips = g.strips.map((u) => {
      const lo = Math.min(u.x1, u.x2);
      const hi = Math.max(u.x1, u.x2);
      // The band follows the ground surface, both corners of a vertical
      // face included (a straight line between the end arrows would cut
      // through the ground over a crest, the face's top alone the corner
      // of a step).
      const ground = groundBetween(coordinates, lo, hi).map(([wx, wy]) => tf.worldToPdf(wx, wy));
      const lift = arrowH * loadHeightFraction(u.magnitude, qMaxAll);
      return { lo, hi, lift, ground, top: ground.map(([px, py]) => [px, py - lift] as [number, number]) };
    });

    // Hatched band under the top edges (as on the canvas).
    const bandOps: PathOp[] = strips.flatMap((s) => buildPolylinePath([...s.top, ...[...s.ground].reverse()], true));
    pdf.saveGraphicsState();
    pdfPath(pdf, bandOps, "");
    pdf.clip();
    (pdf as unknown as { discardPath?: () => void }).discardPath?.();
    const all = strips.flatMap((s) => [...s.ground, ...s.top]);
    const minX = Math.min(...all.map(([x]) => x));
    const maxX = Math.max(...all.map(([x]) => x));
    const minY = Math.min(...all.map(([, y]) => y));
    const maxY = Math.max(...all.map(([, y]) => y));
    const span = maxX - minX + (maxY - minY);
    pdf.setDrawColor(...UDL_LOAD_COLOR.rgb);
    pdf.setLineWidth(0.15);
    setOpacity(pdf, 1, 0.5);
    for (let d = -span; d < span; d += HATCH_SPACING_PX * tf.mmPerPx) {
      pdf.line(minX + d, minY, minX + d + (maxY - minY), maxY);
    }
    resetOpacity(pdf);
    pdf.restoreGraphicsState();

    pdf.setDrawColor(...UDL_LOAD_COLOR.rgb);
    pdf.setLineWidth(0.4);
    pdf.setFillColor(...UDL_LOAD_COLOR.rgb);
    const edges = [strips[0].lo, ...strips.map((s) => s.hi)];
    const edgePts = edges.map(groundAt);
    const edgeLift = (i: number) => Math.max(i > 0 ? strips[i - 1].lift : 0, i < strips.length ? strips[i].lift : 0);
    for (const i of arrowEdges(edgePts.map(([x]) => x), 60 * tf.mmPerPx)) {
      const [px, py] = edgePts[i];
      pdf.line(px, py - edgeLift(i), px, py - headL);
      pdf.triangle(px, py, px - headW, py - headL, px + headW, py - headL, "F");
    }

    // Outline as on the canvas: up the left end, along the tops (stepping
    // between strips of different size), down the right end, back along
    // the ground.
    const groundAll = strips.flatMap((s) => s.ground);
    const outline: [number, number][] = [strips[0].ground[0], ...strips.flatMap((s) => s.top), ...[...groundAll].reverse()];
    pdf.setLineWidth(0.3);
    pdfPath(pdf, buildPolylinePath(outline, true), "S");

    pdf.setTextColor(...UDL_LOAD_COLOR.rgb);
    const labelX = (edgePts[0][0] + edgePts[edgePts.length - 1][0]) / 2;
    const topMost = Math.min(...strips.flatMap((s) => s.top.map(([, y]) => y)));
    // The canvas's 8 px gap above the band, in mm.
    drawLoadLabelPdf(pdf, formatRange(g.qMin, g.qMax, "q", "kPa"), labelX, topMost - 8 * tf.mmPerPx, placed);
  }
}

export function drawLineLoads(
  pdf: jsPDF,
  tf: PdfTransform,
  lineLoads: { x: number; magnitude: number }[],
  coordinates: [number, number][],
  placed: Box[] = [],
) {
  const arrowH = ARROW_HEIGHT_PX * tf.mmPerPx;
  const headW = ARROW_HEAD_PX * tf.mmPerPx;
  const headL = ARROW_HEAD_LEN_PX * tf.mmPerPx;
  const pMaxAll = Math.max(0, ...lineLoads.map((ll) => Math.abs(ll.magnitude)));

  for (const ll of lineLoads) {
    const sy = surfaceYAtX(coordinates, ll.x);
    if (sy === null) continue;

    const [px, py] = tf.worldToPdf(ll.x, sy);
    const lift = arrowH * loadHeightFraction(ll.magnitude, pMaxAll);
    pdf.setDrawColor(...LINE_LOAD_COLOR.rgb);
    pdf.setLineWidth(0.4);
    pdf.line(px, py - lift, px, py - headL);
    pdf.setFillColor(...LINE_LOAD_COLOR.rgb);
    pdf.triangle(px, py, px - headW, py - headL, px + headW, py - headL, "F");

    pdf.setTextColor(...LINE_LOAD_COLOR.rgb);
    // The canvas's 4 px gap above the arrow, in mm.
    drawLoadLabelPdf(pdf, `P = ${formatMagnitude(ll.magnitude)} kN/m`, px, py - lift - 4 * tf.mmPerPx, placed);
  }
}

const REINFORCEMENT_RGB: [number, number, number] = [142, 68, 173];

/** Reinforcement elements: bar, head plate, bonded part (as on canvas). */
export function drawReinforcementsPdf(
  pdf: jsPDF,
  tf: PdfTransform,
  rows: readonly ReinforcementRow[],
) {
  rows.forEach((r, i) => {
    const [ax, ay] = tf.worldToPdf(r.x1, r.y1);
    const [bx, by] = tf.worldToPdf(r.x2, r.y2);
    const len = Math.hypot(bx - ax, by - ay);
    if (!(len > 0)) return;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    const span = bondedSpan(r);
    if (span) {
      pdf.setDrawColor(...REINFORCEMENT_RGB);
      setOpacity(pdf, 0.3);
      pdf.setLineWidth(1.6);
      pdf.line(ax + ux * len * span[0], ay + uy * len * span[0], ax + ux * len * span[1], ay + uy * len * span[1]);
      resetOpacity(pdf);
    }
    pdf.setDrawColor(...REINFORCEMENT_RGB);
    pdf.setLineWidth(0.45);
    pdf.line(ax, ay, bx, by);
    const p = 1.2;
    pdf.setLineWidth(0.6);
    pdf.line(ax - uy * p, ay + ux * p, ax + uy * p, ay - ux * p);
    if (r.pullout === "none") {
      // Anchor block at the embedded end, as on the canvas.
      pdf.setFillColor(...REINFORCEMENT_RGB);
      pdf.rect(bx - 0.8, by - 0.8, 1.6, 1.6, "F");
    }
    pdf.setFontSize(8);
    setSansFont(pdf, "bold");
    pdf.setTextColor(...REINFORCEMENT_RGB);
    pdf.text(String(i + 1), ax - ux * 2.5, ay - uy * 2.5, { align: "center", baseline: "middle" });
  });
}

/** Piles and sheet piles: a thick bar labelled P1… at the head. */
export function drawPilesPdf(pdf: jsPDF, tf: PdfTransform, rows: readonly PileRow[]) {
  rows.forEach((p, i) => {
    const [ax, ay] = tf.worldToPdf(p.x1, p.y1);
    const [bx, by] = tf.worldToPdf(p.x2, p.y2);
    pdf.setDrawColor(93, 64, 55);
    pdf.setLineWidth(p.type === "sheet-pile" ? 1 : 0.8);
    pdf.line(ax, ay, bx, by);
    pdf.setFontSize(8);
    setSansFont(pdf, "bold");
    pdf.setTextColor(93, 64, 55);
    pdf.text(`P${i + 1}`, ax, ay - 1.2, { align: "center" });
  });
}

/**
 * Reinforcement forces on the critical surface, as on the canvas: arrow
 * beside the line it acts along, size on a white plate clear of the
 * elements, the slip line and the other labels (layoutReinforcementForces).
 */
export function drawReinforcementForcesPdf(
  pdf: jsPDF,
  tf: PdfTransform,
  forces: readonly ReinforcementForce[],
  context?: ForceLabelContext,
) {
  const HEAD = 1.5;
  pdf.setFontSize(7);
  setSansFont(pdf, "bold");
  const layout = layoutReinforcementForces(
    forces,
    tf.worldToPdf,
    { arrow: 7, offset: 1, gap: 0.7, pad: 0.5, textH: 7 * MM_PER_PT, measure: (t) => pdf.getTextWidth(t) },
    context,
  );
  pdf.setDrawColor(...REINFORCEMENT_RGB);
  pdf.setFillColor(...REINFORCEMENT_RGB);
  pdf.setLineWidth(0.4);
  for (const { from, to, ux, uy } of layout) {
    const [ex, ey] = to;
    pdf.line(from[0], from[1], ex - ux * HEAD, ey - uy * HEAD);
    pdf.triangle(
      ex, ey,
      ex - ux * HEAD - uy * HEAD * 0.6, ey - uy * HEAD + ux * HEAD * 0.6,
      ex - ux * HEAD + uy * HEAD * 0.6, ey - uy * HEAD - ux * HEAD * 0.6,
      "F",
    );
  }
  pdf.setTextColor(...REINFORCEMENT_RGB);
  for (const { label, text } of layout) {
    if (!label) continue;
    pdf.setFillColor(255, 255, 255);
    setOpacity(pdf, 0.85);
    pdf.rect(label.left, label.top, label.right - label.left, label.bottom - label.top, "F");
    resetOpacity(pdf);
    pdf.text(text, (label.left + label.right) / 2, (label.top + label.bottom) / 2, { align: "center", baseline: "middle" });
  }
}

export function drawPiezometricLines(
  pdf: jsPDF,
  tf: PdfTransform,
  lines: { id: string; coordinates: [number, number][] }[],
  modelCoordinates: [number, number][] = [],
  freeWater = false,
  mainLineId?: string,
  /** Critical slip surface, kept clear of the water-table symbols. */
  critical: DrawableSurface | null = null,
  /** Kept clear of the symbols: element heads and numbers (`placed`) and bars (`obstacles`). */
  avoid: ForceLabelContext = { obstacles: [], placed: [] },
  /** What else is drawn around the lines (loads, search markers; see piezoObstacles). */
  scene: Omit<PiezoScene, "coordinates" | "critical"> = {},
) {
  const multiLine = lines.length > 1;
  const obstacles = piezoObstacles({ ...scene, coordinates: modelCoordinates, critical }, tf.worldToPdf, tf.mmPerPx);
  // Symbols placed so far, so lines don't put theirs on top of each other.
  const taken: [number, number][] = [];

  // Free water standing on the ground (from the main line), as on canvas.
  const mainLine = mainPiezoLine({ lines, mainLineId });
  if (freeWater && mainLine) {
    pdf.setFillColor(...POND_COLOR.rgb);
    setOpacity(pdf, POND_OPACITY);
    for (const poly of freeWaterPolygons(mainLine.coordinates, modelCoordinates)) {
      const pts = poly.map(([wx, wy]) => tf.worldToPdf(wx, wy));
      pdfPath(pdf, buildPolylinePath(pts, true), "f");
    }
    resetOpacity(pdf);
  }

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (line.coordinates.length < 2) continue;
    const pts = line.coordinates.map(([wx, wy]) => tf.worldToPdf(wx, wy));

    pdf.setDrawColor(...PIEZO_COLOR.rgb);
    pdf.setLineWidth(0.35);
    const ops = buildPolylinePath(pts, false);
    pdfPath(pdf, ops, "S");

    // Dashed horizontal continuation used by the analysis (see canvas).
    pdf.setLineWidth(0.25);
    pdf.setLineDashPattern([1.6, 1.1], 0);
    for (const [a, b] of piezoExtensions(line.coordinates, modelCoordinates)) {
      const [ax, ay] = tf.worldToPdf(a[0], a[1]);
      const [bx, by] = tf.worldToPdf(b[0], b[1]);
      pdf.line(ax, ay, bx, by);
    }
    pdf.setLineDashPattern([], 0);

    const triHalf = PIEZO_TRI_HALF_PX * tf.mmPerPx;
    const triH = PIEZO_TRI_H_PX * tf.mmPerPx;
    const barW = PIEZO_BAR_W_PX * tf.mmPerPx;
    const barGap1 = PIEZO_BAR_GAP1_PX * tf.mmPerPx;
    const barGap2 = PIEZO_BAR_GAP2_PX * tf.mmPerPx;

    // Water-table symbols spaced along the line, as on the canvas.
    for (const { x: mx, y: my, bars } of piezoSymbolLayout(line.coordinates, tf.worldToPdf, {
      unit: tf.mmPerPx,
      model: modelCoordinates,
      critical,
      taken,
      avoid: [...avoid.placed, ...obstacles.avoid],
      avoidLines: [...avoid.obstacles, ...obstacles.avoidLines],
      softLines: obstacles.softLines,
      slipMass: obstacles.slipMass,
      numbered: multiLine,
    })) {
      const triTop = my - triH;
      pdf.setFillColor(...PIEZO_COLOR.rgb);
      const triOps: PathOp[] = [
        { op: "m", c: [mx - triHalf, triTop] },
        { op: "l", c: [mx + triHalf, triTop] },
        { op: "l", c: [mx, my] },
        { op: "h", c: [] },
      ];
      pdfPath(pdf, triOps, "f");

      if (bars) {
        pdf.setDrawColor(...PIEZO_COLOR.rgb);
        pdf.setLineWidth(0.25);
        pdf.line(mx - barW, my + barGap1, mx + barW, my + barGap1);
        pdf.line(mx - barW, my + barGap2, mx + barW, my + barGap2);
      }

      if (multiLine) {
        setSansFont(pdf, "bold");
        pdf.setFontSize(8);
        pdf.setTextColor(...PIEZO_COLOR.rgb);
        pdf.text(String(lineIdx + 1), mx, triTop - 1, { align: "center" });
      }
    }
  }
}

/** Opacity of the search-limit markers in the result (as on the canvas). */
const RESULT_MARKER_OPACITY = 0.55;

/**
 * The search limits as on the canvas over a result (layoutLimitMarkers,
 * layoutRangeDots): dots along the ground over each range, none over the
 * sliding mass of `critical`, then at each limit a bar with a triangle
 * lifted clear of the ground pointing into the range (only a bar for a
 * range of zero width), a limit both ranges share drawn once. Lighter
 * than the result drawn over them.
 */
export function drawEntryExitMarkers(
  pdf: jsPDF,
  tf: PdfTransform,
  limits: AnalysisLimitsState,
  coordinates: [number, number][],
  critical: Pick<DrawableSurface, "entryPoint" | "exitPoint"> | null = null,
) {
  setOpacity(pdf, RESULT_MARKER_OPACITY);
  const radius = ENTRY_EXIT_DOT_RADIUS_PX * tf.mmPerPx * 0.8;
  for (const d of layoutRangeDots(limits, coordinates, tf.worldToPdf, tf.mmPerPx, {
    skip: critical ? [critical.entryPoint[0], critical.exitPoint[0]] : null,
    radius,
  })) {
    pdf.setFillColor(...(d.range === "entry" ? ENTRY_DOT_COLOR.rgb : EXIT_DOT_COLOR.rgb));
    pdf.circle(d.x, d.y, radius, "F");
  }
  pdf.setDrawColor(...MARKER_COLOR.rgb);
  pdf.setFillColor(...MARKER_COLOR.rgb);
  pdf.setLineWidth(0.4);
  for (const m of layoutLimitMarkers(limits, coordinates, tf.worldToPdf, tf.mmPerPx, { lifted: true })) {
    pdf.line(m.cx, m.barTop, m.cx, m.barBottom);
    for (const [tip, b1, b2] of m.triangles) {
      const triOps: PathOp[] = [
        { op: "m", c: tip },
        { op: "l", c: b1 },
        { op: "l", c: b2 },
        { op: "h", c: [] },
      ];
      pdfPath(pdf, triOps, "f");
    }
  }
  resetOpacity(pdf);
}

export function drawSlipSurfaces(
  pdf: jsPDF,
  tf: PdfTransform,
  result: AnalysisResult,
  rvs: ResultViewSettings,
) {
  if (rvs.surfaceDisplay === "critical" || result.allSurfaces.length === 0) {
    return;
  }

  const fosRange = fosScaleRange(result);
  for (let si = result.allSurfaces.length - 1; si >= 0; si--) {
    const surf = result.allSurfaces[si];
    if (result.criticalSurface && sameSurface(surf, result.criticalSurface)) {
      continue;
    }
    if (rvs.surfaceDisplay === "filter" && surf.fos > rvs.fosFilterMax) {
      continue;
    }

    const arcPts = surfacePoints(surf);
    const pdfPts = arcPts.map(([wx, wy]) => tf.worldToPdf(wx, wy));
    const color = parseColor(fosColor(surf.fos, fosRange.min, fosRange.max));

    pdf.setDrawColor(...color);
    pdf.setLineWidth(0.15);
    setOpacity(pdf, 1, SLIP_SURFACE_OPACITY);
    const ops = buildPolylinePath(pdfPts, false);
    pdfPath(pdf, ops, "S");
    resetOpacity(pdf);
  }
}

/** What the critical surface drawing needs besides the result. */
export interface CriticalSurfaceContext {
  /** Analysis options: the water in a tension crack. */
  options?: Pick<AnalysisOptions, "tensionCrackWater">;
  /** Materials and regions: slice lines in a colour that shows on the fill. */
  materials?: MaterialRow[];
  materialBoundaries?: MaterialBoundaryRow[];
  regionMaterials?: RegionMaterials;
}

export function drawCriticalSurface(
  pdf: jsPDF,
  tf: PdfTransform,
  result: AnalysisResult,
  rvs: ResultViewSettings,
  coordinates: [number, number][],
  context: CriticalSurfaceContext = {},
) {
  const cs = result.criticalSurface;
  if (!cs) return;

  const arcPts = surfacePoints(cs);
  // The crack the analysis reports (none for an entry that merely lies
  // below the ground, or a result saved without it).
  const crack = tensionCrackFace(cs);

  {
    // The ground from the entry to the exit (both corners of every
    // vertical face, and the crack face at a tension crack), then back
    // along the slip surface (as on the canvas).
    const massPts = slipMassPolygon(coordinates, cs, arcPts).map(([wx, wy]) =>
      tf.worldToPdf(wx, wy),
    );
    const ops = buildPolylinePath(massPts, true);
    pdf.setFillColor(...FAILURE_MASS_COLOR.rgb);
    setOpacity(pdf, FAILURE_MASS_FILL_OPACITY);
    pdfPath(pdf, ops, "f");
    resetOpacity(pdf);
    // A very thin mass gets a band of minimum width under the ground
    // along it, clipped to the soil (as on the canvas).
    const minWidth = MIN_SLIP_MASS_PX * tf.mmPerPx;
    if (meanThickness(massPts) < minWidth && coordinates.length >= 3) {
      pdf.saveGraphicsState();
      pdfPath(pdf, buildPolylinePath(coordinates.map(([wx, wy]) => tf.worldToPdf(wx, wy)), true), "");
      pdf.clip();
      (pdf as unknown as { discardPath?: () => void }).discardPath?.();
      pdf.setDrawColor(...FAILURE_MASS_COLOR.rgb);
      pdf.setLineWidth(2 * minWidth);
      pdf.setLineJoin("round");
      setOpacity(pdf, 1, MIN_SLIP_MASS_BAND_OPACITY);
      const ground = groundProfile(coordinates, cs.entryPoint, cs.exitPoint).map(([wx, wy]) => tf.worldToPdf(wx, wy));
      pdfPath(pdf, buildPolylinePath(ground, false), "S");
      resetOpacity(pdf);
      pdf.restoreGraphicsState();
    }
  }

  if (rvs.showSlices && result.criticalSlices.length > 0) {
    const arcYAt = (x: number): number | null => surfaceBaseYAt(cs, x);
    // As on the canvas: coincident boundaries once, every other line left
    // out where they lie closer than 3 (canvas) px.
    const { xs: xBounds, density } = sliceLines(
      result.criticalSlices,
      (x) => tf.worldToPdf(x, 0)[0] / tf.mmPerPx,
    );
    const { materials = [], materialBoundaries = [], regionMaterials = [] } = context;
    const regions =
      rvs.showSoilColor !== false && materials.length > 0
        ? computeRegions(coordinates, materialBoundaries, regionMaterials, materials[0].id)
        : [];
    const regionDark = new Map(
      regions.map((r) => [r, isDarkFill(materials.find((m) => m.id === r.materialId)?.color)]),
    );

    pdf.setLineWidth(SLICE_LINE_WIDTH_PX * tf.mmPerPx * Math.max(0.6, density));
    setOpacity(pdf, 1, SLICE_LINE_OPACITY * density);
    for (const x of xBounds) {
      const topY = surfaceYAtX(coordinates, x);
      const botY = arcYAt(x);
      if (topY === null || botY === null) continue;
      for (const part of splitVerticalByRegion(regions, x, botY, topY)) {
        const dark = part.region !== null && regionDark.get(part.region) === true;
        pdf.setDrawColor(...(dark ? SLICE_LINE_ON_DARK_COLOR.rgb : CRITICAL_SURFACE_COLOR.rgb));
        const [sx, sy] = tf.worldToPdf(x, part.y1);
        const [, ey] = tf.worldToPdf(x, part.y0);
        pdf.line(sx, sy, sx, ey);
      }
    }

    resetOpacity(pdf);
  }

  // Water in a tension crack: a blue band in the crack against the face
  // on the side of the sliding mass, from the crack bottom up to the
  // water level (as on the canvas).
  const crackWater = Math.min(1, Math.max(0, context.options?.tensionCrackWater ?? 0));
  if (crack && crackWater > 0) {
    const hw = (crack.top - crack.bottom) * crackWater;
    const [bx, by] = tf.worldToPdf(crack.x, crack.bottom);
    const [, wy] = tf.worldToPdf(crack.x, crack.bottom + hw);
    const [massX] = tf.worldToPdf(crack.x + crack.massSide, crack.bottom);
    const bandW = CRACK_WATER_WIDTH_PX * tf.mmPerPx;
    const left = massX > bx ? bx : bx - bandW;
    pdf.setFillColor(...POND_COLOR.rgb);
    setOpacity(pdf, CRACK_WATER_OPACITY);
    pdf.rect(left, wy, bandW, by - wy, "F");
    resetOpacity(pdf);
    pdf.setDrawColor(...PIEZO_COLOR.rgb);
    pdf.setLineWidth(0.25);
    pdf.line(left, wy, left + bandW, wy);
  }

  {
    // From the top of a tension crack (its face is part of the surface).
    const pts: [number, number][] = crack ? [[crack.x, crack.top], ...arcPts] : arcPts;
    const pdfPts = pts.map(([wx, wy]) => tf.worldToPdf(wx, wy));
    pdf.setDrawColor(...CRITICAL_SURFACE_COLOR.rgb);
    pdf.setLineWidth(0.5);
    const ops = buildPolylinePath(pdfPts, false);
    pdfPath(pdf, ops, "S");
  }

  if (rvs.showCentreMarker && !cs.points) {
    const [ccx, ccy] = tf.worldToPdf(cs.cx, cs.cy);
    const [epx, epy] = tf.worldToPdf(cs.entryPoint[0], cs.entryPoint[1]);
    const [xpx, xpy] = tf.worldToPdf(cs.exitPoint[0], cs.exitPoint[1]);

    pdf.setDrawColor(...CRITICAL_SURFACE_COLOR.rgb);
    pdf.setLineWidth(0.5);
    pdf.line(ccx, ccy, epx, epy);
    pdf.line(ccx, ccy, xpx, xpy);

    pdf.setFillColor(...CRITICAL_SURFACE_COLOR.rgb);
    pdf.circle(ccx, ccy, 0.8, "F");
  }

  if (rvs.showFosLabel) {
    const [ccx, ccy] = tf.worldToPdf(...fosLabelAnchor(cs));
    const fosText = cs.fos.toFixed(3);
    const labelX = ccx + 3;

    pdf.setFontSize(10);
    setSansFont(pdf, "bold");
    const tw = pdf.getTextWidth(fosText);
    pdf.setFillColor(...FOS_LABEL_BG_COLOR.rgb);
    pdf.rect(labelX - 0.5, ccy - 4.5, tw + 1, 5.5, "F");

    pdf.setTextColor(...CRITICAL_SURFACE_COLOR.rgb);
    pdf.text(fosText, labelX, ccy - 1);

    pdf.setDrawColor(...CRITICAL_SURFACE_COLOR.rgb);
    pdf.setLineWidth(0.3);
    pdf.line(labelX - 0.2, ccy, labelX + tw + 0.2, ccy);
  }
}

function measureTextAnnotationPdf(
  pdf: jsPDF,
  anno: Annotation,
  scale: number,
  projectInfo: Partial<ProjectInfo>,
  result: AnalysisResult,
  parameters: ParameterDef[],
): { w: number; h: number } {
  const fontSize = (anno.fontSize ?? ANNOTATION_DEFAULT_FONT_SIZE) * scale;
  const ptSize = fontSize / 0.3528;
  const family = mapFont(anno.fontFamily ?? ANNOTATION_DEFAULT_FONT_FAMILY);
  const style = mapFontStyle(anno.bold, anno.italic);
  if (family === PDF_SANS) setSansFont(pdf, style);
  else pdf.setFont(family, style);
  pdf.setFontSize(ptSize);
  const resolved = resolveAnnotationText({
    text: anno.text ?? "",
    projectInfo,
    result,
    parameters,
  });
  const lines = resolved.split("\n");
  const lineHeight = fontSize * ANNOTATION_LINE_HEIGHT;
  let maxW = 0;
  for (const line of lines) maxW = Math.max(maxW, pdf.getTextWidth(line));
  return { w: maxW, h: Math.max(lineHeight, lines.length * lineHeight) };
}

/**
 * Colour bar layout in mm, using the canvas proportions (bar 20 × 200,
 * labels 11, title above the bar) with the annotation scale in mm.
 */
function layoutColorBarPdf(pdf: jsPDF, result: AnalysisResult, scale: number) {
  const barW = 20 * scale;
  const barH = 200 * scale;
  const labelMm = 11 * scale;
  const labelPt = labelMm / 0.3528;
  const titleExtraTop = labelMm + 4 * scale;
  setSansFont(pdf, "normal");
  pdf.setFontSize(labelPt);
  let maxLabelW = 0;
  const fosScale = fosScaleRange(result);
  for (let t = 0; t <= COLOR_BAR_NUM_TICKS; t++) {
    maxLabelW = Math.max(
      maxLabelW,
      pdf.getTextWidth(fosTickLabel(fosScale, t, COLOR_BAR_NUM_TICKS, PDF_GE)),
    );
  }
  return {
    barW,
    barH,
    labelPt,
    titleExtraTop,
    w: barW + 5 * scale + maxLabelW,
    h: barH + titleExtraTop,
  };
}

/** Points per millimetre-sized font (1 pt = 0.3528 mm). */
const MM_PER_PT = 0.3528;

function wrapTextPdf(pdf: jsPDF, text: string, maxWidth: number): string[] {
  if (pdf.getTextWidth(text) <= maxWidth) return [text];
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= 1) return [text];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || pdf.getTextWidth(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [text];
}

/**
 * Material table layout in mm.  Uses exactly the canvas formulas
 * (features/canvas/helpers.ts drawTable/measureTable) with the annotation
 * scale in mm instead of px, so the PDF table has the same proportions as
 * on screen.  (It used to convert px to mm twice and clamp fonts to 8 pt,
 * making the table ~3.7× too small with every cell cut off.)
 */
function layoutMaterialTablePdf(
  pdf: jsPDF,
  annotation: Annotation,
  materials: MaterialRow[],
  piezometricLine: PiezometricLineState,
  scale: number,
) {
  const fontSize = annotation.fontSize ?? 6;
  const f = fontSize / 6;
  const { columnKeys, header, rows } = buildMaterialTableData(
    annotation,
    materials,
    piezometricLine,
  );
  const padding = 3 * scale;
  const rowH = 15 * scale * f;
  const fontMm = fontSize * scale;
  const bodyPt = fontMm / MM_PER_PT;
  const headerPt = fontMm / MM_PER_PT;
  const swatchW = 10 * scale * f;
  const headerLineH = Math.max(fontMm * 1.1, 11 * scale * f);

  setSansFont(pdf, "bold");
  pdf.setFontSize(headerPt);
  const headerLines = header.map((h, c) =>
    c <= 1
      ? [h]
      : wrapTextPdf(
          pdf,
          h,
          Math.max(
            20 * scale,
            getMaterialTableColumnWidthPx(columnKeys[c], scale, fontSize) -
              padding * 2,
          ),
        ),
  );
  const colW = columnKeys.map((key) =>
    getMaterialTableColumnWidthPx(key, scale, fontSize),
  );
  colW[0] = Math.max(colW[0], swatchW + padding * 2);
  const maxHeaderLines = Math.max(...headerLines.map((l) => l.length));
  const headerH = Math.max(
    22 * scale * f,
    maxHeaderLines * headerLineH + padding * 2,
  );
  const totalW = colW.reduce((a, b) => a + b, 0);
  const totalH = headerH + rows.length * rowH;
  return {
    columnKeys,
    header,
    rows,
    padding,
    rowH,
    bodyPt,
    headerPt,
    swatchW,
    headerLineH,
    headerLines,
    colW,
    headerH,
    totalW,
    totalH,
  };
}

function measureTablePdf(
  pdf: jsPDF,
  annotation: Annotation,
  materials: MaterialRow[],
  piezometricLine: PiezometricLineState,
  scale: number,
): { w: number; h: number } {
  const layout = layoutMaterialTablePdf(
    pdf,
    annotation,
    materials,
    piezometricLine,
    scale,
  );
  return { w: layout.totalW, h: layout.totalH };
}

export function drawAnnotations(
  pdf: jsPDF,
  tf: PdfTransform,
  annotations: Annotation[],
  result: AnalysisResult,
  materials: MaterialRow[],
  piezometricLine: PiezometricLineState,
  projectInfo: Partial<ProjectInfo>,
  parameters: ParameterDef[],
  paperFrame: { x: number; y: number; w: number; h: number },
) {
  const annoScale = Math.min(tf.paperW, tf.paperH) / ANNOTATION_SCALE_DIVISOR;

  for (const anno of annotations) {
    const ax = paperFrame.x + anno.x * paperFrame.w;
    const ay = paperFrame.y + anno.y * paperFrame.h;

    if (anno.type === "text") {
      const size = measureTextAnnotationPdf(
        pdf,
        anno,
        annoScale,
        projectInfo,
        result,
        parameters,
      );
      const { x: drawX, y: drawY } = anchoredTopLeft(
        ax,
        ay,
        size.w,
        size.h,
        anno.anchor,
      );
      drawTextAnnotation(
        pdf,
        drawX,
        drawY,
        anno,
        annoScale,
        projectInfo,
        result,
        parameters,
      );
    } else if (anno.type === "color-bar") {
      // Drawn whenever the canvas draws it (also for a single surface).
      const size = layoutColorBarPdf(pdf, result, annoScale);
      const { x: drawX, y: drawY } = anchoredTopLeft(
        ax,
        ay,
        size.w,
        size.h,
        anno.anchor,
      );
      drawColorBarAnnotation(pdf, drawX, drawY, result, annoScale);
    } else if (anno.type === "material-table") {
      const size = measureTablePdf(
        pdf,
        anno,
        materials,
        piezometricLine,
        annoScale,
      );
      const { x: drawX, y: drawY } = anchoredTopLeft(
        ax,
        ay,
        size.w,
        size.h,
        anno.anchor,
      );
      drawTablePdf(
        pdf,
        drawX,
        drawY,
        anno,
        materials,
        piezometricLine,
        annoScale,
      );
    } else if (anno.type === "plot") {
      const plotW = paperFrame.w * (anno.width ?? 0.24);
      const plotH = paperFrame.h * (anno.height ?? 0.18);
      const { x: drawX, y: drawY } = anchoredTopLeft(
        ax,
        ay,
        plotW,
        plotH,
        anno.anchor,
      );
      drawPlotAnnotationPdf(
        pdf,
        drawX,
        drawY,
        plotW,
        plotH,
        anno,
        result,
        annoScale,
      );
    }
  }
}

/** Mirrors the canvas slice plot (draw.ts) in paper millimetres. */
function drawPlotAnnotationPdf(
  pdf: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  anno: Annotation,
  result: AnalysisResult,
  scale: number,
) {
  const plot = computeSlicePlotData(result, anno.plotAxisX, anno.plotAxisY);
  const titleMm = 10 * scale;
  const axisMm = 9 * scale;
  const pad = 4 * scale;

  pdf.setFillColor(255, 255, 255);
  pdf.setDrawColor(120, 144, 156);
  pdf.setLineWidth(0.2);
  pdf.rect(x, y, w, h, "FD");

  setSansFont(pdf, "normal");
  pdf.setFontSize(titleMm / 0.3528);
  pdf.setTextColor(120, 144, 156);
  pdf.text(plot.title, x + 6 * scale, y + pad, { baseline: "top" });

  pdf.setFontSize(axisMm / 0.3528);
  if (!plot.range) {
    pdf.setTextColor(102, 102, 102);
    pdf.text("No slice data", x + w / 2, y + h / 2, {
      align: "center",
      baseline: "middle",
    });
    return;
  }

  const padLeft = 32 * scale;
  const padRight = 12 * scale;
  const padBottom = 22 * scale;
  const padTop = titleMm + 6 * scale;
  const chartX = x + padLeft;
  const chartY = y + padTop;
  const chartW = Math.max(2, w - padLeft - padRight);
  const chartH = Math.max(2, h - padTop - padBottom);
  const { xMin, xMax, yMin, yMax } = plot.range;
  const mapX = (v: number) => chartX + ((v - xMin) / (xMax - xMin)) * chartW;
  const mapY = (v: number) =>
    chartY + chartH - ((v - yMin) / (yMax - yMin)) * chartH;

  pdf.setDrawColor(207, 216, 220);
  pdf.setLineWidth(0.15);
  for (let i = 1; i < 4; i++) {
    const gy = chartY + (chartH * i) / 4;
    pdf.line(chartX, gy, chartX + chartW, gy);
  }
  pdf.setDrawColor(120, 144, 156);
  pdf.setLineWidth(0.2);
  pdf.rect(chartX, chartY, chartW, chartH, "S");

  pdf.setDrawColor(38, 166, 154);
  pdf.setFillColor(38, 166, 154);
  pdf.setLineWidth(Math.max(0.25, 0.35 * scale));
  for (let i = 1; i < plot.points.length; i++) {
    const a = plot.points[i - 1];
    const b = plot.points[i];
    pdf.line(mapX(a.x), mapY(a.y), mapX(b.x), mapY(b.y));
  }
  const r = Math.max(0.35, 1.8 * scale);
  for (const p of plot.points) pdf.circle(mapX(p.x), mapY(p.y), r, "F");

  pdf.setTextColor(95, 107, 115);
  pdf.text(yMax.toFixed(2), chartX - pad, chartY, {
    align: "right",
    baseline: "middle",
  });
  pdf.text(yMin.toFixed(2), chartX - pad, chartY + chartH, {
    align: "right",
    baseline: "middle",
  });
  // Axis ends, not first/last slice (descending x on rtl models).
  pdf.text(xMin.toFixed(plot.xDecimals), chartX, chartY + chartH + pad, {
    align: "center",
    baseline: "top",
  });
  pdf.text(
    xMax.toFixed(plot.xDecimals),
    chartX + chartW,
    chartY + chartH + pad,
    { align: "center", baseline: "top" },
  );
}

function drawTextAnnotation(
  pdf: jsPDF,
  x: number,
  y: number,
  anno: Annotation,
  scale: number,
  projectInfo: Partial<ProjectInfo>,
  result: AnalysisResult,
  parameters: ParameterDef[],
) {
  // Same size as on the canvas (no 8 pt floor, which made small text
  // overlap because the line spacing used the unclamped size).
  const fontSize = (anno.fontSize ?? ANNOTATION_DEFAULT_FONT_SIZE) * scale;
  const ptSize = fontSize / 0.3528;

  const family = mapFont(anno.fontFamily ?? ANNOTATION_DEFAULT_FONT_FAMILY);
  const style = mapFontStyle(anno.bold, anno.italic);

  pdf.setFont(family, style);
  pdf.setFontSize(ptSize);
  const [r, g, b] = parseColor(anno.color ?? ANNOTATION_DEFAULT_TEXT_COLOR);
  pdf.setTextColor(r, g, b);

  const resolved = resolveAnnotationText({
    text: anno.text ?? "",
    projectInfo,
    result,
    parameters,
  });
  const lines = resolved.split("\n");
  const lineHeight = fontSize * ANNOTATION_LINE_HEIGHT;

  lines.forEach((line, i) => {
    pdf.text(line, x, y + i * lineHeight, { baseline: "top" });
  });
}

function drawColorBarAnnotation(
  pdf: jsPDF,
  x: number,
  y: number,
  result: AnalysisResult,
  scale: number,
) {
  const { barW, barH, labelPt, titleExtraTop } = layoutColorBarPdf(
    pdf,
    result,
    scale,
  );
  const barY = y + titleExtraTop;

  const fosScale = fosScaleRange(result);
  const fosMin = fosScale.min;
  const fosMax = fosScale.max;
  const numSteps = 50;

  for (let i = 0; i < numSteps; i++) {
    const t = i / (numSteps - 1);
    const fos = fosMax - t * (fosMax - fosMin);
    const [r, g, b] = parseColor(fosColor(fos, fosMin, fosMax));
    pdf.setFillColor(r, g, b);
    pdf.rect(x, barY + t * barH, barW, barH / (numSteps - 1) + 0.1, "F");
  }

  pdf.setDrawColor(...MARKER_COLOR.rgb);
  pdf.setLineWidth(0.2);
  pdf.rect(x, barY, barW, barH, "S");

  pdf.setFontSize(labelPt);
  setSansFont(pdf, "bold");
  pdf.setTextColor(...MARKER_COLOR.rgb);
  pdf.text("FOS", x, barY - 4 * scale, { baseline: "bottom" });

  setSansFont(pdf, "normal");
  const labelX = x + barW + 5 * scale;
  for (let t = 0; t <= COLOR_BAR_NUM_TICKS; t++) {
    const frac = t / COLOR_BAR_NUM_TICKS;
    const ty = barY + frac * barH;

    pdf.setDrawColor(...MARKER_COLOR.rgb);
    pdf.setLineWidth(0.2);
    pdf.line(x + barW, ty, x + barW + 3 * scale, ty);

    pdf.text(fosTickLabel(fosScale, t, COLOR_BAR_NUM_TICKS, PDF_GE), labelX, ty, {
      baseline: "middle",
    });
  }
}

function drawTablePdf(
  pdf: jsPDF,
  x: number,
  y: number,
  annotation: Annotation,
  materials: MaterialRow[],
  piezometricLine: PiezometricLineState,
  scale: number,
) {
  // A shortened cell ends in "..." (the standard PDF fonts have no "…",
  // which dropped silently and left a cut-off number looking complete).
  const fitTextPdf = (text: string, maxWidth: number): string => {
    if (maxWidth <= 0) return "";
    if (pdf.getTextWidth(text) <= maxWidth) return text;
    let out = text;
    while (out.length > 1 && pdf.getTextWidth(`${out}...`) > maxWidth) {
      out = out.slice(0, -1);
    }
    return `${out}...`;
  };

  const {
    header,
    rows,
    padding,
    rowH,
    bodyPt,
    headerPt,
    swatchW,
    headerLineH,
    headerLines,
    colW,
    headerH,
    totalW,
    totalH,
  } = layoutMaterialTablePdf(pdf, annotation, materials, piezometricLine, scale);

  pdf.setFillColor(255, 255, 255);
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.35);
  pdf.rect(x, y, totalW, totalH, "FD");

  pdf.setFillColor(240, 240, 240);
  pdf.rect(x, y, totalW, headerH, "F");

  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.35);
  pdf.line(x, y + headerH, x + totalW, y + headerH);

  setSansFont(pdf, "bold");
  pdf.setFontSize(headerPt);
  pdf.setTextColor(0, 0, 0);
  let cx = x;
  for (let c = 0; c < header.length; c++) {
    const lines = headerLines[c];
    const startY = y + padding;
    for (let i = 0; i < lines.length; i++) {
      pdf.text(lines[i], cx + padding, startY + i * headerLineH, {
        baseline: "top",
      });
    }
    cx += colW[c];
  }

  setSansFont(pdf, "normal");
  pdf.setFontSize(bodyPt);
  for (let r = 0; r < rows.length; r++) {
    const ry = y + headerH + r * rowH;

    if (r % 2 === 1) {
      pdf.setFillColor(248, 248, 248);
      pdf.rect(x, ry, totalW, rowH, "F");
    }

    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.35);
    pdf.line(x, ry + rowH, x + totalW, ry + rowH);

    cx = x;
    for (let c = 0; c < rows[r].length; c++) {
      if (c === 0 && materials[r]) {
        const swatchX = cx + (colW[c] - swatchW) / 2;
        const [sr, sg, sb] = parseColor(materials[r].color);
        pdf.setFillColor(sr, sg, sb);
        const swatchY = ry + (rowH - swatchW) / 2;
        pdf.rect(swatchX, swatchY, swatchW, swatchW, "FD");
        pdf.setDrawColor(102, 102, 102);
        pdf.setLineWidth(0.1);
        pdf.rect(swatchX, swatchY, swatchW, swatchW, "S");
      }
      if (c === 0) {
        cx += colW[c];
        continue;
      }

      pdf.setTextColor(51, 51, 51);
      const fitted = fitTextPdf(rows[r][c], Math.max(2, colW[c] - padding * 2));
      pdf.text(fitted, cx + padding, ry + rowH / 2, { baseline: "middle" });
      cx += colW[c];
    }
  }

  let separatorX = x;
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.35);
  for (let c = 0; c < colW.length - 1; c++) {
    separatorX += colW[c];
    pdf.line(separatorX, y, separatorX, y + totalH);
  }
}
