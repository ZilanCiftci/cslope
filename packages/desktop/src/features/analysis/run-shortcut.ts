import { useEffect } from "react";

/** F5, or Ctrl+Enter (Cmd+Enter on a Mac): run the analysis. */
export function isRunShortcut(e: KeyboardEvent): boolean {
  if (e.altKey || e.shiftKey) return false;
  if (e.key === "F5") return !e.ctrlKey && !e.metaKey;
  return e.key === "Enter" && (e.ctrlKey || e.metaKey);
}

/** A field the user types into: its keys are not app shortcuts. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * Runs `run` on the Run shortcut, except while typing in a field or while a
 * modal dialog is open.  `run` decides itself whether a run can start.
 */
export function useRunShortcut(run: () => void): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isRunShortcut(e) || e.defaultPrevented || e.repeat) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [run]);
}
