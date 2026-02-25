import { jsPDF } from "jspdf";
import { fosColor } from "../../utils/fos-color";
import { circleArcPoints } from "../../utils/arc";
import { computeRegions } from "../../utils/regions";
import { GRID_RAW_STEP_PX } from "../../constants";
import {
  GRID_STEP_MIN,
  LL_COLOR_RGB,
  UDL_COLOR_RGB,
} from "../canvas/constants";
import type { AnalysisResult } from "@cslope/engine";
import type {
  AnalysisLimitsState,
  Annotation,
  MaterialBoundaryRow,
  MaterialRow,
  ModelOrientation,
  ProjectInfo,
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
  surfaceYAtX,
  type PathOp,
  type PdfTransform,
} from "./pdf-helpers";

export function drawGrid(
  pdf: jsPDF,
  tf: PdfTransform,
  viewScale: number,
  clip: { x: number; y: number; w: number; h: number },
) {
  const rawStep = GRID_RAW_STEP_PX / viewScale;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const steps = [1, 2, 5, 10];
  const gridStep = Math.max(
    GRID_STEP_MIN,
    steps.find((s) => s * mag >= rawStep)! * mag,
  );

  const [originPdfX, originPdfY] = tf.worldToPdf(0, 0);
  const worldPerMm = 1 / (viewScale * tf.mmPerPx);

  const worldLeft = (clip.x - originPdfX) * worldPerMm;
  const worldRight = (clip.x + clip.w - originPdfX) * worldPerMm;
  const worldTop = (originPdfY - clip.y) * worldPerMm;
  const worldBottom = (originPdfY - (clip.y + clip.h)) * worldPerMm;

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

  const pixelsPerWorldUnit = innerFrame.w / (worldRight - worldLeft);
  const rulerRawStep = (10 / pixelsPerWorldUnit) * (tf.paperW / 297);
  const rawStep = Math.max(rulerRawStep, 0.5);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const stepOptions = [1, 2, 5, 10];
  const rulerStep = Math.max(
    0.5,
    stepOptions.find((s) => s * mag >= rawStep)! * mag,
  );

  pdf.setFontSize(FONT_SIZE);
  pdf.setFont("helvetica", "normal");
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
    const label = Number.isInteger(gx) ? gx.toString() : gx.toFixed(1);
    pdf.text(label, px, btmY + TICK_LEN + FONT_SIZE * 0.35 + 1.0, {
      align: "center",
    });
  }

  const xMinorStep = rulerStep / 2;
  const xMinorStart = Math.ceil(worldLeft / xMinorStep) * xMinorStep;
  for (let gx = xMinorStart; gx <= worldRight; gx += xMinorStep) {
    const [px] = tf.worldToPdf(gx, 0);
    if (px < ifx || px > ifx + ifw) continue;
    if (Math.abs(gx / rulerStep - Math.round(gx / rulerStep)) < 0.001) continue;
    pdf.setLineWidth(0.15);
    pdf.line(px, btmY, px, btmY + MINI_TICK);
  }

  const yStart = Math.ceil(worldBottom / rulerStep) * rulerStep;
  for (let gy = yStart; gy <= worldTop; gy += rulerStep) {
    const [, py] = tf.worldToPdf(0, gy);
    if (py < ify || py > ify + ifh) continue;
    pdf.setLineWidth(0.2);
    pdf.line(ifx, py, ifx - TICK_LEN, py);
    const label = Number.isInteger(gy) ? gy.toString() : gy.toFixed(1);
    pdf.text(label, ifx - TICK_LEN - 1.0, py + FONT_SIZE * 0.12, {
      align: "right",
    });
  }

  const yMinorStep = rulerStep / 2;
  const yMinorStart = Math.ceil(worldBottom / yMinorStep) * yMinorStep;
  for (let gy = yMinorStart; gy <= worldTop; gy += yMinorStep) {
    const [, py] = tf.worldToPdf(0, gy);
    if (py < ify || py > ify + ifh) continue;
    if (Math.abs(gy / rulerStep - Math.round(gy / rulerStep)) < 0.001) continue;
    pdf.setLineWidth(0.15);
    pdf.line(ifx, py, ifx - MINI_TICK, py);
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
  regionMaterials: Record<string, string>,
) {
  const defaultMatId = materials[0]?.id ?? "";
  const regions = computeRegions(
    coordinates,
    materialBoundaries,
    regionMaterials,
    defaultMatId,
  );

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

    const [r, g, b] = parseColor(mat.color);
    pdf.setFillColor(r, g, b);
    setOpacity(pdf, 0.33);
    pdfPath(pdf, ops, region.holes ? "f*" : "f");
    resetOpacity(pdf);
  }
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
  pdfPath(pdf, ops, "S");
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
  pdfPath(pdf, ops, "S");
}

export function drawUdlLoads(
  pdf: jsPDF,
  tf: PdfTransform,
  udls: { x1: number; x2: number; magnitude: number }[],
  coordinates: [number, number][],
) {
  const UDL_COLOR = UDL_COLOR_RGB;
  const arrowH = 8 * tf.mmPerPx;

  for (const u of udls) {
    const y1 = surfaceYAtX(u.x1, coordinates);
    const y2 = surfaceYAtX(u.x2, coordinates);
    if (y1 === null || y2 === null) continue;

    const [px1, py1] = tf.worldToPdf(u.x1, y1);
    const [px2, py2] = tf.worldToPdf(u.x2, y2);

    pdf.setDrawColor(...UDL_COLOR);
    pdf.setLineWidth(0.4);

    pdf.line(px1, py1 - arrowH, px1, py1);
    pdf.setFillColor(...UDL_COLOR);
    pdf.triangle(px1, py1, px1 - 1.5, py1 - 2.5, px1 + 1.5, py1 - 2.5, "F");

    pdf.line(px2, py2 - arrowH, px2, py2);
    pdf.triangle(px2, py2, px2 - 1.5, py2 - 2.5, px2 + 1.5, py2 - 2.5, "F");

    pdf.line(px1, py1 - arrowH, px2, py2 - arrowH);

    pdf.setFontSize(9);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...UDL_COLOR);
    const labelX = (px1 + px2) / 2;
    const labelY = Math.min(py1, py2) - arrowH - 1.5;
    pdf.text(`q = ${u.magnitude} kPa`, labelX, labelY, { align: "center" });
  }
}

export function drawLineLoads(
  pdf: jsPDF,
  tf: PdfTransform,
  lineLoads: { x: number; magnitude: number }[],
  coordinates: [number, number][],
) {
  const LL_COLOR = LL_COLOR_RGB;
  const arrowH = 8 * tf.mmPerPx;

  for (const ll of lineLoads) {
    const sy = surfaceYAtX(ll.x, coordinates);
    if (sy === null) continue;

    const [px, py] = tf.worldToPdf(ll.x, sy);
    pdf.setDrawColor(...LL_COLOR);
    pdf.setLineWidth(0.4);
    pdf.line(px, py - arrowH, px, py);
    pdf.setFillColor(...LL_COLOR);
    pdf.triangle(px, py, px - 1.5, py - 2.5, px + 1.5, py - 2.5, "F");

    pdf.setFontSize(9);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...LL_COLOR);
    pdf.text(`P = ${ll.magnitude} kN/m`, px, py - arrowH - 1.5, {
      align: "center",
    });
  }
}

export function drawPiezometricLines(
  pdf: jsPDF,
  tf: PdfTransform,
  lines: { id: string; coordinates: [number, number][] }[],
) {
  const PIEZO_COLOR: [number, number, number] = [26, 58, 138];
  const multiLine = lines.length > 1;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (line.coordinates.length < 2) continue;
    const pts = line.coordinates.map(([wx, wy]) => tf.worldToPdf(wx, wy));

    pdf.setDrawColor(...PIEZO_COLOR);
    pdf.setLineWidth(0.35);
    const ops = buildPolylinePath(pts, false);
    pdfPath(pdf, ops, "S");

    const triHalf = 6 * tf.mmPerPx;
    const triH = 10 * tf.mmPerPx;
    const barW = 7 * tf.mmPerPx;
    const barGap1 = 3 * tf.mmPerPx;
    const barGap2 = 6 * tf.mmPerPx;

    for (let i = 0; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;

      const triTop = my - triH;
      pdf.setFillColor(...PIEZO_COLOR);
      const triOps: PathOp[] = [
        { op: "m", c: [mx - triHalf, triTop] },
        { op: "l", c: [mx + triHalf, triTop] },
        { op: "l", c: [mx, my] },
        { op: "h", c: [] },
      ];
      pdfPath(pdf, triOps, "f");

      pdf.setDrawColor(...PIEZO_COLOR);
      pdf.setLineWidth(0.25);
      pdf.line(mx - barW, my + barGap1, mx + barW, my + barGap1);
      pdf.line(mx - barW, my + barGap2, mx + barW, my + barGap2);

      if (multiLine) {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8);
        pdf.setTextColor(...PIEZO_COLOR);
        pdf.text(String(lineIdx + 1), mx, triTop - 1, { align: "center" });
      }
    }
  }
}

export function drawEntryExitMarkers(
  pdf: jsPDF,
  tf: PdfTransform,
  limits: AnalysisLimitsState,
  coordinates: [number, number][],
  orientation: ModelOrientation,
) {
  const MARKER_COLOR: [number, number, number] = [0, 0, 0];
  const DOTTED_COLOR: [number, number, number] = [204, 0, 0];
  const barH = 10 * tf.mmPerPx;
  const sz = 7 * tf.mmPerPx;

  const drawArrow = (worldX: number, worldY: number, dir: "left" | "right") => {
    const [cx, cy] = tf.worldToPdf(worldX, worldY);

    pdf.setDrawColor(...MARKER_COLOR);
    pdf.setLineWidth(0.4);
    pdf.line(cx, cy - barH, cx, cy + barH);

    const tipX = dir === "right" ? cx - sz * 2 : cx + sz * 2;
    pdf.setFillColor(...MARKER_COLOR);
    const triOps: PathOp[] = [
      { op: "m", c: [cx, cy] },
      { op: "l", c: [tipX, cy - sz] },
      { op: "l", c: [tipX, cy + sz] },
      { op: "h", c: [] },
    ];
    pdfPath(pdf, triOps, "f");
  };

  const drawDottedSurfaceLine = (x1: number, x2: number) => {
    const leftX = Math.min(x1, x2);
    const rightX = Math.max(x1, x2);

    const surfPts: [number, number][] = [];
    const leftY = surfaceYAtX(leftX, coordinates);
    const rightY = surfaceYAtX(rightX, coordinates);
    if (leftY === null || rightY === null) return;

    surfPts.push([leftX, leftY]);
    for (const [cx, cy] of coordinates) {
      if (cx > leftX && cx < rightX) {
        const topY = surfaceYAtX(cx, coordinates);
        if (topY !== null && Math.abs(cy - topY) < 0.001) {
          surfPts.push([cx, cy]);
        }
      }
    }
    surfPts.push([rightX, rightY]);
    surfPts.sort((a, b) => a[0] - b[0]);

    if (surfPts.length < 2) return;

    const pdfPts = surfPts.map(([wx, wy]) => tf.worldToPdf(wx, wy));
    pdf.setDrawColor(...DOTTED_COLOR);
    pdf.setLineWidth(0.4);
    pdf.setLineDashPattern([0.6, 0.8], 0);
    const ops = buildPolylinePath(pdfPts, false);
    pdfPath(pdf, ops, "S");
    pdf.setLineDashPattern([], 0);
  };

  const leftHandleDir: "left" | "right" =
    orientation === "rtl" ? "left" : "right";
  const rightHandleDir: "left" | "right" =
    orientation === "rtl" ? "right" : "left";

  const entryLeftY = surfaceYAtX(limits.entryLeftX, coordinates);
  const entryRightY = surfaceYAtX(limits.entryRightX, coordinates);
  if (entryLeftY !== null) {
    drawArrow(limits.entryLeftX, entryLeftY, leftHandleDir);
  }
  if (entryRightY !== null) {
    drawArrow(limits.entryRightX, entryRightY, rightHandleDir);
  }
  if (entryLeftY !== null && entryRightY !== null) {
    drawDottedSurfaceLine(limits.entryLeftX, limits.entryRightX);
  }

  const exitLeftY = surfaceYAtX(limits.exitLeftX, coordinates);
  const exitRightY = surfaceYAtX(limits.exitRightX, coordinates);
  if (exitLeftY !== null) {
    drawArrow(limits.exitLeftX, exitLeftY, leftHandleDir);
  }
  if (exitRightY !== null) {
    drawArrow(limits.exitRightX, exitRightY, rightHandleDir);
  }
  if (exitLeftY !== null && exitRightY !== null) {
    drawDottedSurfaceLine(limits.exitLeftX, limits.exitRightX);
  }
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

  for (let si = result.allSurfaces.length - 1; si >= 0; si--) {
    const surf = result.allSurfaces[si];
    if (
      result.criticalSurface &&
      surf.cx === result.criticalSurface.cx &&
      surf.cy === result.criticalSurface.cy &&
      surf.radius === result.criticalSurface.radius
    ) {
      continue;
    }
    if (rvs.surfaceDisplay === "filter" && surf.fos > rvs.fosFilterMax) {
      continue;
    }

    const arcPts = circleArcPoints(
      surf.cx,
      surf.cy,
      surf.radius,
      surf.entryPoint,
      surf.exitPoint,
    );
    const pdfPts = arcPts.map(([wx, wy]) => tf.worldToPdf(wx, wy));
    const color = parseColor(fosColor(surf.fos, result.minFOS, result.maxFOS));

    pdf.setDrawColor(...color);
    pdf.setLineWidth(0.15);
    setOpacity(pdf, 1, 0.6);
    const ops = buildPolylinePath(pdfPts, false);
    pdfPath(pdf, ops, "S");
    resetOpacity(pdf);
  }
}

export function drawCriticalSurface(
  pdf: jsPDF,
  tf: PdfTransform,
  result: AnalysisResult,
  rvs: ResultViewSettings,
  coordinates: [number, number][],
) {
  const cs = result.criticalSurface;
  if (!cs) return;

  const arcPts = circleArcPoints(
    cs.cx,
    cs.cy,
    cs.radius,
    cs.entryPoint,
    cs.exitPoint,
  );

  {
    const entryX = cs.entryPoint[0];
    const exitX = cs.exitPoint[0];
    const minX = Math.min(entryX, exitX);
    const maxX = Math.max(entryX, exitX);

    const surfacePts: [number, number][] = [cs.entryPoint];
    for (const [bx, by] of coordinates) {
      if (bx > minX && bx < maxX) surfacePts.push([bx, by]);
    }
    surfacePts.push(cs.exitPoint);
    surfacePts.sort((a, b) => a[0] - b[0]);

    const allPts: [number, number][] = [
      ...surfacePts.map(([wx, wy]) => tf.worldToPdf(wx, wy)),
      ...arcPts.reverse().map(([wx, wy]) => tf.worldToPdf(wx, wy)),
    ];
    arcPts.reverse();

    const ops = buildPolylinePath(allPts, true);
    pdf.setFillColor(0, 0, 0);
    setOpacity(pdf, 0.12);
    pdfPath(pdf, ops, "f");
    resetOpacity(pdf);
  }

  if (rvs.showSlices && result.criticalSlices.length > 0) {
    pdf.setDrawColor(160, 160, 160);
    pdf.setLineWidth(0.15);

    const arcYAt = (x: number): number | null => {
      const dx = x - cs.cx;
      if (Math.abs(dx) > cs.radius) return null;
      return cs.cy - Math.sqrt(cs.radius * cs.radius - dx * dx);
    };

    const xBounds = new Set<number>();
    for (const slice of result.criticalSlices) {
      xBounds.add(slice.xLeft);
      xBounds.add(slice.xRight);
    }

    for (const x of xBounds) {
      const topY = surfaceYAtX(x, coordinates);
      const botY = arcYAt(x);
      if (topY === null || botY === null) continue;
      const [sx, sy] = tf.worldToPdf(x, topY);
      const [, ey] = tf.worldToPdf(x, botY);
      pdf.line(sx, sy, sx, ey);
    }
  }

  {
    const pdfPts = arcPts.map(([wx, wy]) => tf.worldToPdf(wx, wy));
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.5);
    const ops = buildPolylinePath(pdfPts, false);
    pdfPath(pdf, ops, "S");
  }

  if (rvs.showCentreMarker) {
    const [ccx, ccy] = tf.worldToPdf(cs.cx, cs.cy);
    const [epx, epy] = tf.worldToPdf(cs.entryPoint[0], cs.entryPoint[1]);
    const [xpx, xpy] = tf.worldToPdf(cs.exitPoint[0], cs.exitPoint[1]);

    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.5);
    pdf.line(ccx, ccy, epx, epy);
    pdf.line(ccx, ccy, xpx, xpy);

    pdf.setFillColor(0, 0, 0);
    pdf.circle(ccx, ccy, 0.8, "F");
  }

  if (rvs.showFosLabel) {
    const [ccx, ccy] = tf.worldToPdf(cs.cx, cs.cy);
    const fosText = cs.fos.toFixed(3);
    const labelX = ccx + 3;

    pdf.setFontSize(10);
    pdf.setFont("helvetica", "bold");
    const tw = pdf.getTextWidth(fosText);
    pdf.setFillColor(255, 255, 255);
    pdf.rect(labelX - 0.5, ccy - 4.5, tw + 1, 5.5, "F");

    pdf.setTextColor(0, 0, 0);
    pdf.text(fosText, labelX, ccy - 1);

    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.3);
    pdf.line(labelX - 0.2, ccy, labelX + tw + 0.2, ccy);
  }
}

export function drawAnnotations(
  pdf: jsPDF,
  tf: PdfTransform,
  annotations: Annotation[],
  result: AnalysisResult,
  materials: MaterialRow[],
  projectInfo: Partial<ProjectInfo>,
) {
  const annoScale = Math.min(tf.paperW, tf.paperH) / 600;

  for (const anno of annotations) {
    const ax = anno.x * tf.paperW;
    const ay = anno.y * tf.paperH;

    if (anno.type === "text") {
      drawTextAnnotation(pdf, ax, ay, anno, annoScale, projectInfo, result);
    } else if (anno.type === "color-bar" && result.allSurfaces.length > 1) {
      drawColorBarAnnotation(pdf, ax, ay, result, annoScale);
    } else if (anno.type === "input-params") {
      drawParamBlockPdf(
        pdf,
        ax,
        ay,
        "Input Parameters",
        [
          `Method: ${result.method}`,
          `Slices: ${result.criticalSlices.length}`,
          `Surfaces: ${result.allSurfaces.length}`,
        ],
        annoScale,
      );
    } else if (anno.type === "output-params") {
      const lines = [`FOS = ${result.minFOS.toFixed(3)}`];
      if (result.criticalSurface) {
        lines.push(
          `Centre: (${result.criticalSurface.cx.toFixed(1)}, ${result.criticalSurface.cy.toFixed(1)})`,
        );
        lines.push(`Radius: ${result.criticalSurface.radius.toFixed(2)} m`);
      }
      lines.push(`Time: ${result.elapsedMs.toFixed(0)} ms`);
      drawParamBlockPdf(pdf, ax, ay, "Results", lines, annoScale);
    } else if (anno.type === "material-table") {
      drawTablePdf(pdf, ax, ay, materials, annoScale);
    }
  }
}

function resolveAnnotationText(
  text: string,
  projectInfo: Partial<ProjectInfo>,
  result?: AnalysisResult,
): string {
  if (!text) return "";
  let t = text;

  if (projectInfo) {
    t = t.replace(/#Title/gi, projectInfo.title ?? "");
    t = t.replace(/#Subtitle/gi, projectInfo.subtitle ?? "");
    t = t.replace(/#Date/gi, projectInfo.date ?? "");
    t = t.replace(/#Author/gi, projectInfo.author ?? "");
    t = t.replace(/#Client/gi, projectInfo.client ?? "");
    t = t.replace(/#ProjectNumber/gi, projectInfo.projectNumber ?? "");
    t = t.replace(/#Revision/gi, projectInfo.revision ?? "");
    t = t.replace(/#Checker/gi, projectInfo.checker ?? "");
    t = t.replace(/#Description/gi, projectInfo.description ?? "");
  }

  if (result) {
    t = t.replace(/#Method/gi, result.method);
    const minFOS = result.minFOS?.toFixed(3) ?? "N/A";
    t = t.replace(/#FOS/gi, minFOS);
    t = t.replace(/#MinFOS/gi, minFOS);
  }

  t = t.replace(/\\n/g, "\n");

  return t;
}

function drawTextAnnotation(
  pdf: jsPDF,
  x: number,
  y: number,
  anno: Annotation,
  scale: number,
  projectInfo: Partial<ProjectInfo>,
  result: AnalysisResult,
) {
  const fontSize = (anno.fontSize ?? 12) * scale;
  const ptSize = Math.max(8, fontSize / 0.3528);

  const family = mapFont(anno.fontFamily ?? "sans-serif");
  const style = mapFontStyle(anno.bold, anno.italic);

  pdf.setFont(family, style);
  pdf.setFontSize(ptSize);
  const [r, g, b] = parseColor(anno.color ?? "#000000");
  pdf.setTextColor(r, g, b);

  const resolved = resolveAnnotationText(anno.text ?? "", projectInfo, result);
  const lines = resolved.split("\n");
  const lineHeight = fontSize * 1.2;

  lines.forEach((line, i) => {
    pdf.text(line, x, y + fontSize * 0.8 + i * lineHeight);
  });
}

function drawColorBarAnnotation(
  pdf: jsPDF,
  x: number,
  y: number,
  result: AnalysisResult,
  scale: number,
) {
  const barW = 5 * scale;
  const barH = 50 * scale;

  const fosMin = result.minFOS;
  const fosMax = result.maxFOS;
  const numSteps = 50;

  for (let i = 0; i < numSteps; i++) {
    const t = i / (numSteps - 1);
    const fos = fosMax - t * (fosMax - fosMin);
    const [r, g, b] = parseColor(fosColor(fos, fosMin, fosMax));
    pdf.setFillColor(r, g, b);
    pdf.rect(x, y + t * barH, barW, barH / (numSteps - 1) + 0.1, "F");
  }

  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.2);
  pdf.rect(x, y, barW, barH, "S");

  pdf.setFontSize(Math.max(8, 8 * scale));
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(0, 0, 0);
  pdf.text("FOS", x, y - 2 * scale);

  const numTicks = 5;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(Math.max(7, 7 * scale));

  for (let t = 0; t <= numTicks; t++) {
    const frac = t / numTicks;
    const ty = y + frac * barH;
    const fos = fosMax - frac * (fosMax - fosMin);

    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.2);
    pdf.line(x + barW, ty, x + barW + 1.5 * scale, ty);

    pdf.text(fos.toFixed(2), x + barW + 2 * scale, ty + 1 * scale);
  }
}

function drawParamBlockPdf(
  pdf: jsPDF,
  x: number,
  y: number,
  title: string,
  lines: string[],
  scale: number,
) {
  const bodyPt = Math.max(8, (3 * scale) / 0.3528);
  const titlePt = Math.max(9, (3 * scale) / 0.3528);

  const bodyH = bodyPt * 0.3528;
  const titleH = titlePt * 0.3528;

  const padding = Math.max(1.5, 2 * scale);
  const lineHeight = Math.max(bodyH * 1.2, 4 * scale);
  const titleHeight = Math.max(titleH * 1.2, 5 * scale);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(titlePt);
  let maxW = pdf.getTextWidth(title);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(bodyPt);
  for (const line of lines) {
    maxW = Math.max(maxW, pdf.getTextWidth(line));
  }

  const boxW = maxW + padding * 2;
  const boxH = titleHeight + lines.length * lineHeight + padding;

  pdf.setFillColor(255, 255, 255);
  pdf.setDrawColor(51, 51, 51);
  pdf.setLineWidth(0.2);
  pdf.rect(x, y, boxW, boxH, "FD");

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(titlePt);
  pdf.setTextColor(0, 0, 0);
  pdf.text(title, x + padding, y + padding + titleHeight * 0.6);

  pdf.setDrawColor(204, 204, 204);
  pdf.setLineWidth(0.1);
  pdf.line(x + 1, y + titleHeight, x + boxW - 1, y + titleHeight);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(bodyPt);
  pdf.setTextColor(51, 51, 51);
  for (let i = 0; i < lines.length; i++) {
    pdf.text(
      lines[i],
      x + padding,
      y + titleHeight + 1 + (i + 0.7) * lineHeight,
    );
  }
}

function drawTablePdf(
  pdf: jsPDF,
  x: number,
  y: number,
  materials: MaterialRow[],
  scale: number,
) {
  const header = ["Material", "γ", "φ", "c"];
  const rows = materials.map((m) => [
    m.name,
    `${m.unitWeight}`,
    `${m.frictionAngle}°`,
    `${m.cohesion}`,
  ]);

  const bodyPt = Math.max(8, (2.8 * scale) / 0.3528);
  const headerPt = Math.max(9, (2.8 * scale) / 0.3528);

  const padding = Math.max(1.5, 1.5 * scale);
  const rowH = Math.max(bodyPt * 0.3528 * 1.3, 4.5 * scale);
  const headerH = Math.max(headerPt * 0.3528 * 1.3, 5.5 * scale);
  const swatchW = 3 * scale;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(headerPt);
  const colW = header.map((h) => pdf.getTextWidth(h) + padding * 2);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(bodyPt);
  for (const row of rows) {
    for (let c = 0; c < row.length; c++) {
      colW[c] = Math.max(colW[c], pdf.getTextWidth(row[c]) + padding * 2);
    }
  }
  colW[0] += swatchW + 1;

  const totalW = colW.reduce((a, b) => a + b, 0);
  const totalH = headerH + rows.length * rowH;

  pdf.setFillColor(255, 255, 255);
  pdf.setDrawColor(51, 51, 51);
  pdf.setLineWidth(0.2);
  pdf.rect(x, y, totalW, totalH, "FD");

  pdf.setFillColor(240, 240, 240);
  pdf.rect(x, y, totalW, headerH, "F");

  pdf.setDrawColor(204, 204, 204);
  pdf.setLineWidth(0.1);
  pdf.line(x, y + headerH, x + totalW, y + headerH);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(headerPt);
  pdf.setTextColor(0, 0, 0);
  let cx = x;
  for (let c = 0; c < header.length; c++) {
    pdf.text(
      header[c],
      cx + padding + (c === 0 ? swatchW + 1 : 0),
      y + headerH * 0.65,
    );
    cx += colW[c];
  }

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(bodyPt);
  for (let r = 0; r < rows.length; r++) {
    const ry = y + headerH + r * rowH;

    if (r % 2 === 1) {
      pdf.setFillColor(248, 248, 248);
      pdf.rect(x, ry, totalW, rowH, "F");
    }

    pdf.setDrawColor(238, 238, 238);
    pdf.line(x, ry + rowH, x + totalW, ry + rowH);

    cx = x;
    for (let c = 0; c < rows[r].length; c++) {
      if (c === 0 && materials[r]) {
        const [sr, sg, sb] = parseColor(materials[r].color);
        pdf.setFillColor(sr, sg, sb);
        pdf.rect(cx + padding, ry + 0.8, swatchW, swatchW, "FD");
        pdf.setDrawColor(102, 102, 102);
        pdf.setLineWidth(0.1);
        pdf.rect(cx + padding, ry + 0.8, swatchW, swatchW, "S");
      }

      pdf.setTextColor(51, 51, 51);
      pdf.text(
        rows[r][c],
        cx + padding + (c === 0 ? swatchW + 1 : 0),
        ry + rowH * 0.65,
      );
      cx += colW[c];
    }
  }
}
