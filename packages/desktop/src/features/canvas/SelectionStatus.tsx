import { useAppStore } from "../../store/app-store";
import { canvasObjectLabel, canvasPointLabel, isObjectLocked } from "../../store/canvas-selection";

const SEP = <span style={{ color: "var(--color-vsc-border)" }}>|</span>;

/**
 * The edit canvas's part of the status bar: what is selected ("Selected:
 * Water line 1 · point 2"), how many objects a repeated click cycles
 * through, whether it is locked (with a button that unlocks it), and, for
 * an imported model, that its geometry is locked, with a button that
 * unlocks it.
 */
export function SelectionStatus() {
  const mode = useAppStore((s) => s.mode);
  const sel = useAppStore((s) => s.canvasSelection);
  const cycle = useAppStore((s) => s.canvasSelectionCycle);
  const locks = useAppStore((s) => s.locks);
  // the label follows renames and renumbering
  const label = useAppStore((s) => (s.canvasSelection ? canvasObjectLabel(s, s.canvasSelection.object) : null));
  const unlockGeometry = useAppStore((s) => s.unlockGeometry);
  const setObjectLocked = useAppStore((s) => s.setObjectLocked);
  if (mode !== "edit") return null;
  const importedLocked = !!locks.fromImport && (!!locks.exterior || (locks.boundaries?.length ?? 0) > 0);
  if (!sel && !importedLocked) return null;
  const locked = sel ? isObjectLocked(locks, sel.object) : false;
  return (
    <>
      {sel && label && (
        <>
          {SEP}
          <span data-testid="status-selection" className="truncate" title="Escape or a click on empty canvas clears the selection">
            Selected: {label}
            {sel.point !== null && ` · ${canvasPointLabel(sel.point)}`}
            {cycle && cycle.count > 1 && ` (${cycle.position} of ${cycle.count} under the pointer)`}
            {locked && " · locked"}
          </span>
          {locked && (
            <button
              type="button"
              onClick={() => setObjectLocked(sel.object, false)}
              aria-label={`Unlock ${label}`}
              className="cursor-pointer hover:underline font-medium whitespace-nowrap"
              style={{ color: "var(--color-vsc-link)" }}
              title={`Unlock ${label}, so it can be selected and moved on the canvas`}
            >
              Unlock
            </button>
          )}
        </>
      )}
      {importedLocked && (
        <>
          {SEP}
          <span data-testid="status-imported-lock" className="flex items-center gap-1 whitespace-nowrap">
            Geometry is locked (imported) ·
            <button
              type="button"
              onClick={() => unlockGeometry()}
              className="cursor-pointer hover:underline font-medium"
              style={{ color: "var(--color-vsc-link)" }}
              title="Unlock the exterior boundary and the material boundaries, so their points can be dragged"
            >
              Unlock
            </button>
          </span>
        </>
      )}
    </>
  );
}
