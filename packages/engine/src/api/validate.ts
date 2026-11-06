/**
 * The engine's contract for input from outside the app (issue #55): its
 * JSON schemas, strict validation of a definition with the path of each
 * issue, and a summary of a result that says what F is. The same functions
 * serve Python (`cslope.validate`, `cslope.summarize`, `cslope.schema`).
 * The schemas are the files packages/engine/schema/<name>.json (draft
 * 2020-12), written by packages/engine-rs/tools/schema.ts.
 */
import { wasm } from "../facade/internal";
import type { AnalysisMethod, AnalysisOptions, AnalysisResult, PartialFactors, SwedishFactorBasis } from "../types/analysis";
import type { SlopeOrientation } from "../model/canonical";

/** The schemas the engine provides, by name (packages/engine/schema/<name>.json). */
export const SCHEMA_NAMES = [
  "analysis-document",
  "slope-definition",
  "analysis-options",
  "analysis-result",
  "material-model",
  "fem-analysis-settings",
  "reliability-options",
  "random-variables",
  "result-summary",
  "validation-issues",
] as const;
export type SchemaName = (typeof SCHEMA_NAMES)[number];

/** The version of the schemas: the engine's version (each schema's `$id` carries it). */
export function schemaVersion(): string {
  return wasm().schema_version();
}

/** One finding of `validateDefinition`. */
export interface ValidationIssue {
  /** JSON pointer to the value, e.g. "/materials/1/model/undrainedShearStrength". */
  path: string;
  /** A stable code, e.g. "unknown-key", "missing-region-assignments". */
  code: string;
  message: string;
  /** An error gives a wrong answer or none; a warning is often a mistake. */
  severity: "error" | "warning";
}

/**
 * The issues of an analysis document (`{ format: "cslope-analysis",
 * formatVersion: 1, definition, options }`, paths under /definition and
 * /options) or of a bare definition and its options (paths from the
 * definition's root, the options under /options): unknown keys, values of
 * the wrong type, and the rules of the model (regions and their
 * assignments, boundaries that reach the outline, loads and water within
 * the model, saturated unit weights below the water). Empty: valid.
 */
export function validateDefinition(docOrDefinition: unknown, options?: unknown): ValidationIssue[] {
  return wasm().validate_definition(docOrDefinition, options ?? null) as ValidationIssue[];
}

/** The summary of a result (see `summarizeResult`). */
export interface ResultSummary {
  fos: number | null;
  /** On characteristic values a factor of safety; on design values an over-design factor. */
  fosLabel: "factor of safety" | "over-design factor";
  /** The label as the app shows it, e.g. "Over-design factor (design values)". */
  fosHeading: string;
  fosText: string;
  valueBasis: "characteristic" | "design";
  partialFactors: (Omit<PartialFactors, "basis"> & { basis: SwedishFactorBasis | null; gammaD: number | null; text: string }) | null;
  /** The method as a reader would cite it. */
  method: string;
  methodName: AnalysisMethod;
  criticalSurface: {
    shape: "circle" | "composite" | "non-circular";
    center: [number, number];
    radius: number;
    points: number | null;
    entry: [number, number];
    exit: [number, number];
    text: string;
    entryExitText: string;
  } | null;
  slidingDirection: SlopeOrientation | null;
  bothDirections: { slidingDirection: SlopeOrientation; otherDirectionFos: number | null; text: string } | null;
  surfaces: number;
  surfacesBelowOne: number;
  surfacesText: string;
  nonConverged: number;
  nonConvergedText: string | null;
  discardedBySize: number;
  customSurfaces: { name: string; fos: number | null; text: string }[];
  warnings: { code: string; message: string }[];
  engineBuild: string;
}

/**
 * What a result means, as the app's report states it: F with what it is
 * (a factor of safety on characteristic values, an over-design factor on
 * design values with the partial factors and their basis), the method, the
 * critical surface with its entry and exit, the warnings, the surfaces
 * without a solution, both directions when run, and the engine build.
 * `options` are those the analysis ran with.
 */
export function summarizeResult(
  result: AnalysisResult,
  options?: Partial<AnalysisOptions>,
  engineBuild: string = wasm().engine_build(),
): ResultSummary {
  return wasm().summarize_result(result, options ?? null, engineBuild) as ResultSummary;
}

/**
 * The defaults of Python's `cslope.analyse` and the command line (D-23):
 * the app's options for a new model (Morgenstern-Price, 30 slices, 1000 +
 * 500 trial surfaces, composite surfaces). The engine's own defaults
 * (`DEFAULT_ANALYSIS_OPTIONS`) are unchanged.
 */
export function publicDefaultOptions(): Partial<AnalysisOptions> {
  return wasm().public_default_options() as Partial<AnalysisOptions>;
}
