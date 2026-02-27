import { useEffect, useRef, useState, type ChangeEventHandler } from "react";
import { createPortal } from "react-dom";
import { parseProjectFile, serializeProject } from "../../../store/persistence";
import { useAppStore } from "../../../store/app-store";
import { isElectron } from "../../../utils/is-electron";
import { RibbonGroup, RibbonButton, RibbonSep } from "./RibbonParts";

interface Props {
  activeModelName?: string;
  isOpen: boolean;
  onActivate: () => void;
  panelHost: HTMLElement | null;
}

const ensureJsonName = (name: string) =>
  name.toLowerCase().endsWith(".json") ? name : `${name}.json`;

const stripJsonExt = (name: string) => name.replace(/\.json$/i, "");

export function FileMenu({
  activeModelName,
  isOpen,
  onActivate,
  panelHost,
}: Props) {
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    if (isElectron) window.cslope.menuNew();
  };

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
      return;
    }
    const suggested = fileName || defaultBaseName;
    const finalName = ensureJsonName(suggested.trim());
    triggerDownload(json, finalName);
    setFileName(stripJsonExt(finalName));
  };

  const handleSaveAs = async () => {
    const store = useAppStore.getState();
    store.saveCurrentModel();
    const snapshot = serializeProject(useAppStore.getState());
    const json = JSON.stringify(snapshot, null, 2);

    if (isElectron) {
      await window.cslope.saveFileAs(json);
      return;
    }
    const suggested = fileName || defaultBaseName;
    const inputName = window.prompt("Save project as", suggested);
    if (!inputName) return;
    const finalName = ensureJsonName(inputName.trim());
    triggerDownload(json, finalName);
    setFileName(stripJsonExt(finalName));
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
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <button
        onClick={onActivate}
        className="h-9 px-4 text-[12px] font-medium flex items-center cursor-pointer relative"
        style={{
          color: isOpen
            ? "var(--color-vsc-text-bright)"
            : "var(--color-vsc-text-muted)",
          background: isOpen ? "var(--color-vsc-tab-active)" : "transparent",
        }}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        File
        {isOpen && (
          <div
            className="absolute bottom-0 left-0 right-0 h-0.5"
            style={{ background: "var(--color-vsc-accent)" }}
          />
        )}
      </button>

      {isOpen &&
        panelHost &&
        createPortal(
          <div className="h-full flex items-center gap-0" role="menu">
            <RibbonGroup label="Project">
              <RibbonButton
                icon={<NewIcon />}
                label="New"
                shortcut="Ctrl+N"
                onClick={handleNew}
              />
              <RibbonButton
                icon={<OpenIcon />}
                label="Open"
                shortcut="Ctrl+O"
                onClick={handleOpen}
              />
            </RibbonGroup>
            <RibbonSep />
            <RibbonGroup label="Save">
              <RibbonButton
                icon={<SaveIcon />}
                label="Save"
                shortcut="Ctrl+S"
                onClick={handleSave}
              />
              <RibbonButton
                icon={<SaveAsIcon />}
                label="Save As"
                shortcut="Ctrl+Shift+S"
                onClick={handleSaveAs}
              />
            </RibbonGroup>
            {isElectron && (
              <>
                <RibbonSep />
                <RibbonGroup label="">
                  <RibbonButton
                    icon={<ExitIcon />}
                    label="Exit"
                    onClick={() => window.cslope.close()}
                  />
                </RibbonGroup>
              </>
            )}
          </div>,
          panelHost,
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

// ── Icons ──

function NewIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
        fill="#e3edfa"
        stroke="#4a90d9"
        strokeWidth="1.5"
      />
      <path d="M14 2v6h6" fill="#c6daef" stroke="#4a90d9" strokeWidth="1.5" />
      <path
        d="M12 18v-5M9.5 15.5h5"
        stroke="#43a047"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M2 8h7l2 2h11v10H2V8z"
        fill="#fdd835"
        stroke="#f9a825"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M2 8V6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v0"
        stroke="#f9a825"
        strokeWidth="1.5"
        fill="#fce88a"
      />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"
        fill="#5c95d6"
        stroke="#3b6ea5"
        strokeWidth="1.5"
      />
      <rect x="7" y="13" width="10" height="8" rx="1" fill="#e8f0fe" />
      <rect x="8" y="3" width="7" height="5" rx="0.5" fill="#b7d4f5" />
    </svg>
  );
}

function SaveAsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M17 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2z"
        fill="#5c95d6"
        stroke="#3b6ea5"
        strokeWidth="1.5"
      />
      <rect x="7" y="13" width="8" height="8" rx="1" fill="#e8f0fe" />
      <rect x="8" y="3" width="6" height="5" rx="0.5" fill="#b7d4f5" />
      <path
        d="M18 14l-5 5M16.5 15.5l2 2"
        stroke="#e8a735"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="20" cy="13" r="1.5" fill="#e8a735" />
    </svg>
  );
}

function ExitIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
        stroke="#78909c"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="16 17 21 12 16 7"
        stroke="#e53935"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="21"
        y1="12"
        x2="9"
        y2="12"
        stroke="#e53935"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
