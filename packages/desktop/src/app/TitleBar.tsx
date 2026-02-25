import { useEffect, useState } from "react";
import { FileMenu } from "./FileMenu";
import { HelpMenu } from "./HelpMenu";
import { isElectron } from "../utils/is-electron";

interface Props {
  theme: "dark" | "light";
  onToggleTheme: () => void;
  activeModelName?: string;
}

export function TitleBar({ theme, onToggleTheme, activeModelName }: Props) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isElectron) return;
    // Get initial state
    void window.cslope.isMaximized().then(setMaximized);
    // Listen for changes
    const onMaxChange = (_e: unknown, isMax: unknown) =>
      setMaximized(Boolean(isMax));
    window.ipcRenderer.on("window:maximized", onMaxChange);
    return () => {
      window.ipcRenderer.off("window:maximized", onMaxChange);
    };
  }, []);

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
      {/* ── Left: logo + menus ── */}
      <div
        className="flex items-center gap-1 px-2"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold mr-1"
          style={{
            background: "var(--color-vsc-accent)",
            color: "#fff",
          }}
        >
          cS
        </div>
        <FileMenu activeModelName={activeModelName} />
        <HelpMenu />
      </div>

      {/* ── Center: project name ── */}
      <div className="flex-1 flex items-center justify-center pointer-events-none">
        <span
          className="text-[12px] px-2.5 py-0.5 rounded-full"
          style={{
            color: "var(--color-vsc-text-muted)",
          }}
        >
          {activeModelName ?? "Untitled"} — cSlope
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

// ── SVG icons ──

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
