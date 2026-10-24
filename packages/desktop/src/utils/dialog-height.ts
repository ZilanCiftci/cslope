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
export function naturalDialogHeight(doc: Document, windowHeight: number): number | null {
  const body = doc.querySelector<HTMLElement>(".h-screen > .flex-1.overflow-y-auto");
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
