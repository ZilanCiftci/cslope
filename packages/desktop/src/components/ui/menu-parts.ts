import type React from "react";
import { useEffect, useLayoutEffect, useRef } from "react";

/** The shared parts of the app's menus (see Menu.tsx). */

/** The stacking level of a menu over the canvas and its rulers, under dialogs. */
export const MENU_Z = "z-[100]";

/** The frame of a menu or of a dropdown panel of choices (no role of its own). */
export const MENU_FRAME_CLASS = "py-1 rounded-xs text-[12px] whitespace-nowrap";
export const MENU_FRAME_STYLE: React.CSSProperties = {
  background: "var(--color-vsc-input-bg)",
  border: "1px solid var(--color-vsc-border)",
  boxShadow: "var(--color-vsc-shadow-float)",
  color: "var(--color-vsc-text)",
};

/**
 * Closes an open menu on Escape, on a press outside `refs` (the menu and
 * the button that opens it) and when the window loses focus.
 */
export function useMenuDismiss(
  open: boolean,
  refs: React.RefObject<HTMLElement | null>[],
  onClose: () => void,
) {
  const latest = useRef({ refs, onClose });
  useLayoutEffect(() => {
    latest.current = { refs, onClose };
  });
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (!latest.current.refs.some((r) => r.current?.contains(t))) latest.current.onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") latest.current.onClose();
    };
    const blur = () => latest.current.onClose();
    // Capture: before the canvas, which keeps its presses to itself.
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("mousedown", outside, true);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("mousedown", outside, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", blur);
    };
  }, [open]);
}
