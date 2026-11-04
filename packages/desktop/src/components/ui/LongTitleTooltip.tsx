import { useEffect, useRef, useState } from "react";

/** Titles at least this long get the app's tooltip instead of the system's. */
export const LONG_TITLE = 60;
/** Delay before the tooltip shows, like the system's. */
const DELAY_MS = 450;
const MAX_WIDTH = 340;
const MARGIN = 8;

/**
 * The app's tooltip for long `title` texts. The system draws a title as one
 * line as wide as the screen allows (on Windows far outside the window), so
 * while the pointer rests on an element whose title is long, its title is
 * moved aside and shown here instead: wrapped, at most 340 px wide and kept
 * inside the window. Short titles keep the system tooltip. The title comes
 * back when the pointer leaves, so the markup and tests see it as written.
 */
export function LongTitleTooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let owner: HTMLElement | null = null;
    let timer: number | undefined;
    let pointer = { x: 0, y: 0 };

    const release = () => {
      window.clearTimeout(timer);
      if (owner?.dataset.longTitle !== undefined) {
        owner.setAttribute("title", owner.dataset.longTitle);
        delete owner.dataset.longTitle;
      }
      owner = null;
      setTip(null);
    };

    const onOver = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const el = target?.closest<HTMLElement>("[title]") ?? null;
      if (el === owner) return;
      release();
      const text = el?.getAttribute("title") ?? "";
      if (!el || text.length < LONG_TITLE) return;
      owner = el;
      el.dataset.longTitle = text;
      el.removeAttribute("title");
      pointer = { x: e.clientX, y: e.clientY };
      timer = window.setTimeout(() => setTip({ text, x: pointer.x, y: pointer.y }), DELAY_MS);
    };
    const onMove = (e: MouseEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
    };
    const onOut = (e: MouseEvent) => {
      const next = e.relatedTarget instanceof Node ? e.relatedTarget : null;
      if (owner && (!next || !owner.contains(next))) release();
    };

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseout", onOut);
    document.addEventListener("mousedown", release, true);
    document.addEventListener("keydown", release, true);
    window.addEventListener("blur", release);
    window.addEventListener("scroll", release, true);
    return () => {
      release();
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("mousedown", release, true);
      document.removeEventListener("keydown", release, true);
      window.removeEventListener("blur", release);
      window.removeEventListener("scroll", release, true);
    };
  }, []);

  // Below the pointer, moved left or above when it would leave the window.
  useEffect(() => {
    if (!tip || !boxRef.current) {
      setPos(null);
      return;
    }
    const { width, height } = boxRef.current.getBoundingClientRect();
    let left = tip.x + 4;
    let top = tip.y + 18;
    if (left + width > window.innerWidth - MARGIN) left = window.innerWidth - MARGIN - width;
    if (top + height > window.innerHeight - MARGIN) top = tip.y - height - 8;
    setPos({ left: Math.max(MARGIN, left), top: Math.max(MARGIN, top) });
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={boxRef}
      role="tooltip"
      className="fixed z-[1000] pointer-events-none rounded px-2 py-1.5 text-[12px] leading-snug shadow-lg"
      style={{
        maxWidth: MAX_WIDTH,
        whiteSpace: "pre-line",
        left: pos?.left ?? tip.x,
        top: pos?.top ?? tip.y,
        visibility: pos ? "visible" : "hidden",
        background: "var(--color-vsc-bg)",
        color: "var(--color-vsc-text)",
        border: "1px solid var(--color-vsc-border)",
      }}
    >
      {tip.text}
    </div>
  );
}
