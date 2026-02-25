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

  const defaultBaseName = activeModelName?.trim() || "cslope-project";

  // ── Browser-only download helper ──
  const triggerDownload = (json: string, name: string) => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Actions (work in both Electron and browser) ──

  const handleNew = () => {
    useAppStore.getState().newProject();
    useAppStore.temporal.getState().clear();
    setFileName("");
    setOpen(false);
    if (isElectron) window.cslope.menuNew();
  };

  const handleOpen = async () => {
    setOpen(false);
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
    const input = fileInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  };

  const handleSave = async () => {
    const store = useAppStore.getState();
    store.saveCurrentModel();
    const snapshot = serializeProject(useAppStore.getState());
    const json = JSON.stringify(snapshot, null, 2);

    if (isElectron) {
      await window.cslope.saveFile(json);
      setOpen(false);
      return;
    }
    const suggested = fileName || defaultBaseName;
    const finalName = ensureJsonName(suggested.trim());
    triggerDownload(json, finalName);
    setFileName(stripJsonExt(finalName));
    setOpen(false);
  };

  const handleSaveAs = async () => {
    const store = useAppStore.getState();
    store.saveCurrentModel();
    const snapshot = serializeProject(useAppStore.getState());
    const json = JSON.stringify(snapshot, null, 2);

    if (isElectron) {
      await window.cslope.saveFileAs(json);
      setOpen(false);
      return;
    }
    const suggested = fileName || defaultBaseName;
    const inputName = window.prompt("Save project as", suggested);
    if (!inputName) return;
    const finalName = ensureJsonName(inputName.trim());
    triggerDownload(json, finalName);
    setFileName(stripJsonExt(finalName));
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
        useAppStore.temporal.getState().clear();
        setFileName(stripJsonExt(file.name));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        window.alert(`Unable to open project: ${msg}`);
      }
    };
    reader.readAsText(file);
  };

  // ── Keyboard shortcuts (Ctrl+N/O/S/Shift+S) ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        handleNew();
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        void handleOpen();
      } else if (e.shiftKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        void handleSaveAs();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div
      className="relative"
      ref={menuRef}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-8 px-3 rounded text-[12px] font-medium flex items-center cursor-pointer"
        style={{
          color: "var(--color-vsc-text-muted)",
          background: open ? "var(--color-vsc-list-active)" : "transparent",
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        File
      </button>

      {open && (
        <div
          className="absolute left-0 mt-0.5 w-56 rounded shadow-lg py-1 text-[12px]"
          style={{
            background: "var(--color-vsc-panel)",
            border: "1px solid var(--color-vsc-border)",
            color: "var(--color-vsc-text)",
            zIndex: 60,
          }}
          role="menu"
        >
          <MenuItem label="New Project" shortcut="Ctrl+N" onClick={handleNew} />
          <MenuSep />
          <MenuItem
            label="Open Project…"
            shortcut="Ctrl+O"
            onClick={handleOpen}
          />
          <MenuSep />
          <MenuItem label="Save" shortcut="Ctrl+S" onClick={handleSave} />
          <MenuItem
            label="Save As…"
            shortcut="Ctrl+Shift+S"
            onClick={handleSaveAs}
          />
          {isElectron && (
            <>
              <MenuSep />
              <MenuItem label="Exit" onClick={() => window.cslope.close()} />
            </>
          )}
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

// ── Shared sub-components ──

function MenuItem({
  label,
  shortcut,
  onClick,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      className="w-full text-left px-3 py-1.5 hover:bg-[var(--color-vsc-list-hover)] flex items-center justify-between cursor-pointer"
      onClick={onClick}
      role="menuitem"
    >
      <span>{label}</span>
      {shortcut && (
        <span
          className="text-[11px] ml-6"
          style={{ color: "var(--color-vsc-text-muted)" }}
        >
          {shortcut}
        </span>
      )}
    </button>
  );
}

function MenuSep() {
  return (
    <div
      className="my-1 mx-2"
      style={{ borderTop: "1px solid var(--color-vsc-border)" }}
    />
  );
}
