import { jsPDF } from "jspdf";
import type { AnalysisResult } from "../../engine/types/analysis";
import type {
  AnalysisLimitsState,
  MaterialBoundaryRow,
  MaterialRow,
  ModelOrientation,
  PaperSize,
  ProjectInfo,
  ResultViewSettings,
} from "../../store/types";
import { PAPER_DIMENSIONS, PLOT_MARGINS } from "../../store/defaults";
import {
  drawAnnotations,
  drawClosedPolyline,
  drawCriticalSurface,
  drawEntryExitMarkers,
  drawGrid,
  drawLineLoads,
  drawMaterialRegions,
  drawOpenPolyline,
  drawPiezometricLines,
  drawRulerFrame,
  drawSlipSurfaces,
  drawUdlLoads,
} from "./pdf-drawing";
import type { PdfTransform } from "./pdf-helpers";

interface PdfViewBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface PdfExportData {
  coordinates: [number, number][];
  materials: MaterialRow[];
  materialBoundaries: MaterialBoundaryRow[];
  regionMaterials: Record<string, string>;
  result: AnalysisResult;
  resultViewSettings: ResultViewSettings;
  piezometricLine: {
    enabled: boolean;
    lines: { id: string; coordinates: [number, number][] }[];
  };
  udls: { id: string; x1: number; x2: number; magnitude: number }[];
  lineLoads: { id: string; x: number; magnitude: number }[];
  analysisLimits: AnalysisLimitsState;
  orientation: ModelOrientation;
  projectInfo?: ProjectInfo;
  viewBounds?: PdfViewBounds;
}

function createTransform(
  canvasW: number,
  canvasH: number,
  paperSize: PaperSize,
  viewOffset: [number, number],
  viewScale: number,
): PdfTransform {
  const dim = PAPER_DIMENSIONS[paperSize];
  const paperW = dim.w;
  const paperH = dim.h;

  const paperAspect = paperW / paperH;
  const margin = 20;
  const availW = canvasW - margin * 2;
  const availH = canvasH - margin * 2;
  let frameW: number;
  let frameH: number;
  if (availW / availH > paperAspect) {
    frameH = availH;
    frameW = frameH * paperAspect;
  } else {
    frameW = availW;
    frameH = frameW / paperAspect;
  }
  const pfX = (canvasW - frameW) / 2;
  const pfY = (canvasH - frameH) / 2;

  const mmPerPx = paperW / frameW;

  const canvasToPdf = (cx: number, cy: number): [number, number] => [
    (cx - pfX) * mmPerPx,
    (cy - pfY) * mmPerPx,
  ];

  const worldToPdf = (wx: number, wy: number): [number, number] => {
    const cx = canvasW / 2 + (wx + viewOffset[0]) * viewScale;
    const cy = canvasH / 2 - (wy + viewOffset[1]) * viewScale;
    return canvasToPdf(cx, cy);
  };

  return { worldToPdf, canvasToPdf, mmPerPx, paperW, paperH };
}

export function exportVectorPdf(data: PdfExportData): void {
  const {
    coordinates,
    materials,
    materialBoundaries,
    regionMaterials,
    result,
    resultViewSettings: rvs,
    piezometricLine,
    udls,
    lineLoads,
    analysisLimits,
    orientation,
    projectInfo,
    viewBounds,
  } = data;

  const paperSize = rvs.paperFrame.paperSize;
  const dim = PAPER_DIMENSIONS[paperSize];

  const virtualW = 1200;
  const virtualH = (1200 * dim.h) / dim.w;

  const PLOT_PAD_L = PLOT_MARGINS.L;
  const PLOT_PAD_B = PLOT_MARGINS.B;
  const PLOT_PAD_T = PLOT_MARGINS.T;
  const PLOT_PAD_R = PLOT_MARGINS.R;
  const plotW = virtualW * (1 - PLOT_PAD_L - PLOT_PAD_R);
  const plotH = virtualH * (1 - PLOT_PAD_T - PLOT_PAD_B);

  let viewScale: number;
  let viewOffset: [number, number];

  if (viewBounds) {
    const worldW = viewBounds.xMax - viewBounds.xMin || 10;
    const worldH = viewBounds.yMax - viewBounds.yMin || 10;

    const scaleX = plotW / worldW;
    const scaleY = plotH / worldH;
    viewScale = Math.min(scaleX, scaleY);

    const worldCx = (viewBounds.xMin + viewBounds.xMax) / 2;
    const worldCy = (viewBounds.yMin + viewBounds.yMax) / 2;

    const shiftX = (virtualW / 2) * (PLOT_PAD_L - PLOT_PAD_R);
    const shiftY = (virtualH / 2) * (PLOT_PAD_B - PLOT_PAD_T);

    const ox = shiftX / viewScale - worldCx;
    const oy = shiftY / viewScale - worldCy;

    viewOffset = [ox, oy];
  } else {
    const xs = coordinates.map((c) => c[0]);
    const ys = coordinates.map((c) => c[1]);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const worldW = xMax - xMin || 10;
    const worldH = yMax - yMin || 10;
    viewScale = Math.min(plotW / (worldW * 1.3), plotH / (worldH * 1.3));
    const plotCenterOffsetX =
      (((PLOT_PAD_L - PLOT_PAD_R) / 2) * virtualW) / viewScale;
    const plotCenterOffsetY =
      (((PLOT_PAD_B - PLOT_PAD_T) / 2) * virtualH) / viewScale;
    viewOffset = [
      -(xMin + xMax) / 2 - plotCenterOffsetX,
      -(yMin + yMax) / 2 + plotCenterOffsetY,
    ];
  }

  const tf = createTransform(
    virtualW,
    virtualH,
    paperSize,
    viewOffset,
    viewScale,
  );

  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: [dim.w, dim.h],
  });

  const PAD_L = tf.paperW * 0.06;
  const PAD_B = tf.paperH * 0.06;
  const PAD_T = tf.paperH * 0.05;
  const PAD_R = tf.paperW * 0.04;
  const innerFrame = {
    x: PAD_L,
    y: PAD_T,
    w: tf.paperW - PAD_L - PAD_R,
    h: tf.paperH - PAD_T - PAD_B,
  };

  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, 0, tf.paperW, tf.paperH, "F");

  if (rvs.showGrid) {
    drawGrid(pdf, tf, viewScale, innerFrame);
  }

  if (coordinates.length >= 3) {
    drawMaterialRegions(
      pdf,
      tf,
      coordinates,
      materials,
      materialBoundaries,
      regionMaterials,
    );
  }

  if (coordinates.length >= 3) {
    drawClosedPolyline(pdf, tf, coordinates, [0, 0, 0], 0.5);
  }

  for (const b of materialBoundaries) {
    if (b.coordinates.length >= 2) {
      drawOpenPolyline(pdf, tf, b.coordinates, [0, 0, 0], 0.5);
    }
  }

  if (udls.length > 0 && coordinates.length >= 3) {
    drawUdlLoads(pdf, tf, udls, coordinates);
  }

  if (lineLoads.length > 0 && coordinates.length >= 3) {
    drawLineLoads(pdf, tf, lineLoads, coordinates);
  }

  if (piezometricLine.lines.length > 0) {
    drawPiezometricLines(pdf, tf, piezometricLine.lines);
  }

  if (analysisLimits.enabled && coordinates.length >= 3) {
    drawEntryExitMarkers(pdf, tf, analysisLimits, coordinates, orientation);
  }

  drawSlipSurfaces(pdf, tf, result, rvs);

  drawCriticalSurface(pdf, tf, result, rvs, coordinates);

  drawAnnotations(
    pdf,
    tf,
    rvs.annotations,
    result,
    materials,
    projectInfo || {},
  );

  drawRulerFrame(pdf, tf, viewScale, innerFrame);

  pdf.save("slope-analysis.pdf");
}
