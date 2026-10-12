/**
 * Type definitions for the media capture scene manifest.
 *
 * These types describe what each automated capture scene needs:
 * which benchmark to load, what mode to show, any store overrides,
 * and how to output the result.
 */

/** Store-level overrides applied after loading a benchmark model. */
export interface SceneSetup {
  /** Switch to a specific model by name (within the loaded benchmarks). */
  switchToModel?: string;
  /** Remove the other benchmark models, as in a new project with one model. */
  onlyModel?: boolean;
  /** Force app mode. */
  mode?: "edit" | "result";
  /** Run analysis and wait for completion before capture. */
  runAnalysis?: boolean;
  /** Partial result-view-settings overrides. */
  resultView?: {
    showSlices?: boolean;
    showFosLabel?: boolean;
    showCentreMarker?: boolean;
    showGrid?: boolean;
    showSoilColor?: boolean;
    surfaceDisplay?: "critical" | "all" | "filter";
    fosFilterMax?: number;
  };
  /**
   * Store actions applied in order after the benchmark is loaded and the
   * mode set, as [action name, ...arguments], e.g. ["setActiveSection",
   * "Search Limits"]. They run before the analysis. An argument
   * "$last:<state key>" stands for the id of the last item in that list,
   * e.g. ["updateReinforcement", "$last:reinforcements", { spacing: 1.5 }].
   */
  actions?: [string, ...unknown[]][];
  /** Store actions applied after the analysis (e.g. to select an annotation). */
  afterAnalysis?: [string, ...unknown[]][];
  /** Ribbon tab to show: "File", "Model", "Results" or "Help". */
  ribbonTab?: string;
  /**
   * Buttons to click in the main window, in order, by their visible text or
   * accessible name (exact match), e.g. ["Model", "Exterior"].
   */
  click?: string[];
  /** Wait until this text appears in the main window (e.g. the end of a run). */
  waitForText?: string;
  /** Milliseconds to wait after the clicks. */
  waitMs?: number;
  /** In the captured dialog window: choose options, as [field label, option text]. */
  windowSelect?: [string, string][];
}

export interface SceneOutput {
  type: "png";
  filename: string;
  /**
   * "canvas": the drawing canvas only; "full": the whole main window;
   * "window": the dialog window whose title is `window`.
   */
  crop: "canvas" | "full" | "window";
  /** The dialog window's title, for crop "window". */
  window?: string;
  /**
   * Shrink a dialog window to its content's height (default). Off for
   * windows whose content grows with the window, such as a chart.
   */
  fitHeight?: boolean;
  /** Directory under public/media (default "generated"). */
  dir?: string;
}

export interface Scene {
  /** Unique identifier used in manifest and filenames. */
  id: string;
  /** Human-readable title for the manifest. */
  title: string;
  /** Short description of what this scene shows. */
  description: string;
  /** Name of the benchmark model to load (must match a name in BENCHMARK_MODELS). */
  benchmark: string;
  /** Setup steps applied after loading the benchmark. */
  setup: SceneSetup;
  /** Output configuration. */
  output: SceneOutput;
}
