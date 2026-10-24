// ── Application-wide constants ───────────────────────────────

/** Per-analysis timeout in milliseconds (applies to both single and batch runs). */
export const ANALYSIS_TIMEOUT_MS = 60_000;

/** New models are named "Model 1", "Model 2", ... */
export const MODEL_NAME_PREFIX = "Model";

/** Name for a model that has none (e.g. a broken project file entry). */
export const DEFAULT_MODEL_NAME = "Untitled";

/** Pixel margin around the paper frame on canvas and in PDF export. */
export const PAPER_FRAME_MARGIN_PX = 20;

/** Raw grid step divisor used in grid-step snapping (canvas + PDF). */
export const GRID_RAW_STEP_PX = 50;
