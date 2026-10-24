import { jsPDF } from "jspdf";
import type { AnalysisOptions, AnalysisResult } from "@cslope/engine";
import type {
  AnalysisLimitsState,
  MaterialBoundaryRow,
  MaterialRow,
  ModelOrientation,
  ParameterDef,
  PaperSize,
  PiezometricLineState,
  ProjectInfo,
  RegionMaterials,
  PileRow,
  ReinforcementRow,
  ResultViewSettings,
} from "../../store/types";
import { PLOT_MARGINS } from "../../store/defaults";
import { computeInnerFrame, computePaperFrame, getPaperDimensions } from "../view/paper";
import { computeViewLockFit } from "../view/fit";
import {
  drawAnnotations,
  drawClosedPolyline,
  drawCriticalSurface,
  drawEntryExitMarkers,
  drawGrid,
  drawLineLoads,
  drawReinforcementsPdf,
  drawPilesPdf,
  drawReinforcementForcesPdf,
  drawMaterialRegions,
  drawOpenPolyline,
  drawPiezometricLines,
  drawRulerFrame,
  drawSlipSurfaces,
  drawUdlLoads,
} from "./pdf-drawing";
import type { PdfTransform } from "./pdf-helpers";
import { forceLabelContext } from "../canvas/reinforcement-draw";
import type { Box } from "../rendering/overlay-layout";
import { surfacePoints } from "../../utils/arc";
import { drawSummaryPages, type SummaryHeader } from "./pdf-summary";
import type { SummarySection } from "../export/analysisSummary";
import { clampMinorTicks } from "../../utils/ruler";

interface PdfViewBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

function pdfNum(value: number, decimals = 12): string {
  if (!Number.isFinite(value)) return "0";
  const fixed = value.toFixed(decimals);
  return fixed.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function buildPdfFilename(projectInfo?: ProjectInfo): string {
  return buildExportFilename(projectInfo, "pdf");
}

/** File name for an exported view, from the project title or number. */
export function buildExportFilename(
  projectInfo: ProjectInfo | undefined,
  extension: string,
): string {
  const preferredBase =
    projectInfo?.title?.trim() ||
    projectInfo?.projectNumber?.trim() ||
    "slope-analysis";

  const sanitizedBase = preferredBase
    .normalize("NFKD")
    .replace(/[<>:"/\\|?*]/g, "")
    .split("")
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code < 0 || code > 31;
    })
    .join("")
    .replace(/\s+/g, " ")
    .replace(/\.+$/, "")
    .trim()
    .slice(0, 120);

  const safeBase = sanitizedBase.length > 0 ? sanitizedBase : "slope-analysis";
  return `${safeBase}.${extension}`;
}

export interface PdfExportData {
  coordinates: [number, number][];
  materials: MaterialRow[];
  materialBoundaries: MaterialBoundaryRow[];
  regionMaterials: RegionMaterials;
  result: AnalysisResult;
  resultViewSettings: ResultViewSettings;
  piezometricLine: PiezometricLineState;
  udls: { id: string; x1: number; x2: number; magnitude: number }[];
  lineLoads: { id: string; x: number; magnitude: number }[];
  reinforcements?: ReinforcementRow[];
  piles?: PileRow[];
  analysisLimits: AnalysisLimitsState;
  /** Analysis options (the water in a tension crack). */
  options?: Pick<AnalysisOptions, "tensionCrackWater">;
  /** Only prescribed surfaces were analysed: no search limits are drawn. */
  customPlanesOnly?: boolean;
  orientation: ModelOrientation;
  projectInfo?: ProjectInfo;
  parameters?: ParameterDef[];
  viewBounds?: PdfViewBounds;
  /** Analysis summary, appended as text pages after the drawing. */
  summary?: { sections: SummarySection[]; header: SummaryHeader };
}

function createTransform(
  canvasW: number,
  canvasH: number,
  paperSize: PaperSize,
  landscape: boolean,
  viewOffset: [number, number],
  viewScale: number,
): PdfTransform {
  const { width: paperW, height: paperH } = getPaperDimensions(
    paperSize,
    landscape,
  );
  const pf = computePaperFrame(canvasW, canvasH, paperSize, landscape);

  const mmPerPx = paperW / pf.w;

  const canvasToPdf = (cx: number, cy: number): [number, number] => [
    (cx - pf.x) * mmPerPx,
    (cy - pf.y) * mmPerPx,
  ];

  const worldToPdf = (wx: number, wy: number): [number, number] => {
    const cx = canvasW / 2 + (wx + viewOffset[0]) * viewScale;
    const cy = canvasH / 2 - (wy + viewOffset[1]) * viewScale;
    return canvasToPdf(cx, cy);
  };

  return { worldToPdf, canvasToPdf, mmPerPx, paperW, paperH };
}

export function exportVectorPdf(data: PdfExportData): void {
  try {
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
      reinforcements = [],
      piles = [],
      analysisLimits,
      options,
      customPlanesOnly = false,
      projectInfo,
      parameters,
      viewBounds,
      summary,
    } = data;

    const hasSurfaces =
      Array.isArray(result?.allSurfaces) && result.allSurfaces.length > 0;
    const hasCriticalSurface = Boolean(result?.criticalSurface);
    if (!hasSurfaces || !hasCriticalSurface) {
      window.alert(
        "No analysis results available to export. Run analysis first, then export PDF.",
      );
      return;
    }

    const paperSize = rvs.paperFrame.paperSize;
    const landscape = rvs.paperFrame.landscape;
    const { width: paperW, height: paperH } = getPaperDimensions(
      paperSize,
      landscape,
    );

    const virtualW = 1200;
    const virtualH = (1200 * paperH) / paperW;
    const virtualPaperFrame = computePaperFrame(
      virtualW,
      virtualH,
      paperSize,
      landscape,
    );

    const PLOT_PAD_L = PLOT_MARGINS.L;
    const PLOT_PAD_B = PLOT_MARGINS.B;
    const PLOT_PAD_T = PLOT_MARGINS.T;
    const PLOT_PAD_R = PLOT_MARGINS.R;
    const plotW = virtualPaperFrame.w * (1 - PLOT_PAD_L - PLOT_PAD_R);
    const plotH = virtualPaperFrame.h * (1 - PLOT_PAD_T - PLOT_PAD_B);

    let viewScale: number;
    let viewOffset: [number, number];

    // A reversed or empty locked view (e.g. Right X < Left X typed in the
    // view lock fields) falls back to auto-fit like the canvas does,
    // instead of a mirrored, off-page drawing.
    const usableBounds =
      viewBounds &&
      viewBounds.xMax > viewBounds.xMin &&
      viewBounds.yMax > viewBounds.yMin
        ? viewBounds
        : null;
    // Same placement as the canvas (useViewport): a lock whose aspect
    // differs from the plot area is centred horizontally with its bottom
    // on the bottom of the plot frame (it used to be centred vertically,
    // so the PDF did not match the screen).
    const lockFit = usableBounds
      ? computeViewLockFit(
          computeInnerFrame(virtualPaperFrame),
          {
            bottomLeft: [usableBounds.xMin, usableBounds.yMin],
            topRight: [usableBounds.xMax, usableBounds.yMax],
          },
          virtualW,
          virtualH,
        )
      : null;
    if (lockFit) {
      viewScale = lockFit.scale;
      viewOffset = lockFit.offset;
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
        (((PLOT_PAD_L - PLOT_PAD_R) / 2) * virtualPaperFrame.w) / viewScale;
      const plotCenterOffsetY =
        (((PLOT_PAD_B - PLOT_PAD_T) / 2) * virtualPaperFrame.h) / viewScale;
      viewOffset = [
        -(xMin + xMax) / 2 - plotCenterOffsetX,
        -(yMin + yMax) / 2 + plotCenterOffsetY,
      ];
    }

    const tf = createTransform(
      virtualW,
      virtualH,
      paperSize,
      landscape,
      viewOffset,
      viewScale,
    );

    const [afx0, afy0] = tf.canvasToPdf(
      virtualPaperFrame.x,
      virtualPaperFrame.y,
    );
    const [afx1, afy1] = tf.canvasToPdf(
      virtualPaperFrame.x + virtualPaperFrame.w,
      virtualPaperFrame.y + virtualPaperFrame.h,
    );
    const annotationFrame = {
      x: afx0,
      y: afy0,
      w: afx1 - afx0,
      h: afy1 - afy0,
    };

    const pdf = new jsPDF({
      orientation: landscape ? "landscape" : "portrait",
      unit: "mm",
      format: [paperW, paperH],
    });

    const PAD_L = tf.paperW * PLOT_MARGINS.L;
    const PAD_B = tf.paperH * PLOT_MARGINS.B;
    const PAD_T = tf.paperH * PLOT_MARGINS.T;
    const PAD_R = tf.paperW * PLOT_MARGINS.R;
    const innerFrame = {
      x: PAD_L,
      y: PAD_T,
      w: tf.paperW - PAD_L - PAD_R,
      h: tf.paperH - PAD_T - PAD_B,
    };

    // Inject PDF Viewport and Measure dictionary for accurate scaling in PDF viewers.
    // Calibrate from the actual transform output (1 m reference segment), and scope
    // the viewport to the inner plotting frame (where model geometry is drawn).
    const ptsPerMm = 72 / 25.4;
    const [wx0, wy0] = tf.worldToPdf(0, 0);
    const [wx1, wy1] = tf.worldToPdf(1, 0);
    const mmPerWorld = Math.hypot(wx1 - wx0, wy1 - wy0);
    const ptsPerWorld = mmPerWorld * ptsPerMm;
    const metersPerPt = ptsPerWorld > 0 ? 1 / ptsPerWorld : 0;
    const metersPerMm = mmPerWorld > 0 ? 1 / mmPerWorld : 0;

    const bboxX0 = 0;
    const bboxX1 = tf.paperW * ptsPerMm;
    const bboxY0 = 0;
    const bboxY1 = tf.paperH * ptsPerMm;

    const metersPerPtPdf = pdfNum(metersPerPt, 12);
    const metersPerMmPdf = pdfNum(metersPerMm, 9);
    const areaPerPt2Pdf = pdfNum(metersPerPt * metersPerPt, 15);

    const measureDict = `<< /Type /Measure /Subtype /RL /R (1 mm = ${metersPerMmPdf} m) /X [ << /Type /NumberFormat /U (m) /C ${metersPerPtPdf} /D 3 >> ] /Y [ << /Type /NumberFormat /U (m) /C ${metersPerPtPdf} /D 3 >> ] /D [ << /Type /NumberFormat /U (m) /C ${metersPerPtPdf} /D 3 >> ] /A [ << /Type /NumberFormat /U (sq m) /C ${areaPerPt2Pdf} /D 3 >> ] >>`;

    type PdfInternalWithOut = typeof pdf.internal & {
      out: (chunk: string) => void;
    };
    const pdfInternal = pdf.internal as PdfInternalWithOut;

    // Scale and viewport belong to the drawing (page 1), not to the
    // summary pages after it.
    pdf.internal.events.subscribe("putPage", function (page: { pageNumber?: number }) {
      if (page?.pageNumber !== undefined && page.pageNumber !== 1) return;
      pdfInternal.out(`/Measure ${measureDict}`);
      pdfInternal.out(
        `/VP [ << /Type /Viewport /Name (Model Space) /BBox [${pdfNum(bboxX0, 4)} ${pdfNum(bboxY0, 4)} ${pdfNum(bboxX1, 4)} ${pdfNum(bboxY1, 4)}] /Measure ${measureDict} >> ]`,
      );
    });

    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, tf.paperW, tf.paperH, "F");

    pdf.saveGraphicsState();
    pdf.rect(innerFrame.x, innerFrame.y, innerFrame.w, innerFrame.h, null);
    pdf.clip();
    (pdf as unknown as { discardPath?: () => void }).discardPath?.();

    if (coordinates.length >= 3) {
      drawMaterialRegions(
        pdf,
        tf,
        coordinates,
        materials,
        materialBoundaries,
        regionMaterials,
        rvs.showSoilColor ?? true,
      );
    }

    // Grid on top of the (opaque) regions, as on the canvas.
    if (rvs.showGrid) {
      drawGrid(pdf, tf, viewScale, innerFrame, rvs.gridSpacing);
    }

    if (coordinates.length >= 3) {
      drawClosedPolyline(pdf, tf, coordinates, [0, 0, 0], 0.5);
    }

    for (const b of materialBoundaries) {
      if (b.coordinates.length >= 2) {
        drawOpenPolyline(pdf, tf, b.coordinates, [0, 0, 0], 0.5);
      }
    }

    // Load labels placed so far, so later ones keep clear of them.
    const loadLabels: Box[] = [];
    if (udls.length > 0 && coordinates.length >= 3) {
      drawUdlLoads(pdf, tf, udls, coordinates, loadLabels);
    }

    if (lineLoads.length > 0 && coordinates.length >= 3) {
      drawLineLoads(pdf, tf, lineLoads, coordinates, loadLabels);
    }

    if (reinforcements.length > 0) {
      drawReinforcementsPdf(pdf, tf, reinforcements);
    }
    if (piles.length > 0) {
      drawPilesPdf(pdf, tf, piles);
    }

    if (piezometricLine.lines.length > 0) {
      drawPiezometricLines(
        pdf,
        tf,
        piezometricLine.lines,
        coordinates,
        piezometricLine.freeWater !== false,
        piezometricLine.mainLineId,
        result.criticalSurface ?? null,
        forceLabelContext(tf.worldToPdf, { reinforcements, piles, numberSize: 2.8 }),
      );
    }

    // Not for an analysis of prescribed surfaces only (nothing was searched).
    if (analysisLimits.enabled && coordinates.length >= 3 && !customPlanesOnly) {
      drawEntryExitMarkers(pdf, tf, analysisLimits, coordinates);
    }

    drawSlipSurfaces(pdf, tf, result, rvs);

    drawCriticalSurface(pdf, tf, result, rvs, coordinates, {
      options,
      materials,
      materialBoundaries,
      regionMaterials,
    });
    if (result.criticalSurface?.reinforcementForces?.length) {
      const cs = result.criticalSurface;
      drawReinforcementForcesPdf(
        pdf,
        tf,
        cs.reinforcementForces!,
        forceLabelContext(tf.worldToPdf, { reinforcements, piles, surface: surfacePoints(cs), numberSize: 2.8 }),
      );
    }

    pdf.restoreGraphicsState();

    drawAnnotations(
      pdf,
      tf,
      rvs.annotations,
      result,
      materials,
      piezometricLine,
      projectInfo || {},
      parameters ?? [],
      annotationFrame,
    );

    drawRulerFrame(
      pdf,
      tf,
      viewScale,
      innerFrame,
      rvs.gridSpacing,
      clampMinorTicks(rvs.minorTicks ?? 0),
    );

    if (summary) {
      drawSummaryPages(pdf, summary.sections, summary.header, {
        w: tf.paperW,
        h: tf.paperH,
        landscape,
      });
    }

    pdf.save(buildPdfFilename(projectInfo));
  } catch (error) {
    console.error("PDF export failed", error);
    window.alert(
      "PDF export failed. Please try again or simplify the model before exporting.",
    );
  }
}
