import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import {
  useAppStore,
  performUndo,
  performRedo,
} from "../../../store/app-store";
import { RibbonGroup, RibbonButton, RibbonSep } from "./RibbonParts";
import {
  RibbonUndoIcon,
  RibbonRedoIcon,
  RibbonGeometryIcon,
  RibbonInteriorBoundaryIcon,
  RibbonAssignMaterialsIcon,
  RibbonMaterialsIcon,
  RibbonUdlIcon,
  RibbonLineLoadIcon,
  RibbonPiezoLineIcon,
  RibbonParametersIcon,
  RibbonSearchLimitsIcon,
  RibbonCustomPlanesIcon,
  RibbonOptionsIcon,
} from "../../icons/EditIcons";
import {
  RibbonFitIcon,
  RibbonZoomBoxIcon,
  RibbonHandIcon,
  PlusIcon,
  MinusIcon,
} from "../../icons/ViewIcons";
import type { CanvasToolbarState } from "../../../store/types";

interface Props {
  canvasToolbar: CanvasToolbarState | null;
  isOpen: boolean;
  onActivate: () => void;
  panelHost: HTMLElement | null;
}

export function EditMenu({
  canvasToolbar,
  isOpen,
  onActivate,
  panelHost,
}: Props) {
  const setActiveSection = useAppStore((s) => s.setActiveSection);

  const canUndo = useStore(
    useAppStore.temporal,
    (s) => s.pastStates.length > 0,
  );
  const canRedo = useStore(
    useAppStore.temporal,
    (s) => s.futureStates.length > 0,
  );

  // ── Keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y) ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;

      // Ctrl+Z  →  Undo
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (canUndo) {
          performUndo();
        }
      }
      // Ctrl+Shift+Z or Ctrl+Y  →  Redo
      else if (
        (e.key === "Z" && e.shiftKey) ||
        (e.key === "z" && e.shiftKey) ||
        e.key === "y" ||
        e.key === "Y"
      ) {
        e.preventDefault();
        if (canRedo) {
          performRedo();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canUndo, canRedo]);

  return (
    <div
      className="relative"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <button
        onClick={onActivate}
        className="h-[1.9rem] px-4 text-[11px] font-medium flex items-center cursor-pointer relative"
        style={{
          color: isOpen
            ? "var(--color-vsc-text-bright)"
            : "var(--color-vsc-text-muted)",
          background: isOpen ? "var(--color-vsc-tab-active)" : "transparent",
        }}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        Model
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
            <RibbonGroup label="Controls">
              <div className="grid grid-cols-[auto_auto_auto_auto] grid-rows-2 gap-2">
                {/* Row 1: Fit, Pan, Undo */}
                <CompactButton
                  icon={<RibbonFitIcon size={18} />}
                  label="Fit"
                  onClick={canvasToolbar?.onFitToScreen}
                  disabled={!canvasToolbar}
                />
                <CompactButton
                  icon={<RibbonZoomBoxIcon size={18} />}
                  label="Zoom box"
                  onClick={canvasToolbar?.onToggleZoomBox}
                  active={canvasToolbar?.zoomBoxActive}
                  disabled={!canvasToolbar}
                />
                <CompactButton
                  icon={<RibbonHandIcon size={18} />}
                  label="Pan"
                  onClick={canvasToolbar?.onTogglePan}
                  active={canvasToolbar?.panActive}
                  disabled={!canvasToolbar}
                />
                <CompactButton
                  icon={<RibbonUndoIcon size={18} />}
                  label="Undo"
                  shortcut="Ctrl+Z"
                  onClick={performUndo}
                  disabled={!canUndo}
                />

                {/* Row 2: Zoom box, Zoom %, Redo */}

                <div className="col-span-3">
                  <CompactZoomControl
                    scalePercent={canvasToolbar?.zoomPercent ?? 100}
                    onZoomIn={canvasToolbar?.onZoomIn}
                    onZoomOut={canvasToolbar?.onZoomOut}
                    onSetZoom={canvasToolbar?.onSetZoomPercent}
                    disabled={!canvasToolbar}
                  />
                </div>

                <CompactButton
                  icon={<RibbonRedoIcon size={18} />}
                  label="Redo"
                  shortcut="Ctrl+Shift+Z"
                  onClick={performRedo}
                  disabled={!canRedo}
                />
              </div>
            </RibbonGroup>

            <RibbonSep />

            <RibbonGroup label="GEOMETRY">
              <RibbonButton
                icon={<RibbonGeometryIcon />}
                label="Exterior Boundary"
                onClick={() => {
                  setActiveSection("Exterior Boundary");
                  window.cslope.openGeometryDialog();
                }}
              />
              <RibbonButton
                icon={<RibbonInteriorBoundaryIcon />}
                label="Interior Boundaries"
                onClick={() => {
                  setActiveSection("Interior Boundaries");
                  window.cslope.openInteriorBoundariesDialog();
                }}
              />
            </RibbonGroup>

            <RibbonSep />

            <RibbonGroup label="Materials">
              <RibbonButton
                icon={<RibbonMaterialsIcon />}
                label="Define"
                onClick={() => window.cslope.openMaterialsDialog()}
              />
              <RibbonButton
                icon={<RibbonAssignMaterialsIcon />}
                label="Assign"
                onClick={() => {
                  setActiveSection("Material Assignment");
                  window.cslope.openMaterialAssignmentDialog();
                }}
              />
            </RibbonGroup>

            <RibbonSep />

            <RibbonGroup label="External loads">
              <RibbonButton
                icon={<RibbonUdlIcon />}
                label="UDL"
                onClick={() => {
                  setActiveSection("Loads");
                  window.cslope.openUdlDialog();
                }}
              />
              <RibbonButton
                icon={<RibbonLineLoadIcon />}
                label="Line loads"
                onClick={() => {
                  setActiveSection("Loads");
                  window.cslope.openLineLoadsDialog();
                }}
              />
            </RibbonGroup>

            <RibbonSep />

            <RibbonGroup label="Water Pressure">
              <RibbonButton
                icon={<RibbonPiezoLineIcon />}
                label="Piezometric Lines"
                onClick={() => {
                  setActiveSection("Piezometric Lines");
                  window.cslope.openPiezoDialog();
                }}
              />
            </RibbonGroup>

            <RibbonSep />

            <RibbonGroup label="Parameters">
              <RibbonButton
                icon={<RibbonParametersIcon />}
                label="Define"
                onClick={() => {
                  setActiveSection("Parameters");
                  window.cslope.openParametersDialog();
                }}
              />
            </RibbonGroup>

            <RibbonSep />

            <RibbonGroup label="Analysis">
              <RibbonButton
                icon={<RibbonSearchLimitsIcon />}
                label="Search limits"
                onClick={() => {
                  setActiveSection("Search Limits");
                  window.cslope.openSearchLimitsDialog();
                }}
              />
              <RibbonButton
                icon={<RibbonCustomPlanesIcon />}
                label="Custom search planes"
                onClick={() => {
                  setActiveSection("Custom Search Planes");
                  window.cslope.openCustomSearchPlanesDialog();
                }}
              />
              <RibbonButton
                icon={<RibbonOptionsIcon />}
                label="Options"
                onClick={() => {
                  setActiveSection("Options");
                  window.cslope.openOptionsDialog();
                }}
              />
            </RibbonGroup>
          </div>,
          panelHost,
        )}
    </div>
  );
}

// ── Compact controls ──

function CompactButton({
  icon,
  label,
  shortcut,
  onClick,
  disabled,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={disabled ? undefined : onClick}
      className="w-7 h-[18px] rounded flex items-center justify-center cursor-pointer"
      style={{
        color: active
          ? "var(--color-vsc-text-bright)"
          : "var(--color-vsc-text-muted)",
        background: active ? "var(--color-vsc-list-active)" : "transparent",
        opacity: disabled ? 0.35 : 1,
        filter: disabled ? "grayscale(1)" : "none",
      }}
    >
      {icon}
    </button>
  );
}

function CompactZoomControl({
  scalePercent,
  onZoomIn,
  onZoomOut,
  onSetZoom,
  disabled,
}: {
  scalePercent: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onSetZoom?: (percent: number) => void;
  disabled?: boolean;
}) {
  const presets = [25, 50, 75, 100, 125, 150, 200, 300, 400];
  const selectedPreset = presets.reduce((best, current) =>
    Math.abs(current - scalePercent) < Math.abs(best - scalePercent)
      ? current
      : best,
  );

  return (
    <div
      className="flex items-center gap-0 h-[18px] px-0.5 rounded"
      style={{
        background: "var(--color-vsc-tab-inactive)",
        border: "1px solid var(--color-vsc-border)",
        opacity: disabled ? 0.35 : 1,
        filter: disabled ? "grayscale(1)" : "none",
      }}
    >
      <button
        title="Zoom out"
        onClick={disabled ? undefined : onZoomOut}
        className="w-4 h-4 flex items-center justify-center cursor-pointer rounded"
        style={{ color: "var(--color-vsc-accent)" }}
      >
        <MinusIcon size={12} />
      </button>
      <select
        className="h-4 text-[9px] rounded cursor-pointer"
        style={{
          minWidth: 38,
          background: "var(--color-vsc-input-bg)",
          color: "var(--color-vsc-text)",
          border: "none",
          padding: "0 1px",
        }}
        value={selectedPreset}
        onChange={(e) => onSetZoom?.(Number(e.target.value))}
        disabled={disabled}
      >
        {presets.map((v) => (
          <option key={v} value={v}>
            {v}%
          </option>
        ))}
      </select>
      <button
        title="Zoom in"
        onClick={disabled ? undefined : onZoomIn}
        className="w-4 h-4 flex items-center justify-center cursor-pointer rounded"
        style={{ color: "var(--color-vsc-accent)" }}
      >
        <PlusIcon size={12} />
      </button>
    </div>
  );
}
