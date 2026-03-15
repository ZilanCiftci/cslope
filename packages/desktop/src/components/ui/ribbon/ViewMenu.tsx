import { createPortal } from "react-dom";
import type { CanvasToolbarState } from "../../../store/types";
import { RibbonGroup } from "./RibbonParts";
import { PlusIcon, MinusIcon } from "../../icons/ViewIcons";

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

  const handleActivate = () => {
    if (!disabled) onActivate();
  };

  return (
    <div className="relative">
      <button
        onClick={handleActivate}
        className="h-[1.9rem] px-4 text-[11px] font-medium flex items-center cursor-pointer relative"
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
                scalePercent={canvasToolbar.zoomPercent}
                onZoomIn={canvasToolbar.onZoomIn}
                onZoomOut={canvasToolbar.onZoomOut}
                onSetZoom={canvasToolbar.onSetZoomPercent}
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
