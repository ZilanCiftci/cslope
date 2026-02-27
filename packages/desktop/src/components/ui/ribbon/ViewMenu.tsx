import { createPortal } from "react-dom";
import { useAppStore } from "../../../store/app-store";
import type { CanvasToolbarState } from "../../../store/types";
import { RibbonGroup, RibbonButton, RibbonSep } from "./RibbonParts";

interface Props {
  canvasToolbar: CanvasToolbarState | null;
  isOpen: boolean;
  onActivate: () => void;
  panelHost: HTMLElement | null;
}

export function ViewMenu({
  canvasToolbar,
  isOpen,
  onActivate,
  panelHost,
}: Props) {
  const disabled = !canvasToolbar;
  const mode = useAppStore((s) => s.mode);
  const editViewScale = useAppStore((s) => s.editViewScale);
  const resultViewScale = useAppStore((s) => s.resultViewScale);
  const setEditViewScale = useAppStore((s) => s.setEditViewScale);
  const setResultViewScale = useAppStore((s) => s.setResultViewScale);

  const currentScale = Math.max(
    0.1,
    mode === "result" ? resultViewScale || 1 : editViewScale || 1,
  );

  const setZoomPercent = (percent: number) => {
    const scale = Math.max(0.1, Math.min(200, percent / 100));
    if (mode === "result") setResultViewScale(scale);
    else setEditViewScale(scale);
  };

  const handleActivate = () => {
    if (!disabled) onActivate();
  };

  return (
    <div className="relative">
      <button
        onClick={handleActivate}
        className="h-9 px-4 text-[12px] font-medium flex items-center cursor-pointer relative"
        style={{
          color: isOpen
            ? "var(--color-vsc-text-bright)"
            : "var(--color-vsc-text-muted)",
          background: isOpen ? "var(--color-vsc-tab-active)" : "transparent",
          opacity: disabled ? 0.6 : 1,
        }}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        disabled={disabled}
      >
        View
        {isOpen && (
          <div
            className="absolute bottom-0 left-0 right-0 h-0.5"
            style={{ background: "var(--color-vsc-accent)" }}
          />
        )}
      </button>

      {isOpen &&
        canvasToolbar &&
        panelHost &&
        createPortal(
          <div className="h-full flex items-center gap-0" role="menu">
            <RibbonGroup label="Zoom">
              <ZoomControl
                scalePercent={Math.round(currentScale * 100)}
                onZoomIn={canvasToolbar.onZoomIn}
                onZoomOut={canvasToolbar.onZoomOut}
                onSetZoom={setZoomPercent}
              />
            </RibbonGroup>
            <RibbonSep />
            <RibbonGroup label="Navigation">
              <RibbonButton
                icon={<FitIcon />}
                label="Fit"
                onClick={canvasToolbar.onFitToScreen}
              />
              <RibbonButton
                icon={<HandIcon />}
                label="Pan"
                onClick={canvasToolbar.onTogglePan}
                active={canvasToolbar.panActive}
              />
              <RibbonButton
                icon={<ZoomBoxIcon />}
                label="Zoom box"
                onClick={canvasToolbar.onToggleZoomBox}
                active={canvasToolbar.zoomBoxActive}
              />
            </RibbonGroup>
          </div>,
          panelHost,
        )}
    </div>
  );
}

// ── View-specific components ──

function ZoomControl({
  scalePercent,
  onZoomIn,
  onZoomOut,
  onSetZoom,
}: {
  scalePercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSetZoom: (percent: number) => void;
}) {
  const presets = [25, 50, 75, 100, 125, 150, 200, 300, 400];
  const selectedPreset = presets.reduce((best, current) =>
    Math.abs(current - scalePercent) < Math.abs(best - scalePercent)
      ? current
      : best,
  );

  return (
    <div
      className="flex items-center gap-1 h-9 px-1.5 rounded"
      style={{
        background: "var(--color-vsc-tab-inactive)",
        border: "1px solid var(--color-vsc-border)",
      }}
    >
      <button
        title="Zoom out"
        onClick={onZoomOut}
        className="w-5 h-5 rounded-full flex items-center justify-center cursor-pointer"
        style={{
          border: "1px solid var(--color-vsc-border)",
          color: "var(--color-vsc-accent)",
          background: "var(--color-vsc-panel)",
        }}
      >
        <MinusIcon />
      </button>
      <select
        className="h-6 px-1 text-[11px] rounded cursor-pointer"
        style={{
          minWidth: 60,
          background: "var(--color-vsc-input-bg)",
          color: "var(--color-vsc-text)",
          border: "1px solid var(--color-vsc-border)",
        }}
        value={selectedPreset}
        onChange={(e) => onSetZoom(Number(e.target.value))}
      >
        {presets.map((v) => (
          <option key={v} value={v}>
            {v}%
          </option>
        ))}
      </select>
      <button
        title="Zoom in"
        onClick={onZoomIn}
        className="w-5 h-5 rounded-full flex items-center justify-center cursor-pointer"
        style={{
          border: "1px solid var(--color-vsc-border)",
          color: "var(--color-vsc-accent)",
          background: "var(--color-vsc-panel)",
        }}
      >
        <PlusIcon />
      </button>
    </div>
  );
}

function FitIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect
        x="6"
        y="6"
        width="12"
        height="12"
        rx="1"
        fill="#e0f2f1"
        stroke="#26a69a"
        strokeWidth="1"
        strokeDasharray="3 2"
      />
      <path
        d="M8 3H5a2 2 0 0 0-2 2v3"
        stroke="#00897b"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M16 3h3a2 2 0 0 1 2 2v3"
        stroke="#00897b"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M8 21H5a2 2 0 0 1-2-2v-3"
        stroke="#00897b"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M16 21h3a2 2 0 0 0 2-2v-3"
        stroke="#00897b"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

function ZoomBoxIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="3"
        width="14"
        height="14"
        rx="1.5"
        fill="#e3f2fd"
        stroke="#42a5f5"
        strokeWidth="1.5"
        strokeDasharray="3 2"
      />
      <circle
        cx="17"
        cy="17"
        r="4"
        fill="#fff"
        stroke="#42a5f5"
        strokeWidth="1.5"
      />
      <path
        d="M15.5 17h3M17 15.5v3"
        stroke="#1e88e5"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function HandIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M8 13V9a2 2 0 0 1 4 0v4"
        fill="#fff3e0"
        stroke="#f57c00"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M12 11V7a2 2 0 0 1 4 0v6"
        fill="#fff3e0"
        stroke="#f57c00"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M16 13V6a2 2 0 0 1 4 0v8"
        fill="#fff3e0"
        stroke="#f57c00"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M8 13v2a6 6 0 0 0 12 0v-1"
        stroke="#f57c00"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="#ffe0b2"
      />
    </svg>
  );
}
