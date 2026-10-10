import { useEffect, useRef, type RefObject } from "react";

/** The wheel event fields the canvas wheel handlers use. */
export type CanvasWheelEvent = Pick<
  WheelEvent,
  | "clientX"
  | "clientY"
  | "deltaX"
  | "deltaY"
  | "ctrlKey"
  | "preventDefault"
  | "stopPropagation"
>;

/**
 * Attach a wheel handler that may call `preventDefault()`.
 *
 * React registers `onWheel` as a passive listener, where preventDefault
 * is ignored (and logged as an error by the browser), so page scrolling
 * and Ctrl+wheel page zoom were not actually suppressed.  A native
 * listener with `passive: false` is needed; it always calls the latest
 * handler.
 */
export function useNonPassiveWheel(
  ref: RefObject<HTMLElement | null>,
  handler: (e: CanvasWheelEvent) => void,
): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = (e: WheelEvent) => handlerRef.current(e);
    el.addEventListener("wheel", listener, { passive: false });
    return () => el.removeEventListener("wheel", listener);
  }, [ref]);
}
