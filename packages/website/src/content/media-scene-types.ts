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
    /** The part of the model the paper shows (Results › the paper's extents). */
    viewLock?: { bottomLeft: [number, number]; topRight: [number, number] };
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
  /** In the captured dialog window, after windowSelect: click buttons by their exact text. */
  windowClick?: string[];
  /** In the captured dialog window: wait until this text appears (e.g. the end of a run). */
  windowWaitForText?: string;
  /**
   * In the captured dialog window, last: scroll the element whose text is
   * exactly this to the middle of its scrolling area (for a part of a long
   * form, such as a section of the Options window).
   */
  windowScrollTo?: string;
}

export interface SceneOutput {
  type: "png";
  filename: string;
  /**
   * "canvas": the drawing canvas only; "full": the whole main window;
   * "window": the dialog window whose title is `window`; "export": the
   * result plot as the app's "Export PNG" saves it (the paper; in the dark
   * theme the dark paper, which the app's export does not offer).
   */
  crop: "canvas" | "full" | "window" | "export";
  /** The dialog window's title, for crop "window". */
  window?: string;
  /**
   * Crop "canvas" in edit mode: draw the rulers (the axes along the left
   * and bottom edges, a canvas of their own over the drawing) on the image.
   */
  rulers?: boolean;
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
  benchmark?: string;
  /**
   * Instead of a benchmark: a new project, as File › New and the start of
   * the app give it (one model, "Model 1", with T-ACADS Simple's geometry
   * and no title). For the tutorials that start with File › New.
   */
  newProject?: boolean;
  /**
   * Instead of a benchmark: a verification problem opened in the app, run
   * as one of its analyses (cSlope's name for it, as the verification table
   * shows it).
   */
  verification?: { id: string; method: string };
  /** Setup steps applied after loading the benchmark. */
  setup: SceneSetup;
  /** Output configuration. */
  output: SceneOutput;
}

/** Every scene is captured in both themes of the app. */
export type CaptureTheme = "light" | "dark";

/** The file of a scene's image in a theme: "a.png" (light), "a-dark.png" (dark). */
export function themedFilename(filename: string, theme: CaptureTheme): string {
  return theme === "dark" ? filename.replace(/\.png$/, "-dark.png") : filename;
}

/** How a scene starts: exactly one of a benchmark, a verification problem or a new project. */
export function sceneSources(scene: Pick<Scene, "benchmark" | "verification" | "newProject">): number {
  return [scene.benchmark, scene.verification, scene.newProject].filter(Boolean).length;
}
