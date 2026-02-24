// Canvas interaction constants
export const POINT_RADIUS = 6;
export const SNAP_THRESHOLD = 12; // px distance to snap to a point
export const EDGE_THRESHOLD = 10; // px distance to detect near-edge
export const GRID_STEP_MIN = 1;
export const POINT_COLOR = "#0078d4";
export const POINT_COLOR_HOVER = "#1a8adb";
export const POINT_COLOR_SELECTED = "#ff6b6b";

/** Read a CSS custom property from :root at render time. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}
