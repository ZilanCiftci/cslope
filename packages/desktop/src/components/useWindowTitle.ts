import { useEffect, useState } from "react";
import { isProjectDirty, onProjectMarkedClean, useAppStore } from "../store/app-store";
import { isElectron } from "../utils/is-electron";

/** How long the title waits for edits to settle before it compares the project with the saved one (ms). */
const DIRTY_CHECK_MS = 250;

/**
 * The window's title: the project file's name ("Untitled" before it is
 * saved), marked with "*" while it has unsaved changes, as Windows
 * programs do.
 */
export function windowTitleText(fileName: string | null, dirty: boolean): string {
  return `${dirty ? "*" : ""}${fileName ?? "Untitled"} — cSlope`;
}

/** Whether the project has unsaved changes, checked shortly after each change (the check compares the whole project). */
function useProjectDirty(): boolean {
  const [dirty, setDirty] = useState(() => isProjectDirty(useAppStore.getState()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      timer = null;
      setDirty(isProjectDirty(useAppStore.getState()));
    };
    const schedule = () => {
      if (timer === null) timer = setTimeout(check, DIRTY_CHECK_MS);
    };
    const unsubscribeStore = useAppStore.subscribe(schedule);
    // Saved: no edit follows, so check at once.
    const unsubscribeClean = onProjectMarkedClean(() => {
      if (timer !== null) clearTimeout(timer);
      check();
    });
    return () => {
      unsubscribeStore();
      unsubscribeClean();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
  return dirty;
}

/**
 * The title of the main window, also set as the document's (and so the
 * operating system's) title: the main process names the project file.
 */
export function useWindowTitle(): string {
  const [fileName, setFileName] = useState<string | null>(null);
  const dirty = useProjectDirty();
  useEffect(() => {
    if (!isElectron) return;
    return window.cslope.onFileNameChanged((_event, name) => {
      setFileName(typeof name === "string" && name !== "" ? name : null);
    });
  }, []);
  const title = windowTitleText(fileName, dirty);
  useEffect(() => {
    document.title = title;
  }, [title]);
  return title;
}
