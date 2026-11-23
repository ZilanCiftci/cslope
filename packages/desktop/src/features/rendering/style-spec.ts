/**
 * Shared rendering style specification.
 *
 * Single source of truth for colours, sizes, and spacing values used by
 * both the canvas renderer (`features/canvas/draw.ts`) and the PDF
 * renderer (`features/pdf/pdf-drawing.ts`).
 *
 * Colours are exposed as {@link DualColor} pairs so each renderer can
 * pick the most convenient format (hex for Canvas 2D, RGB tuple for jsPDF).
 *
 * Geometric values suffixed `_PX` are in *logical pixels*.  The canvas
 * renderer uses them directly; the PDF renderer multiplies by
 * `tf.mmPerPx` to convert to millimetres.
 */

// ── Dual-format colour type ────────────────────────────────────

/** A colour expressed as both a CSS hex string and an RGB triple. */
export interface DualColor {
  hex: string;
  rgb: [number, number, number];
}

// ── Shared colours ─────────────────────────────────────────────

/** Entry range dot colour (green). */
export const ENTRY_DOT_COLOR: DualColor = { hex: "#006400", rgb: [0, 100, 0] };
/** Exit range dot colour (red). */
export const EXIT_DOT_COLOR: DualColor = { hex: "#cc0000", rgb: [204, 0, 0] };
/** Marker arrow/bar colour (black). */
export const MARKER_COLOR: DualColor = { hex: "#000000", rgb: [0, 0, 0] };
/** Piezometric line colour (dark blue). */
export const PIEZO_COLOR: DualColor = { hex: "#1a3a8a", rgb: [26, 58, 138] };
/** Ponded water above the ground (light blue), filled with POND_OPACITY. */
export const POND_COLOR: DualColor = { hex: "#4aa8e8", rgb: [74, 168, 232] };
/** Opacity of the pond fill: the ground line and the slip surface show through. */
export const POND_OPACITY = 0.35;
/** UDL load colour (red). */
export const UDL_LOAD_COLOR: DualColor = { hex: "#cc0000", rgb: [204, 0, 0] };
/** Line-load colour (blue). */
export const LINE_LOAD_COLOR: DualColor = {
  hex: "#2563eb",
  rgb: [37, 99, 235],
};
/** Critical surface / arc colour (black). */
export const CRITICAL_SURFACE_COLOR: DualColor = {
  hex: "#000000",
  rgb: [0, 0, 0],
};
/** FOS label background fill colour (white). */
export const FOS_LABEL_BG_COLOR: DualColor = {
  hex: "#ffffff",
  rgb: [255, 255, 255],
};
/**
 * Reference annotations (a slip surface from another program, a line from
 * a paper): a purple no surface uses. The canvas takes the theme's
 * --color-canvas-reference instead where it is set; the PDF this.
 */
export const REFERENCE_ANNOTATION_COLOR: DualColor = {
  hex: "#a21caf",
  rgb: [162, 28, 175],
};
/** Failure mass semi-transparent fill colour (black). */
export const FAILURE_MASS_COLOR: DualColor = {
  hex: "#000000",
  rgb: [0, 0, 0],
};
/**
 * The custom search planes' surfaces in the result (dashed, each with its
 * own FOS label): purple, apart from the black critical surface and the
 * red–yellow–green–blue FOS scale. The canvas takes its theme's
 * `--color-canvas-custom-surface` and falls back to this (the PDF's).
 */
export const CUSTOM_SURFACE_COLOR: DualColor = {
  hex: "#7e22ce",
  rgb: [126, 34, 206],
};
/** Dash pattern of a custom surface in the result (logical px). */
export const CUSTOM_SURFACE_DASH_PX: readonly [number, number] = [8, 5];
/** Line width of a custom surface in the result (logical px). */
export const CUSTOM_SURFACE_LINE_WIDTH_PX = 1.5;

// ── Entry / exit marker geometry (logical px) ──────────────────

/** Arrowhead half-size for entry/exit markers. */
export const MARKER_SZ_PX = 7;
/** Bar half-height for entry/exit markers. */
export const MARKER_BAR_H_PX = 10;
/** Dot spacing along entry/exit surfaces. */
export const ENTRY_EXIT_DOT_SPACING_PX = 12;
/** Dot radius on entry/exit surfaces. */
export const ENTRY_EXIT_DOT_RADIUS_PX = 2;

// ── Piezometric line geometry (logical px) ─────────────────────

/** Piezometric triangle half-width. */
export const PIEZO_TRI_HALF_PX = 6;
/** Piezometric triangle height. */
export const PIEZO_TRI_H_PX = 10;
/** Piezometric bar width. */
export const PIEZO_BAR_W_PX = 7;
/** Piezometric bar gap 1 (between triangle and first bar). */
export const PIEZO_BAR_GAP1_PX = 3;
/** Piezometric bar gap 2 (between first and second bar). */
export const PIEZO_BAR_GAP2_PX = 6;

// ── Load arrows in ponded water (logical px) ───────────────────

/** Arc length along the ground between the arrows. */
export const POND_ARROW_SPACING_PX = 50;
/** Longest arrow. */
export const POND_ARROW_MAX_PX = 20;
/** Arrow length as a fraction of the local water depth. */
export const POND_ARROW_DEPTH_FRACTION = 0.7;
/** No arrow where the water is shallower than this. */
export const POND_ARROW_MIN_DEPTH_PX = 8;
/** Arrowhead length and half-width. */
export const POND_ARROW_HEAD_PX = 4;
export const POND_ARROW_HEAD_HALF_PX = 2;
/** Shaft width. */
export const POND_ARROW_WIDTH_PX = 0.8;
/** Gap kept to a water-table symbol. */
export const POND_ARROW_CLEARANCE_PX = 3;
/** Opacity of the arrows (PIEZO_COLOR): subtle, under the result. */
export const POND_ARROW_OPACITY = 0.6;

// ── Slip surface / critical surface ────────────────────────────

/** Opacity for non-critical slip surface arcs. */
export const SLIP_SURFACE_OPACITY = 0.6;
/** Opacity for the critical failure mass fill. */
export const FAILURE_MASS_FILL_OPACITY = 0.12;
/** Opacity for slice wall lines. */
export const SLICE_LINE_OPACITY = 0.6;
/** Slice wall line width (logical px; PDF scales by mmPerPx). */
export const SLICE_LINE_WIDTH_PX = 0.55;
/** The model outline over a result (mm on the paper, the PDF's; 1 px in the edit view). */
export const RESULT_OUTLINE_MM = 0.3;
/** Slice wall colour over a dark material fill (white). */
export const SLICE_LINE_ON_DARK_COLOR: DualColor = { hex: "#ffffff", rgb: [255, 255, 255] };
/** A sliding mass thinner than this on screen gets a band of this width along it. */
export const MIN_SLIP_MASS_PX = 5;
/** Opacity of that band (FAILURE_MASS_COLOR). */
export const MIN_SLIP_MASS_BAND_OPACITY = 0.3;
/** Width of the water band in a water-filled tension crack (logical px). */
export const CRACK_WATER_WIDTH_PX = 5;
/** Opacity of that band (POND_COLOR). */
export const CRACK_WATER_OPACITY = 0.85;
/** The critical surface's line (logical px; the thickest result line). */
export const CRITICAL_SURFACE_LINE_WIDTH_PX = 1.5;
/** The other slip surfaces' lines (Surfaces: all, filter). */
export const SLIP_SURFACE_LINE_WIDTH_PX = 1;
/** Their width on the paper (mm; the PDF's, and the result view's at its sheet's px per mm), scaled by a style's width over SLIP_SURFACE_LINE_WIDTH_PX. */
export const SLIP_SURFACE_LINE_MM = 0.15;
/** The center's radius lines to the entry and exit. */
export const CENTER_LINE_WIDTH_PX = 1;
/** The radius of the center's dot. */
export const CENTER_DOT_RADIUS_PX = 3;
/** The FOS label's text (px at paper zoom 1, bold sans-serif) and its decimals. */
export const FOS_LABEL_FONT_PX = 12;
export const FOS_LABEL_DECIMALS = 3;
/** The finite element mesh's lines and their opacity (in the theme's line color). */
export const FEM_MESH_LINE_WIDTH_PX = 0.4;
export const FEM_MESH_OPACITY = 0.35;
/** The plastic zone's shade: its color and the opacity of the most strained elements. */
export const FEM_PLASTIC_ZONE_COLOR: DualColor = { hex: "#d62828", rgb: [214, 40, 40] };
export const FEM_PLASTIC_ZONE_OPACITY = 0.85;

// ── Annotations ────────────────────────────────────────────────

/** Default annotation font size (px). */
export const ANNOTATION_DEFAULT_FONT_SIZE = 12;
/** Default annotation font family. */
export const ANNOTATION_DEFAULT_FONT_FAMILY = "sans-serif";
/** Line-height multiplier for multi-line annotation text. */
export const ANNOTATION_LINE_HEIGHT = 1.2;
/** Divisor for annotation scale (`scale = min(paperW, paperH) / divisor`). */
export const ANNOTATION_SCALE_DIVISOR = 600;
/** Default annotation text colour. */
export const ANNOTATION_DEFAULT_TEXT_COLOR = "#000000";

// ── Slice plot annotation ──────────────────────────────────────
// Sizes in annotation px (scale = min(paperW, paperH) / divisor) or mm on
// the paper; the canvas and the PDF draw the plot from these
// (features/annotations/plotStyle.ts).

/** The plot's title and its tick values and axis title (annotation px). */
export const PLOT_TITLE_FONT_PX = 10;
export const PLOT_AXIS_FONT_PX = 9;
/** The series' line: PLOT_LINE_PX annotation px, at least PLOT_LINE_MIN_MM. */
export const PLOT_LINE_PX = 0.35;
export const PLOT_LINE_MIN_MM = 0.25;
/** The markers' radius: PLOT_MARKER_PX annotation px, at least PLOT_MARKER_MIN_MM. */
export const PLOT_MARKER_PX = 1.8;
export const PLOT_MARKER_MIN_MM = 0.35;
/** The dash of a dashed series, in line widths. */
export const PLOT_SERIES_DASH: readonly [number, number] = [6, 3];
/** The PDF's plot series color (the light theme's --color-canvas-plot-line). */
export const PLOT_LINE_COLOR: DualColor = { hex: "#26a69a", rgb: [38, 166, 154] };

// ── Colour bar ─────────────────────────────────────────────────

/** Number of tick/label positions on the FOS colour bar. */
export const COLOR_BAR_NUM_TICKS = 5;

// ── The sheet's frame: ticks, their labels and the plot frame (mm on the paper) ──
// The PDF draws these sizes; the result view draws them at its sheet's px per mm.

/** Millimetres per typographic point. */
export const MM_PER_PT = 0.3528;
/** A labelled tick and a minor tick. */
export const RULER_TICK_MM = 2;
export const RULER_MINOR_TICK_MM = 1;
/** Their lines. */
export const RULER_TICK_LINE_MM = 0.2;
export const RULER_MINOR_TICK_LINE_MM = 0.15;
/** The tick labels (pt), between the tick and the label, and the label's baseline below its tick (x axis, mm) or beside it (y axis, mm). */
export const RULER_FONT_PT = 9;
export const RULER_LABEL_GAP_MM = 1;
export const RULER_X_LABEL_BASELINE_MM = RULER_FONT_PT * 0.35 + RULER_LABEL_GAP_MM;
export const RULER_Y_LABEL_BASELINE_MM = RULER_FONT_PT * 0.12;
/** The ticks and their labels: dark grey on white paper. */
export const RULER_COLOR: DualColor = { hex: "#323232", rgb: [50, 50, 50] };
/** The plot frame's line. */
export const PLOT_FRAME_LINE_MM = 0.4;
/**
 * Px per millimetre on the paper of a width in the result view's
 * properties (the frame's width, the plot's line width and marker size):
 * 1 px = 0.1 mm. (Divide by it: 4 / 10 is 0.4 exactly, 4 * 0.1 is not.)
 */
export const STYLE_PX_PER_MM = 10;
/** The frame's width in those px (Layers › Frame; the default PLOT_FRAME_LINE_MM). */
export const FRAME_LINE_WIDTH_PX = PLOT_FRAME_LINE_MM * STYLE_PX_PER_MM;
/**
 * The sheet's grid (Layers › Grid): light grey on white paper, its lines
 * GRID_LINE_MM wide on the paper at the style's default width
 * (GRID_LINE_WIDTH_PX); a style's width scales it (width / that default),
 * in the view and the PDF alike. The minor lines between them are half as
 * wide by default, in the same color.
 */
export const GRID_COLOR: DualColor = { hex: "#dcdcdc", rgb: [220, 220, 220] };
export const GRID_LINE_MM = 0.1;
export const GRID_LINE_WIDTH_PX = 1;
export const GRID_MINOR_LINE_WIDTH_PX = 0.5;
/** The minor lines' subdivisions of a grid interval when they are turned on. */
export const GRID_DEFAULT_SUBDIVISIONS = 5;
/** Minor lines closer than this on the paper (mm) are not drawn. */
export const GRID_MINOR_MIN_SPACING_MM = 1;
/**
 * The canvas's family for the sheet's sans-serif text: Arial's metrics, as
 * the PDF's embedded Liberation Sans has, so that text takes the same room.
 */
export const SHEET_SANS_FAMILY = "Arial, 'Liberation Sans', sans-serif";

/** The canvas family of a family the sheet's text names: sans-serif as SHEET_SANS_FAMILY, others as named. */
export function sheetCanvasFamily(family: string): string {
  return family === "sans-serif" ? SHEET_SANS_FAMILY : family;
}

// ── The F label at the critical surface (mm on the paper; the PDF's) ──

/** Its text (pt at the default size, bold sans-serif). */
export const FOS_LABEL_FONT_PT = 10;
/** From the anchor (the circle's centre) to the text. */
export const FOS_LABEL_OFFSET_MM = 3;
/** The text's baseline above the underline, at the default size. */
export const FOS_LABEL_RAISE_MM = 1;
/** The underline: its width and how far it runs past the text. */
export const FOS_LABEL_UNDERLINE_MM = 0.2;
/** The plate under the label: past the text at the sides, above and below the underline (at the default size). */
export const FOS_LABEL_PLATE_SIDE_MM = 0.5;
export const FOS_LABEL_PLATE_TOP_MM = 4.5;
export const FOS_LABEL_PLATE_BOTTOM_MM = 1;
/** Between two stacked labels (custom surfaces). */
export const FOS_LABEL_STACK_GAP_MM = 0.5;

// ── Page 1's title line in the top margin (the PDF's; previewed by the result view) ──

/** Its text (pt). */
export const PAGE_TITLE_PT = 9;
/** Its baseline above the plot frame (mm). */
export const PAGE_TITLE_RAISE_MM = 2.5;
/** Between the model's name and the result (mm), and kept before the out-of-date note. */
export const PAGE_TITLE_GAP_MM = 4;
/** Less than this left for the result (mm): it is left out. */
export const PAGE_TITLE_MIN_ROOM_MM = 10;

/** The colour bar's border and tick lines (mm on the paper). */
export const COLOR_BAR_LINE_MM = 0.2;
/** The material table's rules and its swatches' borders (mm on the paper, the canvas and the PDF alike). */
export const MATERIAL_TABLE_RULE_MM = 0.2;
export const MATERIAL_TABLE_SWATCH_BORDER_MM = 0.1;
/** Space between the colour bar (its title, bar and values) and the edge of its plate, at annotation scale 1. */
export const COLOR_BAR_PLATE_PAD = 4;

// ── Material model hatch patterns ──────────────────────────────

import type { MaterialModelKind } from "@cslope/engine";

/**
 * Describes a hatch-pattern overlay for special material model kinds.
 *
 * `lineSpacing` is in logical pixels (canvas) — the PDF renderer
 * multiplies by `tf.mmPerPx`.
 */
export interface HatchPattern {
  /** Hatch line angle in degrees (0 = horizontal, 45 = diagonal). */
  angle: number;
  /** Spacing between hatch lines (logical px). */
  lineSpacing: number;
  /** Hatch line width (logical px). */
  lineWidth: number;
  /** Stroke colour. */
  color: DualColor;
  /** Optional second angle for cross-hatch. */
  crossAngle?: number;
  /** Short label drawn in the region centroid. */
  label?: string;
}

/** Hatch patterns for model kinds that need visual distinction. */
export const MODEL_HATCH_PATTERNS: Partial<
  Record<MaterialModelKind, HatchPattern>
> = {
  "high-strength": {
    angle: 45,
    lineSpacing: 8,
    lineWidth: 1.2,
    color: { hex: "#555555", rgb: [85, 85, 85] },
    crossAngle: -45,
    label: "HS",
  },
  impenetrable: {
    angle: 45,
    lineSpacing: 6,
    lineWidth: 1.5,
    color: { hex: "#333333", rgb: [51, 51, 51] },
    label: "BR",
  },
};

/**
 * Short display labels for each model kind, used in the material table
 * "Model" column. Falls back to the full label from MATERIAL_MODEL_LABELS.
 */
export const MODEL_SHORT_LABELS: Record<MaterialModelKind, string> = {
  "mohr-coulomb": "M-C",
  undrained: "Undr.",
  "high-strength": "High-S",
  impenetrable: "Bedrock",
  "spatial-mohr-coulomb": "Spat. M-C",
  "anisotropic-function": "Aniso.",
  "s-f-depth": "S=f(d)",
  "s-f-datum": "S=f(z)",
  "lime-cement-columns": "KC",
  "hoek-brown": "H-B",
  shansep: "SHANSEP",
  "shear-normal": "τ=f(σn)",
};
