import { useEffect } from "react";
import { useAppStore } from "../../../store/app-store";
import { isElectron } from "../../../utils/is-electron";
import { confirmUnsavedChanges } from "../../project/unsavedGuard";
import { adoptProjectAssets, isProjectFileName, readProject } from "../../project/cslp";
import { readFileBytes } from "../../project/useProjectActions";

/**
 * Load a project file read from outside the File menu (dropped on the
 * window, or opened by double-click / on the command line): parsed first,
 * then unsaved changes are dealt with, then it replaces the project. In
 * the desktop app the file then becomes the save target.
 */
async function openProjectBytes(bytes: Uint8Array | null): Promise<void> {
  try {
    if (!bytes) return;
    const read = await readProject(bytes);
    if (!(await confirmUnsavedChanges())) return;
    adoptProjectAssets(read.assets);
    useAppStore.getState().loadProject(read.file);
    useAppStore.temporal.getState().clear();
    if (isElectron) window.cslope.confirmFileOpened();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    window.alert(`Unable to open project: ${msg}`);
  }
}

/**
 * Allows dropping project files (.cslp, and .json or .cslope from earlier
 * versions) onto the window. Works in both Electron (using the native file
 * path) and browser (using the File API). In Electron it also opens the
 * project file cSlope was started with (double-click on a .cslp file), and
 * one passed to it later, while it runs.
 */
export function useDragDrop() {
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      // A drag an element in the window took (a row being reordered) keeps
      // its own drop effect: "copy" here would refuse its "move" drop.
      if (e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
    };

    const handleDrop = async (e: DragEvent) => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();

      const file = e.dataTransfer?.files?.[0];
      if (!file || !isProjectFileName(file.name)) return;

      let bytes: Uint8Array | null;
      try {
        // Electron: read by the main process from the native path (then a
        // save writes back to that file). Browser: read via FileReader.
        bytes = isElectron ? await window.cslope.openDroppedFile(file) : await readFileBytes(file);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        window.alert(`Unable to open project: ${msg}`);
        return;
      }
      await openProjectBytes(bytes);
    };

    // Prevent the browser from navigating to the file on stray drops
    const blockDefault = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);
    window.addEventListener("dragleave", blockDefault);

    // A project file given to the app (on launch or while it runs): the
    // main process holds its path and reads it when asked.
    let unsubscribeOpenRequests: (() => void) | undefined;
    if (isElectron && typeof window.cslope.onOpenFileRequested === "function") {
      const openRequested = () => {
        void window.cslope.openRequestedFile().then(openProjectBytes, (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Unknown error";
          window.alert(`Unable to open project: ${msg}`);
        });
      };
      unsubscribeOpenRequests = window.cslope.onOpenFileRequested(openRequested);
      // One may be waiting since launch.
      openRequested();
    }

    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
      window.removeEventListener("dragleave", blockDefault);
      unsubscribeOpenRequests?.();
    };
  }, []);
}
