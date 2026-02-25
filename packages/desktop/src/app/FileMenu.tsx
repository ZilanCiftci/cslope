import { useEffect, useRef, useState, type ChangeEventHandler } from "react";
import { parseProjectFile, serializeProject } from "../store/persistence";
import { useAppStore } from "../store/app-store";
import { isElectron } from "../utils/is-electron";

interface Props {
  activeModelName?: string;
}

const ensureJsonName = (name: string) =>
  name.toLowerCase().endsWith(".json") ? name : `${name}.json`;

const stripJsonExt = (name: string) => name.replace(/\.json$/i, "");

export function FileMenu({ activeModelName }: Props) {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (!open) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Listen for native Electron menu events
  useEffect(() => {
    if (!isElectron) return;
    const onOpen = () => handleOpen();
    const onSave = () => runSave(false);
    const onSaveAs = () => runSave(true);
    window.ipcRenderer.on("menu:open", onOpen);
    window.ipcRenderer.on("menu:save", onSave);
    window.ipcRenderer.on("menu:saveAs", onSaveAs);
    return () => {
      window.ipcRenderer.off("menu:open", onOpen);
      window.ipcRenderer.off("menu:save", onSave);
      window.ipcRenderer.off("menu:saveAs", onSaveAs);
    };
  });

  const defaultBaseName = activeModelName?.trim() || "cslope-project";

  const triggerDownload = (json: string, name: string) => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const runSave = async (promptForName: boolean) => {
    const store = useAppStore.getState();
    store.saveCurrentModel();
    const snapshot = serializeProject(useAppStore.getState());
    const json = JSON.stringify(snapshot, null, 2);

    if (isElectron) {
      const saveFn = promptForName
        ? window.cslope.saveFileAs
        : window.cslope.saveFile;
      await saveFn(json);
      setOpen(false);
      return;
    }

    const suggested = fileName || defaultBaseName;
    const inputName = promptForName
      ? window.prompt("Save project as", suggested)
      : suggested;
    if (!inputName) return;

    const finalName = ensureJsonName(inputName.trim());
    triggerDownload(json, finalName);
    setFileName(stripJsonExt(finalName));
    setOpen(false);
  };

  const handleOpen = async () => {
    if (isElectron) {
      const contents = await window.cslope.openFile();
      if (!contents) return;
      try {
        const parsed = parseProjectFile(contents);
        useAppStore.getState().loadProject(parsed);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        window.alert(`Unable to open project: ${message}`);
      }
      setOpen(false);
      return;
    }

    const input = fileInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
    setOpen(false);
  };

  const handleFileChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseProjectFile(String(reader.result ?? ""));
        useAppStore.getState().loadProject(parsed);
        setFileName(stripJsonExt(file.name));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        window.alert(`Unable to open project: ${message}`);
      }
    };
    reader.readAsText(file);
  };

  const handleNew = () => {
    useAppStore.getState().newProject();
    setFileName("");
    setOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-8 px-3 rounded text-[12px] font-medium flex items-center gap-1"
        style={{
          color: "var(--color-vsc-text-muted)",
          background: open ? "var(--color-vsc-list-active)" : "transparent",
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        File
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <path d="M2 3l3 3.5L8 3z" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute mt-1 w-44 rounded shadow-lg py-1 text-[12px]"
          style={{
            background: "var(--color-vsc-panel)",
            border: "1px solid var(--color-vsc-border)",
            color: "var(--color-vsc-text)",
            zIndex: 60,
          }}
          role="menu"
        >
          <button
            className="w-full text-left px-3 py-2 hover:bg-[var(--color-vsc-list-hover)]"
            onClick={handleNew}
            role="menuitem"
          >
            New
          </button>
          <button
            className="w-full text-left px-3 py-2 hover:bg-[var(--color-vsc-list-hover)]"
            onClick={handleOpen}
            role="menuitem"
          >
            Open...
          </button>
          <div
            className="my-1"
            style={{ borderTop: "1px solid var(--color-vsc-border)" }}
          />
          <button
            className="w-full text-left px-3 py-2 hover:bg-[var(--color-vsc-list-hover)]"
            onClick={() => runSave(false)}
            role="menuitem"
          >
            Save
          </button>
          <button
            className="w-full text-left px-3 py-2 hover:bg-[var(--color-vsc-list-hover)]"
            onClick={() => runSave(true)}
            role="menuitem"
          >
            Save As...
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
