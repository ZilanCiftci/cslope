import { useEffect } from "react";
import { parseProjectFile } from "../../../store/persistence";
import { useAppStore } from "../../../store/app-store";
import { isElectron } from "../../../utils/is-electron";

/**
 * Allows dropping `.json` or `.cslope` project files onto the window.
 * Works in both Electron (using the native file path) and browser (using
 * the File API).
 */
export function useDragDrop() {
  useEffect(() => {
    const isProjectFile = (name: string) => /\.(json|cslope)$/i.test(name);

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const file = e.dataTransfer?.files?.[0];
      if (!file || !isProjectFile(file.name)) return;

      try {
        let contents: string | null = null;

        if (isElectron && "path" in file && typeof file.path === "string") {
          // Electron exposes the native file path on dropped File objects
          contents = await window.cslope.openFilePath(file.path);
        } else {
          // Browser fallback: read via FileReader
          contents = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ""));
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
          });
        }

        if (!contents) return;
        const parsed = parseProjectFile(contents);
        useAppStore.getState().loadProject(parsed);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        window.alert(`Unable to open project: ${msg}`);
      }
    };

    // Prevent the browser from navigating to the file on stray drops
    const blockDefault = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);
    window.addEventListener("dragleave", blockDefault);

    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
      window.removeEventListener("dragleave", blockDefault);
    };
  }, []);
}
