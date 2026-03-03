import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { DEFAULT_MODEL_NAME } from "../constants";
import { useAppStore, performUndo, performRedo } from "../store/app-store";
import { isElectron } from "../utils/is-electron";
import { useProjectActions } from "../features/project/useProjectActions";
import { NewIcon, OpenIcon, SaveIcon } from "./icons/FileActionIcons";
import { UndoIcon, RedoIcon } from "./icons/EditIcons";
import { SunIcon, MoonIcon } from "./icons/ThemeIcons";
import {
  MinimizeIcon,
  MaximizeIcon,
  RestoreIcon,
  CloseIcon,
} from "./icons/WindowIcons";

interface Props {
  theme: "dark" | "light";
  onToggleTheme: () => void;
  activeModelName?: string;
}

export function TitleBar({ theme, onToggleTheme, activeModelName }: Props) {
  const [maximized, setMaximized] = useState(false);

  const defaultBaseName = activeModelName?.trim() || "cslope-project";
  const { fileInputRef, handleNew, handleOpen, handleSave, handleFileChange } =
    useProjectActions(defaultBaseName);

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

  const handleUndo = () => performUndo();
  const handleRedo = () => performRedo();

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
            <NewIcon size={18} />
          </FavButton>
          <FavButton title="Open project" onClick={handleOpen}>
            <OpenIcon size={18} />
          </FavButton>
          <FavButton title="Save" onClick={handleSave}>
            <SaveIcon size={18} />
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
