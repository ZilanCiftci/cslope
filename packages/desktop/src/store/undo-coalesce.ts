/**
 * One undo step per edit of a field, not per keystroke.
 *
 * A number field writes the store on every keystroke, so typing "0.5"
 * left three undo steps. Here a change that edits the same values as the
 * step just recorded, from the same edit, joins that step instead of
 * adding one (the step keeps the state from before the edit began):
 *
 * - in this window, while the same text field keeps the focus (focusing
 *   any element, the same one again too, starts a new edit);
 * - from a dialog window (`asDialogEdit`), whose focus this window does
 *   not see, while the changes follow each other within COALESCE_MS.
 *
 * Changes made in code (no text field focused) each stay a step of their
 * own, and an undo or redo in between always starts a new step.
 */

/** Longest pause between the changes of one edit from a dialog window (ms). */
export const COALESCE_MS = 2000;

/** At most this many changed values make one edit; more is a larger change. */
const MAX_PATHS = 8;

let dialogEdit = false;

/** Runs a change that a dialog window sent (an edit typed there). */
export function asDialogEdit<T>(apply: () => T): T {
  dialogEdit = true;
  try {
    return apply();
  } finally {
    dialogEdit = false;
  }
}

let focusSession = 0;
if (typeof document !== "undefined") {
  document.addEventListener("focusin", () => {
    focusSession += 1;
  }, true);
}

const TEXT_INPUT_TYPES = new Set(["", "text", "number", "search", "tel", "url", "email"]);

/** Whether a text field (where each keystroke is a change) has the focus in this window. */
function textFieldFocused(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type.toLowerCase());
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * The paths of the values that differ between two states, sorted and
 * joined; null for more than MAX_PATHS. Unchanged parts (the same
 * reference or the same content) are skipped; a missing value and
 * undefined count as the same.
 */
export function changedPaths(a: unknown, b: unknown): string | null {
  const out: string[] = [];
  const walk = (x: unknown, y: unknown, path: string): boolean => {
    if (Object.is(x, y)) return true;
    const objects = typeof x === "object" && x !== null && typeof y === "object" && y !== null;
    if (!objects || Array.isArray(x) !== Array.isArray(y) || (Array.isArray(x) && x.length !== (y as unknown[]).length)) {
      out.push(path);
      return out.length <= MAX_PATHS;
    }
    const xo = x as Record<string, unknown>;
    const yo = y as Record<string, unknown>;
    for (const key of new Set([...Object.keys(xo), ...Object.keys(yo)])) {
      if (!walk(xo[key], yo[key], path ? `${path}.${key}` : key)) return false;
    }
    return true;
  };
  return walk(a, b, "") ? out.sort().join("\n") : null;
}

interface TemporalView {
  pastStates: unknown[];
  futureStates: unknown[];
}

type HandleSet<S> = (pastState: S, replace: unknown, currentState: S, deltaState?: unknown) => void;

/**
 * zundo's `handleSet` option: records a step as zundo does, except a
 * change that continues the edit of the step just recorded.
 */
export function coalescingHandleSet<S>(temporal: () => TemporalView, now: () => number = () => Date.now()) {
  let last: { entry: unknown; key: string; paths: string; at: number } | null = null;
  return (handleSet: HandleSet<S>): HandleSet<S> =>
    (pastState, replace, currentState, deltaState) => {
      const key = dialogEdit ? "dialog" : textFieldFocused() ? `field:${focusSession}` : null;
      const paths = key ? changedPaths(pastState, currentState) : null;
      const t = now();
      const history = temporal();
      if (
        key &&
        paths &&
        last &&
        last.key === key &&
        last.paths === paths &&
        last.entry === history.pastStates[history.pastStates.length - 1] &&
        history.futureStates.length === 0 &&
        (key !== "dialog" || t - last.at <= COALESCE_MS)
      ) {
        last.at = t;
        return;
      }
      handleSet(pastState, replace, currentState, deltaState);
      const after = temporal().pastStates;
      last = key && paths ? { entry: after[after.length - 1], key, paths, at: t } : null;
    };
}
