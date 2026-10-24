/** Keys that move focus: after one of them the focus ring is wanted. */
const NAVIGATION_KEYS = new Set([
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/**
 * Records on <html data-focus-source> whether focus was last moved with the
 * pointer or the keyboard.  Chromium also shows the focus ring on a clicked
 * button as soon as any key is pressed (Escape, Ctrl+S); index.css hides the
 * ring until a navigation key is used.
 */
export function installFocusSource(doc: Document = document): () => void {
  const root = doc.documentElement;
  const set = (source: "pointer" | "keyboard") => {
    if (root.dataset.focusSource !== source) root.dataset.focusSource = source;
  };
  const onPointerDown = () => set("pointer");
  const onKeyDown = (e: KeyboardEvent) => {
    if (NAVIGATION_KEYS.has(e.key)) set("keyboard");
  };
  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("keydown", onKeyDown, true);
  return () => {
    doc.removeEventListener("pointerdown", onPointerDown, true);
    doc.removeEventListener("keydown", onKeyDown, true);
  };
}
