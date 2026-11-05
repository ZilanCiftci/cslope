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
import {
  isProjectDirty,
  useAppStore,
} from "../../store/app-store";
import { isElectron } from "../../utils/is-electron";
import { fileTooLarge, MAX_PROJECT_FILE_BYTES } from "./file-limits";
import {
  buildProjectArchive,
  ensureCslpName,
  stripProjectExt,
  triggerBrowserDownload,
} from "./actions";
import { adoptProjectAssets, readProject } from "./cslp";
import {
  confirmUnsavedChanges,
  createdForSave,
  markProjectSaved,
  saveProjectInElectron,
  withUnsavedChangesCheck,
} from "./unsavedGuard";
import { projectThumbnail } from "./thumbnail";

export interface ProjectActions {
  /** Current project file-name (without `.cslp`). Empty for untitled. */
  fileName: string;

  /** Hidden `<input type="file">` ref for browser Open dialog. */
  fileInputRef: RefObject<HTMLInputElement | null>;

  /** Create a fresh, empty project (asks about unsaved changes first). */
  handleNew: () => void | Promise<void>;

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
  const [fileName, setFileNameState] = useState("");
  // The latest name also in a ref: a save right after another (Ctrl+S
  // after Save As) runs before React has rendered the new name.
  const fileNameRef = useRef("");
  const setFileName = (name: string) => {
    fileNameRef.current = name;
    setFileNameState(name);
  };
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── New ──────────────────────────────────────────────────────────

  const handleNew = () =>
    withUnsavedChangesCheck(() => {
      useAppStore.getState().newProject();
      useAppStore.temporal.getState().clear();
      setFileName("");
      if (isElectron) window.cslope.menuNew();
    });

  // ── Open ─────────────────────────────────────────────────────────

  const handleOpen = async () => {
    // Stay synchronous when there is nothing to save: a browser only opens
    // the file picker from within the click.
    if (
      isProjectDirty(useAppStore.getState()) &&
      !(await confirmUnsavedChanges())
    )
      return;
    if (isElectron) {
      try {
        const contents = await window.cslope.openFile();
        if (!contents) return;
        const read = await readProject(contents);
        adoptProjectAssets(read.assets);
        useAppStore.getState().loadProject(read.file);
        useAppStore.temporal.getState().clear();
        window.cslope.confirmFileOpened();
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
    if (isElectron) {
      await saveProjectInElectron();
      return;
    }
    const suggested = fileNameRef.current || defaultBaseName;
    await downloadProject(ensureCslpName(suggested));
  };

  /** Browser: offer the project as a .cslp download. */
  const downloadProject = async (finalName: string) => {
    useAppStore.getState().saveCurrentModel();
    const state = useAppStore.getState();
    const created = createdForSave(state);
    try {
      const bytes = await buildProjectArchive(state, { thumbnail: projectThumbnail, created });
      setFileName(stripProjectExt(finalName));
      triggerBrowserDownload(bytes, finalName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      window.alert(`Unable to save project: ${msg}`);
      return;
    }
    markProjectSaved(state, created);
  };

  // ── Save As ──────────────────────────────────────────────────────

  const handleSaveAs = async () => {
    if (isElectron) {
      await saveProjectInElectron(true);
      return;
    }
    const suggested = fileNameRef.current || defaultBaseName;
    const inputName = window.prompt("Save project as", suggested);
    if (!inputName?.trim()) return;
    await downloadProject(ensureCslpName(inputName));
  };

  // ── File change (browser <input> → read → load) ─────────────────

  const handleFileChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const tooLarge = fileTooLarge(file, MAX_PROJECT_FILE_BYTES);
    if (tooLarge) {
      window.alert(`Unable to open project: ${tooLarge}`);
      return;
    }
    // A .cslp archive, or a .json/.cslope project of an earlier version.
    void readFileBytes(file)
      .then(readProject)
      .then((read) => {
        adoptProjectAssets(read.assets);
        useAppStore.getState().loadProject(read.file);
        useAppStore.temporal.getState().clear();
        setFileName(stripProjectExt(file.name));
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Unknown error";
        window.alert(`Unable to open project: ${msg}`);
      });
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

/** The bytes of a file chosen in a browser file picker or dropped. */
export function readFileBytes(file: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsArrayBuffer(file);
  });
}
