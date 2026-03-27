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
}

export interface SceneOutput {
  type: "png";
  filename: string;
  /** "canvas" crops to the paper-frame area; "full" captures the whole window. */
  crop: "canvas" | "full";
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
