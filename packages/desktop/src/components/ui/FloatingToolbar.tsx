import { useState, useRef, useCallback, useEffect } from "react";
import type { AnalysisRunState, CanvasToolbarState } from "../../store/types";
import { EditModeIcon, ResultsModeIcon } from "../icons/ModeIcons";
import {
  FitIcon,
  ZoomInIcon,
  ZoomOutIcon,
  ZoomBoxIcon,
  HandIcon,
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
      strokeWidth="2"
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
      strokeWidth="2"
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
        opacity: faded ? 0.2 : 1,
        transition: "opacity 0.4s ease",
      }}
      onPointerEnter={() => {
        setFaded(false);
        clearTimeout(fadeTimerRef.current);
      }}
      onPointerLeave={resetFadeTimer}
    >
      <div
        className="pointer-events-auto flex items-center gap-0 rounded-xl shadow-lg px-1 h-9"
        style={{
          background:
            "color-mix(in srgb, var(--color-vsc-bg) 82%, transparent)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: "1px solid var(--color-vsc-border)",
        }}
      >
        {/* ── Mode Toggle ─────────────────────────────────── */}
        <div className="flex items-center gap-0.5 px-1">
          <ToolbarButton
            icon={<EditModeIcon size={14} />}
            label="Edit"
            showLabel={!compact}
            active={mode === "edit"}
            onClick={() => setMode("edit")}
          />
          <ToolbarButton
            icon={<ResultsModeIcon size={14} />}
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
            className="h-7 px-2.5 rounded-lg flex items-center gap-1.5 cursor-pointer text-[11px] font-semibold transition-colors"
            style={{
              background:
                runState === "running"
                  ? "color-mix(in srgb, var(--color-vsc-error, #f44747) 18%, transparent)"
                  : "color-mix(in srgb, var(--color-vsc-success) 18%, transparent)",
              color:
                runState === "running"
                  ? "var(--color-vsc-error, #f44747)"
                  : "var(--color-vsc-success)",
            }}
            title={
              runState === "running"
                ? "Cancel running analysis"
                : "Run analysis and view results"
            }
          >
            <span
              className="w-4 h-4 rounded-full flex items-center justify-center text-[9px]"
              style={{
                background:
                  runState === "running"
                    ? "var(--color-vsc-error, #f44747)"
                    : "var(--color-vsc-success)",
                color: "var(--color-vsc-bg)",
              }}
            >
              {runState === "running" ? "■" : "▶"}
            </span>
            {!compact && (runState === "running" ? "Cancel" : "Run")}
          </button>

          {/* Chevron dropdown */}
          <button
            onClick={() => setRunMenuOpen((v) => !v)}
            disabled={runState === "running"}
            className="h-7 w-5 rounded-lg flex items-center justify-center cursor-pointer text-[10px] disabled:opacity-40 disabled:cursor-not-allowed"
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
              className="absolute bottom-full mb-1.5 rounded-lg shadow-xl overflow-hidden min-w-[140px]"
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
                label="Reset"
                disabled={!hasResult}
                onClick={() => {
                  setRunMenuOpen(false);
                  onReset();
                }}
              />
              <DropdownItem
                label="Reset all"
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
            icon={<UndoIcon size={15} />}
            label="Undo"
            shortcut="Ctrl+Z"
            disabled={!canUndo}
            onClick={onUndo}
          />
          <ToolbarButton
            icon={<RedoIcon size={15} />}
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
            icon={<ZoomOutIcon size={15} />}
            label="Zoom out"
            disabled={!canvasToolbar}
            onClick={canvasToolbar?.onZoomOut}
          />

          {/* Zoom % selector — hidden in compact mode */}
          {!compact && (
            <select
              className="h-6 text-[10px] rounded cursor-pointer px-0.5"
              style={{
                minWidth: 44,
                background: "var(--color-vsc-input-bg)",
                color: "var(--color-vsc-text)",
                border: "1px solid var(--color-vsc-border)",
              }}
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
            icon={<ZoomInIcon size={15} />}
            label="Zoom in"
            disabled={!canvasToolbar}
            onClick={canvasToolbar?.onZoomIn}
          />

          <div
            className="w-px h-4 mx-0.5"
            style={{ background: "var(--color-vsc-border)", opacity: 0.5 }}
          />

          <ToolbarButton
            icon={<ZoomBoxIcon size={15} />}
            label="Zoom box"
            active={canvasToolbar?.zoomBoxActive}
            disabled={!canvasToolbar}
            onClick={canvasToolbar?.onToggleZoomBox}
          />
          <ToolbarButton
            icon={<HandIcon size={15} />}
            label="Pan"
            active={canvasToolbar?.panActive}
            disabled={!canvasToolbar}
            onClick={canvasToolbar?.onTogglePan}
          />
          <ToolbarButton
            icon={<FitIcon size={15} />}
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
      className="w-px h-5 mx-0.5"
      style={{ background: "var(--color-vsc-border)", opacity: 0.6 }}
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
      className="h-7 rounded-lg flex items-center justify-center gap-1 cursor-pointer transition-colors"
      style={{
        padding: showLabel ? "0 8px" : "0 6px",
        color: active
          ? "var(--color-vsc-text-bright)"
          : "var(--color-vsc-text-muted)",
        background: active
          ? "color-mix(in srgb, var(--color-vsc-accent) 22%, transparent)"
          : "transparent",
        opacity: disabled ? 0.35 : 1,
        pointerEvents: disabled ? "none" : "auto",
      }}
    >
      {icon}
      {showLabel && <span className="text-[11px] font-medium">{label}</span>}
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
      className="w-full text-left px-3 py-1.5 text-[11px] cursor-pointer"
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
      onClick={onClick}
    >
      {label}
    </button>
  );
}
