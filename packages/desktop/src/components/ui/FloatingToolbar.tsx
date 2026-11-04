import { useState, useRef, useCallback, useEffect } from "react";
import type { AnalysisRunState, CanvasToolbarState } from "../../store/types";
import { EditModeIcon, ResultsModeIcon } from "../icons/ModeIcons";
import {
  FitIcon,
  ZoomInIcon,
  ZoomOutIcon,
  ZoomBoxIcon,
  PanIcon,
} from "../icons/ViewIcons";

// ── Undo / Redo icons (small, monochrome) ───────────────────────────

function UndoIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  );
}

function RedoIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
    </svg>
  );
}

// ── Props ────────────────────────────────────────────────────────────

export interface FloatingToolbarProps {
  mode: "edit" | "result";
  setMode: (m: "edit" | "result") => void;
  runState: AnalysisRunState;
  hasResult: boolean;
  onRun: () => void;
  onCancel: () => void;
  onRunAll: () => void;
  onReset: () => void;
  onResetAll: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canvasToolbar: CanvasToolbarState | null;
}

// ── Component ────────────────────────────────────────────────────────

export function FloatingToolbar({
  mode,
  setMode,
  runState,
  hasResult,
  onRun,
  onCancel,
  onRunAll,
  onReset,
  onResetAll,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  canvasToolbar,
}: FloatingToolbarProps) {
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const runMenuRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // ── Auto-fade after 3 s of no pointer hover ────────────────────────
  const [faded, setFaded] = useState(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const resetFadeTimer = useCallback(() => {
    setFaded(false);
    clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => setFaded(true), 3000);
  }, []);

  // Start the initial fade timer on mount
  useEffect(() => {
    clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => setFaded(true), 3000);
    return () => clearTimeout(fadeTimerRef.current);
  }, []);

  // ── Icon-only collapse when canvas is narrow ───────────────────────
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const el = toolbarRef.current?.parentElement;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCompact(entry.contentRect.width < 600);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Close run dropdown on outside click
  useEffect(() => {
    if (!runMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        runMenuRef.current &&
        !runMenuRef.current.contains(e.target as Node)
      ) {
        setRunMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [runMenuOpen]);

  const handleRunClick = useCallback(() => {
    if (runState === "running") {
      onCancel();
    } else {
      onRun();
    }
  }, [runState, onRun, onCancel]);

  const runColor =
    runState === "running"
      ? "var(--color-vsc-error, #f44747)"
      : "var(--color-vsc-success)";

  const zoomPresets = [25, 50, 75, 100, 125, 150, 200, 300, 400];
  const currentZoom = canvasToolbar?.zoomPercent ?? 100;
  const selectedPreset = zoomPresets.reduce((best, cur) =>
    Math.abs(cur - currentZoom) < Math.abs(best - currentZoom) ? cur : best,
  );

  return (
    <div
      ref={toolbarRef}
      className="absolute bottom-10 left-1/2 -translate-x-1/2 z-30 pointer-events-none"
      role="toolbar"
      aria-label="Floating toolbar"
      style={{
        opacity: faded ? 0.7 : 1,
        transition: "opacity 0.4s ease",
      }}
      onPointerEnter={() => {
        setFaded(false);
        clearTimeout(fadeTimerRef.current);
      }}
      onPointerLeave={resetFadeTimer}
    >
      <div
        className="pointer-events-auto flex items-center gap-0 rounded-xs shadow-md px-0.5 h-8"
        style={{
          background: "var(--color-vsc-sidebar)",
          border: "1px solid var(--color-vsc-border)",
        }}
      >
        {/* ── Mode Toggle ─────────────────────────────────── */}
        <div className="flex items-center gap-0.5 px-1">
          <ToolbarButton
            icon={<EditModeIcon size={16} />}
            label="Edit"
            showLabel={!compact}
            active={mode === "edit"}
            onClick={() => setMode("edit")}
          />
          <ToolbarButton
            icon={<ResultsModeIcon size={16} />}
            label="Results"
            showLabel={!compact}
            active={mode === "result"}
            disabled={!hasResult}
            onClick={() => {
              if (hasResult) setMode("result");
            }}
          />
        </div>

        <Divider />

        {/* ── Run Group ───────────────────────────────────── */}
        <div className="flex items-center gap-0.5 px-1" ref={runMenuRef}>
          <button
            onClick={handleRunClick}
            className="h-6 px-2 rounded-xs flex items-center gap-1.5 text-[12px] font-medium hover:brightness-110"
            style={{
              background: `color-mix(in srgb, ${runColor} 12%, transparent)`,
              border: `1px solid color-mix(in srgb, ${runColor} 45%, transparent)`,
              color: "var(--color-vsc-text-bright)",
            }}
            title={
              runState === "running"
                ? "Cancel running analysis"
                : "Run analysis and view results"
            }
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
              style={{ color: runColor }}
            >
              {runState === "running" ? (
                <rect x="2" y="2" width="8" height="8" fill="currentColor" />
              ) : (
                <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
              )}
            </svg>
            {!compact && (runState === "running" ? "Cancel" : "Run")}
          </button>

          {/* Chevron dropdown */}
          <button
            onClick={() => setRunMenuOpen((v) => !v)}
            disabled={runState === "running"}
            className="h-6 w-4 rounded-xs flex items-center justify-center text-[10px] hover:bg-[var(--color-vsc-list-active)] disabled:opacity-40"
            style={{
              color: "var(--color-vsc-text-muted)",
            }}
            title="More run options"
          >
            ▾
          </button>

          {/* Dropdown menu */}
          {runMenuOpen && (
            <div
              className="absolute bottom-full mb-1 rounded-xs shadow-md overflow-hidden min-w-[140px] py-0.5"
              style={{
                background: "var(--color-vsc-input-bg)",
                border: "1px solid var(--color-vsc-border)",
              }}
            >
              <DropdownItem
                label="Run all"
                onClick={() => {
                  setRunMenuOpen(false);
                  onRunAll();
                }}
              />
              <div
                className="mx-2"
                style={{ borderTop: "1px solid var(--color-vsc-border)" }}
              />
              <DropdownItem
                label="Clear results"
                disabled={!hasResult}
                onClick={() => {
                  setRunMenuOpen(false);
                  onReset();
                }}
              />
              <DropdownItem
                label="Clear all results"
                onClick={() => {
                  setRunMenuOpen(false);
                  onResetAll();
                }}
              />
            </div>
          )}
        </div>

        <Divider />

        {/* ── History (Undo / Redo) ───────────────────────── */}
        <div className="flex items-center gap-0.5 px-1">
          <ToolbarButton
            icon={<UndoIcon size={16} />}
            label="Undo"
            shortcut="Ctrl+Z"
            disabled={!canUndo}
            onClick={onUndo}
          />
          <ToolbarButton
            icon={<RedoIcon size={16} />}
            label="Redo"
            shortcut="Ctrl+Shift+Z"
            disabled={!canRedo}
            onClick={onRedo}
          />
        </div>

        <Divider />

        {/* ── Viewport Controls ───────────────────────────── */}
        <div className="flex items-center gap-0.5 px-1">
          <ToolbarButton
            icon={<ZoomOutIcon size={16} />}
            label="Zoom out"
            disabled={!canvasToolbar}
            onClick={canvasToolbar?.onZoomOut}
          />

          {/* Zoom % selector — hidden in compact mode */}
          {!compact && (
            <select
              className="w-[64px] text-[11px] mx-0.5"
              value={selectedPreset}
              onChange={(e) =>
                canvasToolbar?.onSetZoomPercent(Number(e.target.value))
              }
              disabled={!canvasToolbar}
            >
              {zoomPresets.map((v) => (
                <option key={v} value={v}>
                  {v}%
                </option>
              ))}
            </select>
          )}

          <ToolbarButton
            icon={<ZoomInIcon size={16} />}
            label="Zoom in"
            disabled={!canvasToolbar}
            onClick={canvasToolbar?.onZoomIn}
          />

          <div
            className="w-px h-4 mx-0.5"
            style={{ background: "var(--color-vsc-border)", opacity: 0.5 }}
          />

          <ToolbarButton
            icon={<ZoomBoxIcon size={16} />}
            label="Zoom box"
            active={canvasToolbar?.zoomBoxActive}
            disabled={!canvasToolbar}
            onClick={canvasToolbar?.onToggleZoomBox}
          />
          <ToolbarButton
            icon={<PanIcon size={16} />}
            label="Pan"
            active={canvasToolbar?.panActive}
            disabled={!canvasToolbar}
            onClick={canvasToolbar?.onTogglePan}
          />
          <ToolbarButton
            icon={<FitIcon size={16} />}
            label="Fit to screen"
            disabled={!canvasToolbar}
            onClick={canvasToolbar?.onFitToScreen}
          />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function Divider() {
  return (
    <div
      className="w-px h-4 mx-1"
      style={{ background: "var(--color-vsc-border)" }}
    />
  );
}

function ToolbarButton({
  icon,
  label,
  shortcut,
  showLabel,
  active,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  showLabel?: boolean;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={disabled ? undefined : onClick}
      aria-pressed={active === undefined ? undefined : active}
      className={`h-6 rounded-xs flex items-center justify-center gap-1 border ${
        active
          ? "bg-[var(--color-vsc-selected-bg)]"
          : "hover:bg-[var(--color-vsc-list-active)]"
      }`}
      style={{
        padding: showLabel ? "0 6px" : "0 3px",
        borderColor: active
          ? "color-mix(in srgb, var(--color-vsc-accent) 55%, transparent)"
          : "transparent",
        color: active ? "var(--color-vsc-text-bright)" : "var(--color-vsc-text)",
        opacity: disabled ? 0.35 : 1,
        pointerEvents: disabled ? "none" : "auto",
      }}
    >
      {icon}
      {showLabel && <span className="text-[12px]">{label}</span>}
    </button>
  );
}

function DropdownItem({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      // Disabled for the keyboard too, not only for the pointer.
      disabled={disabled}
      className="w-full text-left px-3 py-1 text-[12px]"
      style={{
        color: disabled ? "var(--color-vsc-badge)" : "var(--color-vsc-text)",
        pointerEvents: disabled ? "none" : "auto",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          (e.target as HTMLElement).style.background =
            "var(--color-vsc-list-hover)";
        }
      }}
      onMouseLeave={(e) => {
        (e.target as HTMLElement).style.background = "transparent";
      }}
      onClick={disabled ? undefined : onClick}
    >
      {label}
    </button>
  );
}
