/**
 * The window height a dialog needs to show all of its content with neither
 * a scroll bar nor empty space below it.
 *
 * Dialog windows are a full-height column (`h-screen flex flex-col`) whose
 * one scrolling body (`flex-1 overflow-y-auto`) takes the space left by the
 * header and the Close button. The answer is the window height with the
 * body's own height swapped for the height of what is in it. Null when the
 * page doesn't have that layout.
 */
export const DIALOG_BODY_SELECTOR = ".h-screen > .flex-1.overflow-y-auto";

export function naturalDialogHeight(doc: Document, windowHeight: number): number | null {
  const body = doc.querySelector<HTMLElement>(DIALOG_BODY_SELECTOR);
  if (!body) return null;
  const top = body.getBoundingClientRect().top;
  let bottom = top;
  for (const child of Array.from(body.children)) {
    bottom = Math.max(bottom, child.getBoundingClientRect().bottom);
  }
  if (bottom <= top) return null;
  const padding = parseFloat(getComputedStyle(body).paddingBottom) || 0;
  const content = bottom - top + body.scrollTop + padding;
  return Math.ceil(windowHeight - body.clientHeight + content);
}

/**
 * How a dialog window's height follows its content:
 * - "follow": fitted when it opens and whenever its content changes size
 *   (lists whose rows are added or removed);
 * - "open": fitted only while it opens, then kept (Materials,
 *   Reinforcement: switching to a longer form scrolls instead of the
 *   window jumping);
 * - "grow": fitted while it opens, then only grows (Sensitivity,
 *   Probabilistic: the results appear below the inputs after a run).
 * Workspace windows (Results plot, Place drawing) keep their size and are
 * not fitted at all.
 */
export type DialogFit = "follow" | "open" | "grow";

/** How long a dialog counts as opening: its state arrives and lays out. */
export const DIALOG_OPENING_MS = 1500;

/** Whether to fit the window to `height`, given the height sent last (0: none yet). */
export function shouldFitDialog(mode: DialogFit, opening: boolean, height: number, sent: number): boolean {
  if (Math.abs(height - sent) <= 2) return false;
  if (opening || mode === "follow") return true;
  return mode === "grow" && height > sent;
}
