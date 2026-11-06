import { isPointInPolygon } from "@cslope/engine";
import type { AnalysisResult } from "@cslope/engine";
import { PAPER_DIMENSIONS, PLOT_MARGINS } from "../../store/app-store";
import type { Annotation, AppState, BackgroundImage, CanvasObjectRef, CanvasPointKey, CanvasSelection, ModelLocks, PaperAnnotation } from "../../store/types";
import { isObjectLocked, sameObject } from "../../store/canvas-selection";
import {
  fosLabelAnchor,
  sameSurface,
  surfaceBaseYAt,
  surfacePoints,
  type DrawableSurface,
} from "../../utils/arc";
import { fosTickLabel } from "../../utils/fos-color";
import { colorScaleOf, colorScaleOfBar } from "../annotations/colorScale";
import { computeRegions } from "../../utils/regions";
import { prescribedPath } from "../../utils/custom-plane";
import {
  ARROW_HEAD_LEN_PX,
  ARROW_HEAD_PX,
  ARROW_HEIGHT_PX,
  GRID_STEP_MIN,
  HATCH_SPACING_PX,
  POINT_COLOR,
  POINT_COLOR_HOVER,
  POINT_RADIUS,
  cssVar,
  RULER_SIZE_PX,
} from "./constants";
import { PRINT_INK, themeInk } from "./ink";
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
import { axisTicks, tickLabel } from "../annotations/plotAxis";
import type { PointHit } from "./types";
import { drawUnderlays, placementCanvasCorners } from "../drawings/draw-underlays";
import { drawReferenceLabels, drawReferenceLines, referenceSegments, type DrawnReference } from "./reference-draw";
import { baseLayerCount, isPaperStep, layerSteps, resultLayers } from "../results/layers";
import {
  ANNOTATION_DEFAULT_FONT_FAMILY,
  ANNOTATION_DEFAULT_FONT_SIZE,
  ANNOTATION_LINE_HEIGHT,
  ANNOTATION_SCALE_DIVISOR,
  COLOR_BAR_NUM_TICKS,
  CRACK_WATER_OPACITY,
  CRACK_WATER_WIDTH_PX,
  CRITICAL_SURFACE_COLOR,
  CUSTOM_SURFACE_COLOR,
  CUSTOM_SURFACE_DASH_PX,
  CUSTOM_SURFACE_LINE_WIDTH_PX,
  ENTRY_DOT_COLOR,
  ENTRY_EXIT_DOT_RADIUS_PX,
  EXIT_DOT_COLOR,
  FAILURE_MASS_COLOR,
  FAILURE_MASS_FILL_OPACITY,
  REFERENCE_ANNOTATION_COLOR,
  MARKER_COLOR,
  RESULT_OUTLINE_WIDTH_PX,
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
  MODEL_HATCH_PATTERNS,
  COLOR_BAR_PLATE_PAD,
} from "../rendering/style-spec";
import { drawCanvasHatch, drawCanvasHatchLabel } from "../rendering/hatch";
import {
  canvasForceLayout,
  drawPiles,
  drawReinforcementForces,
  drawReinforcements,
  elementNumberScene,
  FORCE_LABEL_MARGIN_PX,
  forceLabelContext,
  limitMarkerObstacles,
  loadObstacleBoxes,
  type ForceLayout,
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
import {
  crackMarkerPosition,
  limitMarkerBoxes,
  limitMarkerGeometry,
  rangeMarkerEnds,
  type CrackMarker,
  type MarkerDot,
} from "./marker-geometry";
import { piezoExtensions, piezoPonds } from "../../utils/piezo";
import { staggerLabelTops } from "../../utils/stagger-labels";
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
  boxesOverlap,
  clampBox,
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

/** Margin of the plate around a line label, in px at paper zoom 1. */
const LABEL_PLATE_PAD_PX = 1.5;

/**
 * Text on a plate in the colour behind it (the sheet or the canvas), so the
 * ground line or a soil fill under the text does not strike through it, as
 * the PDF does with a white plate. Uses the context's font, alignment and
 * baseline.
 */
function fillTextOnPlate(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, plate: string, pad: number) {
  const size = Number(/([\d.]+)px/.exec(ctx.font)?.[1] ?? 10);
  const width = ctx.measureText(text).width;
  const height = size * 1.15;
  const align = ctx.textAlign;
  const left = align === "right" || align === "end" ? x - width : align === "center" ? x - width / 2 : x;
  const base = ctx.textBaseline;
  const top = base === "top" ? y : base === "bottom" ? y - height : base === "middle" ? y - height / 2 : y - size;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = plate;
  ctx.fillRect(left - pad, top, width + 2 * pad, height);
  ctx.restore();
  ctx.fillText(text, x, y);
}

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
 * a hovered arrow, and the water-table symbols), whether the search
 * limits are shown and the vertex dots (the limit triangles move off
 * them); without it they are laid out here.
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
  drawn: { loads?: LoadLayout; piezoSymbols?: PiezoSymbol[][]; showLimits?: boolean; vertexDots?: readonly MarkerDot[] } = {},
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
        boxes.push(...limitMarkerBoxes(limitMarkerGeometry(cx, cy, toward, 1, drawn.vertexDots)));
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
    // With room: a vertex label touching a symbol reads as labelling it.
    for (const sym of line) boxes.push(growBox(piezoSymbolBox(sym, 1, numbered), 4));
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

/**
 * Where the crack-depth label goes (and reserves it), with the leader line
 * to the dimension it needs (null when it is next to the dimension):
 * beside the dimension at mid height (when it is tall enough), beside or
 * above its top tick, on the `side` (+1: right) first; then farther out,
 * taking only a spot whose leader crosses no reserved line. The first
 * candidate when none is free. `topCover`: how far down from the top the
 * dimension is hidden (under a vertex dot); a leader ends below that.
 */
export function placeCrackLabel(
  layout: LabelLayout,
  x: number,
  top: number,
  bottom: number,
  w: number,
  h: number,
  side: number,
  topCover = 0,
): { box: Box; leader: Seg | null } {
  const s = side >= 0 ? 1 : -1;
  const gap = 6;
  const lift = 5;
  const beside = (y: number, d: number): Box =>
    d > 0
      ? { left: x + gap, top: y - h / 2, right: x + gap + w, bottom: y + h / 2 }
      : { left: x - gap - w, top: y - h / 2, right: x - gap, bottom: y + h / 2 };
  const above = (dx: number, up = lift): Box => {
    const left = dx > 0 ? x - 4 : dx < 0 ? x + 4 - w : x - w / 2;
    return { left, top: top - up - h, right: left + w, bottom: top - up };
  };
  // The visible part of the dimension, where a leader ends.
  const a0 = Math.min(top + topCover, (top + bottom) / 2);
  const leaderFor = (b: Box): Seg | null => {
    const ty = Math.max(a0, Math.min((b.top + b.bottom) / 2, bottom));
    const nx = Math.max(b.left, Math.min(x, b.right));
    const ny = Math.max(b.top, Math.min(ty, b.bottom));
    return Math.hypot(nx - x, ny - ty) <= 8 ? null : [x, ty, nx, ny];
  };
  const near: Box[] = [];
  const mid = (top + bottom) / 2;
  if (Math.abs(bottom - top) >= h + 4) near.push(beside(mid, s), beside(mid, -s));
  near.push(above(-s), above(0), above(s), beside(top - h / 2 - lift, s), beside(top - h / 2 - lift, -s));
  // Higher, clear of vertex dots on the ground beside the tick.
  near.push(above(-s, 2 * lift), above(0, 2 * lift), above(s, 2 * lift));
  const clearLeader = (l: Seg | null) => {
    if (!l) return true;
    // Not counting the end at the dimension (the lines meeting there).
    const len = Math.hypot(l[2] - l[0], l[3] - l[1]);
    if (len <= 10) return true;
    const f = 10 / len;
    return !layout.crossesLine([l[0] + (l[2] - l[0]) * f, l[1] + (l[3] - l[1]) * f, l[2], l[3]]);
  };
  for (const c of near.map((b) => clampBox(b, layout.bounds))) {
    const leader = leaderFor(c);
    if (layout.isFree(c) && clearLeader(leader)) {
      layout.reserve(c);
      return { box: c, leader };
    }
  }
  for (const r of [20, 40]) {
    for (const c of pointLabelCandidates(x, top, w, h, [s, -1], r).map((b) => clampBox(b, layout.bounds))) {
      if (!layout.isFree(c)) continue;
      const leader = leaderFor(c);
      if (!clearLeader(leader)) continue;
      layout.reserve(c);
      return { box: c, leader };
    }
  }
  const first = clampBox(near[0], layout.bounds);
  layout.reserve(first);
  return { box: first, leader: leaderFor(first) };
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

/** The last value of a layout and the inputs it was computed from. */
interface LayoutMemo<T> {
  key: readonly unknown[] | null;
  value: T | null;
}

/**
 * The value for `key` (compared item by item, Object.is): the last one
 * when the inputs are the same, else computed. The canvas is drawn again
 * on every mouse move; the layouts below depend only on the model, the
 * result and the view, so they are not worked out again then.
 */
function memoLayout<T>(memo: LayoutMemo<T>, key: readonly unknown[], compute: () => T): T {
  const k = memo.key;
  if (memo.value !== null && k !== null && k.length === key.length && k.every((v, i) => Object.is(v, key[i]))) {
    return memo.value;
  }
  memo.value = compute();
  memo.key = key;
  return memo.value;
}

const piezoSymbolMemo: LayoutMemo<PiezoSymbol[][]> = { key: null, value: null };
const forceLayoutMemo: LayoutMemo<ForceLayout[]> = { key: null, value: null };

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
function drawPondArrows(ctx: CanvasRenderingContext2D, arrows: PondArrow[], paperZoom: number, color: string) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
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

/**
 * A small padlock (canvas px, its body's top left at x, y): on a locked
 * selection's handles.
 */
export function drawPadlock(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, halo: string): void {
  ctx.save();
  ctx.setLineDash([]);
  // a plate keeps it readable over lines and fills
  ctx.fillStyle = halo;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(x + 4, y + 2.5, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(x + 4, y + 1, 2.4, Math.PI, 0);
  ctx.lineTo(x + 6.4, y + 3);
  ctx.moveTo(x + 1.6, y + 1);
  ctx.lineTo(x + 1.6, y + 3);
  ctx.stroke();
  ctx.fillRect(x, y + 3, 8, 5.5);
  ctx.restore();
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
  /**
   * Imported head and reference lines (they give the pore pressure instead
   * of the piezometric lines): the head lines are drawn thin and dashed.
   */
  waternet?: AppState["waternet"];
  /** Prescribed slip surfaces, drawn faintly in edit view. */
  customSearchPlanes?: AppState["customSearchPlanes"];
  /** Block search objects, drawn in edit view when the block search is selected. */
  blockSearchObjects?: AppState["blockSearchObjects"];
  viewScale: number;
  mouseWorld: [number, number] | null;
  hoverHit: PointHit | null;
  /**
   * The selection of the edit canvas: its object is drawn in the selection
   * colour with its handles (grey with a padlock when it is locked).
   */
  selection?: CanvasSelection | null;
  /** The object under the pointer (edit view), drawn with a faint highlight. */
  hoverObject?: { object: CanvasObjectRef; point: CanvasPointKey | null; locked?: boolean } | null;
  /** The locked objects of the edit view. */
  locks?: ModelLocks;
  /**
   * The model's placed drawings: drawn above the fills, below the lines
   * (in the result view only those shown in results).
   */
  backgrounds?: AppState["backgrounds"];
  /** Device pixels per canvas unit (the drawings' raster resolution follows it). */
  pixelRatio?: number;
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
}

const NO_LOCKS: ModelLocks = {};
const NO_BACKGROUNDS: AppState["backgrounds"] = [];

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
    waternet,
    customSearchPlanes,
    blockSearchObjects,
    viewScale,
    mouseWorld,
    hoverHit,
    selection = null,
    hoverObject = null,
    locks = NO_LOCKS,
    backgrounds = NO_BACKGROUNDS,
    pixelRatio = 1,
    worldToCanvas,
    canvasToWorld,
    surfaceYAtX,
  }: DrawCanvasParams,
) {
  // The selected object of the edit view: the one drawn with its handles.
  const selObject = mode !== "result" ? (selection?.object ?? null) : null;
  const selPoint = selObject ? (selection?.point ?? null) : null;
  const selLocked = !!selObject && isObjectLocked(locks, selObject);
  const editingExterior = selObject?.type === "exterior";
  const selectedPointIndex = editingExterior && typeof selPoint === "number" ? selPoint : null;
  const selectedBoundaryId = selObject?.type === "boundary" ? selObject.id : null;
  const editingBoundaries = selectedBoundaryId !== null;
  const selectedWaterLineId = selObject?.type === "waterLine" ? selObject.id : null;
  const selectedCustomPlaneId = selObject?.type === "customPlane" ? selObject.id : null;
  // Read theme-aware colors
  const BG_COLOR = cssVar("--color-canvas-bg");
  // The drawing's ink: the print colours in the light theme, lighter ones
  // on the dark theme's dark sheet (see ink.ts).
  const INK = themeInk();
  const GRID_COLOR = INK.gridLine;
  const GRID_TEXT_COLOR = cssVar("--color-canvas-grid-text");
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
  // The selection's colour (the accent), and the grey of a locked object's handles.
  const SELECTED_BOUNDARY_COLOR = cssVar("--color-vsc-accent") || POINT_COLOR;
  const LOCKED_HANDLE_COLOR = "#9aa3ad";
  /** The ring around the selected point of the selection. */
  const selectedPointRing = (px: number, py: number, r: number) => {
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = selLocked ? LOCKED_HANDLE_COLOR : SELECTED_BOUNDARY_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, r + 3.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };
  /** The canvas lines of an object (edit view), for its hover highlight and its selection outline. */
  const objectLines = (ref: CanvasObjectRef): { pts: [number, number][]; closed: boolean }[] => {
    const toC = (pts: [number, number][]) => pts.map(([x, y]) => worldToCanvas(x, y, w, h));
    const groundLine = (x1: number, x2: number) => {
      const lo = Math.min(x1, x2);
      const hi = Math.max(x1, x2);
      const xs = [lo, ...coordinates.map(([x]) => x).filter((x) => x > lo && x < hi), hi].sort((a, b) => a - b);
      return xs.flatMap((x): [number, number][] => {
        const y = surfaceYAtX(x);
        return y === null ? [] : [[x, y]];
      });
    };
    switch (ref.type) {
      case "exterior":
        return [{ pts: toC(coordinates), closed: true }];
      case "boundary": {
        const b = materialBoundaries.find((v) => v.id === ref.id);
        return b ? [{ pts: toC(b.coordinates), closed: false }] : [];
      }
      case "waterLine": {
        const l = piezometricLine.lines.find((v) => v.id === ref.id);
        return l ? [{ pts: toC(l.coordinates), closed: false }] : [];
      }
      case "udl": {
        const u = udls.find((v) => v.id === ref.id);
        return u ? [{ pts: toC(groundLine(u.x1, u.x2)), closed: false }] : [];
      }
      case "reinforcement":
      case "pile": {
        const list: { id: string; x1: number; y1: number; x2: number; y2: number }[] =
          ref.type === "pile" ? (piles ?? []) : (reinforcements ?? []);
        const r = list.find((v) => v.id === ref.id);
        return r ? [{ pts: toC([[r.x1, r.y1], [r.x2, r.y2]]), closed: false }] : [];
      }
      case "background": {
        const b = backgrounds.find((v) => v.id === ref.id);
        const corners = b ? placementCanvasCorners(b, (x, y) => worldToCanvas(x, y, w, h)) : null;
        return corners ? [{ pts: corners, closed: true }] : [];
      }
      case "customPlane": {
        const p = customSearchPlanes?.find((v) => v.id === ref.id);
        if (!p) return [];
        if (p.points) return [{ pts: toC(p.points), closed: false }];
        const n = 72;
        return [{ pts: toC(Array.from({ length: n }, (_, k): [number, number] => [p.cx + p.radius * Math.cos((2 * Math.PI * k) / n), p.cy + p.radius * Math.sin((2 * Math.PI * k) / n)])), closed: true }];
      }
      default:
        return [];
    }
  };
  const strokeObject = (ref: CanvasObjectRef, color: string, width: number, alpha: number, dash: number[] = []) => {
    ctx.save();
    ctx.setLineDash(dash);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    for (const { pts, closed } of objectLines(ref)) {
      if (pts.length < 2) continue;
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      if (closed) ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  };
  /** Where the padlock of a locked selection goes: its selected point, else its first handle (canvas px). */
  const selectionAnchor = (ref: CanvasObjectRef, point: CanvasPointKey | null): [number, number] | null => {
    const at = (x: number, y: number | null): [number, number] | null => (y === null ? null : worldToCanvas(x, y, w, h));
    const vertex = (pts: [number, number][] | undefined) => {
      if (!pts || pts.length === 0) return null;
      const k = typeof point === "number" && pts[point] ? point : 0;
      return at(pts[k][0], pts[k][1]);
    };
    switch (ref.type) {
      case "exterior":
        return vertex(coordinates);
      case "boundary":
        return vertex(materialBoundaries.find((v) => v.id === ref.id)?.coordinates);
      case "waterLine":
        return vertex(piezometricLine.lines.find((v) => v.id === ref.id)?.coordinates);
      case "udl": {
        const u = udls.find((v) => v.id === ref.id);
        const x = u ? (point === "x2" ? u.x2 : u.x1) : null;
        return x === null ? null : at(x, surfaceYAtX(x));
      }
      case "lineLoad": {
        const l = lineLoads.find((v) => v.id === ref.id);
        return l ? at(l.x, surfaceYAtX(l.x)) : null;
      }
      case "searchLimits": {
        const key = point === "entryRightX" || point === "exitLeftX" || point === "exitRightX" ? point : "entryLeftX";
        return at(analysisLimits[key], surfaceYAtX(analysisLimits[key]));
      }
      case "reinforcement":
      case "pile": {
        const list: { id: string; x1: number; y1: number; x2: number; y2: number }[] =
          ref.type === "pile" ? (piles ?? []) : (reinforcements ?? []);
        const r = list.find((v) => v.id === ref.id);
        return r ? (point === "end2" ? at(r.x2, r.y2) : at(r.x1, r.y1)) : null;
      }
      case "customPlane": {
        const p = customSearchPlanes?.find((v) => v.id === ref.id);
        if (!p) return null;
        return p.points ? vertex(p.points) : at(p.cx, p.cy);
      }
      case "background": {
        const b = backgrounds.find((v) => v.id === ref.id);
        return (b && placementCanvasCorners(b, (x, y) => worldToCanvas(x, y, w, h))?.[0]) ?? null;
      }
    }
  };
  const MARKER_BASE = cssVar("--color-canvas-marker") || MARKER_COLOR.hex;
  const CUSTOM_SURFACE = cssVar("--color-canvas-custom-surface") || CUSTOM_SURFACE_COLOR.hex;
  // Reference annotations without a colour of their own: the theme's.
  const REFERENCE_COLOR = cssVar("--color-canvas-reference") || REFERENCE_ANNOTATION_COLOR.hex;
  // Labels of the water and head lines: a lighter tint in the dark theme,
  // on a plate in the colour of the sheet or the canvas behind them.
  const WATER_LABEL_COLOR = cssVar("--color-canvas-water-label") || PIEZO_COLOR.hex;
  const HEAD_LABEL_COLOR = cssVar("--color-canvas-head-label") || PRINT_INK.headLine;
  const LINE_LABEL_HALO = (mode === "result" && result ? PAPER_FILL_COLOR : BG_COLOR) || "#ffffff";
  // Lines that cross the soil (the critical surface, water and head lines):
  // in the theme's ink over the sheet, in the print colour over the light
  // soil fills, where the dark theme's light ink would not read (the fills
  // are the user's colours in both themes). One pass where the two are
  // the same (the light theme).
  let lightFillRings: [number, number][][] | null = null;
  const paintAgainstFills = (ink: string, print: string, paint: (color: string) => void) => {
    if (ink === print || resultViewSettings.showSoilColor === false || coordinates.length < 3) {
      paint(ink);
      return;
    }
    lightFillRings ??= getCachedRegions(coordinates, materialBoundaries, regionMaterials, materials[0]?.id ?? "").flatMap((r) => {
      const color = materials.find((m) => m.id === r.materialId)?.color;
      if (color === undefined || r.px.length < 3 || isDarkFill(color)) return [];
      return [r, ...(r.holes ?? [])]
        .filter((ring) => ring.px.length >= 3)
        .map((ring) => ring.px.map((x, i) => worldToCanvas(x, ring.py[i], w, h)));
    });
    const rings = lightFillRings;
    if (rings.length === 0) {
      paint(ink);
      return;
    }
    const addRings = () => {
      for (const ring of rings) {
        ring.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
        ctx.closePath();
      }
    };
    // Outside the light fills, then inside them (each part once, so a
    // translucent line is not painted twice).
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    addRings();
    ctx.clip("evenodd");
    paint(ink);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    addRings();
    ctx.clip("evenodd");
    paint(print);
    ctx.restore();
  };
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

  // The layers of a result sheet in the model's order (bottom first);
  // those at the bottom, the soil colours and drawings, are drawn with
  // the model under its lines, as by default; the rest over them.
  const resultLayerList =
    mode === "result" && result ? resultLayers({ resultViewSettings, result, backgrounds }) : null;
  const baseLayerTotal = resultLayerList ? baseLayerCount(resultLayerList) : 0;
  const baseLayerList = resultLayerList?.slice(0, baseLayerTotal) ?? [];
  const soilIndex = baseLayerList.findIndex((l) => l.key === "soilColor");
  const soilInBase = soilIndex >= 0;
  const baseDrawings = (from: number, to: number) =>
    baseLayerList.slice(from, to).flatMap((l) => (l.kind === "drawing" ? [l.drawing] : []));
  const baseDrawingsBelowSoil = soilInBase ? baseDrawings(0, soilIndex) : [];
  const baseDrawingsAboveSoil = baseDrawings(soilInBase ? soilIndex + 1 : 0, baseLayerList.length);

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
  // Lines over a result are drawn thinner than in the edit view.
  const thin = mode === "result" ? 0.7 : 1;
  // The view as numbers (worldToCanvas is a new function every frame):
  // where two world points land fixes the scale and offset.
  const viewProbe = [...worldToCanvas(0, 0, w, h), ...worldToCanvas(1, 1, w, h)];

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
  // The grid has a spacing of its own when the user sets one (Properties).
  const gridStep =
    resultTickStep !== null
      ? resolveTickStep(resultViewSettings.gridLineSpacing, resultTickStep)
      : autoGridStep;

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

    // (No heavier line at x = 0 and y = 0: every grid line is drawn alike.)
  };

  // ── Material region fills ─────────────────────────────
  // The soil colours of the regions (`fill`, with the hatches of special
  // materials) and, over a result, their outlines.
  const paintRegions = (regions: ReturnType<typeof getCachedRegions>, fill: boolean, outline: boolean) => {
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

      if (fill) {
        ctx.fillStyle = mat.color;
        ctx.fill(region.holes ? "evenodd" : "nonzero");
      }

      if (outline) {
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
      if (fill && hatchPattern) {
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
  };
  const modelRegions = () => getCachedRegions(coordinates, materialBoundaries, regionMaterials, materials[0]?.id ?? "");
  // The soil colours as a layer of their own, above the bottom of the
  // order (the base drawing drew the outlines without them).
  const paintSoilFills = () => {
    if (coordinates.length >= 3) paintRegions(modelRegions(), true, false);
  };
  // Placed drawings shown in results, each a layer, in the given order.
  const drawDrawingLayers = (list: readonly BackgroundImage[]) => {
    for (const d of list) {
      drawUnderlays(ctx, [d], (x, y) => worldToCanvas(x, y, w, h), { pixelRatio, ink: INK.drawingInk, include: (p) => p.visible });
    }
  };
  // Drawings below the soil colours in the order (default: none).
  if (baseDrawingsBelowSoil.length > 0) {
    ctx.save();
    drawDrawingLayers(baseDrawingsBelowSoil);
    ctx.restore();
  }
  if (coordinates.length >= 3) {
    // Over a result the soil colours here only at the bottom of the
    // layers' order (as by default); otherwise a step of their own.
    const showSoilColor = resultLayerList ? soilInBase : resultViewSettings.showSoilColor !== false;
    const defaultMatId = materials[0]?.id ?? "";
    const regions = getCachedRegions(
      coordinates,
      materialBoundaries,
      regionMaterials,
      defaultMatId,
    );

    paintRegions(regions, showSoilColor, mode === "result");

    // ── Highlight the region whose material is being chosen ──
    if (selectedRegionKey && mode !== "result") {
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

  // ── Placed drawings: above the fills, below the grid and every line ──
  // (draw-underlays.ts says why), as a sheet at their opacity. In the
  // result view only those shown in results.
  if (backgrounds.length > 0) {
    // Where the rulers are drawn (AxisOverlay: not on the result sheet),
    // the drawing stays off them: its texts would show through the
    // rulers' numbers.
    const rulers = !(mode === "result" && result);
    ctx.save();
    if (rulers) {
      ctx.beginPath();
      ctx.rect(RULER_SIZE_PX, 0, Math.max(0, w - RULER_SIZE_PX), Math.max(0, h - RULER_SIZE_PX));
      ctx.clip();
    }
    if (resultLayerList) drawDrawingLayers(baseDrawingsAboveSoil);
    else
      drawUnderlays(ctx, backgrounds, (x, y) => worldToCanvas(x, y, w, h), {
        pixelRatio,
        ink: INK.drawingInk,
        include: (p) => p.visible && (mode !== "result" || p.showInResults === true),
      });
    ctx.restore();
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
    // Thinner over a result, where the slip surface is the heavy line.
    ctx.lineWidth = (mode === "result" ? RESULT_OUTLINE_WIDTH_PX : 1) * paperZoom;
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
    const strokeBoundaries = (only: string | null = null) => {
      for (const b of materialBoundaries) {
        if (b.coordinates.length < 2 || (only !== null && b.id !== only)) continue;
        const isSelectedBoundary = b.id === selectedBoundaryId;
        ctx.strokeStyle = isSelectedBoundary
          ? SELECTED_BOUNDARY_COLOR
          : POLY_STROKE;
        ctx.lineWidth = (isSelectedBoundary ? 2 : 1) * thin * paperZoom;
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
      strokeBoundaries(selectedBoundaryId);
      ctx.restore();
    }
  }

  // ── Tension crack of fixed depth (edit view): where it shows ──────
  // With prescribed surfaces the analysis cuts each at the crack (where
  // it lies the crack depth below the ground on the entry side) and the
  // surface enters at the crack's base: the dimension stands there, at
  // the first surface with a crack. Otherwise on the crest near its
  // downslope edge, its bottom tick clear of material boundaries (a
  // boundary at the crack depth would read as the crack's end). (An
  // automatic depth depends on the soil where the crack opens; the result
  // shows that crack.)
  const editCrackDepth =
    mode !== "result" && !options?.tensionCrackAuto ? Math.max(0, options?.tensionCrackDepth ?? 0) : 0;
  const prescribedPaths =
    mode !== "result" && coordinates.length >= 3
      ? (customSearchPlanes ?? []).map((s) =>
          prescribedPath(coordinates, s, editCrackDepth, orientation === "rtl", options?.compositeSurfaces !== false && options?.compositeBase === true),
        )
      : [];
  const crackPlane = prescribedPaths.findIndex((p) => p.crack !== null);
  let editCrackMarker: CrackMarker | null = null;
  if (editCrackDepth > 0 && coordinates.length >= 3) {
    const pc = crackPlane >= 0 ? prescribedPaths[crackPlane].crack : null;
    if (pc) {
      // `inward`: the upslope side, away from the sliding mass.
      editCrackMarker = { x: pc.x, top: pc.top, bottom: pc.bottom, inward: orientation === "rtl" ? 1 : -1 };
    } else {
      // Clear of the search-limit markers (their triangles reach 14 px).
      const px = 1 / Math.max(viewScale, 1e-9);
      const limitXs = analysisLimits.enabled
        ? [analysisLimits.entryLeftX, analysisLimits.entryRightX, analysisLimits.exitLeftX, analysisLimits.exitRightX]
        : [];
      const lines = materialBoundaries.flatMap((b) =>
        b.coordinates.slice(1).map(([x, y], i) => [b.coordinates[i][0], b.coordinates[i][1], x, y] as const),
      );
      editCrackMarker = crackMarkerPosition(coordinates, editCrackDepth, orientation === "rtl", 30 * px, limitXs, 20 * px, {
        lines,
        lineClear: 4 * px,
        tickHalf: 4 * px,
      });
    }
  }

  // ── Prescribed slip surfaces (edit view) ────────────────
  // Custom circles and polylines, dashed: a circle from where it enters
  // the ground to where it leaves it (the entry and exit the analysis
  // takes), a polyline clipped to the model; with a tension crack of
  // fixed depth from the crack's base, with the crack face (the crack
  // dimension stands at the first one's). A circle the analysis can't
  // use (no such entry and exit, or never as deep as the crack) shows
  // fainter, its part in the soil. A halo of the background colour keeps
  // them visible on dark fills. The plane picked on the canvas is drawn in
  // the selection colour, a hovered rim as a thin ring.
  if (mode !== "result" && customSearchPlanes?.length && coordinates.length >= 3) {
    const extC = coordinates.map(([x, y]) => worldToCanvas(x, y, w, h));
    const inModel = (x: number, y: number) =>
      isPointInPolygon(x, y, extC.map((c) => c[0]), extC.map((c) => c[1]));
    const strokeDashed = (path: () => void, alpha: number, selected: boolean) => {
      ctx.save();
      ctx.setLineDash([]);
      ctx.strokeStyle = BG_COLOR;
      ctx.globalAlpha = 0.55 * alpha;
      ctx.lineWidth = 4;
      ctx.beginPath();
      path();
      ctx.stroke();
      ctx.strokeStyle = selected ? SELECTED_BOUNDARY_COLOR : MARKER_BASE;
      ctx.globalAlpha = selected ? 1 : 0.85 * alpha;
      ctx.lineWidth = selected ? 2 : 1.5;
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
    customSearchPlanes.forEach((s, k) => {
      const path = prescribedPaths[k];
      const selected = s.id === selectedCustomPlaneId;
      if (s.points) {
        if (s.points.length < 2) return;
      } else if (!(s.radius > 0)) return;
      if (!path.unusable && path.points.length >= 2) {
        // The crack face too, where no dimension stands on it.
        const world = path.crack && k !== crackPlane ? [[path.crack.x, path.crack.top] as [number, number], ...path.points] : path.points;
        const pts = world.map(([x, y]) => worldToCanvas(x, y, w, h));
        strokeDashed(polyPath(pts), 1, selected);
        for (const seg of segmentsInside(pts, extC, inModel)) labelLines.push({ seg, pad: 2 });
      } else if (s.points) {
        // A polyline the analysis has no surface for, faint as it was given.
        strokeDashed(polyPath(s.points.map(([x, y]) => worldToCanvas(x, y, w, h))), 0.4, selected);
      } else {
        const [cx, cy] = worldToCanvas(s.cx, s.cy, w, h);
        const [ex] = worldToCanvas(s.cx + s.radius, s.cy, w, h);
        strokeDashed(() => ctx.arc(cx, cy, Math.abs(ex - cx), 0, Math.PI * 2), 0.4, selected);
      }
    });
    ctx.restore();
    // The whole rim under the pointer, unclipped: it is what a drag resizes.
    const rimHover = hoverHit?.kind === "customCircle" && hoverHit.handle === "rim" ? hoverHit : null;
    const rimPlane = rimHover ? customSearchPlanes.find((s) => s.id === rimHover.planeId) : undefined;
    if (rimPlane && !rimPlane.points && rimPlane.radius > 0) {
      const [cx, cy] = worldToCanvas(rimPlane.cx, rimPlane.cy, w, h);
      const [ex] = worldToCanvas(rimPlane.cx + rimPlane.radius, rimPlane.cy, w, h);
      ctx.save();
      ctx.setLineDash([]);
      ctx.strokeStyle = POINT_COLOR_HOVER;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.abs(ex - cx), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── Reference annotations marked for the edit view ──────
  // Lines over the soil as in the result view, with their labels; the
  // point labels keep off them.
  if (mode !== "result") {
    const drawnRefs = drawReferenceLines(ctx, {
      annotations: resultViewSettings.annotations,
      mode: "edit",
      toC: (x, y) => worldToCanvas(x, y, w, h),
      groundYAt: surfaceYAtX,
      paperZoom: 1,
      defaultColor: REFERENCE_COLOR,
    });
    if (drawnRefs.length > 0) {
      const refSegs = referenceSegments(drawnRefs);
      for (const seg of refSegs) labelLines.push({ seg, pad: 2 });
      const refLayout = new LabelLayout(labelBounds);
      for (const seg of refSegs) refLayout.reserveSegment(seg, 2);
      if (coordinates.length >= 3) refLayout.reservePolyline(coordinates.map(([x, y]) => worldToCanvas(x, y, w, h)), 2, true);
      for (const box of drawReferenceLabels(ctx, drawnRefs, { toC: (x, y) => worldToCanvas(x, y, w, h), paperZoom: 1, layout: refLayout, plate: BG_COLOR }))
        pointSymbols.push(box);
    }
  }

  // ── Block search objects (edit view, block search) ──────
  // Windows shaded with their outline, lines solid, fixed points as small
  // crosses; each numbered as in the Options dialog.
  if (mode !== "result" && options?.searchMethod === "block" && blockSearchObjects?.length) {
    ctx.save();
    ctx.setLineDash([]);
    ctx.font = `${10 * paperZoom}px sans-serif`;
    blockSearchObjects.forEach((o, k) => {
      if (o.points.length === 0) return;
      const pts = o.points.map(([x, y]) => worldToCanvas(x, y, w, h));
      ctx.strokeStyle = MARKER_BASE;
      ctx.fillStyle = MARKER_BASE;
      ctx.lineWidth = 1.5 * paperZoom;
      if (pts.length === 1) {
        const [px, py] = pts[0];
        const r = 4 * paperZoom;
        ctx.beginPath();
        ctx.moveTo(px - r, py - r);
        ctx.lineTo(px + r, py + r);
        ctx.moveTo(px - r, py + r);
        ctx.lineTo(px + r, py - r);
        ctx.stroke();
      } else {
        ctx.beginPath();
        pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
        if (pts.length >= 3) {
          ctx.closePath();
          ctx.globalAlpha = 0.15;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.stroke();
        if (pts.length === 2) {
          for (const [px, py] of pts) {
            ctx.beginPath();
            ctx.arc(px, py, 2.5 * paperZoom, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      const top = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
      ctx.globalAlpha = 0.9;
      ctx.fillText(`B${k + 1}`, top[0] + 4 * paperZoom, top[1] - 4 * paperZoom);
      ctx.globalAlpha = 1;
    });
    ctx.restore();
  }

  // ── UDL and line loads (geometry from layoutLoads) ───────
  const loads = layoutLoads(ctx, { w, h, coordinates, worldToCanvas, surfaceYAtX }, udls, lineLoads, hoverHit, paperZoom);
  const drawDownArrow = ({ cx, cy, top, tail }: LoadArrow, color: string, lineWidth: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth * thin * paperZoom;
    if (tail) {
      // an inclined line load: the shaft from the tail, the head along it
      const len = Math.hypot(cx - tail[0], cy - tail[1]) || 1;
      const ux = (cx - tail[0]) / len;
      const uy = (cy - tail[1]) / len;
      const hl = ARROW_HEAD_LEN_PX * paperZoom;
      const hw = ARROW_HEAD_PX * paperZoom;
      ctx.beginPath();
      ctx.moveTo(tail[0], tail[1]);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx - ux * hl - uy * hw, cy - uy * hl + ux * hw);
      ctx.lineTo(cx - ux * hl + uy * hw, cy - uy * hl - ux * hw);
      ctx.closePath();
      ctx.fill();
      return;
    }
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
    ctx.strokeStyle = INK.udlHatch;
    ctx.lineWidth = 1 * thin * paperZoom;
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
    ctx.strokeStyle = INK.udl;
    ctx.lineWidth = 1.5 * thin * paperZoom;
    ctx.beginPath();
    ctx.moveTo(strips[0].ground[0][0], strips[0].ground[0][1]);
    for (const s of strips) for (const [px, py] of s.top) ctx.lineTo(px, py);
    const groundAll = strips.flatMap((s) => s.ground);
    for (let i = groundAll.length - 1; i >= 0; i--) ctx.lineTo(groundAll[i][0], groundAll[i][1]);
    ctx.closePath();
    ctx.stroke();

    for (const a of g.arrows) drawDownArrow(a, a.hover ? INK.udlHover : INK.udl, a.hover ? 3 : 2);
  }
  for (const a of loads.lineLoads) drawDownArrow(a, a.hover ? INK.lineLoadHover : INK.lineLoad, a.hover ? 3 : 2);
  ctx.font = `bold ${LOAD_LABEL_FONT_PX * paperZoom}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  for (const l of loads.labels) {
    ctx.fillStyle = l.kind === "udl" ? INK.udl : l.hover ? INK.lineLoadHover : INK.lineLoad;
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
      color: INK.reinforcementText,
    });
  }
  if (piles && piles.length > 0) {
    drawPiles(ctx, piles, (x, y) => worldToCanvas(x, y, w, h), paperZoom, INK.pileText);
  }

  // The vertex dots of the edit view (drawn over the search-limit markers,
  // which move their triangles off them), with half their outline.
  const vertexDots: MarkerDot[] = [];
  if (mode !== "result") {
    const extR = (editingExterior ? POINT_RADIUS : 3) + (editingExterior ? 0.75 : 0.5);
    for (const [x, y] of coordinates) {
      const [px, py] = worldToCanvas(x, y, w, h);
      vertexDots.push({ x: px, y: py, r: extR });
    }
    const bndR = (edited: boolean) => (edited ? POINT_RADIUS - 1 : 3) + (edited ? 0.75 : 0.5);
    const ext = coordinates.map(([x, y]) => worldToCanvas(x, y, w, h));
    const onModel = (px: number, py: number) =>
      ext.length < 3 ||
      isPointInPolygon(px, py, ext.map((c) => c[0]), ext.map((c) => c[1])) ||
      ext.some((a, k) => distanceToSegment(px, py, a, ext[(k + 1) % ext.length]) <= 1.5);
    for (const b of materialBoundaries) {
      const edited = b.id === selectedBoundaryId;
      for (const [x, y] of b.coordinates) {
        const [px, py] = worldToCanvas(x, y, w, h);
        if (edited || onModel(px, py)) vertexDots.push({ x: px, y: py, r: bndR(edited) });
      }
    }
  }

  // ── Piezometric lines ──────────────────────────────────
  // Water-table symbols, clear of what is drawn around them (computed
  // once: the edit-view labels keep clear of them too).
  const searchShown =
    analysisLimits.enabled &&
    !(customPlanesOnly && (mode === "result" || (customSearchPlanes?.length ?? 0) > 0));
  // On the inputs, not the mouse: the vertex dots follow from the model,
  // the editing flags and the view.
  const piezoCritical = mode === "result" ? (result?.criticalSurface ?? null) : null;
  const drawnPiezoSymbols =
    piezometricLine.lines.length > 0
      ? memoLayout(
          piezoSymbolMemo,
          [
            w,
            h,
            ...viewProbe,
            paperZoom,
            mode,
            coordinates,
            piezometricLine,
            reinforcements,
            piles,
            piezoCritical,
            materialBoundaries,
            udls,
            lineLoads,
            searchShown ? analysisLimits : null,
            mode !== "result" ? customSearchPlanes : undefined,
            editCrackMarker?.x,
            editCrackMarker?.top,
            editCrackMarker?.bottom,
            editingExterior,
            selectedBoundaryId,
          ],
          () =>
            layoutPiezoSymbols(
              { w, h, coordinates, worldToCanvas, surfaceYAtX },
              piezometricLine,
              reinforcements,
              piles,
              paperZoom,
              piezoCritical,
              {
                materialBoundaries,
                udls,
                lineLoads,
                analysisLimits: searchShown ? analysisLimits : null,
                prescribed: mode !== "result" ? customSearchPlanes : undefined,
                // The crack-depth dimension where the crack block below draws it.
                crackMarker: editCrackMarker,
                vertices:
                  mode !== "result"
                    ? [
                        ...coordinates,
                        ...materialBoundaries.flatMap((b) => b.coordinates),
                        ...piezometricLine.lines.flatMap((l) => l.coordinates),
                      ]
                    : undefined,
                vertexDots,
              },
            ),
        )
      : [];
  // Rapid drawdown: the water before drawdown, dashed, with a label at
  // its right end.
  const waterBefore = piezometricLine.rapidDrawdown?.waterBefore;
  if (waterBefore && waterBefore.length >= 2) {
    const pts = waterBefore.map(([x, y]) => worldToCanvas(x, y, w, h));
    paintAgainstFills(INK.waterLine, PIEZO_COLOR.hex, (color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 * paperZoom;
      ctx.setLineDash([8 * paperZoom, 5 * paperZoom]);
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.stroke();
      ctx.setLineDash([]);
    });
    const [lx, ly] = pts.reduce((a, b) => (b[0] > a[0] ? b : a));
    ctx.fillStyle = WATER_LABEL_COLOR;
    ctx.font = `${9 * paperZoom}px 'Segoe UI', sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    fillTextOnPlate(ctx, "before drawdown", lx - 2 * paperZoom, ly - 2 * paperZoom, LINE_LABEL_HALO, LABEL_PLATE_PAD_PX * paperZoom);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
  }
  let drawHeadLabels: (() => void) | null = null;
  // Imported head and reference lines: unlike the water lines and the
  // drawdown line (blue, long dashes), head lines are teal and dash-dotted
  // with a label at their right end; reference lines are faint and dotted.
  if (waternet) {
    const path = (points: [number, number][]) => {
      ctx.beginPath();
      points.forEach(([x, y], i) => {
        const [px, py] = worldToCanvas(x, y, w, h);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    };
    paintAgainstFills(INK.referenceLine, PRINT_INK.referenceLine, (color) => {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 * paperZoom;
      ctx.setLineDash([1.5 * paperZoom, 3 * paperZoom]);
      for (const ref of waternet.referenceLines) if (ref.points.length >= 2) path(ref.points);
      ctx.restore();
    });

    paintAgainstFills(INK.headLine, PRINT_INK.headLine, (color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2 * paperZoom;
      ctx.setLineDash([8 * paperZoom, 3 * paperZoom, 2 * paperZoom, 3 * paperZoom]);
      waternet.headLines.forEach((head) => {
        if (head.points.length >= 2) path(head.points);
      });
      ctx.setLineDash([]);
    });
    const headFont = `${9 * paperZoom}px 'Segoe UI', sans-serif`;
    ctx.font = headFont;
    // Labels of lines ending close together are put below one another, a
    // whole plate (as fillTextOnPlate draws it) and a gap apart.
    const plateH = 9 * 1.15 * paperZoom;
    const platePad = LABEL_PLATE_PAD_PX * paperZoom;
    const labels = waternet.headLines.flatMap((head, i) => {
      if (head.points.length < 2) return [];
      const pts = head.points.map(([x, y]) => worldToCanvas(x, y, w, h));
      const [lx, ly] = pts.reduce((a, b) => (b[0] > a[0] ? b : a));
      const text = `head line ${i + 1}`;
      return [{ text, right: lx - 2 * paperZoom, top: ly + 2 * paperZoom, width: ctx.measureText(text).width + platePad, height: plateH }];
    });
    const tops = staggerLabelTops(labels, 1.5 * paperZoom);
    // The point labels (a selected line's coordinates) keep off them.
    labels.forEach((l, i) =>
      pointSymbols.push({ left: l.right - l.width - platePad, top: tops[i], right: l.right + platePad, bottom: tops[i] + plateH }),
    );
    // Drawn after the water lines, so a (selected, thick) water line does
    // not strike through them.
    drawHeadLabels = () => {
      ctx.fillStyle = HEAD_LABEL_COLOR;
      ctx.font = headFont;
      // Below the line, clear of the "before drawdown" label above its line.
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      // A plate keeps the ground line and the soil fill from striking through them.
      labels.forEach((l, i) => fillTextOnPlate(ctx, l.text, l.right, tops[i], LINE_LABEL_HALO, platePad));
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
    };
  }
  if (piezometricLine.lines.length > 0) {
    const multiLine = piezometricLine.lines.length > 1;
    const piezoBlue = INK.waterLine;
    // Free water standing on the ground (from the line of the material at
    // the ground, as the analysis takes it).
    if (piezometricLine.freeWater !== false) {
      const ponds = piezoPonds(
        piezometricLine,
        coordinates,
        getCachedRegions(coordinates, materialBoundaries, regionMaterials, materials[0]?.id ?? ""),
      );
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
        piezoBlue,
      );
      ctx.globalAlpha = 1;
    }
    for (let lineIdx = 0; lineIdx < piezometricLine.lines.length; lineIdx++) {
      const line = piezometricLine.lines[lineIdx];
      if (line.coordinates.length < 2) continue;
      const plCoords = line.coordinates;

      // Stroke: solid polyline (the water ink over the sheet, the print
      // blue over a light fill)
      const selectedLine = line.id === selectedWaterLineId;
      paintAgainstFills(selectedLine ? SELECTED_BOUNDARY_COLOR : piezoBlue, selectedLine ? SELECTED_BOUNDARY_COLOR : PIEZO_COLOR.hex, (lineColor) => {
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = (selectedLine ? 3 : 1.5) * thin * paperZoom;
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
      });

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
        paintAgainstFills(piezoBlue, PIEZO_COLOR.hex, (symbolColor) => {
          ctx.beginPath();
          ctx.moveTo(mx - triHalf, triTop);
          ctx.lineTo(mx + triHalf, triTop);
          ctx.lineTo(mx, my);
          ctx.closePath();
          ctx.fillStyle = symbolColor;
          ctx.fill();

          // Two bars below the tip (left out where they would go into the ground).
          if (bars) {
            ctx.strokeStyle = symbolColor;
            ctx.lineWidth = 1.2 * thin * paperZoom;
            for (const gap of [PIEZO_BAR_GAP1_PX, PIEZO_BAR_GAP2_PX]) {
              ctx.beginPath();
              ctx.moveTo(mx - barW, my + gap * paperZoom);
              ctx.lineTo(mx + barW, my + gap * paperZoom);
              ctx.stroke();
            }
          }
        });

        // Line number above the triangle (only if multiple lines)
        if (multiLine) {
          ctx.fillStyle = WATER_LABEL_COLOR;
          ctx.font = `bold ${10 * paperZoom}px 'Segoe UI', sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          fillTextOnPlate(ctx, labelNum, mx, triTop - 2 * paperZoom, LINE_LABEL_HALO, LABEL_PLATE_PAD_PX * paperZoom);
          ctx.textBaseline = "alphabetic";
        }
      }

      // Circle node markers are edit-mode affordances only; hide them in result view.
      if (mode !== "result") {
        const piezoRadius = selectedLine ? POINT_RADIUS : 3;
        for (let i = 0; i < plCoords.length; i++) {
          const [px, py] = worldToCanvas(plCoords[i][0], plCoords[i][1], w, h);
          const isHover =
            selectedLine &&
            hoverHit?.kind === "piezo" &&
            hoverHit.lineId === line.id &&
            hoverHit.index === i;

          ctx.beginPath();
          ctx.arc(px, py, piezoRadius, 0, Math.PI * 2);
          ctx.fillStyle = isHover
            ? POINT_COLOR_HOVER
            : selectedLine
              ? selLocked
                ? LOCKED_HANDLE_COLOR
                : SELECTED_BOUNDARY_COLOR
              : piezoBlue + "99";
          ctx.fill();
          ctx.strokeStyle = selectedLine ? STROKE_ACTIVE : STROKE_INACTIVE;
          ctx.lineWidth = selectedLine ? 1.5 : 1;
          ctx.stroke();
          if (selectedLine && selPoint === i) selectedPointRing(px, py, piezoRadius);

          pointSymbols.push(boxAround(px, py, piezoRadius));
          if (selectedLine && onScreen(px, py)) {
            pointLabels.push({
              text: `(${plCoords[i][0].toFixed(1)}, ${plCoords[i][1].toFixed(1)})`,
              px,
              py,
              below: false,
              force: isHover || selPoint === i,
            });
          }
        }
      }
    }
  }

  drawHeadLabels?.();

  // ── Tension crack depth (edit mode) ─────────────────────
  // A crack of fixed depth shows as a vertical dimension from the ground
  // down to the crack's depth (where editCrackMarker puts it), labelled
  // "crack 2.0 m". A dashed line along the whole ground read as a
  // boundary or a prescribed surface and ran through foundations.
  let crackLabel: { text: string; x: number; top: number; bottom: number; inward: number } | null = null;
  {
    const marker = editCrackMarker;
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
      pointSymbols.push({ left: mx - 4, top: top - 1, right: mx + 4, bottom: top + 1 });
      crackLabel = { text: `crack ${formatCrackDepth(editCrackDepth)} m`, x: mx, top, bottom, inward: marker.inward };
    }
  }

  // ── Entry / Exit range markers ──────────────────────────
  // Not when only prescribed surfaces are analysed (nothing is searched):
  // in the result, and in edit view once there is a prescribed surface. In
  // the result they look as in the edit view, drawn before the sliding
  // mass so the critical surface stays on top of them.
  const limitsShown =
    analysisLimits.enabled &&
    coordinates.length >= 3 &&
    !(customPlanesOnly && (mode === "result" || (customSearchPlanes?.length ?? 0) > 0));
  if (limitsShown) {
    // Over a result as in the edit view (opaque, standing on the ground).
    const markerAlpha = 1;
    const toC = (x: number, y: number) => worldToCanvas(x, y, w, h);

    // Dots along the ground over each range (alternating colours where the
    // entry and exit ranges coincide), as in the edit view: also over the
    // sliding mass.
    const dotRadius = ENTRY_EXIT_DOT_RADIUS_PX * paperZoom;
    ctx.save();
    ctx.globalAlpha = markerAlpha;
    for (const d of layoutRangeDots(analysisLimits, coordinates, toC, paperZoom, {
      skip: null,
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
    for (const m of layoutLimitMarkers(analysisLimits, coordinates, toC, paperZoom, {
      lifted: false,
      dots: vertexDots,
    })) {
      const isHover = hoverHit?.kind === "limit" && m.handles.includes(hoverHit.handle);
      const hoverColor =
        isHover && hoverHit?.kind === "limit" && hoverHit.handle.startsWith("exit") ? EXIT_DOT_COLOR.hex : ENTRY_DOT_COLOR.hex;
      const color = isHover ? hoverColor : MARKER_BASE;
      ctx.save();
      ctx.globalAlpha = markerAlpha;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = (isHover ? 2.5 : 2) * thin * paperZoom;
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

  // ── Selection outline and hover highlight (edit view) ───
  // The selected object's lines in the selection colour; the object under
  // the pointer with a faint, wide halo of it (under the handles); a locked
  // one in the locked grey, so it does not look selected.
  if (mode !== "result") {
    if (selObject?.type === "exterior") strokeObject(selObject, SELECTED_BOUNDARY_COLOR, 2, 0.9);
    if (hoverObject) strokeObject(hoverObject.object, hoverObject.locked ? LOCKED_HANDLE_COLOR : SELECTED_BOUNDARY_COLOR, 8, 0.3);
    // A selected drawing: its crop frame, dashed (grey when locked).
    if (selObject?.type === "background") {
      strokeObject(selObject, selLocked ? LOCKED_HANDLE_COLOR : SELECTED_BOUNDARY_COLOR, 1.75, 1, [7, 4]);
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
      ctx.fillStyle = isHover
        ? POINT_COLOR_HOVER
        : editingExterior
          ? selLocked
            ? LOCKED_HANDLE_COLOR
            : SELECTED_BOUNDARY_COLOR
          : STROKE_INACTIVE;
      ctx.fill();
      ctx.strokeStyle = editingExterior ? STROKE_ACTIVE : STROKE_INACTIVE;
      ctx.lineWidth = editingExterior ? 1.5 : 1;
      ctx.stroke();
      if (isSelected) selectedPointRing(px, py, extRadius);

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
    const bndRadiusOf = (edited: boolean) => (edited ? POINT_RADIUS - 1 : 3);
    // Outside the model a boundary point divides nothing; it is shown (and
    // can be picked) only while the boundaries are edited.
    const ext = coordinates.map(([x, y]) => worldToCanvas(x, y, w, h));
    const onModel = (px: number, py: number) =>
      ext.length < 3 ||
      isPointInPolygon(px, py, ext.map((c) => c[0]), ext.map((c) => c[1])) ||
      ext.some((a, k) => distanceToSegment(px, py, a, ext[(k + 1) % ext.length]) <= 1.5);
    for (const b of materialBoundaries) {
      const color = materials[0]?.color ?? "#888";
      const isSelectedBoundary = b.id === selectedBoundaryId;
      const edited = isSelectedBoundary;
      const bndRadius = bndRadiusOf(edited);
      const boundaryBaseColor = isSelectedBoundary
        ? selLocked
          ? LOCKED_HANDLE_COLOR
          : SELECTED_BOUNDARY_COLOR
        : color;

      for (let i = 0; i < b.coordinates.length; i++) {
        const [px, py] = worldToCanvas(
          b.coordinates[i][0],
          b.coordinates[i][1],
          w,
          h,
        );
        if (!edited && !onModel(px, py)) continue;
        const isHover =
          edited &&
          hoverHit?.kind === "boundary" &&
          hoverHit.boundaryId === b.id &&
          hoverHit.pointIndex === i;

        ctx.beginPath();
        ctx.arc(px, py, bndRadius, 0, Math.PI * 2);
        ctx.fillStyle = isHover
          ? POINT_COLOR_HOVER
          : edited
            ? boundaryBaseColor
            : STROKE_INACTIVE;
        ctx.fill();
        ctx.strokeStyle = edited ? STROKE_ACTIVE : STROKE_INACTIVE;
        ctx.lineWidth = edited ? 1.5 : 1;
        ctx.stroke();
        if (edited && selPoint === i) selectedPointRing(px, py, bndRadius);
        pointSymbols.push(boxAround(px, py, bndRadius));
      }
    }
  }

  // ── Custom search plane handles ────────────────────────
  // A circle's centre and a non-circular surface's vertices: handles of
  // the selected surface, small dots of the others; a centre carries a
  // small cross.
  if (mode !== "result" && customSearchPlanes?.length) {
    const drawHandle = (px: number, py: number, hover: boolean, selected: boolean, cross: boolean, picked: boolean) => {
      const r = selected ? POINT_RADIUS - 1 : 3;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = hover ? POINT_COLOR_HOVER : selected ? (selLocked ? LOCKED_HANDLE_COLOR : SELECTED_BOUNDARY_COLOR) : MARKER_BASE;
      ctx.fill();
      ctx.strokeStyle = selected ? STROKE_ACTIVE : STROKE_INACTIVE;
      ctx.lineWidth = selected ? 1.5 : 1;
      ctx.stroke();
      if (cross) {
        const arm = r + 3;
        ctx.beginPath();
        ctx.moveTo(px - arm, py);
        ctx.lineTo(px + arm, py);
        ctx.moveTo(px, py - arm);
        ctx.lineTo(px, py + arm);
        ctx.strokeStyle = selected ? SELECTED_BOUNDARY_COLOR : MARKER_BASE;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (picked) selectedPointRing(px, py, r);
      pointSymbols.push(boxAround(px, py, r + (cross ? 3 : 0)));
    };
    ctx.save();
    ctx.setLineDash([]);
    for (const s of customSearchPlanes) {
      const selected = s.id === selectedCustomPlaneId;
      if (s.points) {
        for (let i = 0; i < s.points.length; i++) {
          const [px, py] = worldToCanvas(s.points[i][0], s.points[i][1], w, h);
          const hover =
            selected && hoverHit?.kind === "customVertex" && hoverHit.planeId === s.id && hoverHit.pointIndex === i;
          drawHandle(px, py, hover, selected, false, selected && selPoint === i);
        }
      } else {
        const [px, py] = worldToCanvas(s.cx, s.cy, w, h);
        const hover =
          selected && hoverHit?.kind === "customCircle" && hoverHit.planeId === s.id && hoverHit.handle === "centre";
        drawHandle(px, py, hover, selected, true, selected && selPoint === "centre");
      }
    }
    ctx.restore();
  }

  // ── The selection's other handles (edit view) ──────────
  // A load's ends or point, the search limits, an element's ends: handles
  // on the selected object only (its line in the selection colour for an
  // element); a locked object's handles are grey with a padlock.
  if (mode !== "result" && selObject) {
    const handle = (wx: number, wy: number, key: CanvasPointKey) => {
      const [px, py] = worldToCanvas(wx, wy, w, h);
      const hover = hoverObject?.point === key && sameObject(hoverObject.object, selObject);
      ctx.beginPath();
      ctx.arc(px, py, POINT_RADIUS - 1, 0, Math.PI * 2);
      ctx.fillStyle = hover ? POINT_COLOR_HOVER : selLocked ? LOCKED_HANDLE_COLOR : SELECTED_BOUNDARY_COLOR;
      ctx.fill();
      ctx.strokeStyle = STROKE_ACTIVE;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (selPoint === key) selectedPointRing(px, py, POINT_RADIUS - 1);
      pointSymbols.push(boxAround(px, py, POINT_RADIUS - 1));
    };
    const ground = (x: number) => surfaceYAtX(x);
    ctx.save();
    ctx.setLineDash([]);
    switch (selObject.type) {
      case "udl": {
        const u = udls.find((v) => v.id === selObject.id);
        for (const key of ["x1", "x2"] as const) {
          const gy = u ? ground(u[key]) : null;
          if (u && gy !== null) handle(u[key], gy, key);
        }
        break;
      }
      case "lineLoad": {
        const l = lineLoads.find((v) => v.id === selObject.id);
        const gy = l ? (l.angle && Number.isFinite(l.y) ? l.y! : ground(l.x)) : null;
        if (l && gy !== null) handle(l.x, gy, "x");
        break;
      }
      case "searchLimits":
        if (analysisLimits.enabled) {
          for (const key of ["entryLeftX", "entryRightX", "exitLeftX", "exitRightX"] as const) {
            const gy = ground(analysisLimits[key]);
            if (gy !== null) handle(analysisLimits[key], gy, key);
          }
        }
        break;
      case "reinforcement":
      case "pile": {
        const list: { id: string; x1: number; y1: number; x2: number; y2: number }[] =
          selObject.type === "pile" ? (piles ?? []) : (reinforcements ?? []);
        const r = list.find((v) => v.id === selObject.id);
        if (r) {
          const [ax, ay] = worldToCanvas(r.x1, r.y1, w, h);
          const [bx, by] = worldToCanvas(r.x2, r.y2, w, h);
          ctx.strokeStyle = SELECTED_BOUNDARY_COLOR;
          ctx.globalAlpha = 0.6;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
          ctx.globalAlpha = 1;
          handle(r.x1, r.y1, "end1");
          handle(r.x2, r.y2, "end2");
        }
        break;
      }
      default:
        break;
    }
    ctx.restore();
    // One padlock on a locked selection, beside its first handle (or its
    // selected point).
    if (selLocked) {
      const at = selectionAnchor(selObject, selPoint);
      if (at) {
        const lx = at[0] + POINT_RADIUS + 3;
        const ly = at[1] - POINT_RADIUS - 9;
        drawPadlock(ctx, lx, ly, STROKE_ACTIVE, BG_COLOR);
        // the coordinate labels keep off it
        pointSymbols.push({ left: lx - 3, top: ly - 5, right: lx + 11, bottom: ly + 10 });
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
      { loads, piezoSymbols: drawnPiezoSymbols, showLimits: limitsShown, vertexDots },
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
        if (bnd.id === selectedBoundaryId) layout.reservePolyline(pts, 2);
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
    // The crack's label first (it is the dimension's value, always
    // shown), next to the dimension: beside it, else beside or above its
    // top tick, on the upslope side first; else farther out with a leader
    // line to the top tick that crosses no line.
    if (crackLabel) {
      ctx.font = POINT_LABEL_FONT;
      const tw = ctx.measureText(crackLabel.text).width + POINT_LABEL_PAD_X * 2;
      const { x: cx, top, bottom } = crackLabel;
      // A vertex dot over the top tick hides the dimension's top.
      const cover = Math.max(
        0,
        ...pointSymbols
          .filter((b) => b.bottom - b.top > 3 && pointInBox(cx, top, b))
          .map((b) => b.bottom - top + 2),
      );
      const { box, leader } = placeCrackLabel(layout, cx, top, bottom, tw, POINT_LABEL_H, crackLabel.inward || 1, cover);
      if (leader) {
        ctx.save();
        ctx.strokeStyle = labelColors.text;
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        ctx.moveTo(leader[0], leader[1]);
        ctx.lineTo(leader[2], leader[3]);
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
    drawPointLabels(ctx, pointLabels, layout, labelColors);
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

    // The paper and its plot area (the frame, the annotations and the clip).
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
    // Scale factor for annotations based on paper frame size
    const annoScale = Math.min(pf.w, pf.h) / ANNOTATION_SCALE_DIVISOR;

    // The layers, each drawn by a step below, in the model's order
    // (Properties › Layers; features/results/layers.ts).

    const drawFemMeshLayer = () => {
      // The finite element mesh (its last refinement), thin and faint under
      // the plastic zone and the surfaces, to show where it was refined.
      if (result.fem && rvs.showFemMesh === true) {
        drawFemMesh(ctx, result.fem, (x, y) => worldToCanvas(x, y, w, h), POLY_STROKE, FEM_MESH_LINE_WIDTH_PX * paperZoom);
      }
    };
    const drawPlasticZoneLayer = () => {
      // Plastic zone of the finite element analysis: elements shaded by the
      // shear strain of the last displacement increment before failure,
      // relative to the largest, so the failure mechanism shows as a band.
      if (result.fem && rvs.showFemPlasticZone !== false) drawFemPlasticZone(ctx, result.fem, (x, y) => worldToCanvas(x, y, w, h), INK.feLabel);
    };

    // ── Reference annotations: the lines, under the surfaces ──
    // (their labels follow the FOS label, so they can keep clear of it)
    const drawnReferences: DrawnReference[] = [];
    const drawReferenceLayer = (annotations: Annotation[]) => {
      drawnReferences.push(
        ...drawReferenceLines(ctx, {
          annotations,
          mode: "result",
          toC: (x, y) => worldToCanvas(x, y, w, h),
          groundYAt: surfaceYAtX,
          paperZoom,
          defaultColor: REFERENCE_COLOR,
          selectedIds: selectedAnnotationIds,
          hoverHit,
          handleStroke: PAPER_FILL_COLOR || BG_COLOR,
        }),
      );
    };

    const drawSurfacesLayer = () => {
      // Non-critical surfaces (when "all" or "filter" mode)
      // Draw in reverse FOS order (high FOS first = behind, low FOS last = on top)
      if (rvs.surfaceDisplay !== "critical" && result.allSurfaces.length > 0) {
        // The scale of the colour bar, so the plot and the bar agree.
        const fosScale = colorScaleOf(rvs, result);
        for (let si = result.allSurfaces.length - 1; si >= 0; si--) {
          const surf = result.allSurfaces[si];
          // Skip critical (drawn separately) and filtered out
          if (result.criticalSurface && sameSurface(surf, result.criticalSurface))
            continue;
          if (rvs.surfaceDisplay === "filter" && surf.fos > rvs.fosFilterMax)
            continue;

          const arcPts = getArcPoints(surf);
          ctx.strokeStyle = fosScale.colorOf(surf.fos);
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
    };

    // The custom search planes' surfaces, on request (whatever the
    // surface display): dashed in their own colour on a halo of the paper,
    // as the edit view draws the planes; the critical surface is drawn as
    // such below, not again here. Their FOS labels come after the
    // critical surface's, which they keep clear of.
    const customSurfaces =
      rvs.showCustomSurfaces === true
        ? (result.customSurfaces ?? []).flatMap((c) =>
            c.surface && !(result.criticalSurface && sameSurface(c.surface, result.criticalSurface)) ? [c.surface] : [],
          )
        : [];
    // A FOS label's box: the text above its underline, as drawn below.
    const fosLabelBox = (labelX: number, cy: number, tw: number): Box => ({
      left: labelX - 1 * paperZoom,
      top: cy - 11 * paperZoom,
      right: labelX + tw + 1 * paperZoom,
      bottom: cy + 3 * paperZoom,
    });
    let criticalLabelBox: Box | null = null;
    // The custom surfaces' FOS labels' boxes, kept clear by the reference labels.
    const customLabelBoxes: Box[] = [];
    const drawCustomSurfacesLayer = () => {
      if (customSurfaces.length > 0) {
        ctx.save();
        for (const surf of customSurfaces) {
          const arcPts = getArcPoints(surf);
          const path = () => {
            ctx.beginPath();
            arcPts.forEach(([x, y], i) => {
              const [px, py] = worldToCanvas(x, y, w, h);
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            });
          };
          ctx.setLineDash([]);
          ctx.strokeStyle = PAPER_FILL_COLOR || BG_COLOR;
          ctx.globalAlpha = 0.55;
          ctx.lineWidth = 4 * paperZoom;
          path();
          ctx.stroke();
          ctx.strokeStyle = CUSTOM_SURFACE;
          ctx.globalAlpha = 1;
          ctx.lineWidth = CUSTOM_SURFACE_LINE_WIDTH_PX * paperZoom;
          ctx.setLineDash(CUSTOM_SURFACE_DASH_PX.map((d) => d * paperZoom));
          path();
          ctx.stroke();
        }
        ctx.restore();
      }
    };

    const cs = result.criticalSurface;
    // The critical surface and its radius lines: the theme's ink, black
    // over a light soil fill (paintAgainstFills).
    const paintCritical = (paint: (color: string) => void) => paintAgainstFills(INK.critical, CRITICAL_SURFACE_COLOR.hex, paint);

    const drawSlicesLayer = () => {
      if (!cs) return;
      // Slice lines (vertical lines within the failure mass): black, or
      // white over a dark material, and thinner and fainter where the
      // slices lie close together on screen.
      if (rvs.showSlices && result.criticalSlices.length > 0) {
        // Surface y at a given x (lower arc of a circle, or the polyline)
        const arcYAtX = (x: number): number | null => surfaceBaseYAt(cs, x);
        // Boundaries closer than 2.5 px as one line (closer read as a
        // thick double line); every other line left out where they lie
        // closer than 3 px. In px of the paper at zoom 1, as the line
        // widths scale with the paper zoom: the same lines at every zoom.
        const { xs: xBounds, density } = sliceLines(
          result.criticalSlices,
          (x) => worldToCanvas(x, 0, w, h)[0] / paperZoom,
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
            // Over the sheet (no fill) the theme's ink; over a fill black,
            // or white over a dark one.
            const dark = part.region !== null && regionDark.get(part.region) === true;
            ctx.strokeStyle =
              part.region === null ? INK.critical : dark ? SLICE_LINE_ON_DARK_COLOR.hex : CRITICAL_SURFACE_COLOR.hex;
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
    };

    const drawCentreLayer = () => {
      if (!cs) return;
      // Centre dot and radius lines to entry/exit (circles only: the
      // axis point of a non-circular surface is no centre)
      if (rvs.showCentreMarker && (!cs.points || cs.composite)) {
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
        paintCritical((color) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1 * paperZoom;
          ctx.beginPath();
          ctx.moveTo(ccx, ccy);
          ctx.lineTo(epx, epy);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(ccx, ccy);
          ctx.lineTo(xpx, xpy);
          ctx.stroke();

          // Small filled circle at centre
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(ccx, ccy, 3 * paperZoom, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    };

    // The FOS labels: the critical surface's, then the custom surfaces'.
    const drawFosLabelLayer = () => {
      if (cs) {
        // FOS label to the right of the circle centre
        if (rvs.showFosLabel) {
          const [ax, ay] = fosLabelAnchor(cs);
          const [ccx2, ccy2] = worldToCanvas(ax, ay, w, h);
          const fosText = cs.fos.toFixed(3);
          ctx.font = `bold ${12 * paperZoom}px sans-serif`;
          const tw = ctx.measureText(fosText).width;
          const labelX = ccx2 + 10 * paperZoom;
          criticalLabelBox = fosLabelBox(labelX, ccy2, tw);

          // Text
          ctx.fillStyle = INK.critical;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(fosText, labelX, ccy2 - 4 * paperZoom);

          // Underline
          ctx.strokeStyle = INK.critical;
          ctx.lineWidth = 1 * paperZoom;
          ctx.beginPath();
          ctx.moveTo(labelX - 1 * paperZoom, ccy2 + 2 * paperZoom);
          ctx.lineTo(labelX + tw + 1 * paperZoom, ccy2 + 2 * paperZoom);
          ctx.stroke();
        }
      }

      // The custom surfaces' FOS labels, like the critical one's, in their
      // colour: each moved down from its anchor until it is clear of the
      // critical label and the ones placed before it.
      if (customSurfaces.length > 0 && rvs.showFosLabel) {
        const placed: Box[] = criticalLabelBox ? [criticalLabelBox] : [];
        ctx.save();
        ctx.font = `bold ${12 * paperZoom}px sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.setLineDash([]);
        for (const surf of customSurfaces) {
          const [ax, ay] = fosLabelAnchor(surf);
          const [lx, ly] = worldToCanvas(ax, ay, w, h);
          const fosText = surf.fos.toFixed(3);
          const tw = ctx.measureText(fosText).width;
          const labelX = lx + 10 * paperZoom;
          let cy = ly;
          let box = fosLabelBox(labelX, cy, tw);
          for (let n = 0; n < 20 && placed.some((b) => boxesOverlap(box, b, 0)); n++) {
            cy += box.bottom - box.top + 2 * paperZoom;
            box = fosLabelBox(labelX, cy, tw);
          }
          placed.push(box);
          customLabelBoxes.push(box);
          ctx.fillStyle = CUSTOM_SURFACE;
          ctx.fillText(fosText, labelX, cy - 4 * paperZoom);
          ctx.strokeStyle = CUSTOM_SURFACE;
          ctx.lineWidth = 1 * paperZoom;
          ctx.beginPath();
          ctx.moveTo(labelX - 1 * paperZoom, cy + 2 * paperZoom);
          ctx.lineTo(labelX + tw + 1 * paperZoom, cy + 2 * paperZoom);
          ctx.stroke();
        }
        ctx.restore();
      }
    };

    // The critical surface: the sliding mass, the water in a tension
    // crack, the line and the reinforcement forces, with the slices, the
    // center and the FOS label between them when they follow it directly
    // (layerSteps), as they always were.
    const drawCriticalLayer = (step: { withSlices: boolean; withCenter: boolean; withFosLabel: boolean }) => {
      if (!cs) return;
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
      // and clipped to the soil, so none of it spills into the air, and
      // to between the slip line's ends, so its ends don't stick out.
      if (meanThickness(massPx) < MIN_SLIP_MASS_PX * paperZoom && coordinates.length >= 3) {
        ctx.beginPath();
        coordinates.forEach(([bx, by], i) => {
          const [px, py] = worldToCanvas(bx, by, w, h);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.clip();
        const [ex] = worldToCanvas(cs.entryPoint[0], cs.entryPoint[1], w, h);
        const [xx] = worldToCanvas(cs.exitPoint[0], cs.exitPoint[1], w, h);
        ctx.beginPath();
        ctx.rect(Math.min(ex, xx), 0, Math.abs(xx - ex), h);
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

      if (step.withSlices) drawSlicesLayer();

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
      paintCritical((color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5 * paperZoom;
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
      });

      if (step.withCenter) drawCentreLayer();

      // Reinforcement forces on the sliding mass
      if (cs.reinforcementForces?.length) {
        const toC = (x: number, y: number) => worldToCanvas(x, y, w, h);
        // Labels stay inside the plot frame (the geometry clip).
        const pf = resultViewSettings.paperFrame;
        const fr = computePaperFrame(w, h, pf.paperSize, pf.landscape, pf.zoom ?? 1, pf.offsetX ?? 0, pf.offsetY ?? 0);
        const forces = cs.reinforcementForces;
        // Laid out again only when what it depends on changes (not on a mouse move).
        const layout = memoLayout(
          forceLayoutMemo,
          [
            w,
            h,
            ...viewProbe,
            paperZoom,
            cs,
            reinforcements,
            piles,
            coordinates,
            piezometricLine,
            materialBoundaries,
            udls,
            lineLoads,
            ...loads.labels.flatMap((l) => [l.box.left, l.box.top, l.box.right, l.box.bottom]),
            limitsShown,
            analysisLimits,
            customPlanesOnly,
            fr.x,
            fr.y,
            fr.w,
            fr.h,
          ],
          () =>
            canvasForceLayout(
              ctx,
              forces,
              toC,
              paperZoom,
              forceLabelContext(toC, {
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
            ),
        );
        drawReinforcementForces(ctx, forces, toC, paperZoom, { layout, plate: PAPER_FILL_COLOR || BG_COLOR, text: INK.reinforcementText });
      }

      if (step.withFosLabel) drawFosLabelLayer();
    };

    const drawReferenceLabelsStep = () => {
      // ── Reference annotations: the labels ────────────────
      // Clear of the lines of the drawing, the FOS label and each other,
      // inside the plot area.
      if (drawnReferences.some((d) => d.anno.label?.trim())) {
        const toC = (x: number, y: number) => worldToCanvas(x, y, w, h);
        const { paperFrame: rf } = rvs;
        const frame = computePaperFrame(w, h, rf.paperSize, rf.landscape, rf.zoom ?? 1, rf.offsetX ?? 0, rf.offsetY ?? 0);
        const refLayout = new LabelLayout({
          left: frame.x + frame.w * PLOT_MARGINS.L + 2,
          top: frame.y + frame.h * PLOT_MARGINS.T + 2,
          right: frame.x + frame.w * (1 - PLOT_MARGINS.R) - 2,
          bottom: frame.y + frame.h * (1 - PLOT_MARGINS.B) - 2,
        });
        for (const seg of referenceSegments(drawnReferences)) refLayout.reserveSegment(seg, 2 * paperZoom);
        if (coordinates.length >= 3) refLayout.reservePolyline(coordinates.map(([x, y]) => toC(x, y)), 2, true);
        for (const bnd of materialBoundaries) refLayout.reservePolyline(bnd.coordinates.map(([x, y]) => toC(x, y)), 2);
        for (const line of piezometricLine.lines) refLayout.reservePolyline(line.coordinates.map(([x, y]) => toC(x, y)), 2);
        if (result.criticalSurface) {
          const cs = result.criticalSurface;
          refLayout.reservePolyline(getArcPoints(cs).map(([x, y]) => toC(x, y)), 3 * paperZoom);
          if (rvs.showFosLabel) {
            // The FOS label's box, as drawn above.
            const [lx, ly] = toC(...fosLabelAnchor(cs));
            ctx.font = `bold ${12 * paperZoom}px sans-serif`;
            const tw = ctx.measureText(cs.fos.toFixed(3)).width;
            refLayout.reserve({ left: lx + 9 * paperZoom, top: ly - 12 * paperZoom, right: lx + 11 * paperZoom + tw, bottom: ly + 3 * paperZoom });
          }
        }
        // The custom surfaces' dashed lines and FOS labels, as drawn above.
        for (const surf of customSurfaces) refLayout.reservePolyline(getArcPoints(surf).map(([x, y]) => toC(x, y)), 2 * paperZoom);
        for (const box of customLabelBoxes) refLayout.reserve(box);
        drawReferenceLabels(ctx, drawnReferences, { toC, paperZoom, layout: refLayout, plate: PAPER_FILL_COLOR || BG_COLOR });
      }
    };

    // ── Paper frame ──────────────────────────────────────
    // Ticks and labels between the paper edge and the plot area, over the
    // geometry (drawn unclipped).
    const drawFrame = () => {
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
    };

    // ── Annotations ──────────────────────────────────────
    // A paper annotation (references are drawn with the model above).
    const drawPaperAnnotation = (anno: PaperAnnotation) => {
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
        ctx.fillStyle = anno.color ?? INK.annotationText;
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
        const colorScale = colorScaleOfBar(anno, result, rvs);
        const fosScale = colorScale.range;
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

        // On a plate, as the table: its values stay readable over the
        // model, the water-line labels and the result's surfaces.
        const plate = COLOR_BAR_PLATE_PAD * annoScale;
        ctx.save();
        ctx.fillStyle = INK.tableBg;
        ctx.fillRect(drawX - plate, drawY - plate, contentW + 2 * plate, contentH + 2 * plate);
        ctx.restore();

        const fosMin = fosScale.min;
        const fosMax = fosScale.max;
        const numSteps = Math.floor(barH);

        // Draw gradient bar
        for (let i = 0; i < numSteps; i++) {
          const t = i / (numSteps - 1);
          const fos = fosMax - t * (fosMax - fosMin);
          ctx.fillStyle = colorScale.colorOf(fos);
          ctx.fillRect(barX, barY + i, barW, 2);
        }

        // Border
        ctx.strokeStyle = INK.colorBar;
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barW, barH);

        // Labels
        ctx.fillStyle = INK.colorBar;
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
          ctx.strokeStyle = INK.colorBar;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(barX + barW, y);
          ctx.lineTo(barX + barW + 3, y);
          ctx.stroke();

          // Label
          ctx.fillStyle = INK.colorBar;
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
          INK,
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
        // Opaque, as in the PDF: the surfaces behind it do not show through.
        ctx.fillStyle = INK.plotBg;
        ctx.strokeStyle = INK.plotFrame;
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
          ctx.fillStyle = INK.plotTitle;
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.fillText(title, drawX + 6, drawY + 4);
          ctx.font = `${axisSize}px sans-serif`;
          ctx.fillStyle = INK.plotMuted;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("No slice data", drawX + plotW / 2, drawY + plotH / 2);
          ctx.restore();
          return;
        }

        const padLeft = Math.max(26, 32 * annoScale);
        const padRight = Math.max(10, 12 * annoScale);
        // Room below the tick values for the x axis title, and above the
        // top tick value so it stays clear of the plot title.
        const padBottom = Math.max(18, 22 * annoScale) + axisSize + 2;
        const padTop = titlePad + axisSize / 2 + 3;
        const chartX = drawX + padLeft;
        const chartY = drawY + padTop;
        const chartW = Math.max(8, plotW - padLeft - padRight);
        const chartH = Math.max(8, plotH - padTop - padBottom);
        const { xMin, xMax, yMin, yMax } = plot.range;
        // Round ticks on both axes; the axes run to the outer ticks.
        const xTicks = axisTicks(xMin, xMax, 5, (anno.plotAxisX ?? "slice") === "slice");
        const yTicks = axisTicks(yMin, yMax, 4);

        const mapX = (v: number) =>
          chartX + ((v - xTicks.min) / (xTicks.max - xTicks.min)) * chartW;
        const mapY = (v: number) =>
          chartY + chartH - ((v - yTicks.min) / (yTicks.max - yTicks.min)) * chartH;

        ctx.font = `${titleSize}px sans-serif`;
        ctx.fillStyle = INK.plotTitle;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(title, drawX + 6, drawY + 4);

        ctx.strokeStyle = INK.plotGridMajor;
        ctx.lineWidth = 0.8;
        for (const v of yTicks.values) {
          const gy = mapY(v);
          ctx.beginPath();
          ctx.moveTo(chartX, gy);
          ctx.lineTo(chartX + chartW, gy);
          ctx.stroke();
        }
        ctx.strokeStyle = INK.plotGridMinor;
        for (const v of xTicks.values) {
          const gx = mapX(v);
          ctx.beginPath();
          ctx.moveTo(gx, chartY);
          ctx.lineTo(gx, chartY + chartH);
          ctx.stroke();
        }

        ctx.strokeStyle = INK.plotFrame;
        ctx.lineWidth = 1;
        ctx.strokeRect(chartX, chartY, chartW, chartH);

        ctx.strokeStyle = INK.plotLine;
        ctx.lineWidth = Math.max(1.1, 1.3 * annoScale);
        ctx.beginPath();
        points.forEach((point, index) => {
          const px = mapX(point.x);
          const py = mapY(point.y);
          if (index === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();

        ctx.fillStyle = INK.plotLine;
        points.forEach((point) => {
          const px = mapX(point.x);
          const py = mapY(point.y);
          ctx.beginPath();
          ctx.arc(px, py, Math.max(1.4, 1.8 * annoScale), 0, Math.PI * 2);
          ctx.fill();
        });

        // Tick marks and values on both axes.
        const tick = Math.max(2, 3 * annoScale);
        ctx.strokeStyle = INK.plotFrame;
        ctx.lineWidth = 1;
        ctx.font = `${axisSize}px sans-serif`;
        ctx.fillStyle = INK.plotText;
        ctx.textBaseline = "middle";
        ctx.textAlign = "right";
        for (const v of yTicks.values) {
          const gy = mapY(v);
          ctx.beginPath();
          ctx.moveTo(chartX - tick, gy);
          ctx.lineTo(chartX, gy);
          ctx.stroke();
          ctx.fillText(tickLabel(v, yTicks), chartX - tick - 2, gy);
        }
        ctx.textBaseline = "top";
        ctx.textAlign = "center";
        for (const v of xTicks.values) {
          const gx = mapX(v);
          ctx.beginPath();
          ctx.moveTo(gx, chartY + chartH);
          ctx.lineTo(gx, chartY + chartH + tick);
          ctx.stroke();
          ctx.fillText(tickLabel(v, xTicks), gx, chartY + chartH + tick + 2);
        }
        ctx.fillText(plot.xLabel, chartX + chartW / 2, chartY + chartH + tick + 4 + axisSize);
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
          resultView: rvs,
        });
        ctx.save();
        ctx.strokeStyle = "#0078d4";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
        ctx.setLineDash([]);
        ctx.restore();
      }
    };

    // The steps in order, the model's layers clipped to the plot area, the
    // paper annotations not; after the topmost of the model's layers the
    // reference labels (over the lines they keep clear of) and the frame.
    const steps = layerSteps((resultLayerList ?? []).slice(baseLayerTotal));
    let lastModelStep = -1;
    steps.forEach((s, i) => {
      if (!isPaperStep(s)) lastModelStep = i;
    });
    // The clip to the plot area set with the paper above.
    let clipped = true;
    const clipToPlot = () => {
      if (clipped) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(
        pf.x + pf.w * PLOT_MARGINS.L,
        pf.y + pf.h * PLOT_MARGINS.T,
        pf.w - pf.w * PLOT_MARGINS.L - pf.w * PLOT_MARGINS.R,
        pf.h - pf.h * PLOT_MARGINS.T - pf.h * PLOT_MARGINS.B,
      );
      ctx.clip();
      clipped = true;
    };
    const unclip = () => {
      if (!clipped) return;
      ctx.restore();
      clipped = false;
    };
    const finishModel = () => {
      clipToPlot();
      drawReferenceLabelsStep();
      unclip();
      drawFrame();
    };
    if (lastModelStep < 0) finishModel();
    steps.forEach((step, i) => {
      if (step.kind === "paper") {
        unclip();
        drawPaperAnnotation(step.annotation as PaperAnnotation);
      } else {
        clipToPlot();
        if (step.kind === "critical") drawCriticalLayer(step);
        else if (step.kind === "references") drawReferenceLayer(step.annotations);
        else if (step.kind === "drawings") drawDrawingLayers(step.drawings);
        else if (step.layer === "soilColor") paintSoilFills();
        else if (step.layer === "femMesh") drawFemMeshLayer();
        else if (step.layer === "femPlasticZone") drawPlasticZoneLayer();
        else if (step.layer === "surfaces") drawSurfacesLayer();
        else if (step.layer === "customSurfaces") drawCustomSurfacesLayer();
        else if (step.layer === "slices") drawSlicesLayer();
        else if (step.layer === "center") drawCentreLayer();
        else drawFosLabelLayer();
      }
      if (i === lastModelStep) finishModel();
    });

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

/** Line width of the finite element mesh (px of the paper at zoom 1). */
const FEM_MESH_LINE_WIDTH_PX = 0.4;

/**
 * The edges of the finite element mesh, each once (an edge between two
 * elements is not drawn twice, which would make it darker).
 */
export function femMeshEdges(triangles: ArrayLike<number>): [number, number][] {
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  for (let e = 0; e + 2 < triangles.length; e += 3) {
    for (let k = 0; k < 3; k++) {
      const a = triangles[e + k];
      const b = triangles[e + ((k + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([a, b]);
    }
  }
  return edges;
}

function drawFemMesh(
  ctx: CanvasRenderingContext2D,
  fem: NonNullable<AnalysisResult["fem"]>,
  toC: (x: number, y: number) => [number, number],
  color: string,
  lineWidth: number,
): void {
  const { x, y } = fem;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (const [a, b] of femMeshEdges(fem.triangles)) {
    const [ax, ay] = toC(x[a], y[a]);
    const [bx, by] = toC(x[b], y[b]);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * The finite element mechanism: shade per element, in proportion to strain /
 * largest strain, as the other programs' linear contour scales; a square
 * root scale brought out weak strain increments far from the mechanism
 * (e.g. along the fixed base) as if they were part of it.
 */
function drawFemPlasticZone(
  ctx: CanvasRenderingContext2D,
  fem: NonNullable<AnalysisResult["fem"]>,
  toC: (x: number, y: number) => [number, number],
  labelColor: string,
): void {
  const field = fem.shearIncrement ?? fem.plasticShear;
  let max = 0;
  for (const v of field) if (v > max) max = v;
  if (!(max > 0)) return;
  ctx.save();
  const { x, y, triangles: t } = fem;
  // the top of the shaded zone, for its label
  let topX = 0, topY = Infinity;
  for (let e = 0; e < field.length; e++) {
    const r = field[e] / max;
    if (r < 0.05) continue;
    const [ax, ay] = toC(x[t[3 * e]], y[t[3 * e]]);
    const [bx, by] = toC(x[t[3 * e + 1]], y[t[3 * e + 1]]);
    const [cx, cy] = toC(x[t[3 * e + 2]], y[t[3 * e + 2]]);
    for (const [px, py] of [[ax, ay], [bx, by], [cx, cy]]) if (py < topY) { topY = py; topX = px; }
    ctx.fillStyle = `rgba(214, 40, 40, ${(0.85 * r).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
  }
  // the finite element analysis is experimental: said where its result is drawn
  if (Number.isFinite(topY)) {
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = labelColor;
    ctx.fillText("FE plastic zone (experimental)", topX, topY - 4);
  }
  ctx.restore();
}

/**
 * A slice's outline (model coordinates) filled and outlined in the accent
 * color: the slice hovered in the Results plot window.
 */
export function drawHighlightedSlice(
  ctx: CanvasRenderingContext2D,
  outline: [number, number][],
  toCanvas: (x: number, y: number) => [number, number],
): void {
  if (outline.length < 3) return;
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-vsc-accent").trim() || "#0078d4";
  ctx.save();
  ctx.beginPath();
  outline.forEach(([x, y], i) => {
    const [cx, cy] = toCanvas(x, y);
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  });
  ctx.closePath();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = accent;
  ctx.stroke();
  ctx.restore();
}
