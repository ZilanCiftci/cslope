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
  // The body's real height: its clientHeight is rounded, and a body that
  // starts at a fractional y (header text line heights) is half a pixel off.
  const { top, height } = body.getBoundingClientRect();
  let bottom = top;
  for (const child of Array.from(body.children)) {
    bottom = Math.max(bottom, child.getBoundingClientRect().bottom);
  }
  if (bottom <= top) return null;
  const padding = parseFloat(getComputedStyle(body).paddingBottom) || 0;
  let content = bottom - top + body.scrollTop + padding;
  // Overflowing by a pixel or more: at least what it scrolls. (scrollHeight
  // is rounded and never less than the rounded body height, so compare it
  // with that; a fraction of a pixel is in the children's boxes above.)
  if (body.scrollHeight > Math.ceil(height)) content = Math.max(content, body.scrollHeight);
  return Math.ceil(windowHeight - height + content);
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
  // (a little taller than fitted always fits: else a scroll bar for a pixel or two)
  if (height <= sent && sent - height <= 2) return false;
  if (opening || mode === "follow") return true;
  return mode === "grow" && height > sent;
}
