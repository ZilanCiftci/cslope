import { isPointInPolygon } from "@cslope/engine";
import { PAPER_DIMENSIONS, PLOT_MARGINS } from "../../store/app-store";
import type { AppState } from "../../store/types";
import {
  circleArcPoints,
  fosLabelAnchor,
  sameSurface,
  surfaceBaseYAt,
  surfacePoints,
  type DrawableSurface,
} from "../../utils/arc";
import { fosColor, fosScaleRange, fosTickLabel } from "../../utils/fos-color";
import { computeRegions } from "../../utils/regions";
import { circleEntryExit } from "../../utils/custom-plane";
import {
  ARROW_HEAD_LEN_PX,
  ARROW_HEAD_PX,
  ARROW_HEIGHT_PX,
  GRID_STEP_MIN,
  HATCH_SPACING_PX,
  POINT_COLOR,
  POINT_COLOR_HOVER,
  POINT_COLOR_SELECTED,
  POINT_RADIUS,
  cssVar,
  RULER_SIZE_PX,
} from "./constants";
import { GRID_RAW_STEP_PX } from "../../constants";
import {
  clampMinorTicks,
  computeRulerStep,
  formatRulerLabel,
  resolveTickStep,
} from "../../utils/ruler";
import {
  buildMaterialTableData,
  computePaperFrame,
  drawTable,
  getAnnotationBoundsPx,
  measureTable,
} from "./helpers";
import { resolveAnnotationText } from "../annotations/resolveAnnotationText";
import { anchoredTopLeft } from "../annotations/anchorPosition";
import { computeSlicePlotData } from "../annotations/slicePlotData";
import type { PointHit } from "./types";
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
  LINE_LOAD_COLOR,
  MARKER_COLOR,
  MIN_SLIP_MASS_BAND_OPACITY,
  MIN_SLIP_MASS_PX,
  PIEZO_BAR_GAP1_PX,
  PIEZO_BAR_GAP2_PX,
  PIEZO_BAR_W_PX,
  PIEZO_COLOR,
  POND_COLOR,
  POND_ARROW_OPACITY,
  POND_ARROW_WIDTH_PX,
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
import { drawCanvasHatch, drawCanvasHatchLabel } from "../rendering/hatch";
import {
  drawPiles,
  drawReinforcementForces,
  drawReinforcements,
  elementNumberScene,
  FORCE_LABEL_MARGIN_PX,
  forceLabelContext,
  limitMarkerObstacles,
  loadObstacleBoxes,
} from "./reinforcement-draw";
import {
  LOAD_LABEL_FONT_PX,
  layoutLoads,
  layoutPiezoSymbols,
  loadArrowBoxes,
  piezoSymbolBox,
  type LoadArrow,
  type LoadLayout,
} from "./overlay-geometry";
import type { PiezoSymbol } from "../rendering/piezo-layout";
import { layoutLimitMarkers, layoutRangeDots } from "../rendering/search-markers";
import { crackMarkerPosition, limitMarkerBoxes, limitMarkerGeometry, rangeMarkerEnds } from "./marker-geometry";
import { freeWaterPonds, mainPiezoLine, piezoExtensions } from "../../utils/piezo";
import { pondArrowLayout, type PondArrow } from "../rendering/pond-arrows";
import {
  isDarkFill,
  meanThickness,
  groundProfile,
  sliceLines,
  slipMassPolygon,
  splitVerticalByRegion,
  tensionCrackFace,
} from "../../utils/slip-mass";
import {
  boxAround,
  distanceToSegment,
  growBox,
  LabelLayout,
  outwardDirection,
  pointInBox,
  pointLabelCandidates,
  segmentsInside,
  type Box,
  type Seg,
} from "./label-layout";

const arcPointCache = new WeakMap<object, Map<string, [number, number][]>>();

/** A vertex coordinate label waiting to be placed. */
export interface PointLabel {
  text: string;
  px: number;
  py: number;
  /** Prefer below the point (its space above is inside the boundary). */
  below: boolean;
  /**
   * Preferred direction from the point (canvas, y down), e.g. away from
   * the fill at a boundary vertex; overrides `below`.
   */
  prefer?: [number, number];
  /** Hovered or selected: shown even when every position is taken. */
  force?: boolean;
}

const POINT_LABEL_FONT = "10px 'Segoe UI', sans-serif";
const POINT_LABEL_PAD_X = 3;
const POINT_LABEL_H = 13;
/** Opacity of the background-coloured plate under a point label. */
export const POINT_LABEL_PLATE_ALPHA = 0.9;

/**
 * Draws a point's coordinate label at the first free position around the
 * point (see `pointLabelCandidates`): in its preferred direction (away
 * from the fill), then turning gradually to either side and a little
 * farther out. Positions are moved inside the layout bounds, so rulers
 * and the canvas edge don't clip a label. A label with no free position is
 * left out unless `force` is set; then it goes to its preferred position.
 * It sits on a plate of the background colour so grid lines, fills and
 * markers under it don't hide it. Returns whether it was drawn.
 */
export function drawPointLabel(
  ctx: CanvasRenderingContext2D,
  label: PointLabel,
  layout: LabelLayout,
  colors: { text: string; plate: string },
): boolean {
  ctx.font = POINT_LABEL_FONT;
  const boxW = ctx.measureText(label.text).width + POINT_LABEL_PAD_X * 2;
  const box = layout.place(
    pointLabelCandidates(label.px, label.py, boxW, POINT_LABEL_H, label.prefer ?? label.below, POINT_RADIUS),
    label.force,
  );
  if (!box) return false;
  ctx.save();
  ctx.globalAlpha = POINT_LABEL_PLATE_ALPHA;
  ctx.fillStyle = colors.plate;
  ctx.fillRect(box.left, box.top, boxW, POINT_LABEL_H);
  ctx.restore();
  ctx.fillStyle = colors.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label.text, box.left + POINT_LABEL_PAD_X, box.top + POINT_LABEL_H / 2 + 0.5);
  ctx.textBaseline = "alphabetic";
  return true;
}

/**
 * Places point labels greedily in their order; hovered and selected labels
 * that find no free position are drawn last, over the others, at their
 * preferred position (so hovering doesn't shuffle the other labels). A
 * label repeating one already drawn (coincident points) is left out.
 */
export function drawPointLabels(
  ctx: CanvasRenderingContext2D,
  labels: readonly PointLabel[],
  layout: LabelLayout,
  colors: { text: string; plate: string },
): void {
  const late: PointLabel[] = [];
  const drawn = new Set<string>();
  for (const l of labels) {
    if (drawn.has(l.text)) {
      // A hovered duplicate shows over the others, taking no space.
      if (l.force) late.push(l);
      continue;
    }
    if (drawPointLabel(ctx, { ...l, force: false }, layout, colors)) drawn.add(l.text);
    else if (l.force) late.push(l);
  }
  for (const l of late) drawPointLabel(ctx, l, layout, colors);
}

/**
 * Boxes of the symbols and labels drawn over the model in edit view that
 * vertex labels keep clear of: search-limit markers, load arrows, load
 * bands and their labels, water-table symbols, element numbers and pile
 * labels. `drawn` passes what the frame already laid out (the loads, with
 * a hovered arrow, and the water-table symbols) and whether the search
 * limits are shown; without it they are laid out here.
 */
export function editOverlayBoxes(
  ctx: CanvasRenderingContext2D,
  p: Pick<
    DrawCanvasParams,
    | "w"
    | "h"
    | "coordinates"
    | "analysisLimits"
    | "udls"
    | "lineLoads"
    | "piezometricLine"
    | "reinforcements"
    | "piles"
    | "worldToCanvas"
    | "surfaceYAtX"
  > &
    Partial<Pick<DrawCanvasParams, "materialBoundaries">>,
  drawn: { loads?: LoadLayout; piezoSymbols?: PiezoSymbol[][]; showLimits?: boolean } = {},
): Box[] {
  const { w, h, coordinates, surfaceYAtX } = p;
  const toC = (x: number, y: number) => p.worldToCanvas(x, y, w, h);
  const boxes: Box[] = [];
  // Search-limit markers where the markers block draws them.
  const lim = p.analysisLimits;
  if ((drawn.showLimits ?? lim.enabled) && coordinates.length >= 3) {
    const pairs: [number, number][] = [
      [lim.entryLeftX, lim.entryRightX],
      [lim.exitLeftX, lim.exitRightX],
    ];
    for (const [xa, xb] of pairs) {
      for (const end of rangeMarkerEnds(xa, xb)) {
        const y = surfaceYAtX(end.x);
        if (y === null) continue;
        const [cx, cy] = toC(end.x, y);
        const toward = end.toward === null ? null : toC(end.toward, y)[0];
        boxes.push(...limitMarkerBoxes(limitMarkerGeometry(cx, cy, toward)));
      }
    }
  }
  // Loads: arrows (a little wider for the hovered, thicker stroke), the
  // bands under the UDL tops and the labels.
  const view = { w, h, coordinates, worldToCanvas: p.worldToCanvas, surfaceYAtX };
  const loads = drawn.loads ?? layoutLoads(ctx, view, p.udls, p.lineLoads, null);
  for (const a of [...loads.udlGroups.flatMap((g) => g.arrows), ...loads.lineLoads]) {
    for (const b of loadArrowBoxes(a)) boxes.push(growBox(b, 1.5));
  }
  for (const g of loads.udlGroups) {
    for (const st of g.strips) {
      for (let i = 1; i < st.top.length; i++) {
        const xs = [st.top[i - 1][0], st.top[i][0]];
        const ys = [st.top[i - 1][1], st.top[i][1], st.ground[i - 1][1], st.ground[i][1]];
        boxes.push({ left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) });
      }
    }
  }
  for (const l of loads.labels) boxes.push(l.box);
  const numbered = p.piezometricLine.lines.length > 1;
  const symbols = drawn.piezoSymbols ?? layoutPiezoSymbols(view, p.piezometricLine, p.reinforcements, p.piles);
  for (const line of symbols) {
    for (const sym of line) boxes.push(piezoSymbolBox(sym, 1, numbered));
  }
  // Element numbers beyond the head, pile labels above the head (as the
  // force labels and water-table symbols keep clear of them).
  boxes.push(
    ...forceLabelContext(toC, {
      reinforcements: p.reinforcements,
      piles: p.piles,
      numberSize: 11,
      numberScene: elementNumberScene(p, true),
    }).placed,
  );
  return boxes;
}

/** A crack depth for its label: one decimal, two below 1 m. */
function formatCrackDepth(d: number): string {
  return d < 0.995 ? d.toFixed(2) : d.toFixed(1);
}

type ArcSurface = DrawableSurface;

type RegionCacheEntry = {
  coordinatesRef: DrawCanvasParams["coordinates"];
  materialBoundariesRef: DrawCanvasParams["materialBoundaries"];
  regionMaterialsRef: DrawCanvasParams["regionMaterials"];
  defaultMaterialId: string;
  regions: ReturnType<typeof computeRegions>;
};

let regionCache: RegionCacheEntry | null = null;

function getCachedRegions(
  coordinates: DrawCanvasParams["coordinates"],
  materialBoundaries: DrawCanvasParams["materialBoundaries"],
  regionMaterials: DrawCanvasParams["regionMaterials"],
  defaultMaterialId: string,
): ReturnType<typeof computeRegions> {
  if (
    regionCache &&
    regionCache.coordinatesRef === coordinates &&
    regionCache.materialBoundariesRef === materialBoundaries &&
    regionCache.regionMaterialsRef === regionMaterials &&
    regionCache.defaultMaterialId === defaultMaterialId
  ) {
    return regionCache.regions;
  }

  const regions = computeRegions(
    coordinates,
    materialBoundaries,
    regionMaterials,
    defaultMaterialId,
  );

  regionCache = {
    coordinatesRef: coordinates,
    materialBoundariesRef: materialBoundaries,
    regionMaterialsRef: regionMaterials,
    defaultMaterialId,
    regions,
  };

  return regions;
}

function getArcCache(result: AppState["result"]) {
  if (!result || typeof result !== "object") return null;
  const key = result as object;
  const existing = arcPointCache.get(key);
  if (existing) return existing;
  const created = new Map<string, [number, number][]>();
  arcPointCache.set(key, created);
  return created;
}

/** Load arrows in ponded water (pondArrowLayout), in the water line's colour. */
function drawPondArrows(ctx: CanvasRenderingContext2D, arrows: PondArrow[], paperZoom: number) {
  ctx.strokeStyle = PIEZO_COLOR.hex;
  ctx.fillStyle = PIEZO_COLOR.hex;
  ctx.lineWidth = POND_ARROW_WIDTH_PX * paperZoom;
  for (const a of arrows) {
    ctx.beginPath();
    ctx.moveTo(a.tail[0], a.tail[1]);
    ctx.lineTo(a.base[0], a.base[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(a.tip[0], a.tip[1]);
    ctx.lineTo(a.b1[0], a.b1[1]);
    ctx.lineTo(a.b2[0], a.b2[1]);
    ctx.closePath();
    ctx.fill();
  }
}

function getArcKey(surf: ArcSurface): string {
  return [
    surf.cx,
    surf.cy,
    surf.radius,
    surf.entryPoint[0],
    surf.entryPoint[1],
    surf.exitPoint[0],
    surf.exitPoint[1],
  ].join("|");
}

export interface DrawCanvasParams {
  w: number;
  h: number;
  mode: AppState["mode"];
  result: AppState["result"];
  resultViewSettings: AppState["resultViewSettings"];
  orientation: AppState["orientation"];
  coordinates: AppState["coordinates"];
  materials: AppState["materials"];
  materialBoundaries: AppState["materialBoundaries"];
  regionMaterials: AppState["regionMaterials"];
  selectedRegionKey: AppState["selectedRegionKey"];
  editingAssignment: boolean;
  selectedAnnotationIds: AppState["selectedAnnotationIds"];
  selectedResultObject: AppState["selectedResultObject"];
  projectInfo: AppState["projectInfo"];
  parameters: AppState["parameters"];
  analysisLimits: AppState["analysisLimits"];
  /** Analysis options (tension crack); optional for callers without one. */
  options?: AppState["options"];
  /**
   * Only prescribed surfaces are analysed (no search): the result shows no
   * search limits.
   */
  customPlanesOnly?: boolean;
  udls: AppState["udls"];
  lineLoads: AppState["lineLoads"];
  reinforcements?: AppState["reinforcements"];
  piles?: AppState["piles"];
  piezometricLine: AppState["piezometricLine"];
  /** Prescribed slip surfaces, drawn faintly in edit view. */
  customSearchPlanes?: AppState["customSearchPlanes"];
  viewScale: number;
  mouseWorld: [number, number] | null;
  hoverHit: PointHit | null;
  selectedPointIndex: number | null;
  selectedMaterialBoundaryId: string | null;
  interiorBoundariesDialogOpen: boolean;
  worldToCanvas: (
    wx: number,
    wy: number,
    w: number,
    h: number,
  ) => [number, number];
  canvasToWorld: (
    cx: number,
    cy: number,
    w: number,
    h: number,
  ) => [number, number];
  surfaceYAtX: (x: number) => number | null;
  editingExterior: boolean;
  editingBoundaries: boolean;
  editingPiezo: boolean;
}

export function drawCanvas(
  ctx: CanvasRenderingContext2D,
  {
    w,
    h,
    mode,
    result,
    resultViewSettings,
    orientation,
    coordinates,
    materials,
    materialBoundaries,
    regionMaterials,
    selectedRegionKey,
    editingAssignment,
    selectedAnnotationIds,
    selectedResultObject,
    projectInfo,
    parameters,
    analysisLimits,
    options,
    customPlanesOnly = false,
    udls,
    lineLoads,
    reinforcements,
    piles,
    piezometricLine,
    customSearchPlanes,
    viewScale,
    mouseWorld,
    hoverHit,
    selectedPointIndex,
    selectedMaterialBoundaryId,
    interiorBoundariesDialogOpen,
    worldToCanvas,
    canvasToWorld,
    surfaceYAtX,
    editingExterior,
    editingBoundaries,
    editingPiezo,
  }: DrawCanvasParams,
) {
  // Read theme-aware colors
  const BG_COLOR = cssVar("--color-canvas-bg");
  const GRID_COLOR = "rgba(0, 0, 0, 0.1)";
  const GRID_TEXT_COLOR = cssVar("--color-canvas-grid-text");
  const AXIS_COLOR = cssVar("--color-canvas-axis");
  const POLY_STROKE = cssVar("--color-canvas-poly-stroke");
  const STROKE_ACTIVE = cssVar("--color-canvas-stroke-active");
  const STROKE_INACTIVE = cssVar("--color-canvas-stroke-inactive");
  const REGION_SELECT = cssVar("--color-canvas-region-select");
  const CROSSHAIR_COLOR = cssVar("--color-canvas-crosshair");
  const PAPER_OUTSIDE_COLOR = cssVar("--color-canvas-paper-outside");
  const PAPER_FILL_COLOR = cssVar("--color-canvas-paper");
  const PAPER_SHADOW_COLOR = cssVar("--color-canvas-paper-shadow");
  const PAPER_TICK_COLOR = cssVar("--color-canvas-paper-ticks");
  const PAPER_BORDER_COLOR = cssVar("--color-canvas-paper-border");
  const SELECTED_BOUNDARY_COLOR = "#f59e0b";
  const MARKER_BASE = cssVar("--color-canvas-marker") || MARKER_COLOR.hex;
  // Point labels stay off the rulers (left and bottom) and the canvas edge.
  const labelBounds: Box = { left: RULER_SIZE_PX + 2, top: 2, right: w - 2, bottom: h - RULER_SIZE_PX - 2 };
  const labelColors = { text: STROKE_ACTIVE, plate: BG_COLOR };
  // Point labels are placed after the search-limit markers so no marker
  // covers them, clear of the point symbols, the lines and the edit-only
  // overlays collected here (canvas px).
  const pointLabels: PointLabel[] = [];
  const pointSymbols: Box[] = [];
  const labelLines: { seg: Seg; pad: number }[] = [];
  // Off-screen points get no label (it would be pushed into the view).
  const labelMargin = POINT_RADIUS;
  const onScreen = (px: number, py: number) => pointInBox(px, py, { left: 0, top: 0, right: w, bottom: h }, labelMargin);

  // Background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, w, h);

  // ── Paper background (result mode) — drawn before grid so geometry appears on top ──
  if (mode === "result" && result) {
    const { paperFrame: pf0Frame } = resultViewSettings;
    {
      const pf0 = computePaperFrame(
        w,
        h,
        pf0Frame.paperSize,
        pf0Frame.landscape,
        pf0Frame.zoom ?? 1,
        pf0Frame.offsetX ?? 0,
        pf0Frame.offsetY ?? 0,
      );
      // Theme-aware background outside paper
      ctx.save();
      ctx.fillStyle = PAPER_OUTSIDE_COLOR;
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.rect(pf0.x, pf0.y, pf0.w, pf0.h);
      ctx.fill("evenodd");
      ctx.restore();

      // Paper shadow
      ctx.save();
      ctx.shadowColor = PAPER_SHADOW_COLOR;
      ctx.shadowBlur = 12;
      ctx.shadowOffsetX = 4;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = PAPER_FILL_COLOR;
      ctx.fillRect(pf0.x, pf0.y, pf0.w, pf0.h);
      ctx.restore();

      // Clip geometry to an inset plot area (leaves room for ticks+labels)
      // Use standardized percentage margins (same as pdf-export and view-lock logic)
      const PLOT_PAD_L = pf0.w * PLOT_MARGINS.L;
      const PLOT_PAD_B = pf0.h * PLOT_MARGINS.B;
      const PLOT_PAD_T = pf0.h * PLOT_MARGINS.T;
      const PLOT_PAD_R = pf0.w * PLOT_MARGINS.R;

      ctx.save();
      ctx.beginPath();
      ctx.rect(
        pf0.x + PLOT_PAD_L,
        pf0.y + PLOT_PAD_T,
        pf0.w - PLOT_PAD_L - PLOT_PAD_R,
        pf0.h - PLOT_PAD_T - PLOT_PAD_B,
      );
      ctx.clip();
    }
  }

  // ── Grid ───────────────────────────────────────────────
  const showGrid = mode !== "result" || !result || resultViewSettings.showGrid;
  const [tlx, tly] = canvasToWorld(0, 0, w, h);
  const [brx, bry] = canvasToWorld(w, h, w, h);
  const worldLeft = Math.min(tlx, brx);
  const worldRight = Math.max(tlx, brx);
  const worldBottom = Math.min(tly, bry);
  const worldTop = Math.max(tly, bry);
  let gridWorldBounds = {
    xMin: worldLeft,
    xMax: worldRight,
    yMin: worldBottom,
    yMax: worldTop,
  };
  let gridCanvasBounds = {
    xMin: 0,
    xMax: w,
    yMin: 0,
    yMax: h,
  };

  let effectiveScale = viewScale;
  // Result view: the major-tick spacing of the paper frame, which the grid
  // shares ("Ticks spacing" sets both).
  let resultTickStep: number | null = null;
  if (mode === "result" && result) {
    const { paperSize, landscape } = resultViewSettings.paperFrame;
    const pfGrid = computePaperFrame(
      w,
      h,
      paperSize,
      landscape,
      resultViewSettings.paperFrame.zoom ?? 1,
      resultViewSettings.paperFrame.offsetX ?? 0,
      resultViewSettings.paperFrame.offsetY ?? 0,
    );
    const padL = pfGrid.w * PLOT_MARGINS.L;
    const padR = pfGrid.w * PLOT_MARGINS.R;
    const padT = pfGrid.h * PLOT_MARGINS.T;
    const padB = pfGrid.h * PLOT_MARGINS.B;

    const ifx = pfGrid.x + padL;
    const ify = pfGrid.y + padT;
    const ifw = pfGrid.w - padL - padR;
    const ifh = pfGrid.h - padT - padB;

    const [innerLeftX] = canvasToWorld(ifx, ify, w, h);
    const [innerRightX] = canvasToWorld(ifx + ifw, ify, w, h);
    const [, innerTopY] = canvasToWorld(ifx, ify, w, h);
    const [, innerBottomY] = canvasToWorld(ifx, ify + ifh, w, h);

    gridWorldBounds = {
      xMin: Math.min(innerLeftX, innerRightX),
      xMax: Math.max(innerLeftX, innerRightX),
      yMin: Math.min(innerBottomY, innerTopY),
      yMax: Math.max(innerBottomY, innerTopY),
    };
    gridCanvasBounds = {
      xMin: ifx,
      xMax: ifx + ifw,
      yMin: ify,
      yMax: ify + ifh,
    };

    const { w: dimW, h: dimH } = PAPER_DIMENSIONS[paperSize];
    const paperWidthMm = landscape
      ? Math.max(dimW, dimH)
      : Math.min(dimW, dimH);
    const paperHeightMm = landscape
      ? Math.min(dimW, dimH)
      : Math.max(dimW, dimH);
    resultTickStep = resolveTickStep(
      resultViewSettings.gridSpacing,
      computeRulerStep(
        innerRightX - innerLeftX,
        paperWidthMm * (1 - PLOT_MARGINS.L - PLOT_MARGINS.R),
        paperWidthMm,
        [innerLeftX, innerRightX],
      ),
    );
    const virtualW = 1200;
    const virtualH = (1200 * paperHeightMm) / paperWidthMm;
    const virtualPaperFrame = computePaperFrame(
      virtualW,
      virtualH,
      paperSize,
      landscape,
    );
    const virtualPlotW =
      virtualPaperFrame.w * (1 - PLOT_MARGINS.L - PLOT_MARGINS.R);
    const visibleWorldW = gridWorldBounds.xMax - gridWorldBounds.xMin;

    if (visibleWorldW > 0) {
      effectiveScale = virtualPlotW / visibleWorldW;
    }
  }

  // Zoom scale factor: in result mode, scale pixel-based sizes with paper zoom
  // so that ticks, markers, labels etc. maintain their visual proportion to the model.
  const paperZoom =
    mode === "result" && result
      ? Math.max(0.25, resultViewSettings.paperFrame.zoom ?? 1)
      : 1;

  const rawStep = GRID_RAW_STEP_PX / effectiveScale;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const steps = [1, 2, 5, 10];
  const autoGridStep = Math.max(
    GRID_STEP_MIN,
    steps.find((s) => s * mag >= rawStep)! * mag,
  );
  // On the paper the grid lines run through the labelled ticks; their
  // separately rounded automatic steps used to differ (e.g. grid 5 m,
  // ticks 2 m).
  const gridStep = resultTickStep ?? autoGridStep;

  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1 * paperZoom;
  ctx.font = `${10 * paperZoom}px 'Segoe UI', sans-serif`;
  ctx.fillStyle = GRID_TEXT_COLOR;
  ctx.textAlign = "center";

  const drawGridLayer = () => {
    if (!showGrid) return;

    // Vertical grid lines
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1 * paperZoom;
    const startX = Math.floor(gridWorldBounds.xMin / gridStep) * gridStep;
    for (let gx = startX; gx <= gridWorldBounds.xMax; gx += gridStep) {
      const [px] = worldToCanvas(gx, 0, w, h);
      ctx.beginPath();
      ctx.moveTo(px, gridCanvasBounds.yMin);
      ctx.lineTo(px, gridCanvasBounds.yMax);
      ctx.stroke();
    }

    // Horizontal grid lines
    const startY = Math.floor(gridWorldBounds.yMin / gridStep) * gridStep;
    for (let gy = startY; gy <= gridWorldBounds.yMax; gy += gridStep) {
      const [, py] = worldToCanvas(0, gy, w, h);
      ctx.beginPath();
      ctx.moveTo(gridCanvasBounds.xMin, py);
      ctx.lineTo(gridCanvasBounds.xMax, py);
      ctx.stroke();
    }

    // Axes (origin lines)
    ctx.strokeStyle = AXIS_COLOR;
    ctx.lineWidth = 1 * paperZoom;
    const [ax0] = worldToCanvas(0, 0, w, h);
    const [, ay0] = worldToCanvas(0, 0, w, h);
    ctx.beginPath();
    ctx.moveTo(ax0, gridCanvasBounds.yMin);
    ctx.lineTo(ax0, gridCanvasBounds.yMax);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(gridCanvasBounds.xMin, ay0);
    ctx.lineTo(gridCanvasBounds.xMax, ay0);
    ctx.stroke();
  };

  // ── Material region fills ─────────────────────────────
  if (coordinates.length >= 3) {
    const showSoilColor = resultViewSettings.showSoilColor !== false;
    const defaultMatId = materials[0]?.id ?? "";
    const regions = getCachedRegions(
      coordinates,
      materialBoundaries,
      regionMaterials,
      defaultMatId,
    );

    // Clip to model polygon so material colors cannot bleed outside the model
    ctx.save();
    ctx.beginPath();
    const [cx0, cy0] = worldToCanvas(
      coordinates[0][0],
      coordinates[0][1],
      w,
      h,
    );
    ctx.moveTo(cx0, cy0);
    for (let i = 1; i < coordinates.length; i++) {
      const [cpx, cpy] = worldToCanvas(
        coordinates[i][0],
        coordinates[i][1],
        w,
        h,
      );
      ctx.lineTo(cpx, cpy);
    }
    ctx.closePath();
    ctx.clip();

    for (const region of regions) {
      const mat = materials.find((m) => m.id === region.materialId);
      if (!mat || region.px.length < 3) continue;

      ctx.beginPath();
      // Outer boundary
      const [sx, sy] = worldToCanvas(region.px[0], region.py[0], w, h);
      ctx.moveTo(sx, sy);
      for (let i = 1; i < region.px.length; i++) {
        const [rpx, rpy] = worldToCanvas(region.px[i], region.py[i], w, h);
        ctx.lineTo(rpx, rpy);
      }
      ctx.closePath();

      // Inner holes (for donut regions created by closed boundaries)
      if (region.holes) {
        for (const hole of region.holes) {
          if (hole.px.length < 3) continue;
          const [hx0, hy0] = worldToCanvas(hole.px[0], hole.py[0], w, h);
          ctx.moveTo(hx0, hy0);
          for (let i = 1; i < hole.px.length; i++) {
            const [hx, hy] = worldToCanvas(hole.px[i], hole.py[i], w, h);
            ctx.lineTo(hx, hy);
          }
          ctx.closePath();
        }
      }

      if (showSoilColor) {
        ctx.fillStyle = mat.color;
        ctx.fill(region.holes ? "evenodd" : "nonzero");
      }

      if (mode === "result") {
        ctx.strokeStyle = POLY_STROKE;
        ctx.lineWidth = 0.6 * paperZoom;
        ctx.lineJoin = "round"; // no mitre spikes at sharp corners
        ctx.stroke();
        ctx.lineJoin = "miter";
      }

      // ── Hatch pattern overlay for special model kinds ──
      const modelKind = mat.model?.kind;
      const hatchPattern = modelKind
        ? MODEL_HATCH_PATTERNS[modelKind]
        : undefined;
      if (showSoilColor && hatchPattern) {
        const canvasPts: [number, number][] = region.px.map((_, i) =>
          worldToCanvas(region.px[i], region.py[i], w, h),
        );
        // Clip to region polygon for hatch lines
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(canvasPts[0][0], canvasPts[0][1]);
        for (let i = 1; i < canvasPts.length; i++) {
          ctx.lineTo(canvasPts[i][0], canvasPts[i][1]);
        }
        ctx.closePath();
        if (region.holes) {
          for (const hole of region.holes) {
            if (hole.px.length < 3) continue;
            const hPts: [number, number][] = hole.px.map((_, i) =>
              worldToCanvas(hole.px[i], hole.py[i], w, h),
            );
            ctx.moveTo(hPts[0][0], hPts[0][1]);
            for (let i = 1; i < hPts.length; i++) {
              ctx.lineTo(hPts[i][0], hPts[i][1]);
            }
            ctx.closePath();
          }
        }
        ctx.clip(region.holes ? "evenodd" : "nonzero");
        drawCanvasHatch(ctx, canvasPts, hatchPattern);
        ctx.restore();

        // Label at centroid (outside clip so it's not clipped)
        if (hatchPattern.label) {
          const labelPts: [number, number][] = region.px.map((_, i) =>
            worldToCanvas(region.px[i], region.py[i], w, h),
          );
          drawCanvasHatchLabel(ctx, labelPts, hatchPattern.label);
        }
      }
    }
    ctx.restore();

    // ── Highlight selected region (only when Material Assignment is open) ──
    if (selectedRegionKey && editingAssignment) {
      const sel = regions.find((r) => r.regionKey === selectedRegionKey);
      if (sel && sel.px.length >= 3) {
        // Helper to build the combined outer+holes path
        const buildSelPath = () => {
          ctx.beginPath();
          const [sx0, sy0] = worldToCanvas(sel.px[0], sel.py[0], w, h);
          ctx.moveTo(sx0, sy0);
          for (let i = 1; i < sel.px.length; i++) {
            const [rpx, rpy] = worldToCanvas(sel.px[i], sel.py[i], w, h);
            ctx.lineTo(rpx, rpy);
          }
          ctx.closePath();
          if (sel.holes) {
            for (const hole of sel.holes) {
              if (hole.px.length < 3) continue;
              const [hx0, hy0] = worldToCanvas(hole.px[0], hole.py[0], w, h);
              ctx.moveTo(hx0, hy0);
              for (let i = 1; i < hole.px.length; i++) {
                const [hx, hy] = worldToCanvas(hole.px[i], hole.py[i], w, h);
                ctx.lineTo(hx, hy);
              }
              ctx.closePath();
            }
          }
        };

        ctx.save();

        // Clip to region shape so border only appears within it
        buildSelPath();
        ctx.clip("evenodd");

        // Solid accent border (width doubled since half is clipped)
        ctx.strokeStyle = REGION_SELECT;
        ctx.lineWidth = 6;
        buildSelPath();
        ctx.stroke();

        ctx.restore();
      }
    }
  }

  // Draw grid above model fills so lines remain visible over colored regions.
  drawGridLayer();

  // ── External boundary stroke ─────────────────────────
  if (coordinates.length >= 3) {
    ctx.beginPath();
    const [sx, sy] = worldToCanvas(coordinates[0][0], coordinates[0][1], w, h);
    ctx.moveTo(sx, sy);
    for (let i = 1; i < coordinates.length; i++) {
      const [px, py] = worldToCanvas(
        coordinates[i][0],
        coordinates[i][1],
        w,
        h,
      );
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = POLY_STROKE;
    ctx.lineWidth = 1 * paperZoom;
    // Round joins: a mitre at a sharp toe sticks out far past the corner.
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.lineJoin = "miter";
  }

  // ── Material boundary lines ─────────────────────────────
  if (
    mode !== "result" &&
    materialBoundaries.length > 0 &&
    coordinates.length >= 3
  ) {
    // Only the part inside the exterior boundary divides the soil, so the
    // lines are clipped to it. Definitions often run past the model (to
    // x = -1, or wider than the ground); while the boundaries are edited the
    // outside part is shown faint and dashed so the points out there stay
    // connected to their line, otherwise it is left out.
    const exteriorPath = () => {
      coordinates.forEach(([x, y], i) => {
        const [px, py] = worldToCanvas(x, y, w, h);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
    };
    const strokeBoundaries = () => {
      for (const b of materialBoundaries) {
        if (b.coordinates.length < 2) continue;
        const isSelectedBoundary =
          interiorBoundariesDialogOpen &&
          selectedMaterialBoundaryId !== null &&
          b.id === selectedMaterialBoundaryId;
        ctx.strokeStyle = isSelectedBoundary
          ? SELECTED_BOUNDARY_COLOR
          : POLY_STROKE;
        ctx.lineWidth = isSelectedBoundary ? 2 : 1;
        ctx.beginPath();
        b.coordinates.forEach(([x, y], i) => {
          const [px, py] = worldToCanvas(x, y, w, h);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      }
    };
    ctx.save();
    ctx.beginPath();
    exteriorPath();
    ctx.clip();
    strokeBoundaries();
    ctx.restore();
    if (editingBoundaries) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      exteriorPath();
      ctx.clip("evenodd");
      ctx.globalAlpha = 0.45;
      ctx.setLineDash([4, 4]);
      strokeBoundaries();
      ctx.restore();
    }
  }

  // ── Prescribed slip surfaces (edit view) ────────────────
  // Custom circles and polylines, dashed: a circle from where it enters
  // the ground to where it leaves it (the entry and exit the analysis
  // takes), a polyline clipped to the model. A circle the analysis can't
  // use (no such entry and exit) shows fainter, its part in the soil. A
  // halo of the background colour keeps them visible on dark fills.
  if (mode !== "result" && customSearchPlanes?.length && coordinates.length >= 3) {
    const extC = coordinates.map(([x, y]) => worldToCanvas(x, y, w, h));
    const inModel = (x: number, y: number) =>
      isPointInPolygon(x, y, extC.map((c) => c[0]), extC.map((c) => c[1]));
    const strokeDashed = (path: () => void, alpha: number) => {
      ctx.save();
      ctx.setLineDash([]);
      ctx.strokeStyle = BG_COLOR;
      ctx.globalAlpha = 0.55 * alpha;
      ctx.lineWidth = 4;
      ctx.beginPath();
      path();
      ctx.stroke();
      ctx.strokeStyle = MARKER_BASE;
      ctx.globalAlpha = 0.85 * alpha;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      path();
      ctx.stroke();
      ctx.restore();
    };
    const polyPath = (pts: [number, number][]) => () =>
      pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.save();
    ctx.beginPath();
    extC.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.clip();
    for (const s of customSearchPlanes) {
      if (s.points) {
        if (s.points.length < 2) continue;
        const pts = s.points.map(([x, y]) => worldToCanvas(x, y, w, h));
        strokeDashed(polyPath(pts), 1);
        for (const seg of segmentsInside(pts, extC, inModel)) labelLines.push({ seg, pad: 2 });
        continue;
      }
      if (!(s.radius > 0)) continue;
      const ends = circleEntryExit(coordinates, s.cx, s.cy, s.radius, orientation === "rtl");
      if (ends) {
        const pts = circleArcPoints(s.cx, s.cy, s.radius, ends[0], ends[1], 90).map(([x, y]) =>
          worldToCanvas(x, y, w, h),
        );
        strokeDashed(polyPath(pts), 1);
        for (let i = 1; i < pts.length; i++) {
          labelLines.push({ seg: [pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]], pad: 2 });
        }
      } else {
        const [cx, cy] = worldToCanvas(s.cx, s.cy, w, h);
        const [ex] = worldToCanvas(s.cx + s.radius, s.cy, w, h);
        strokeDashed(() => ctx.arc(cx, cy, Math.abs(ex - cx), 0, Math.PI * 2), 0.4);
      }
    }
    ctx.restore();
  }

  // ── UDL and line loads (geometry from layoutLoads) ───────
  const loads = layoutLoads(ctx, { w, h, coordinates, worldToCanvas, surfaceYAtX }, udls, lineLoads, hoverHit, paperZoom);
  const drawDownArrow = ({ cx, cy, top }: LoadArrow, color: string, lineWidth: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth * paperZoom;
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(cx, cy);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy); // tip on the ground
    ctx.lineTo(cx - ARROW_HEAD_PX * paperZoom, cy - ARROW_HEAD_LEN_PX * paperZoom);
    ctx.lineTo(cx + ARROW_HEAD_PX * paperZoom, cy - ARROW_HEAD_LEN_PX * paperZoom);
    ctx.closePath();
    ctx.fill();
  };
  for (const g of loads.udlGroups) {
    const { strips } = g;
    // Hatched area under the top edge.
    ctx.save();
    ctx.beginPath();
    for (const s of strips) {
      s.top.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      for (let i = s.ground.length - 1; i >= 0; i--) ctx.lineTo(s.ground[i][0], s.ground[i][1]);
      ctx.closePath();
    }
    ctx.clip();
    ctx.strokeStyle = UDL_LOAD_COLOR.hex;
    ctx.lineWidth = 1 * paperZoom;
    ctx.globalAlpha = 0.5;
    const allPts = strips.flatMap((s) => [...s.ground, ...s.top]);
    const minX = Math.min(...allPts.map(([x]) => x));
    const maxX = Math.max(...allPts.map(([x]) => x));
    const minY = Math.min(...allPts.map(([, y]) => y));
    const maxY = Math.max(...allPts.map(([, y]) => y));
    const span = maxX - minX + (maxY - minY);
    for (let d = -span; d < span; d += HATCH_SPACING_PX * paperZoom) {
      ctx.beginPath();
      ctx.moveTo(minX + d, minY);
      ctx.lineTo(minX + d + (maxY - minY), maxY);
      ctx.stroke();
    }
    ctx.globalAlpha = 1.0;
    ctx.restore();

    // Outline: up the left end, along the tops (stepping between strips of
    // different size), down the right end, back along the ground.
    ctx.strokeStyle = UDL_LOAD_COLOR.hex;
    ctx.lineWidth = 1.5 * paperZoom;
    ctx.beginPath();
    ctx.moveTo(strips[0].ground[0][0], strips[0].ground[0][1]);
    for (const s of strips) for (const [px, py] of s.top) ctx.lineTo(px, py);
    const groundAll = strips.flatMap((s) => s.ground);
    for (let i = groundAll.length - 1; i >= 0; i--) ctx.lineTo(groundAll[i][0], groundAll[i][1]);
    ctx.closePath();
    ctx.stroke();

    for (const a of g.arrows) drawDownArrow(a, a.hover ? "#ff0000" : UDL_LOAD_COLOR.hex, a.hover ? 3 : 2);
  }
  for (const a of loads.lineLoads) drawDownArrow(a, a.hover ? "#3b82f6" : LINE_LOAD_COLOR.hex, a.hover ? 3 : 2);
  ctx.font = `bold ${LOAD_LABEL_FONT_PX * paperZoom}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  for (const l of loads.labels) {
    ctx.fillStyle = l.kind === "udl" ? UDL_LOAD_COLOR.hex : l.hover ? "#3b82f6" : LINE_LOAD_COLOR.hex;
    ctx.fillText(l.text, l.cx, l.box.bottom);
  }
  ctx.textBaseline = "alphabetic";

  // ── Reinforcement ───────────────────────────────────────
  // Element numbers keep off the lines, the vertex dots (edit view) and the
  // search-limit markers (result); the force labels use the same layout.
  const numberScene = elementNumberScene(
    { coordinates, materialBoundaries, piezometricLine },
    mode !== "result",
    mode === "result" && analysisLimits.enabled && !customPlanesOnly
      ? limitMarkerObstacles(analysisLimits, coordinates, (x, y) => worldToCanvas(x, y, w, h), paperZoom, 2 * paperZoom)
      : [],
  );
  if (reinforcements && reinforcements.length > 0) {
    drawReinforcements(ctx, reinforcements, (x, y) => worldToCanvas(x, y, w, h), paperZoom, {
      scene: numberScene,
      halo: (mode === "result" && PAPER_FILL_COLOR) || BG_COLOR,
    });
  }
  if (piles && piles.length > 0) {
    drawPiles(ctx, piles, (x, y) => worldToCanvas(x, y, w, h), paperZoom);
  }

  // ── Piezometric lines ──────────────────────────────────
  // Water-table symbols, clear of what is drawn around them (computed
  // once: the edit-view labels keep clear of them too).
  const searchShown =
    analysisLimits.enabled &&
    !(customPlanesOnly && (mode === "result" || (customSearchPlanes?.length ?? 0) > 0));
  const drawnPiezoSymbols =
    piezometricLine.lines.length > 0
      ? layoutPiezoSymbols(
          { w, h, coordinates, worldToCanvas, surfaceYAtX },
          piezometricLine,
          reinforcements,
          piles,
          paperZoom,
          mode === "result" ? (result?.criticalSurface ?? null) : null,
          {
            materialBoundaries,
            udls,
            lineLoads,
            analysisLimits: searchShown ? analysisLimits : null,
            prescribed: mode !== "result" ? customSearchPlanes : undefined,
            // The crack-depth dimension where the crack block below draws it.
            crackMarker:
              mode !== "result" && !options?.tensionCrackAuto && (options?.tensionCrackDepth ?? 0) > 0
                ? crackMarkerPosition(
                    coordinates,
                    options?.tensionCrackDepth ?? 0,
                    orientation === "rtl",
                    30 / Math.max(viewScale, 1e-9),
                    analysisLimits.enabled
                      ? [analysisLimits.entryLeftX, analysisLimits.entryRightX, analysisLimits.exitLeftX, analysisLimits.exitRightX]
                      : [],
                    20 / Math.max(viewScale, 1e-9),
                  )
                : null,
            vertices:
              mode !== "result"
                ? [
                    ...coordinates,
                    ...materialBoundaries.flatMap((b) => b.coordinates),
                    ...piezometricLine.lines.flatMap((l) => l.coordinates),
                  ]
                : undefined,
          },
        )
      : [];
  if (piezometricLine.lines.length > 0) {
    const multiLine = piezometricLine.lines.length > 1;
    const piezoBlue = PIEZO_COLOR.hex;
    // Free water standing on the ground (from the main line).
    if (piezometricLine.freeWater !== false) {
      const ponds = freeWaterPonds(mainPiezoLine(piezometricLine)!.coordinates, coordinates);
      ctx.fillStyle = POND_COLOR.hex;
      ctx.globalAlpha = POND_OPACITY;
      for (const { water, ground } of ponds) {
        ctx.beginPath();
        [...water, ...[...ground].reverse()].forEach(([x, y], i) => {
          const [px, py] = worldToCanvas(x, y, w, h);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.fill();
      }
      // Load arrows onto the ground, clear of the water-table symbols.
      ctx.globalAlpha = POND_ARROW_OPACITY;
      drawPondArrows(
        ctx,
        pondArrowLayout(
          ponds,
          (x, y) => worldToCanvas(x, y, w, h),
          paperZoom,
          drawnPiezoSymbols.flat().map((sym) => piezoSymbolBox(sym, paperZoom, multiLine)),
        ),
        paperZoom,
      );
      ctx.globalAlpha = 1;
    }
    for (let lineIdx = 0; lineIdx < piezometricLine.lines.length; lineIdx++) {
      const line = piezometricLine.lines[lineIdx];
      if (line.coordinates.length < 2) continue;
      const isActive = line.id === piezometricLine.activeLineId;
      const plCoords = line.coordinates;

      // Stroke: solid polyline
      const lineColor =
        isActive && editingPiezo ? SELECTED_BOUNDARY_COLOR : piezoBlue;
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = (isActive && editingPiezo ? 3 : 1.5) * paperZoom;
      ctx.beginPath();
      for (let i = 0; i < plCoords.length; i++) {
        const [px, py] = worldToCanvas(plCoords[i][0], plCoords[i][1], w, h);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Dashed: the horizontal continuation the analysis uses beyond the
      // line's end points.
      ctx.setLineDash([6 * paperZoom, 4 * paperZoom]);
      ctx.lineWidth = 1 * paperZoom;
      for (const [a, b] of piezoExtensions(plCoords, coordinates)) {
        const [ax, ay] = worldToCanvas(a[0], a[1], w, h);
        const [bx, by] = worldToCanvas(b[0], b[1], w, h);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Water-table symbols: an inverted triangle with its tip on the line
      // and two bars below, spaced along the line on its flat parts, clear
      // of what is drawn around them (see piezoSymbolLayout).
      const triHalf = PIEZO_TRI_HALF_PX * paperZoom;
      const triH = PIEZO_TRI_H_PX * paperZoom;
      const barW = PIEZO_BAR_W_PX * paperZoom;
      const labelNum = String(lineIdx + 1);
      const symbols = drawnPiezoSymbols[lineIdx];
      for (const { x: mx, y: my, bars } of symbols) {
        const triTop = my - triH;
        ctx.beginPath();
        ctx.moveTo(mx - triHalf, triTop);
        ctx.lineTo(mx + triHalf, triTop);
        ctx.lineTo(mx, my);
        ctx.closePath();
        ctx.fillStyle = piezoBlue;
        ctx.fill();

        // Two bars below the tip (left out where they would go into the ground).
        if (bars) {
          ctx.strokeStyle = piezoBlue;
          ctx.lineWidth = 1.2 * paperZoom;
          for (const gap of [PIEZO_BAR_GAP1_PX, PIEZO_BAR_GAP2_PX]) {
            ctx.beginPath();
            ctx.moveTo(mx - barW, my + gap * paperZoom);
            ctx.lineTo(mx + barW, my + gap * paperZoom);
            ctx.stroke();
          }
        }

        // Line number above the triangle (only if multiple lines)
        if (multiLine) {
          ctx.fillStyle = piezoBlue;
          ctx.font = `bold ${10 * paperZoom}px 'Segoe UI', sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(labelNum, mx, triTop - 2 * paperZoom);
          ctx.textBaseline = "alphabetic";
        }
      }

      // Circle node markers are edit-mode affordances only; hide them in result view.
      if (mode !== "result") {
        const piezoRadius = editingPiezo ? POINT_RADIUS : 3;
        for (let i = 0; i < plCoords.length; i++) {
          const [px, py] = worldToCanvas(plCoords[i][0], plCoords[i][1], w, h);
          const isHover =
            editingPiezo &&
            hoverHit?.kind === "piezo" &&
            hoverHit.lineId === line.id &&
            hoverHit.index === i;

          ctx.beginPath();
          ctx.arc(px, py, piezoRadius, 0, Math.PI * 2);
          ctx.fillStyle = isHover
            ? POINT_COLOR_HOVER
            : editingPiezo && isActive
              ? SELECTED_BOUNDARY_COLOR
              : editingPiezo
                ? piezoBlue
                : piezoBlue + "99";
          ctx.fill();
          ctx.strokeStyle = editingPiezo ? STROKE_ACTIVE : STROKE_INACTIVE;
          ctx.lineWidth = editingPiezo ? 1.5 : 1;
          ctx.stroke();

          pointSymbols.push(boxAround(px, py, piezoRadius));
          if (editingPiezo && isActive && onScreen(px, py)) {
            pointLabels.push({
              text: `(${plCoords[i][0].toFixed(1)}, ${plCoords[i][1].toFixed(1)})`,
              px,
              py,
              below: false,
              force: isHover,
            });
          }
        }
      }
    }
  }

  // ── Tension crack depth (edit mode) ─────────────────────
  // A crack of fixed depth shows as a vertical dimension on the crest,
  // from the ground down to the crack's depth, labelled "crack 2.0 m". (An
  // automatic depth depends on the soil where the crack opens; the result
  // shows that crack.) A dashed line along the whole ground read as a
  // boundary or a prescribed surface and ran through foundations.
  const editCrackDepth = options?.tensionCrackAuto ? 0 : (options?.tensionCrackDepth ?? 0);
  let crackLabel: { text: string; x: number; top: number; bottom: number; inward: number } | null = null;
  if (mode !== "result" && editCrackDepth > 0 && coordinates.length >= 3) {
    // Clear of the search-limit markers (their triangles reach 14 px).
    const px = 1 / Math.max(viewScale, 1e-9);
    const limitXs = analysisLimits.enabled
      ? [analysisLimits.entryLeftX, analysisLimits.entryRightX, analysisLimits.exitLeftX, analysisLimits.exitRightX]
      : [];
    const marker = crackMarkerPosition(coordinates, editCrackDepth, orientation === "rtl", 30 * px, limitXs, 20 * px);
    if (marker) {
      const [mx, top] = worldToCanvas(marker.x, marker.top, w, h);
      const [, bottom] = worldToCanvas(marker.x, marker.bottom, w, h);
      ctx.save();
      ctx.strokeStyle = labelColors.text;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mx, top);
      ctx.lineTo(mx, bottom);
      // Ticks at both ends, as on a dimension.
      for (const y of [top, bottom]) {
        ctx.moveTo(mx - 4, y);
        ctx.lineTo(mx + 4, y);
      }
      ctx.stroke();
      ctx.restore();
      labelLines.push({ seg: [mx, top, mx, bottom], pad: 2 });
      pointSymbols.push({ left: mx - 4, top: bottom - 1, right: mx + 4, bottom: bottom + 1 });
      crackLabel = { text: `crack ${formatCrackDepth(editCrackDepth)} m`, x: mx, top, bottom, inward: marker.inward };
    }
  }

  // ── Entry / Exit range markers ──────────────────────────
  // Not when only prescribed surfaces are analysed (nothing is searched):
  // in the result, and in edit view once there is a prescribed surface. In
  // the result they are lighter and drawn before the sliding mass, so the
  // critical surface stays on top of them.
  const limitsShown =
    analysisLimits.enabled &&
    coordinates.length >= 3 &&
    !(customPlanesOnly && (mode === "result" || (customSearchPlanes?.length ?? 0) > 0));
  if (limitsShown) {
    const markerAlpha = mode === "result" ? 0.55 : 1;
    const toC = (x: number, y: number) => worldToCanvas(x, y, w, h);
    const cs = mode === "result" ? (result?.criticalSurface ?? null) : null;

    // Dots along the ground over each range (alternating colours where the
    // entry and exit ranges coincide), none over the sliding mass.
    const dotRadius = ENTRY_EXIT_DOT_RADIUS_PX * paperZoom * (mode === "result" ? 0.8 : 1);
    ctx.save();
    ctx.globalAlpha = markerAlpha;
    for (const d of layoutRangeDots(analysisLimits, coordinates, toC, paperZoom, {
      skip: cs ? [cs.entryPoint[0], cs.exitPoint[0]] : null,
      radius: dotRadius,
    })) {
      ctx.fillStyle = d.range === "entry" ? ENTRY_DOT_COLOR.hex : EXIT_DOT_COLOR.hex;
      ctx.beginPath();
      ctx.arc(d.x, d.y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Bar on the surface with a triangle outside the range pointing into
    // it: >|  at the start of a range, |<  at its end, in any orientation;
    // only the bar for a range of zero width. Over a result the triangle
    // is lifted clear of the ground and a shared limit is drawn once.
    for (const m of layoutLimitMarkers(analysisLimits, coordinates, toC, paperZoom, { lifted: mode === "result" })) {
      const isHover = hoverHit?.kind === "limit" && m.handles.includes(hoverHit.handle);
      const hoverColor =
        isHover && hoverHit?.kind === "limit" && hoverHit.handle.startsWith("exit") ? EXIT_DOT_COLOR.hex : ENTRY_DOT_COLOR.hex;
      const color = isHover ? hoverColor : MARKER_BASE;
      ctx.save();
      ctx.globalAlpha = markerAlpha;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = (isHover ? 2.5 : 2) * paperZoom;
      ctx.beginPath();
      ctx.moveTo(m.cx, m.barTop);
      ctx.lineTo(m.cx, m.barBottom);
      ctx.stroke();
      for (const [tip, b1, b2] of m.triangles) {
        ctx.beginPath();
        ctx.moveTo(tip[0], tip[1]);
        ctx.lineTo(b1[0], b1[1]);
        ctx.lineTo(b2[0], b2[1]);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // Vertex dots go over the markers and the dotted ranges.
  // ── External boundary points ─────────────────────────
  if (mode !== "result") {
    const extRadius = editingExterior ? POINT_RADIUS : 3;
    const extCanvas = coordinates.map(([x, y]) => worldToCanvas(x, y, w, h));
    const extXs = extCanvas.map((c) => c[0]);
    const extYs = extCanvas.map((c) => c[1]);
    // A label goes outside the fill: along the bisector of the corner.
    const insideExt = (x: number, y: number) => isPointInPolygon(x, y, extXs, extYs);
    for (let i = 0; i < coordinates.length; i++) {
      const [px, py] = worldToCanvas(
        coordinates[i][0],
        coordinates[i][1],
        w,
        h,
      );
      const isSelected = editingExterior && i === selectedPointIndex;
      const isHover =
        editingExterior &&
        hoverHit?.kind === "external" &&
        hoverHit.index === i;

      ctx.beginPath();
      ctx.arc(px, py, extRadius, 0, Math.PI * 2);
      ctx.fillStyle = isSelected
        ? POINT_COLOR_SELECTED
        : isHover
          ? POINT_COLOR_HOVER
          : editingExterior
            ? POINT_COLOR
            : STROKE_INACTIVE;
      ctx.fill();
      ctx.strokeStyle = editingExterior ? STROKE_ACTIVE : STROKE_INACTIVE;
      ctx.lineWidth = editingExterior ? 1.5 : 1;
      ctx.stroke();

      // Coordinate label — only when editing.
      pointSymbols.push(boxAround(px, py, extRadius));
      if (editingExterior && onScreen(px, py)) {
        const prefer = outwardDirection(extCanvas, i, insideExt);
        pointLabels.push({
          text: `(${coordinates[i][0].toFixed(1)}, ${coordinates[i][1].toFixed(1)})`,
          px,
          py,
          below: prefer[1] > 0,
          prefer,
          force: isSelected || isHover,
        });
      }
    }
  }

  // ── Material boundary points (interactive) ──────────
  if (mode !== "result") {
    const bndRadius = editingBoundaries ? POINT_RADIUS - 1 : 3;
    // Outside the model a boundary point divides nothing; it is shown (and
    // can be picked) only while the boundaries are edited.
    const ext = coordinates.map(([x, y]) => worldToCanvas(x, y, w, h));
    const onModel = (px: number, py: number) =>
      ext.length < 3 ||
      isPointInPolygon(px, py, ext.map((c) => c[0]), ext.map((c) => c[1])) ||
      ext.some((a, k) => distanceToSegment(px, py, a, ext[(k + 1) % ext.length]) <= 1.5);
    for (const b of materialBoundaries) {
      const color = materials[0]?.color ?? "#888";
      const isSelectedBoundary =
        interiorBoundariesDialogOpen &&
        selectedMaterialBoundaryId !== null &&
        b.id === selectedMaterialBoundaryId;
      const boundaryBaseColor = isSelectedBoundary
        ? SELECTED_BOUNDARY_COLOR
        : color;

      for (let i = 0; i < b.coordinates.length; i++) {
        const [px, py] = worldToCanvas(
          b.coordinates[i][0],
          b.coordinates[i][1],
          w,
          h,
        );
        if (!editingBoundaries && !onModel(px, py)) continue;
        const isHover =
          editingBoundaries &&
          hoverHit?.kind === "boundary" &&
          hoverHit.boundaryId === b.id &&
          hoverHit.pointIndex === i;

        ctx.beginPath();
        ctx.arc(px, py, bndRadius, 0, Math.PI * 2);
        ctx.fillStyle = isHover
          ? POINT_COLOR_HOVER
          : editingBoundaries
            ? boundaryBaseColor
            : STROKE_INACTIVE;
        ctx.fill();
        ctx.strokeStyle = editingBoundaries
          ? isSelectedBoundary
            ? SELECTED_BOUNDARY_COLOR
            : STROKE_ACTIVE
          : STROKE_INACTIVE;
        ctx.lineWidth = editingBoundaries ? (isSelectedBoundary ? 2 : 1.5) : 1;
        ctx.stroke();
        pointSymbols.push(boxAround(px, py, bndRadius));
      }
    }
  }

  if (pointLabels.length > 0 || crackLabel) {
    const layout = new LabelLayout(labelBounds);
    for (const b of pointSymbols) layout.reserve(b);
    for (const b of editOverlayBoxes(
      ctx,
      {
        w,
        h,
        coordinates,
        analysisLimits,
        udls,
        lineLoads,
        piezometricLine,
        materialBoundaries,
        reinforcements,
        piles,
        worldToCanvas,
        surfaceYAtX,
      },
      { loads, piezoSymbols: drawnPiezoSymbols, showLimits: limitsShown },
    ))
      layout.reserve(b);
    // Lines labels must not cover: the boundaries (the exterior wide
    // enough to keep the entry/exit dots on it clear), water lines,
    // elements and piles, prescribed surfaces, the crack marker.
    if (coordinates.length >= 3) {
      const extC = coordinates.map(([x, y]) => worldToCanvas(x, y, w, h));
      layout.reservePolyline(extC, ENTRY_EXIT_DOT_RADIUS_PX + 1.5, true);
      const inModel = (x: number, y: number) =>
        isPointInPolygon(x, y, extC.map((c) => c[0]), extC.map((c) => c[1]));
      for (const bnd of materialBoundaries) {
        const pts = bnd.coordinates.map(([x, y]) => worldToCanvas(x, y, w, h));
        if (editingBoundaries) layout.reservePolyline(pts, 2);
        else for (const seg of segmentsInside(pts, extC, inModel)) layout.reserveSegment(seg, 2);
      }
    }
    for (const line of piezometricLine.lines) {
      layout.reservePolyline(line.coordinates.map(([x, y]) => worldToCanvas(x, y, w, h)), 2);
    }
    for (const seg of forceLabelContext((x, y) => worldToCanvas(x, y, w, h), { reinforcements, piles, numberSize: 11 })
      .obstacles)
      layout.reserveSegment(seg, 3);
    for (const l of labelLines) layout.reserveSegment(l.seg, l.pad);
    drawPointLabels(ctx, pointLabels, layout, labelColors);
    // The crack's label beside its dimension, towards the middle of the
    // crest first, else farther out with a leader line to the dimension;
    // always shown (it is the dimension's value).
    if (crackLabel) {
      ctx.font = POINT_LABEL_FONT;
      const tw = ctx.measureText(crackLabel.text).width + POINT_LABEL_PAD_X * 2;
      const midY = (crackLabel.top + crackLabel.bottom) / 2;
      const prefer: [number, number] = [crackLabel.inward || 1, 0];
      const box = layout.place(
        [2, 26, 50].flatMap((r) => pointLabelCandidates(crackLabel!.x, midY, tw, POINT_LABEL_H, prefer, r)),
        true,
      )!;
      const nx = Math.max(box.left, Math.min(crackLabel.x, box.right));
      const ny = Math.max(box.top, Math.min(midY, box.bottom));
      if (Math.hypot(nx - crackLabel.x, ny - midY) > 8) {
        ctx.save();
        ctx.strokeStyle = labelColors.text;
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        ctx.moveTo(crackLabel.x, midY);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.globalAlpha = POINT_LABEL_PLATE_ALPHA;
      ctx.fillStyle = labelColors.plate;
      ctx.fillRect(box.left, box.top, tw, POINT_LABEL_H);
      ctx.restore();
      ctx.fillStyle = labelColors.text;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(crackLabel.text, box.left + POINT_LABEL_PAD_X, box.top + POINT_LABEL_H / 2 + 0.5);
      ctx.textBaseline = "alphabetic";
    }
  }

  // ── Analysis result surfaces ─────────────────────────
  if (mode === "result" && result) {
    const rvs = resultViewSettings;
    const arcCache = getArcCache(result);
    const getArcPoints = (surf: ArcSurface) => {
      // Polylines are their own points; only arcs are sampled and cached.
      if (!arcCache || surf.points) return surfacePoints(surf);
      const key = getArcKey(surf);
      const cached = arcCache.get(key);
      if (cached) return cached;
      const points = surfacePoints(surf);
      arcCache.set(key, points);
      return points;
    };

    // ── Paper background + shadow (drawn first, behind geometry) ──
    // (already drawn before grid above)

    // Non-critical surfaces (when "all" or "filter" mode)
    // Draw in reverse FOS order (high FOS first = behind, low FOS last = on top)
    if (rvs.surfaceDisplay !== "critical" && result.allSurfaces.length > 0) {
      const fosRange = fosScaleRange(result);
      for (let si = result.allSurfaces.length - 1; si >= 0; si--) {
        const surf = result.allSurfaces[si];
        // Skip critical (drawn separately) and filtered out
        if (result.criticalSurface && sameSurface(surf, result.criticalSurface))
          continue;
        if (rvs.surfaceDisplay === "filter" && surf.fos > rvs.fosFilterMax)
          continue;

        const arcPts = getArcPoints(surf);
        ctx.strokeStyle = fosColor(surf.fos, fosRange.min, fosRange.max);
        ctx.lineWidth = 1 * paperZoom;
        ctx.globalAlpha = SLIP_SURFACE_OPACITY;
        ctx.beginPath();
        for (let i = 0; i < arcPts.length; i++) {
          const [px, py] = worldToCanvas(arcPts[i][0], arcPts[i][1], w, h);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }
    }

    // Critical surface
    if (result.criticalSurface) {
      const cs = result.criticalSurface;
      const arcPts = getArcPoints(cs);

      // The sliding mass: the ground from the entry to the exit (both
      // corners of every vertical face, and the crack face at a tension
      // crack), then back along the slip surface; semi-transparent fill.
      const massPx = slipMassPolygon(coordinates, cs, arcPts).map(([mx, my]) =>
        worldToCanvas(mx, my, w, h),
      );
      ctx.save();
      ctx.globalAlpha = FAILURE_MASS_FILL_OPACITY;
      ctx.fillStyle = FAILURE_MASS_COLOR.hex;
      ctx.beginPath();
      massPx.forEach(([px, py], i) => {
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
      // A very thin mass (a shallow slab) gets a band of minimum width
      // under the ground along it, so it doesn't disappear into the ground
      // line: the ground from the entry to the exit stroked twice as wide
      // and clipped to the soil, so none of it spills into the air.
      if (meanThickness(massPx) < MIN_SLIP_MASS_PX * paperZoom && coordinates.length >= 3) {
        ctx.beginPath();
        coordinates.forEach(([bx, by], i) => {
          const [px, py] = worldToCanvas(bx, by, w, h);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.clip();
        ctx.globalAlpha = MIN_SLIP_MASS_BAND_OPACITY;
        ctx.strokeStyle = FAILURE_MASS_COLOR.hex;
        ctx.lineWidth = 2 * MIN_SLIP_MASS_PX * paperZoom;
        ctx.lineJoin = "round";
        ctx.beginPath();
        groundProfile(coordinates, cs.entryPoint, cs.exitPoint).forEach(([gx, gy], i) => {
          const [px, py] = worldToCanvas(gx, gy, w, h);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      }
      ctx.restore();

      // Slice lines (vertical lines within the failure mass): black, or
      // white over a dark material, and thinner and fainter where the
      // slices lie close together on screen.
      if (rvs.showSlices && result.criticalSlices.length > 0) {
        // Surface y at a given x (lower arc of a circle, or the polyline)
        const arcYAtX = (x: number): number | null => surfaceBaseYAt(cs, x);
        // Coincident boundaries once; every other line left out where
        // they lie closer than 3 px.
        const { xs: xBounds, density } = sliceLines(
          result.criticalSlices,
          (x) => worldToCanvas(x, 0, w, h)[0],
        );
        const sliceRegions =
          rvs.showSoilColor !== false
            ? getCachedRegions(
                coordinates,
                materialBoundaries,
                regionMaterials,
                materials[0]?.id ?? "",
              )
            : [];
        const regionDark = new Map(
          sliceRegions.map((r) => [
            r,
            isDarkFill(materials.find((m) => m.id === r.materialId)?.color),
          ]),
        );

        ctx.save();
        ctx.lineWidth = SLICE_LINE_WIDTH_PX * paperZoom * Math.max(0.6, density);
        ctx.globalAlpha = SLICE_LINE_OPACITY * density;
        for (const x of xBounds) {
          const topY = surfaceYAtX(x);
          const botY = arcYAtX(x);
          if (topY === null || botY === null) continue;
          for (const part of splitVerticalByRegion(sliceRegions, x, botY, topY)) {
            const dark = part.region !== null && regionDark.get(part.region) === true;
            ctx.strokeStyle = dark ? SLICE_LINE_ON_DARK_COLOR.hex : CRITICAL_SURFACE_COLOR.hex;
            const [sx, sy] = worldToCanvas(x, part.y1, w, h);
            const [, ey] = worldToCanvas(x, part.y0, w, h);
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx, ey);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      // Water in a tension crack (the one the analysis reports): a blue
      // band in the crack, against the face on the side of the sliding
      // mass, from the crack bottom up to the water level.
      const crack = tensionCrackFace(cs);
      const crackWater = Math.min(1, Math.max(0, options?.tensionCrackWater ?? 0));
      if (crack && crackWater > 0) {
        const hw = (crack.top - crack.bottom) * crackWater;
        const [bx, by] = worldToCanvas(crack.x, crack.bottom, w, h);
        const [, wy] = worldToCanvas(crack.x, crack.bottom + hw, w, h);
        const bandW = CRACK_WATER_WIDTH_PX * paperZoom;
        const [massX] = worldToCanvas(crack.x + crack.massSide, crack.bottom, w, h);
        const left = massX > bx ? bx : bx - bandW;
        ctx.save();
        ctx.globalAlpha = CRACK_WATER_OPACITY;
        ctx.fillStyle = POND_COLOR.hex;
        ctx.fillRect(left, wy, bandW, by - wy);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = PIEZO_COLOR.hex;
        ctx.lineWidth = 1 * paperZoom;
        ctx.beginPath();
        ctx.moveTo(left, wy);
        ctx.lineTo(left + bandW, wy);
        ctx.stroke();
        ctx.restore();
      }

      // Arc stroke (bold black like reference image), from the top of the
      // tension crack (its face is part of the slip surface) to the exit.
      ctx.strokeStyle = CRITICAL_SURFACE_COLOR.hex;
      ctx.lineWidth = 2 * paperZoom;
      ctx.beginPath();
      if (crack) {
        const [tx, ty] = worldToCanvas(crack.x, crack.top, w, h);
        ctx.moveTo(tx, ty);
      }
      for (let i = 0; i < arcPts.length; i++) {
        const [px, py] = worldToCanvas(arcPts[i][0], arcPts[i][1], w, h);
        if (i === 0 && !crack) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Centre dot and radius lines to entry/exit (circles only: the
      // axis point of a non-circular surface is no centre)
      if (rvs.showCentreMarker && !cs.points) {
        const [ccx, ccy] = worldToCanvas(cs.cx, cs.cy, w, h);
        const [epx, epy] = worldToCanvas(
          cs.entryPoint[0],
          cs.entryPoint[1],
          w,
          h,
        );
        const [xpx, xpy] = worldToCanvas(
          cs.exitPoint[0],
          cs.exitPoint[1],
          w,
          h,
        );

        // Radius lines (solid, bold — same style as the arc)
        ctx.strokeStyle = CRITICAL_SURFACE_COLOR.hex;
        ctx.lineWidth = 2 * paperZoom;
        ctx.beginPath();
        ctx.moveTo(ccx, ccy);
        ctx.lineTo(epx, epy);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ccx, ccy);
        ctx.lineTo(xpx, xpy);
        ctx.stroke();

        // Small filled circle at centre
        ctx.fillStyle = CRITICAL_SURFACE_COLOR.hex;
        ctx.beginPath();
        ctx.arc(ccx, ccy, 3 * paperZoom, 0, Math.PI * 2);
        ctx.fill();
      }

      // Reinforcement forces on the sliding mass
      if (cs.reinforcementForces?.length) {
        const toC = (x: number, y: number) => worldToCanvas(x, y, w, h);
        // Labels stay inside the plot frame (the geometry clip).
        const pf = resultViewSettings.paperFrame;
        const fr = computePaperFrame(w, h, pf.paperSize, pf.landscape, pf.zoom ?? 1, pf.offsetX ?? 0, pf.offsetY ?? 0);
        drawReinforcementForces(ctx, cs.reinforcementForces, toC, paperZoom, {
          context: forceLabelContext(toC, {
            reinforcements,
            piles,
            surface: surfacePoints(cs),
            numberSize: 11 * paperZoom,
            model: coordinates,
            water: piezometricLine.lines.map((l) => l.coordinates),
            boundaries: materialBoundaries.map((b) => b.coordinates),
            loads: [
              ...loadObstacleBoxes(toC, coordinates, udls, lineLoads, ARROW_HEIGHT_PX * paperZoom),
              ...loads.labels.map((l) => l.box),
            ],
            markers: limitsShown ? limitMarkerObstacles(analysisLimits, coordinates, toC, paperZoom, 2 * paperZoom) : [],
            numberScene,
            // A margin inside the plot frame.
            bounds: {
              left: fr.x + fr.w * PLOT_MARGINS.L + FORCE_LABEL_MARGIN_PX * paperZoom,
              top: fr.y + fr.h * PLOT_MARGINS.T + FORCE_LABEL_MARGIN_PX * paperZoom,
              right: fr.x + fr.w * (1 - PLOT_MARGINS.R) - FORCE_LABEL_MARGIN_PX * paperZoom,
              bottom: fr.y + fr.h * (1 - PLOT_MARGINS.B) - FORCE_LABEL_MARGIN_PX * paperZoom,
            },
          }),
          plate: PAPER_FILL_COLOR || BG_COLOR,
        });
      }

      // FOS label to the right of the circle centre
      if (rvs.showFosLabel) {
        const [ax, ay] = fosLabelAnchor(cs);
        const [ccx2, ccy2] = worldToCanvas(ax, ay, w, h);
        const fosText = cs.fos.toFixed(3);
        ctx.font = `bold ${12 * paperZoom}px sans-serif`;
        const tw = ctx.measureText(fosText).width;
        const labelX = ccx2 + 10 * paperZoom;

        // Text
        ctx.fillStyle = CRITICAL_SURFACE_COLOR.hex;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(fosText, labelX, ccy2 - 4 * paperZoom);

        // Underline
        ctx.strokeStyle = CRITICAL_SURFACE_COLOR.hex;
        ctx.lineWidth = 1.5 * paperZoom;
        ctx.beginPath();
        ctx.moveTo(labelX - 1 * paperZoom, ccy2 + 2 * paperZoom);
        ctx.lineTo(labelX + tw + 1 * paperZoom, ccy2 + 2 * paperZoom);
        ctx.stroke();
      }
    }

    // ── Paper frame ──────────────────────────────────────
    const { paperFrame } = rvs;
    const pf = computePaperFrame(
      w,
      h,
      paperFrame.paperSize,
      paperFrame.landscape,
      paperFrame.zoom ?? 1,
      paperFrame.offsetX ?? 0,
      paperFrame.offsetY ?? 0,
    );

    {
      // Restore clip (ticks draw inside paper, on top of geometry)
      ctx.restore();

      // Inner frame (plot area) inset from paper (using standardized percentages)
      const PLOT_PAD_L = pf.w * PLOT_MARGINS.L;
      const PLOT_PAD_B = pf.h * PLOT_MARGINS.B;
      const PLOT_PAD_T = pf.h * PLOT_MARGINS.T;
      const PLOT_PAD_R = pf.w * PLOT_MARGINS.R;

      const ifx = pf.x + PLOT_PAD_L;
      const ify = pf.y + PLOT_PAD_T;
      const ifw = pf.w - PLOT_PAD_L - PLOT_PAD_R;
      const ifh = pf.h - PLOT_PAD_T - PLOT_PAD_B;

      // ── Ticks + labels between paper edge and inner frame ──
      const TICK_LEN = 6 * paperZoom;
      const MINI_TICK = 3 * paperZoom;
      const rulerFont = `${10 * paperZoom}px 'Segoe UI', sans-serif`;

      // World coords at inner frame edges
      const [worldLeftTick] = canvasToWorld(ifx, ify, w, h);
      const [worldRightTick] = canvasToWorld(ifx + ifw, ify, w, h);
      const [, worldTopTick] = canvasToWorld(ifx, ify, w, h);
      const [, worldBottomTick] = canvasToWorld(ifx, ify + ifh, w, h);

      // Compute tick spacing
      const worldSpan = worldRightTick - worldLeftTick;
      const { w: dimW, h: dimH } = PAPER_DIMENSIONS[paperFrame.paperSize];
      const paperWidthMm = paperFrame.landscape
        ? Math.max(dimW, dimH)
        : Math.min(dimW, dimH);
      const innerFrameWidthMm =
        paperWidthMm * (1 - PLOT_MARGINS.L - PLOT_MARGINS.R);
      const rulerStep = resolveTickStep(
        resultViewSettings.gridSpacing,
        computeRulerStep(worldSpan, innerFrameWidthMm, paperWidthMm, [
          worldLeftTick,
          worldRightTick,
        ]),
      );
      const minorTickCount = clampMinorTicks(resultViewSettings.minorTicks ?? 0);

      ctx.save();
      ctx.fillStyle = PAPER_TICK_COLOR;
      ctx.strokeStyle = PAPER_TICK_COLOR;
      ctx.lineWidth = 1 * paperZoom;
      ctx.font = rulerFont;

      // ── Bottom ticks (X axis) — below inner frame ──
      const btmY = ify + ifh;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const xStart = Math.ceil(worldLeftTick / rulerStep) * rulerStep;
      for (let gx = xStart; gx <= worldRightTick; gx += rulerStep) {
        const [px] = worldToCanvas(gx, 0, w, h);
        if (px < ifx || px > ifx + ifw) continue;
        ctx.beginPath();
        ctx.moveTo(px, btmY);
        ctx.lineTo(px, btmY + TICK_LEN);
        ctx.stroke();
        const label = formatRulerLabel(gx, rulerStep);
        ctx.fillText(label, px, btmY + TICK_LEN + 2 * paperZoom);
      }
      // Minor ticks (X axis)
      if (minorTickCount > 0) {
        const xMinorStep = rulerStep / (minorTickCount + 1);
        const xMinorStart = Math.ceil(worldLeftTick / xMinorStep) * xMinorStep;
        for (let gx = xMinorStart; gx <= worldRightTick; gx += xMinorStep) {
          const [px] = worldToCanvas(gx, 0, w, h);
          if (px < ifx || px > ifx + ifw) continue;
          if (Math.abs(gx / rulerStep - Math.round(gx / rulerStep)) < 0.001)
            continue;
          ctx.beginPath();
          ctx.moveTo(px, btmY);
          ctx.lineTo(px, btmY + MINI_TICK);
          ctx.stroke();
        }
      }

      // ── Left ticks (Y axis) — left of inner frame ──
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const yStart = Math.ceil(worldBottomTick / rulerStep) * rulerStep;
      for (let gy = yStart; gy <= worldTopTick; gy += rulerStep) {
        const [, py] = worldToCanvas(0, gy, w, h);
        if (py < ify || py > ify + ifh) continue;
        ctx.beginPath();
        ctx.moveTo(ifx, py);
        ctx.lineTo(ifx - TICK_LEN, py);
        ctx.stroke();
        const label = formatRulerLabel(gy, rulerStep);
        ctx.fillText(label, ifx - TICK_LEN - 3 * paperZoom, py);
      }
      // Minor ticks (Y axis)
      if (minorTickCount > 0) {
        const yMinorStep = rulerStep / (minorTickCount + 1);
        const yMinorStart =
          Math.ceil(worldBottomTick / yMinorStep) * yMinorStep;
        for (let gy = yMinorStart; gy <= worldTopTick; gy += yMinorStep) {
          const [, py] = worldToCanvas(0, gy, w, h);
          if (py < ify || py > ify + ifh) continue;
          if (Math.abs(gy / rulerStep - Math.round(gy / rulerStep)) < 0.001)
            continue;
          ctx.beginPath();
          ctx.moveTo(ifx, py);
          ctx.lineTo(ifx - MINI_TICK, py);
          ctx.stroke();
        }
      }
      ctx.restore();

      // Inner frame border (plot area)
      ctx.strokeStyle = PAPER_BORDER_COLOR;
      ctx.lineWidth = 1.5 * paperZoom;
      ctx.strokeRect(ifx, ify, ifw, ifh);
    }

    // ── Annotations ──────────────────────────────────────
    const annotations = resultViewSettings.annotations;
    // Scale factor for annotations based on paper frame size
    const annoScale = Math.min(pf.w, pf.h) / ANNOTATION_SCALE_DIVISOR;

    for (const anno of annotations) {
      // Convert fractional paper-frame coordinates to canvas pixels (anchor point)
      const ax = pf.x + anno.x * pf.w;
      const ay = pf.y + anno.y * pf.h;
      const fontSize =
        (anno.fontSize ?? ANNOTATION_DEFAULT_FONT_SIZE) * annoScale;

      if (anno.type === "text") {
        const family = anno.fontFamily ?? ANNOTATION_DEFAULT_FONT_FAMILY;
        const weight = anno.bold ? "bold" : "normal";
        const style = anno.italic ? "italic" : "normal";
        const resolvedText = resolveAnnotationText({
          text: anno.text ?? "",
          projectInfo,
          result,
          parameters,
        });
        ctx.fillStyle = anno.color ?? ANNOTATION_DEFAULT_TEXT_COLOR;
        ctx.font = `${style} ${weight} ${fontSize}px ${family}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";

        const lines = resolvedText.split("\n");
        const lineHeight = fontSize * ANNOTATION_LINE_HEIGHT;
        let maxW = 0;
        for (const line of lines)
          maxW = Math.max(maxW, ctx.measureText(line).width);
        const textH = Math.max(lineHeight, lines.length * lineHeight);
        const { x: drawX, y: drawY } = anchoredTopLeft(
          ax,
          ay,
          maxW,
          textH,
          anno.anchor,
        );

        lines.forEach((line, i) => {
          ctx.fillText(line, drawX, drawY + i * lineHeight);
        });
      } else if (anno.type === "color-bar") {
        const barW = 20 * annoScale;
        const barH = 200 * annoScale;
        const labelFontSize = Math.max(10, 11 * annoScale);
        const titleExtraTop = labelFontSize + 4 * annoScale;

        // Measure label width for total content size
        ctx.font = `${labelFontSize}px 'Segoe UI', sans-serif`;
        let maxLabelW = 0;
        const numTicks = COLOR_BAR_NUM_TICKS;
        const fosScale = fosScaleRange(result);
        for (let t = 0; t <= numTicks; t++) {
          maxLabelW = Math.max(
            maxLabelW,
            ctx.measureText(fosTickLabel(fosScale, t, numTicks)).width,
          );
        }
        const contentW = barW + 5 * annoScale + maxLabelW;
        const contentH = barH + titleExtraTop;
        const { x: drawX, y: drawY } = anchoredTopLeft(
          ax,
          ay,
          contentW,
          contentH,
          anno.anchor,
        );
        const barX = drawX;
        const barY = drawY + titleExtraTop;

        const fosMin = fosScale.min;
        const fosMax = fosScale.max;
        const numSteps = Math.floor(barH);

        // Draw gradient bar
        for (let i = 0; i < numSteps; i++) {
          const t = i / (numSteps - 1);
          const fos = fosMax - t * (fosMax - fosMin);
          ctx.fillStyle = fosColor(fos, fosMin, fosMax);
          ctx.fillRect(barX, barY + i, barW, 2);
        }

        // Border
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barW, barH);

        // Labels
        ctx.fillStyle = "#000000";
        ctx.font = `${labelFontSize}px 'Segoe UI', sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const labelX2 = barX + barW + 5 * annoScale;

        // Title
        ctx.font = `bold ${labelFontSize}px 'Segoe UI', sans-serif`;
        ctx.textBaseline = "bottom";
        ctx.fillText("FOS", barX, barY - 4 * annoScale);
        ctx.font = `${labelFontSize}px 'Segoe UI', sans-serif`;
        ctx.textBaseline = "middle";

        // Tick marks and labels
        for (let t = 0; t <= numTicks; t++) {
          const frac = t / numTicks;
          const y = barY + frac * barH;

          // Tick
          ctx.strokeStyle = "#000000";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(barX + barW, y);
          ctx.lineTo(barX + barW + 3, y);
          ctx.stroke();

          // Label
          ctx.fillStyle = "#000000";
          ctx.fillText(fosTickLabel(fosScale, t, numTicks), labelX2, y);
        }
      } else if (anno.type === "material-table") {
        const { columnKeys, header, rows } = buildMaterialTableData(
          anno,
          materials,
          piezometricLine,
        );
        const tableFontSize = anno.fontSize ?? 6;
        const tableSize = measureTable(
          ctx,
          columnKeys,
          header,
          rows,
          annoScale,
          tableFontSize,
        );
        const { x: drawX, y: drawY } = anchoredTopLeft(
          ax,
          ay,
          tableSize.w,
          tableSize.h,
          anno.anchor,
        );
        drawTable(
          ctx,
          drawX,
          drawY,
          columnKeys,
          header,
          rows,
          materials,
          annoScale,
          tableFontSize,
        );
      } else if (anno.type === "plot") {
        const plotW = pf.w * (anno.width ?? 0.24);
        const plotH = pf.h * (anno.height ?? 0.18);
        const { x: drawX, y: drawY } = anchoredTopLeft(
          ax,
          ay,
          plotW,
          plotH,
          anno.anchor,
        );

        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,0.94)";
        ctx.strokeStyle = "#78909c";
        ctx.lineWidth = 1;
        ctx.fillRect(drawX, drawY, plotW, plotH);
        ctx.strokeRect(drawX, drawY, plotW, plotH);

        const plot = computeSlicePlotData(
          result,
          anno.plotAxisX,
          anno.plotAxisY,
        );
        const { points, title } = plot;

        const titleSize = Math.max(8, 10 * annoScale);
        const axisSize = Math.max(7, 9 * annoScale);
        const titlePad = titleSize + 6;

        if (!plot.range) {
          ctx.font = `${titleSize}px sans-serif`;
          ctx.fillStyle = "#78909c";
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.fillText(title, drawX + 6, drawY + 4);
          ctx.font = `${axisSize}px sans-serif`;
          ctx.fillStyle = "#666";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("No slice data", drawX + plotW / 2, drawY + plotH / 2);
          ctx.restore();
          continue;
        }

        const padLeft = Math.max(26, 32 * annoScale);
        const padRight = Math.max(10, 12 * annoScale);
        const padBottom = Math.max(18, 22 * annoScale);
        const padTop = titlePad;
        const chartX = drawX + padLeft;
        const chartY = drawY + padTop;
        const chartW = Math.max(8, plotW - padLeft - padRight);
        const chartH = Math.max(8, plotH - padTop - padBottom);
        const { xMin, xMax, yMin, yMax } = plot.range;

        const mapX = (v: number) =>
          chartX + ((v - xMin) / (xMax - xMin)) * chartW;
        const mapY = (v: number) =>
          chartY + chartH - ((v - yMin) / (yMax - yMin)) * chartH;

        ctx.font = `${titleSize}px sans-serif`;
        ctx.fillStyle = "#78909c";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(title, drawX + 6, drawY + 4);

        ctx.strokeStyle = "rgba(120,144,156,0.35)";
        ctx.lineWidth = 0.8;
        for (let i = 0; i <= 4; i++) {
          const gy = chartY + (chartH * i) / 4;
          ctx.beginPath();
          ctx.moveTo(chartX, gy);
          ctx.lineTo(chartX + chartW, gy);
          ctx.stroke();
        }

        ctx.strokeStyle = "#78909c";
        ctx.lineWidth = 1;
        ctx.strokeRect(chartX, chartY, chartW, chartH);

        ctx.strokeStyle = "#26a69a";
        ctx.lineWidth = Math.max(1.1, 1.3 * annoScale);
        ctx.beginPath();
        points.forEach((point, index) => {
          const px = mapX(point.x);
          const py = mapY(point.y);
          if (index === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();

        ctx.fillStyle = "#26a69a";
        points.forEach((point) => {
          const px = mapX(point.x);
          const py = mapY(point.y);
          ctx.beginPath();
          ctx.arc(px, py, Math.max(1.4, 1.8 * annoScale), 0, Math.PI * 2);
          ctx.fill();
        });

        ctx.font = `${axisSize}px sans-serif`;
        ctx.fillStyle = "#5f6b73";
        ctx.textBaseline = "middle";
        ctx.textAlign = "right";
        ctx.fillText(yMax.toFixed(2), chartX - 4, chartY);
        ctx.fillText(yMin.toFixed(2), chartX - 4, chartY + chartH);

        ctx.textBaseline = "top";
        ctx.textAlign = "center";
        // Axis ends, not first/last slice: slices of a right-to-left
        // model come in descending x.
        ctx.fillText(
          xMin.toFixed(plot.xDecimals),
          chartX,
          chartY + chartH + 4,
        );
        ctx.fillText(
          xMax.toFixed(plot.xDecimals),
          chartX + chartW,
          chartY + chartH + 4,
        );
        ctx.restore();
      }

      // Selection highlight for selected annotations
      if (selectedAnnotationIds.includes(anno.id)) {
        const bounds = getAnnotationBoundsPx(ctx, {
          annotation: anno,
          paperFrame: pf,
          result,
          materials,
          piezometricLine,
          projectInfo,
          parameters,
        });
        ctx.save();
        ctx.strokeStyle = "#0078d4";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // Selection highlight for paper/axis properties target.
    if (selectedResultObject === "paper-frame") {
      ctx.save();
      ctx.strokeStyle = "#0078d4";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(pf.x, pf.y, pf.w, pf.h);
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // ── Mouse crosshair (edit mode only) ───────────────────
  if (mode === "edit" && mouseWorld) {
    const [mx, my] = worldToCanvas(mouseWorld[0], mouseWorld[1], w, h);
    ctx.strokeStyle = CROSSHAIR_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(mx, 0);
    ctx.lineTo(mx, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, my);
    ctx.lineTo(w, my);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
