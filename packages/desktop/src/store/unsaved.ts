/**
 * Tracks whether the project has changes that are not saved to a file.
 *
 * The "content" of a project is what a save writes, minus state that is
 * cheap to regenerate or purely about the view: zoom/pan, the edit/result
 * mode, and analysis status and results.  Zooming or running an analysis
 * therefore does not count as an unsaved change.
 */
import type { AppState, ModelEntry, ResultViewSettings } from "./types";

/**
 * Result view settings without the zoom and pan of the paper on screen:
 * how the user looks at the paper, not what is on it.
 */
export function withoutPaperViewport(settings: ResultViewSettings): ResultViewSettings {
  const paperFrame = { ...settings.paperFrame };
  delete paperFrame.zoom;
  delete paperFrame.offsetX;
  delete paperFrame.offsetY;
  return { ...settings, paperFrame };
}

/** Model entry fields that do not make a project "unsaved". */
const VOLATILE_FIELDS = [
  "editViewOffset",
  "editViewScale",
  "resultViewOffset",
  "resultViewScale",
  "viewOffset",
  "viewScale",
  "runState",
  "progress",
  "result",
  "errorMessage",
  "mode",
] as const satisfies readonly (keyof ModelEntry)[];

let cleanSignature: string | null = null;

/** Signature of the saved content of the project in `state`. */
export function projectContentSignature(state: AppState): string {
  const models = state.models.map((m) => {
    // The active model's latest edits live in the flat state.
    const entry: ModelEntry =
      m.id === state.activeModelId
        ? {
            ...m,
            orientation: state.orientation,
            projectInfo: state.projectInfo,
            coordinates: state.coordinates,
            coordinateExpressions: state.coordinateExpressions,
            parameters: state.parameters,
            materials: state.materials,
            materialBoundaries: state.materialBoundaries,
            regionMaterials: state.regionMaterials,
            piezometricLine: state.piezometricLine,
            udls: state.udls,
            lineLoads: state.lineLoads,
            reinforcements: state.reinforcements,
            piles: state.piles,
            customSearchPlanes: state.customSearchPlanes,
            customPlanesOnly: state.customPlanesOnly,
            blockSearchObjects: state.blockSearchObjects,
            options: state.options,
            analysisLimits: state.analysisLimits,
            resultViewSettings: state.resultViewSettings,
          }
        : m;
    // Optional arrays are absent in older files but present in the flat
    // state, so they compare as empty.
    const content: Record<string, unknown> = {
      ...entry,
      parameters: entry.parameters ?? [],
      coordinateExpressions: entry.coordinateExpressions ?? [],
      reinforcements: entry.reinforcements ?? [],
      piles: entry.piles ?? [],
      blockSearchObjects: entry.blockSearchObjects ?? [],
      ...(entry.resultViewSettings ? { resultViewSettings: withoutPaperViewport(entry.resultViewSettings) } : {}),
    };
    for (const key of VOLATILE_FIELDS) delete content[key];
    return content;
  });
  // Keys in a fixed order: writing a model back (switching models)
  // rebuilds its object in another key order with the same content.
  return JSON.stringify(models, (_key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, (value as Record<string, unknown>)[k]]))
      : value,
  );
}

/** Record the project in `state` as saved (after open, new or save). */
export function markProjectClean(state: AppState): void {
  cleanSignature = projectContentSignature(state);
}

/** True when the project in `state` differs from the last saved content. */
export function isProjectDirty(state: AppState): boolean {
  return (
    cleanSignature !== null && projectContentSignature(state) !== cleanSignature
  );
}
