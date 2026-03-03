/**
 * Shared React hook that exposes all project-level file actions.
 *
 * Both `FileMenu` (ribbon) and `TitleBar` delegate to this hook so the
 * New / Open / Save / Save-As logic lives in exactly one place.
 */

import {
  useRef,
  useState,
  type ChangeEventHandler,
  type RefObject,
} from "react";
import { useAppStore } from "../../store/app-store";
import { isElectron } from "../../utils/is-electron";
import {
  buildProjectJson,
  ensureJsonName,
  parseProjectFile,
  stripJsonExt,
  triggerBrowserDownload,
} from "./actions";

export interface ProjectActions {
  /** Current project file-name (without `.json`). Empty for untitled. */
  fileName: string;

  /** Hidden `<input type="file">` ref for browser Open dialog. */
  fileInputRef: RefObject<HTMLInputElement | null>;

  /** Create a fresh, empty project. */
  handleNew: () => void;

  /** Open a project file (Electron dialog or browser file-picker). */
  handleOpen: () => Promise<void>;

  /** Save the project (Electron save or browser download). */
  handleSave: () => Promise<void>;

  /** Save the project under a new name. */
  handleSaveAs: () => Promise<void>;

  /** onChange handler for the hidden browser `<input type="file">`. */
  handleFileChange: ChangeEventHandler<HTMLInputElement>;
}

/**
 * Encapsulates all file-action logic that was previously duplicated across
 * `ribbon/FileMenu`, `TitleBar`, and `app/FileMenu`.
 *
 * @param defaultBaseName  Fallback file-name when the user hasn't specified
 *                         one yet (typically the active model name or
 *                         `"cslope-project"`).
 */
export function useProjectActions(defaultBaseName: string): ProjectActions {
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── New ──────────────────────────────────────────────────────────

  const handleNew = () => {
    useAppStore.getState().newProject();
    useAppStore.temporal.getState().clear();
    setFileName("");
    if (isElectron) window.cslope.menuNew();
  };

  // ── Open ─────────────────────────────────────────────────────────

  const handleOpen = async () => {
    if (isElectron) {
      const contents = await window.cslope.openFile();
      if (!contents) return;
      try {
        const parsed = parseProjectFile(contents);
        useAppStore.getState().loadProject(parsed);
        useAppStore.temporal.getState().clear();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        window.alert(`Unable to open project: ${msg}`);
      }
      return;
    }
    // Browser path – trigger the hidden file input.
    const input = fileInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  };

  // ── Save ─────────────────────────────────────────────────────────

  const handleSave = async () => {
    const store = useAppStore.getState();
    store.saveCurrentModel();
    const json = buildProjectJson(useAppStore.getState());

    if (isElectron) {
      await window.cslope.saveFile(json);
      return;
    }
    const suggested = fileName || defaultBaseName;
    const finalName = ensureJsonName(suggested.trim());
    triggerBrowserDownload(json, finalName);
    setFileName(stripJsonExt(finalName));
  };

  // ── Save As ──────────────────────────────────────────────────────

  const handleSaveAs = async () => {
    const store = useAppStore.getState();
    store.saveCurrentModel();
    const json = buildProjectJson(useAppStore.getState());

    if (isElectron) {
      await window.cslope.saveFileAs(json);
      return;
    }
    const suggested = fileName || defaultBaseName;
    const inputName = window.prompt("Save project as", suggested);
    if (!inputName) return;
    const finalName = ensureJsonName(inputName.trim());
    triggerBrowserDownload(json, finalName);
    setFileName(stripJsonExt(finalName));
  };

  // ── File change (browser <input> → parse → load) ────────────────

  const handleFileChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseProjectFile(String(reader.result ?? ""));
        useAppStore.getState().loadProject(parsed);
        useAppStore.temporal.getState().clear();
        setFileName(stripJsonExt(file.name));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        window.alert(`Unable to open project: ${msg}`);
      }
    };
    reader.readAsText(file);
  };

  return {
    fileName,
    fileInputRef,
    handleNew,
    handleOpen,
    handleSave,
    handleSaveAs,
    handleFileChange,
  };
}
