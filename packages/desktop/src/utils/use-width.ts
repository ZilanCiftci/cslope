import { useCallback, useRef, useState } from "react";

/**
 * The width of an element as it is laid out (`fallback` until it is known):
 * a chart drawn as wide as the window.
 */
export function useWidth(fallback: number) {
  const [width, setWidth] = useState(fallback);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    observer.current = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    observer.current.observe(el);
  }, []);
  return [ref, width] as const;
}
