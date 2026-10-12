import { useEffect, useRef } from "react";

/** Calls `close` when Escape is pressed while `active` (an open menu). */
export function useEscape(active: boolean, close: () => void) {
  // The latest callback, so that callers need not memoise it.
  const latest = useRef(close);
  useEffect(() => {
    latest.current = close;
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") latest.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active]);
}
