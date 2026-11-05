import { jsPDF } from "jspdf";
import { drawPdfUnderlays, type PdfUnderlay } from "../drawings/pdf-underlay";
import type { AnalysisOptions, AnalysisResult } from "@cslope/engine";
import type {
  AnalysisLimitsState,
  MaterialBoundaryRow,
  MaterialRow,
  ModelOrientation,
  ParameterDef,
  PaperSize,
  ModelWaternet,
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
  drawCentreMarkerPdf,
  drawCriticalFosLabelPdf,
  drawCriticalSlicesPdf,
  drawCriticalSurface,
  drawCustomSurfaceLabels,
  drawCustomSurfaceLines,
  drawEntryExitMarkers,
  drawGrid,
  drawLineLoads,
  drawReinforcementsPdf,
  drawPilesPdf,
  drawReinforcementForcesPdf,
  drawMaterialBoundariesClipped,
  drawMaterialRegions,
  drawWaterExtrasPdf,
  drawPiezometricLines,
  drawRulerFrame,
  drawSlipSurfaces,
  drawUdlLoads,
} from "./pdf-drawing";
import type { PdfTransform } from "./pdf-helpers";
import {
  elementNumberScene,
  FORCE_LABEL_MARGIN_PX,
  forceLabelContext,
  limitMarkerObstacles,
  loadObstacleBoxes,
} from "../canvas/reinforcement-draw";
import { ARROW_HEIGHT_PX } from "../canvas/constants";
import type { Box } from "../rendering/overlay-layout";
import { surfacePoints } from "../../utils/arc";
import { drawReferenceLabelsPdf, drawReferenceLinesPdf } from "./pdf-reference";
import { drawDrawingTitle, drawSummaryPages, type SummaryHeader } from "./pdf-summary";
import type { SummarySection } from "../export/analysisSummary";
import { clampMinorTicks } from "../../utils/ruler";
import { computeRegions } from "../../utils/regions";
import { baseLayerCount, isPaperStep, layerSteps, resultLayers } from "../results/layers";

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
  /** Imported head and reference lines, drawn as on the canvas. */
  waternet?: ModelWaternet;
  udls: { id: string; x1: number; x2: number; magnitude: number }[];
  lineLoads: { id: string; x: number; magnitude: number; angle?: number; y?: number }[];
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
  /**
   * Analysis summary: appended as text pages after the drawing unless
   * `resultViewSettings.pdfSummaryPages` is false, and written as a title
   * line above the drawing unless `resultViewSettings.pdfTitleLine` is false.
   */
  summary?: { sections: SummarySection[]; header: SummaryHeader };
  /** The placed drawings shown in results, rendered (drawings/pdf-underlay.ts): over the fills, under the lines. */
  underlays?: PdfUnderlay[];
}

/** The PDF export's page choices of a result view, with their defaults. */
export function pdfPageOptions(rvs: Pick<ResultViewSettings, "pdfSummaryPages" | "pdfTitleLine">): {
  summaryPages: boolean;
  titleLine: boolean;
} {
  return { summaryPages: rvs.pdfSummaryPages !== false, titleLine: rvs.pdfTitleLine !== false };
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
      waternet,
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
      underlays = [],
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

    // The layers of the sheet in the model's order (bottom first), as on
    // the canvas: those at the bottom, the soil colours and drawings, with
    // the model under its lines, as by default; the rest over them.
    const layers = resultLayers({ resultViewSettings: rvs, result, backgrounds: underlays.map((u) => u.placement) });
    const baseTotal = baseLayerCount(layers);
    const soilIndex = layers.slice(0, baseTotal).findIndex((l) => l.key === "soilColor");
    const underlaysOf = (from: number, to: number) =>
      layers.slice(from, to).flatMap((l) => (l.kind === "drawing" ? underlays.filter((u) => u.placement.id === l.drawing.id) : []));
    if (soilIndex > 0) drawPdfUnderlays(pdf, underlaysOf(0, soilIndex), tf.worldToPdf, innerFrame);

    if (coordinates.length >= 3) {
      drawMaterialRegions(
        pdf,
        tf,
        coordinates,
        materials,
        materialBoundaries,
        regionMaterials,
        soilIndex >= 0,
      );
    }

    // Placed drawings shown in results: over the fills, under the grid and the lines.
    drawPdfUnderlays(pdf, underlaysOf(soilIndex + 1, baseTotal), tf.worldToPdf, innerFrame);

    // Grid on top of the (opaque) regions, as on the canvas.
    if (rvs.showGrid) {
      drawGrid(pdf, tf, viewScale, innerFrame, rvs.gridSpacing, rvs.gridLineSpacing);
    }

    if (coordinates.length >= 3) {
      drawClosedPolyline(pdf, tf, coordinates, [0, 0, 0], 0.3);
    }

    // Clipped to the outline, as on the canvas.
    drawMaterialBoundariesClipped(pdf, tf, coordinates, materialBoundaries);

    // Load labels placed so far, so later ones keep clear of them.
    const loadLabels: Box[] = [];
    if (udls.length > 0 && coordinates.length >= 3) {
      drawUdlLoads(pdf, tf, udls, coordinates, loadLabels);
    }

    if (lineLoads.length > 0 && coordinates.length >= 3) {
      drawLineLoads(pdf, tf, lineLoads, coordinates, loadLabels);
    }

    // Element numbers keep off the lines and the search-limit markers, as on the canvas.
    const numberScene = elementNumberScene(
      { coordinates, materialBoundaries, piezometricLine },
      false,
      analysisLimits.enabled && !customPlanesOnly
        ? limitMarkerObstacles(analysisLimits, coordinates, tf.worldToPdf, tf.mmPerPx, 2 * tf.mmPerPx)
        : [],
    );
    if (reinforcements.length > 0) {
      drawReinforcementsPdf(pdf, tf, reinforcements, numberScene);
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
        forceLabelContext(tf.worldToPdf, { reinforcements, piles, numberSize: 2.8, numberScene }),
        {
          materialBoundaries,
          udls,
          lineLoads,
          analysisLimits: analysisLimits.enabled && !customPlanesOnly ? analysisLimits : null,
        },
        {
          regions: computeRegions(coordinates, materialBoundaries, regionMaterials, materials[0]?.id ?? ""),
          materialAssignment: piezometricLine.materialAssignment,
        },
      );
    }

    drawWaterExtrasPdf(pdf, tf, piezometricLine.rapidDrawdown?.waterBefore, waternet);

    // Not for an analysis of prescribed surfaces only (nothing was searched).
    if (analysisLimits.enabled && coordinates.length >= 3 && !customPlanesOnly) {
      drawEntryExitMarkers(pdf, tf, analysisLimits, coordinates);
    }

    // The layers over the model's lines, each a step in order: the
    // model's clipped to the plot frame, the paper annotations not; after
    // the topmost of the model's layers the reference labels (clear of the
    // lines and the FOS labels) and the reinforcement forces.
    const drawnReferences: ReturnType<typeof drawReferenceLinesPdf> = [];
    let customSurfaces: ReturnType<typeof drawCustomSurfaceLines> = [];
    let customLabelBoxes: Box[] = [];
    const criticalContext = { options, materials, materialBoundaries, regionMaterials };
    const steps = layerSteps(layers.slice(baseTotal));
    let lastModelStep = -1;
    steps.forEach((step, i) => {
      if (!isPaperStep(step)) lastModelStep = i;
    });
    let clipped = true;
    const clipToFrame = () => {
      if (clipped) return;
      pdf.saveGraphicsState();
      pdf.rect(innerFrame.x, innerFrame.y, innerFrame.w, innerFrame.h, null);
      pdf.clip();
      (pdf as unknown as { discardPath?: () => void }).discardPath?.();
      clipped = true;
    };
    const unclip = () => {
      if (!clipped) return;
      pdf.restoreGraphicsState();
      clipped = false;
    };
    const finishModel = () => {
      clipToFrame();
      // Their labels, clear of the lines and the FOS labels.
      drawReferenceLabelsPdf(pdf, tf, drawnReferences, {
        coordinates,
        materialBoundaries,
        waterLines: piezometricLine.lines,
        criticalSurface: result.criticalSurface,
        showFosLabel: rvs.showFosLabel,
        customSurfaces,
        customLabelBoxes,
        bounds: { left: innerFrame.x, top: innerFrame.y, right: innerFrame.x + innerFrame.w, bottom: innerFrame.y + innerFrame.h },
      });
      if (result.criticalSurface?.reinforcementForces?.length) {
        const cs = result.criticalSurface;
        drawReinforcementForcesPdf(
          pdf,
          tf,
          cs.reinforcementForces!,
          forceLabelContext(tf.worldToPdf, {
            reinforcements,
            piles,
            surface: surfacePoints(cs),
            numberSize: 2.8,
            model: coordinates,
            water: piezometricLine.lines.map((l) => l.coordinates),
            boundaries: materialBoundaries.map((b) => b.coordinates),
            loads: [
              ...loadObstacleBoxes(tf.worldToPdf, coordinates, udls, lineLoads, ARROW_HEIGHT_PX * tf.mmPerPx),
              ...loadLabels,
            ],
            markers:
              analysisLimits.enabled && !customPlanesOnly
                ? limitMarkerObstacles(analysisLimits, coordinates, tf.worldToPdf, tf.mmPerPx, 2 * tf.mmPerPx)
                : [],
            numberScene,
            // A margin inside the plot frame, as on the canvas.
            bounds: {
              left: innerFrame.x + FORCE_LABEL_MARGIN_PX * tf.mmPerPx,
              top: innerFrame.y + FORCE_LABEL_MARGIN_PX * tf.mmPerPx,
              right: innerFrame.x + innerFrame.w - FORCE_LABEL_MARGIN_PX * tf.mmPerPx,
              bottom: innerFrame.y + innerFrame.h - FORCE_LABEL_MARGIN_PX * tf.mmPerPx,
            },
          }),
        );
      }
      unclip();
    };
    // The custom surfaces' labels follow the critical one's.
    const drawFosLabels = () => {
      customLabelBoxes = drawCustomSurfaceLabels(pdf, tf, result, rvs);
    };
    if (lastModelStep < 0) finishModel();
    steps.forEach((step, i) => {
      if (step.kind === "paper") {
        unclip();
        drawAnnotations(
          pdf,
          tf,
          [step.annotation],
          result,
          materials,
          piezometricLine,
          projectInfo || {},
          parameters ?? [],
          annotationFrame,
          rvs,
        );
      } else {
        clipToFrame();
        if (step.kind === "references") {
          // Reference annotations: the lines under the surfaces, as on the canvas.
          drawnReferences.push(...drawReferenceLinesPdf(pdf, tf, step.annotations, coordinates));
        } else if (step.kind === "drawings") {
          drawPdfUnderlays(pdf, step.drawings.flatMap((d) => underlays.filter((u) => u.placement.id === d.id)), tf.worldToPdf, innerFrame);
        } else if (step.kind === "critical") {
          drawCriticalSurface(pdf, tf, result, rvs, coordinates, criticalContext, {
            slices: step.withSlices,
            center: step.withCenter,
            fosLabel: step.withFosLabel,
          });
          if (step.withFosLabel) drawFosLabels();
        } else if (step.layer === "soilColor") {
          if (coordinates.length >= 3) drawMaterialRegions(pdf, tf, coordinates, materials, materialBoundaries, regionMaterials, true, "fills");
        } else if (step.layer === "surfaces") {
          drawSlipSurfaces(pdf, tf, result, rvs);
        } else if (step.layer === "customSurfaces") {
          // The custom surfaces' lines under the critical surface (and its
          // FOS label's plate), their labels after it, as on the canvas.
          customSurfaces = drawCustomSurfaceLines(pdf, tf, result, rvs);
        } else if (step.layer === "slices") {
          drawCriticalSlicesPdf(pdf, tf, result, rvs, coordinates, criticalContext);
        } else if (step.layer === "center") {
          drawCentreMarkerPdf(pdf, tf, result, rvs);
        } else if (step.layer === "fosLabel") {
          drawCriticalFosLabelPdf(pdf, tf, result, rvs);
          drawFosLabels();
        }
        // (the finite element layers are not drawn in the PDF)
      }
      if (i === lastModelStep) finishModel();
    });

    drawRulerFrame(
      pdf,
      tf,
      viewScale,
      innerFrame,
      rvs.gridSpacing,
      clampMinorTicks(rvs.minorTicks ?? 0),
    );

    // Both are the user's choice (the PDF button's menu): the title line is
    // off by default, as the drawing's text annotations carry the title.
    const pages = pdfPageOptions(rvs);
    if (summary && pages.titleLine) {
      drawDrawingTitle(pdf, summary.sections, summary.header, { left: innerFrame.x, top: innerFrame.y, width: innerFrame.w });
    }
    if (summary && pages.summaryPages) {
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
