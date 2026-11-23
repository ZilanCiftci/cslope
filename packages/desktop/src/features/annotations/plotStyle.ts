/**
 * The style of a slice plot annotation (`plotStyle`): what a file or a
 * template may hold, how a change is stored, and the layout, axes and
 * marker shapes both renderers (the canvas, draw.ts, and the PDF,
 * pdf-drawing.ts) draw from, so the screen and the print agree. Every
 * member is an override: absent, the plot is drawn as it always was.
 */
import type { PlotLineStyle, PlotMarker, PlotStyle } from "../../store/types";
import { axisTicks, type AxisTicks } from "./plotAxis";
import {
  PLOT_AXIS_FONT_PX,
  PLOT_LINE_MIN_MM,
  PLOT_LINE_PX,
  PLOT_MARKER_MIN_MM,
  PLOT_MARKER_PX,
  PLOT_SERIES_DASH,
  PLOT_TEXT_DEFAULT_PX,
  PLOT_TITLE_FONT_PX,
  STYLE_PX_PER_MM,
  annotationPxToTextPx,
  textLayoutPx,
} from "../rendering/style-spec";

export const PLOT_LINE_STYLES: readonly { value: PlotLineStyle; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "none", label: "None" },
];

export const PLOT_MARKERS: readonly { value: PlotMarker; label: string }[] = [
  { value: "circle", label: "Circle" },
  { value: "square", label: "Square" },
  { value: "triangle", label: "Triangle" },
  { value: "plus", label: "Plus" },
  { value: "cross", label: "Cross" },
  { value: "none", label: "None" },
];

/**
 * The bounds of the sizes: line width and marker size in px (1 px = 0.1 mm
 * on the paper), text in px of the F label's unit (12 px = 10 pt).
 */
export const PLOT_STYLE_LIMITS = {
  lineWidthPx: { min: 0.5, max: 30 },
  markerSizePx: { min: 2, max: 100 },
  fontSizePx: { min: 4, max: 48 },
} as const;

/**
 * The bounds of the sizes in mm of the style's first form (`lineWidth`,
 * `markerSize`), written by development builds before the sizes were in
 * px; read as px (× STYLE_PX_PER_MM) when the px member is absent.
 */
const LEGACY_MM_LIMITS = {
  lineWidth: { min: 0.05, max: 3 },
  markerSize: { min: 0.2, max: 10 },
} as const;

/**
 * The bounds of the text size's first form, `fontSize` in annotation px
 * (the paper's shorter side / 600), written before the size was fixed;
 * read as px of the F label's unit (annotationPxToTextPx, × about 1.19)
 * when `fontSizePx` is absent, the same size on A4.
 */
const LEGACY_FONT_SIZE_LIMITS = { min: 4, max: 36 } as const;

/** A size in mm as px (1 px = 0.1 mm), without the binary fraction's noise (0.35 mm: 3.5 px). */
const mmToStylePx = (mm: number) => Math.round(mm * STYLE_PX_PER_MM * 1e6) / 1e6;

/** The text sizes offered (px of the F label's unit). */
export const PLOT_FONT_SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SWITCHES = ["showTitle", "showAxisTitle", "showGrid", "showBorder"] as const;
const ENDS = ["xMin", "xMax", "yMin", "yMax"] as const;

const inRange = (v: unknown, { min, max }: { min: number; max: number }): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/**
 * A plot's style as read from a file or a template: the known members
 * with valid values that differ from the default (the rest dropped, no
 * error); undefined when nothing is left.
 */
export function normalizePlotStyle(raw: unknown): PlotStyle | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: PlotStyle = {};
  if (typeof r.color === "string" && HEX_COLOR.test(r.color)) out.color = r.color.toLowerCase();
  if (r.line === "dashed" || r.line === "none") out.line = r.line;
  if (inRange(r.lineWidthPx, PLOT_STYLE_LIMITS.lineWidthPx)) out.lineWidthPx = r.lineWidthPx;
  else if (r.lineWidthPx === undefined && inRange(r.lineWidth, LEGACY_MM_LIMITS.lineWidth)) out.lineWidthPx = mmToStylePx(r.lineWidth);
  if (PLOT_MARKERS.some((m) => m.value === r.marker) && r.marker !== "circle") out.marker = r.marker as PlotMarker;
  if (inRange(r.markerSizePx, PLOT_STYLE_LIMITS.markerSizePx)) out.markerSizePx = r.markerSizePx;
  else if (r.markerSizePx === undefined && inRange(r.markerSize, LEGACY_MM_LIMITS.markerSize)) out.markerSizePx = mmToStylePx(r.markerSize);
  if (r.markerOpen === true) out.markerOpen = true;
  for (const k of SWITCHES) if (r[k] === false) out[k] = false;
  if (inRange(r.fontSizePx, PLOT_STYLE_LIMITS.fontSizePx)) out.fontSizePx = r.fontSizePx;
  else if (r.fontSizePx === undefined && inRange(r.fontSize, LEGACY_FONT_SIZE_LIMITS)) out.fontSizePx = annotationPxToTextPx(r.fontSize);
  for (const k of ENDS) {
    const v = r[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The style after a change: `patch` over `style`, a member set to
 * undefined or to its default removed; undefined when nothing is left
 * (the plot drawn as always).
 */
export function plotStylePatched(style: PlotStyle | undefined, patch: Partial<PlotStyle>): PlotStyle | undefined {
  const next: Record<string, unknown> = { ...style };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  return normalizePlotStyle(next);
}

/** A plot's style with every member resolved, in mm on the paper. */
export interface ResolvedPlotStyle {
  /** "#rrggbb", or undefined for the theme's (the PDF's) plot color. */
  color: string | undefined;
  line: PlotLineStyle;
  lineWidthMm: number;
  /** The dash of a dashed line (mm), else empty. */
  dashMm: number[];
  marker: PlotMarker;
  markerRadiusMm: number;
  markerOpen: boolean;
  showTitle: boolean;
  showAxisTitle: boolean;
  showGrid: boolean;
  showBorder: boolean;
  /** The text's size against the layout's (PLOT_AXIS_FONT_PX layout px). */
  textScale: number;
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
}

/** The series' line width (mm) a plot has by default on a paper of `mmPerAnnoPx`. */
export function defaultPlotLineWidthMm(mmPerAnnoPx: number): number {
  return Math.max(PLOT_LINE_MIN_MM, PLOT_LINE_PX * mmPerAnnoPx);
}

/** The markers' size (diameter, mm) a plot has by default on a paper of `mmPerAnnoPx`. */
export function defaultPlotMarkerSizeMm(mmPerAnnoPx: number): number {
  return 2 * Math.max(PLOT_MARKER_MIN_MM, PLOT_MARKER_PX * mmPerAnnoPx);
}

/** The style a plot is drawn with; `mmPerAnnoPx` is the paper's mm per annotation px. */
export function resolvePlotStyle(style: PlotStyle | undefined, mmPerAnnoPx: number): ResolvedPlotStyle {
  const s = style ?? {};
  const line = s.line ?? "solid";
  const lineWidthMm = s.lineWidthPx === undefined ? defaultPlotLineWidthMm(mmPerAnnoPx) : s.lineWidthPx / STYLE_PX_PER_MM;
  return {
    color: s.color,
    line,
    lineWidthMm,
    dashMm: line === "dashed" ? PLOT_SERIES_DASH.map((d) => d * lineWidthMm) : [],
    marker: s.marker ?? "circle",
    markerRadiusMm: (s.markerSizePx === undefined ? defaultPlotMarkerSizeMm(mmPerAnnoPx) : s.markerSizePx / STYLE_PX_PER_MM) / 2,
    markerOpen: s.markerOpen === true,
    showTitle: s.showTitle !== false,
    showAxisTitle: s.showAxisTitle !== false,
    showGrid: s.showGrid !== false,
    showBorder: s.showBorder !== false,
    textScale: textLayoutPx(s.fontSizePx ?? PLOT_TEXT_DEFAULT_PX) / PLOT_AXIS_FONT_PX,
    xMin: s.xMin,
    xMax: s.xMax,
    yMin: s.yMin,
    yMax: s.yMax,
  };
}

/** Where the parts of a plot go, in the renderer's units (canvas px or PDF mm). */
export interface PlotLayout {
  titleSize: number;
  axisSize: number;
  /** The gap between a tick and its value. */
  pad: number;
  tick: number;
  titleX: number;
  titleY: number;
  chartX: number;
  chartY: number;
  chartW: number;
  chartH: number;
  /** The top of the x axis's title. */
  xTitleY: number;
}

/**
 * The layout of a plot at (x, y), w × h: `s` is the renderer's units per
 * layout px (SHEET_LAYOUT_MM_PER_PX, the same on every paper size) and
 * `mm` per mm. The chart leaves room on the left for the
 * y values, below for the x values and the axis title, above for the
 * title; with the default style as the plot has always been laid out.
 */
export function plotLayout(x: number, y: number, w: number, h: number, s: number, mm: number, style: ResolvedPlotStyle): PlotLayout {
  const k = style.textScale;
  const titleSize = PLOT_TITLE_FONT_PX * s * k;
  const axisSize = PLOT_AXIS_FONT_PX * s * k;
  const pad = 4 * s;
  const tick = 1.2 * s;
  const padLeft = 32 * s * k;
  const padRight = 12 * s;
  // Room below the tick values for the x axis title, and above the top
  // tick value so it stays clear of the plot title.
  const padBottom = 22 * s * k + 2 * s + (style.showAxisTitle ? axisSize : 0);
  const padTop = (style.showTitle ? titleSize + 6 * s : pad) + axisSize / 2 + 3 * s;
  const chartX = x + padLeft;
  const chartY = y + padTop;
  const chartW = Math.max(2 * mm, w - padLeft - padRight);
  const chartH = Math.max(2 * mm, h - padTop - padBottom);
  return {
    titleSize,
    axisSize,
    pad,
    tick,
    titleX: x + 6 * s,
    titleY: y + pad,
    chartX,
    chartY,
    chartW,
    chartH,
    xTitleY: chartY + chartH + tick + pad / 2 + axisSize + 2 * s,
  };
}

/**
 * The ticks of one axis over the data's `lo` to `hi`, with the style's
 * fixed ends: a fixed end is the axis's end exactly, the ticks the round
 * ones between the ends. Ends that leave no range (min ≥ max) are not
 * taken.
 */
export function plotAxisTicks(
  lo: number,
  hi: number,
  fixedLo: number | undefined,
  fixedHi: number | undefined,
  target: number,
  integer: boolean,
): AxisTicks {
  const a = fixedLo ?? lo;
  const b = fixedHi ?? hi;
  if ((fixedLo === undefined && fixedHi === undefined) || !(b > a)) return axisTicks(lo, hi, target, integer);
  const t = axisTicks(a, b, target, integer);
  const min = fixedLo ?? t.min;
  const max = fixedHi ?? t.max;
  const eps = (max - min) * 1e-9;
  return { ...t, min, max, values: t.values.filter((v) => v >= min - eps && v <= max + eps) };
}

/** Whether the style fixes an end of either axis (then the series is clipped to the chart). */
export function hasFixedRange(style: ResolvedPlotStyle): boolean {
  return style.xMin !== undefined || style.xMax !== undefined || style.yMin !== undefined || style.yMax !== undefined;
}

/** A marker's shape at a point: a circle, a polygon or loose segments. */
export type MarkerShape =
  | { kind: "circle"; x: number; y: number; r: number }
  | { kind: "polygon"; points: [number, number][] }
  | { kind: "segments"; segments: [number, number, number, number][] };

/** The shape of a marker of radius `r` at (x, y); null for none. */
export function markerShape(marker: PlotMarker, x: number, y: number, r: number): MarkerShape | null {
  switch (marker) {
    case "none":
      return null;
    case "circle":
      return { kind: "circle", x, y, r };
    case "square": {
      const a = r * 0.9;
      return { kind: "polygon", points: [[x - a, y - a], [x + a, y - a], [x + a, y + a], [x - a, y + a]] };
    }
    case "triangle": {
      // Equilateral, pointing up, about the circle's area.
      const R = r * 1.25;
      const c = R * Math.cos(Math.PI / 6);
      return { kind: "polygon", points: [[x, y - R], [x + c, y + R / 2], [x - c, y + R / 2]] };
    }
    case "plus":
      return { kind: "segments", segments: [[x - r, y, x + r, y], [x, y - r, x, y + r]] };
    case "cross": {
      const a = r * 0.8;
      return { kind: "segments", segments: [[x - a, y - a, x + a, y + a], [x - a, y + a, x + a, y - a]] };
    }
  }
}

/** Whether a marker is drawn as an outline (plus and cross always are; the others when open). */
export function markerStroked(marker: PlotMarker, open: boolean): boolean {
  return marker === "plus" || marker === "cross" || open;
}
