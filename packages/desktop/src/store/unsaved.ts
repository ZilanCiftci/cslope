/**
 * Tracks whether the project has changes that are not saved to a file.
 *
 * The "content" of a project is what a save writes, minus state that is
 * cheap to regenerate or purely about the view: zoom/pan, the edit/result
 * mode, and analysis status and results.  Zooming or running an analysis
 * therefore does not count as an unsaved change.
 */
import type { AppState, ModelEntry } from "./types";

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
            customSearchPlanes: state.customSearchPlanes,
            customPlanesOnly: state.customPlanesOnly,
            options: state.options,
            analysisLimits: state.analysisLimits,
            resultViewSettings: state.resultViewSettings,
          }
        : m;
    const content: Record<string, unknown> = { ...entry };
    for (const key of VOLATILE_FIELDS) delete content[key];
    return content;
  });
  return JSON.stringify(models);
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
