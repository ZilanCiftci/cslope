// ── Application-wide constants ───────────────────────────────

/** Per-analysis timeout in milliseconds (applies to both single and batch runs). */
export const ANALYSIS_TIMEOUT_MS = 60_000;
/** Extra time for the finite element analysis, per mesh (the first and each refinement). */
export const FEM_TIMEOUT_MS = 300_000;

/** New models are named "Model 1", "Model 2", ... */
export const MODEL_NAME_PREFIX = "Model";

/** Name for a model that has none (e.g. a broken project file entry). */
export const DEFAULT_MODEL_NAME = "Untitled";

/** Pixel margin around the paper frame on canvas and in PDF export. */
export const PAPER_FRAME_MARGIN_PX = 20;

/** The floating toolbar over the canvas: its distance from the canvas's bottom edge and its height (px). */
export const FLOATING_TOOLBAR_BOTTOM_PX = 40;
export const FLOATING_TOOLBAR_HEIGHT_PX = 32;

/**
 * The band at the bottom of the result canvas kept free of the sheet (px,
 * below the sheet's margin): the floating toolbar and 8 px above it, so at
 * paper zoom 1 (Fit) the toolbar never covers the sheet's x axis. Only on
 * screen: the exports lay the sheet out without it.
 */
export const SCREEN_PAPER_BOTTOM_RESERVE_PX =
  FLOATING_TOOLBAR_BOTTOM_PX + FLOATING_TOOLBAR_HEIGHT_PX + 8 - PAPER_FRAME_MARGIN_PX;

/** Raw grid step divisor used in grid-step snapping (canvas + PDF). */
export const GRID_RAW_STEP_PX = 50;

/**
 * The finite element analysis (strength reduction, the limit analysis bounds
 * and the seepage) is experimental until its verification is as broad as the
 * limit equilibrium one: its results are marked wherever they appear. The
 * note is the one-sentence tooltip of the Experimental badge; the advice adds
 * what to base the design on.
 */
export const FEM_EXPERIMENTAL_NOTE =
  "Finite element analysis is experimental: fewer verification problems than limit equilibrium; results may change between versions.";
export const FEM_EXPERIMENTAL_ADVICE = `${FEM_EXPERIMENTAL_NOTE} Base the design on the limit equilibrium result.`;
