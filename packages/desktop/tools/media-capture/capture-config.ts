/** Capture configuration constants. */

/** CSS viewport size for deterministic captures. */
export const VIEWPORT_WIDTH = 1440;
export const VIEWPORT_HEIGHT = 900;

/** Device pixel ratio — 2 for @2x Retina-quality assets. */
export const CAPTURE_DPR = 2;

/** Maximum time (ms) to wait for analysis completion per scene. */
export const ANALYSIS_TIMEOUT_MS = 60_000;

/** Time (ms) to wait after state change for canvas to render. */
export const RENDER_SETTLE_MS = 500;

/** Output directory relative to workspace root. */
export const OUTPUT_DIR = "packages/website/public/media/generated";
