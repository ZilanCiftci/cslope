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
export const SLICE_LINE_WIDTH_PX = 0.8;
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
};
