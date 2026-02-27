import { useEffect, useRef, useState, type ChangeEventHandler } from "react";
import { useStore } from "zustand";
import { DEFAULT_MODEL_NAME } from "../constants";
import { parseProjectFile, serializeProject } from "../store/persistence";
import { useAppStore } from "../store/app-store";
import { RUN_RESET } from "../store/helpers";
import { isElectron } from "../utils/is-electron";

interface Props {
  theme: "dark" | "light";
  onToggleTheme: () => void;
  activeModelName?: string;
}

export function TitleBar({ theme, onToggleTheme, activeModelName }: Props) {
  const [maximized, setMaximized] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canUndo = useStore(
    useAppStore.temporal,
    (s) => s.pastStates.length > 0,
  );
  const canRedo = useStore(
    useAppStore.temporal,
    (s) => s.futureStates.length > 0,
  );

  useEffect(() => {
    if (!isElectron) return;
    // Get initial state
    void window.cslope.isMaximized().then(setMaximized);
    // Listen for changes
    const onMaxChange = (_e: unknown, isMax: unknown) =>
      setMaximized(Boolean(isMax));
    window.cslope.onMaximized(onMaxChange);
    return () => {
      window.cslope.offMaximized(onMaxChange);
    };
  }, []);

  const defaultBaseName = activeModelName?.trim() || "cslope-project";
  const ensureJsonName = (name: string) =>
    name.toLowerCase().endsWith(".json") ? name : `${name}.json`;

  const triggerDownload = (json: string, name: string) => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

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
    setFileName(finalName.replace(/\.json$/i, ""));
  };

  const handleUndo = () => {
    useAppStore.temporal.getState().resume();
    useAppStore.temporal.getState().undo();
    useAppStore.setState(RUN_RESET);
  };

  const handleRedo = () => {
    useAppStore.temporal.getState().resume();
    useAppStore.temporal.getState().redo();
    useAppStore.setState(RUN_RESET);
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
        setFileName(file.name.replace(/\.json$/i, ""));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        window.alert(`Unable to open project: ${msg}`);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div
      className="flex items-center h-9 shrink-0 relative z-30 select-none"
      style={
        {
          background: "var(--color-vsc-titlebar)",
          borderBottom: "1px solid var(--color-vsc-border)",
          WebkitAppRegion: "drag",
        } as React.CSSProperties
      }
    >
      {/* ── Left: logo + favorites ── */}
      <div
        className="flex items-center gap-1 px-2"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <img
          src="/mountain.svg"
          alt="cSlope"
          className="w-5 h-5 mr-1"
          draggable={false}
        />
        <div
          className="flex items-center gap-1 px-1.5 py-0.5 rounded"
          style={{
            background: "var(--color-vsc-tab-inactive)",
            border: "1px solid var(--color-vsc-border)",
          }}
        >
          <FavButton title="New project" onClick={handleNew}>
            <NewIcon />
          </FavButton>
          <FavButton title="Open project" onClick={handleOpen}>
            <OpenIcon />
          </FavButton>
          <FavButton title="Save" onClick={handleSave}>
            <SaveIcon />
          </FavButton>
          <div
            className="mx-1 h-4"
            style={{ borderLeft: "1px solid var(--color-vsc-border)" }}
          />
          <FavButton title="Undo" onClick={handleUndo} disabled={!canUndo}>
            <UndoIcon />
          </FavButton>
          <FavButton title="Redo" onClick={handleRedo} disabled={!canRedo}>
            <RedoIcon />
          </FavButton>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
      </div>

      {/* ── Center: project name ── */}
      <div className="flex-1 flex items-center justify-center pointer-events-none">
        <span
          className="text-[12px] px-2.5 py-0.5 rounded-full"
          style={{
            color: "var(--color-vsc-text-muted)",
          }}
        >
          {activeModelName ?? DEFAULT_MODEL_NAME} — cSlope
        </span>
      </div>

      {/* ── Right: theme toggle + window controls ── */}
      <div
        className="flex items-center"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          onClick={onToggleTheme}
          className="w-8 h-9 flex items-center justify-center cursor-pointer hover:bg-[var(--color-vsc-list-hover)]"
          style={{ color: "var(--color-vsc-text-muted)" }}
          title={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>

        {isElectron && (
          <>
            <button
              onClick={() => window.cslope.minimize()}
              className="w-12 h-9 flex items-center justify-center cursor-pointer hover:bg-[var(--color-vsc-list-hover)]"
              style={{ color: "var(--color-vsc-text-muted)" }}
              title="Minimize"
            >
              <MinimizeIcon />
            </button>
            <button
              onClick={() => window.cslope.maximize()}
              className="w-12 h-9 flex items-center justify-center cursor-pointer hover:bg-[var(--color-vsc-list-hover)]"
              style={{ color: "var(--color-vsc-text-muted)" }}
              title={maximized ? "Restore" : "Maximize"}
            >
              {maximized ? <RestoreIcon /> : <MaximizeIcon />}
            </button>
            <button
              onClick={() => window.cslope.close()}
              className="w-12 h-9 flex items-center justify-center cursor-pointer hover:bg-[#e81123]"
              style={{ color: "var(--color-vsc-text-muted)" }}
              title="Close"
            >
              <CloseIcon />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Quick action UI ──

function FavButton({
  title,
  onClick,
  disabled = false,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={disabled ? undefined : onClick}
      className="w-7 h-7 rounded flex items-center justify-center"
      style={{
        color: disabled
          ? "var(--color-vsc-text-muted)"
          : "var(--color-vsc-text-bright)",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

// ── SVG icons ──

function NewIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M12 18v-6M9 15h6" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7h6l2 2h10v10H3z" />
      <path d="M3 7V5a2 2 0 0 1 2-2h6l2 2h8" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21V13H7v8" />
      <path d="M7 3v5h8" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 14l-4-4 4-4" />
      <path d="M20 20a8 8 0 0 0-11-8H5" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 6l4 4-4 4" />
      <path d="M4 20a8 8 0 0 1 11-8h4" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M17.36 17.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M17.36 6.64l1.42-1.42" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
      <rect x="0" y="4.5" width="10" height="1" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    >
      <rect x="0.5" y="0.5" width="9" height="9" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    >
      <rect x="0.5" y="2.5" width="7" height="7" />
      <polyline points="2.5,2.5 2.5,0.5 9.5,0.5 9.5,7.5 7.5,7.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
      <path d="M1.41 0L5 3.59 8.59 0 10 1.41 6.41 5 10 8.59 8.59 10 5 6.41 1.41 10 0 8.59 3.59 5 0 1.41z" />
    </svg>
  );
}
