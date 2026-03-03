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
/** Failure mass semi-transparent fill colour (black). */
export const FAILURE_MASS_COLOR: DualColor = {
  hex: "#000000",
  rgb: [0, 0, 0],
};

// ── Entry / exit marker geometry (logical px) ──────────────────

/** Arrowhead half-size for entry/exit markers. */
export const MARKER_SZ_PX = 7;
/** Bar half-height for entry/exit markers. */
export const MARKER_BAR_H_PX = 10;
/** Dot spacing along entry/exit surfaces. */
export const ENTRY_EXIT_DOT_SPACING_PX = 12;
/** Dot radius on entry/exit surfaces. */
export const ENTRY_EXIT_DOT_RADIUS_PX = 2.5;

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

// ── Slip surface / critical surface ────────────────────────────

/** Opacity for non-critical slip surface arcs. */
export const SLIP_SURFACE_OPACITY = 0.6;
/** Opacity for the critical failure mass fill. */
export const FAILURE_MASS_FILL_OPACITY = 0.12;
/** Opacity for slice wall lines. */
export const SLICE_LINE_OPACITY = 0.6;
/** Slice wall line width (logical px; PDF scales by mmPerPx). */
export const SLICE_LINE_WIDTH_PX = 0.8;

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

// ── Colour bar ─────────────────────────────────────────────────

/** Number of tick/label positions on the FOS colour bar. */
export const COLOR_BAR_NUM_TICKS = 5;
