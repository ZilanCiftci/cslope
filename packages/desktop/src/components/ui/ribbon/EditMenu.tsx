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
  RibbonMaterialsIcon,
} from "../../icons/EditIcons";

interface Props {
  isOpen: boolean;
  onActivate: () => void;
  panelHost: HTMLElement | null;
}

export function EditMenu({ isOpen, onActivate, panelHost }: Props) {
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
        Edit
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
            <RibbonGroup label="History">
              <RibbonButton
                icon={<RibbonUndoIcon />}
                label="Undo"
                shortcut="Ctrl+Z"
                onClick={performUndo}
                disabled={!canUndo}
              />
              <RibbonButton
                icon={<RibbonRedoIcon />}
                label="Redo"
                shortcut="Ctrl+Shift+Z"
                onClick={performRedo}
                disabled={!canRedo}
              />
            </RibbonGroup>

            <RibbonSep />

            <RibbonGroup label="Materials">
              <RibbonButton
                icon={<RibbonMaterialsIcon />}
                label="Define"
                onClick={() => window.cslope.openMaterialsDialog()}
              />
            </RibbonGroup>
          </div>,
          panelHost,
        )}
    </div>
  );
}
