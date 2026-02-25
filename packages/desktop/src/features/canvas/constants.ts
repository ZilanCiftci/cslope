// Canvas interaction constants
export const POINT_RADIUS = 6;
export const SNAP_THRESHOLD = 12; // px distance to snap to a point
export const EDGE_THRESHOLD = 10; // px distance to detect near-edge
export const GRID_STEP_MIN = 1;
export const POINT_COLOR = "#0078d4";
export const POINT_COLOR_HOVER = "#1a8adb";
export const POINT_COLOR_SELECTED = "#ff6b6b";

// Load-arrow drawing constants (shared by draw.ts, useHitTest.ts)
export const ARROW_HEIGHT_PX = 38; // arrow shaft length in pixels
export const ARROW_HEAD_PX = 8; // arrowhead half-width in pixels
export const ARROW_HEAD_LEN_PX = 12; // arrowhead length in pixels
export const HATCH_SPACING_PX = 8; // spacing between hatch lines

// Load colors (canvas hex, PDF RGB tuples)
export const UDL_COLOR = "#cc0000";
export const LL_COLOR = "#2563eb";
export const UDL_COLOR_RGB: [number, number, number] = [204, 0, 0];
export const LL_COLOR_RGB: [number, number, number] = [37, 99, 235];

/** Read a CSS custom property from :root at render time. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}
