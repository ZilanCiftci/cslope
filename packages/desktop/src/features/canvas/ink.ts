import {
  ANNOTATION_DEFAULT_TEXT_COLOR,
  CRITICAL_SURFACE_COLOR,
  LINE_LOAD_COLOR,
  PIEZO_COLOR,
  UDL_LOAD_COLOR,
} from "../rendering/style-spec";

/**
 * The colours the canvas draws with on the sheet (the result view's paper)
 * and the edit canvas, from the theme: the light theme's are the print
 * colours (as the PDF and the PNG export draw them, on white paper), the
 * dark theme's lighter ones that read on its dark grey sheet. Each is a
 * --color-canvas-* token of index.css, with the print colour as the
 * fallback (no stylesheet, as in the tests).
 *
 * The soil fills are the user's colours in both themes; in the dark theme
 * the lines that cross them keep the theme's colour and get a thin halo
 * of the sheet's colour, so they read over a light fill (see draw.ts).
 */
export interface CanvasInk {
  /** The critical surface, its radius lines, centre and FOS label; the slice lines in the dark theme. */
  critical: string;
  /** Distributed loads (outline, hatch, arrows, label) and their hover colour. */
  udl: string;
  udlHover: string;
  /** The hatch under a distributed load (drawn at half opacity). */
  udlHatch: string;
  /** Line loads (arrow, label) and their hover colour. */
  lineLoad: string;
  lineLoadHover: string;
  /** Imported reference lines (drawn faintly). */
  referenceLine: string;
  /** Water lines (and the line before drawdown, the ponded-water arrows) and imported head lines. */
  waterLine: string;
  headLine: string;
  /** Text annotations without a colour of their own. */
  annotationText: string;
  /** The colour bar's frame, ticks, title and values. */
  colorBar: string;
  /** The material table. */
  tableBg: string;
  tableHeaderBg: string;
  tableRowAlt: string;
  tableRule: string;
  tableHeaderText: string;
  tableText: string;
  tableSwatchBorder: string;
  /** The slice-data plot annotation. */
  plotBg: string;
  plotFrame: string;
  plotTitle: string;
  plotText: string;
  plotMuted: string;
  plotLine: string;
  plotGridMajor: string;
  plotGridMinor: string;
  /** The label of the finite element plastic zone. */
  feLabel: string;
  /** Reinforcement numbers and force labels; pile labels. */
  reinforcementText: string;
  pileText: string;
  /** The grid lines of the edit canvas (and the result's grid). */
  gridLine: string;
  /** The lines and texts of a DWG or DXF drawing placed under a model. */
  drawingInk: string;
}

/** The print colours: the light theme, the PDF and the PNG export. */
export const PRINT_INK: Readonly<CanvasInk> = {
  critical: CRITICAL_SURFACE_COLOR.hex,
  udl: UDL_LOAD_COLOR.hex,
  udlHover: "#ff0000",
  udlHatch: UDL_LOAD_COLOR.hex,
  lineLoad: LINE_LOAD_COLOR.hex,
  lineLoadHover: "#3b82f6",
  referenceLine: "#78909c",
  waterLine: PIEZO_COLOR.hex,
  headLine: "#00897b",
  annotationText: ANNOTATION_DEFAULT_TEXT_COLOR,
  colorBar: "#000000",
  tableBg: "#ffffff",
  tableHeaderBg: "#f0f0f0",
  tableRowAlt: "rgba(0,0,0,0.03)",
  tableRule: "#000000",
  tableHeaderText: "#000000",
  tableText: "#333333",
  tableSwatchBorder: "#666666",
  plotBg: "#ffffff",
  plotFrame: "#78909c",
  plotTitle: "#78909c",
  plotText: "#5f6b73",
  plotMuted: "#666666",
  plotLine: "#26a69a",
  plotGridMajor: "rgba(120,144,156,0.35)",
  plotGridMinor: "rgba(120,144,156,0.2)",
  feLabel: "rgba(160, 30, 30, 0.95)",
  reinforcementText: "#8e44ad",
  pileText: "#5d4037",
  gridLine: "rgba(0, 0, 0, 0.1)",
  drawingInk: "#3a434c",
};

/** The token of each colour (index.css, both themes). */
export const INK_TOKENS: Readonly<Record<keyof CanvasInk, string>> = {
  critical: "--color-canvas-ink",
  udl: "--color-canvas-udl",
  udlHover: "--color-canvas-udl-hover",
  udlHatch: "--color-canvas-udl-hatch",
  lineLoad: "--color-canvas-line-load",
  lineLoadHover: "--color-canvas-line-load-hover",
  referenceLine: "--color-canvas-reference-line",
  waterLine: "--color-canvas-water-line",
  headLine: "--color-canvas-head-line",
  annotationText: "--color-canvas-annotation-text",
  colorBar: "--color-canvas-color-bar",
  tableBg: "--color-canvas-table-bg",
  tableHeaderBg: "--color-canvas-table-header-bg",
  tableRowAlt: "--color-canvas-table-row-alt",
  tableRule: "--color-canvas-table-rule",
  tableHeaderText: "--color-canvas-table-header-text",
  tableText: "--color-canvas-table-text",
  tableSwatchBorder: "--color-canvas-table-swatch-border",
  plotBg: "--color-canvas-plot-bg",
  plotFrame: "--color-canvas-plot-frame",
  plotTitle: "--color-canvas-plot-title",
  plotText: "--color-canvas-plot-text",
  plotMuted: "--color-canvas-plot-muted",
  plotLine: "--color-canvas-plot-line",
  plotGridMajor: "--color-canvas-plot-grid-major",
  plotGridMinor: "--color-canvas-plot-grid-minor",
  feLabel: "--color-canvas-fe-label",
  reinforcementText: "--color-canvas-reinforcement-text",
  pileText: "--color-canvas-pile-text",
  gridLine: "--color-canvas-grid-line",
  drawingInk: "--color-canvas-drawing-ink",
};

/** The theme's canvas colours (read at render time), the print colours where a token is not set. */
export function themeInk(): CanvasInk {
  const ink = { ...PRINT_INK };
  // One computed style for all of them (as cssVar reads each).
  const style = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
  if (!style) return ink;
  for (const key of Object.keys(INK_TOKENS) as (keyof CanvasInk)[]) {
    const v = style.getPropertyValue(INK_TOKENS[key]).trim();
    if (v) ink[key] = v;
  }
  return ink;
}

/** Whether the app shows the dark theme (the export draws with the light one; see paper-png.ts). */
export function isDarkTheme(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";
}
