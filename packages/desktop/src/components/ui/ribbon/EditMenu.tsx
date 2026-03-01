import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import { useAppStore } from "../../../store/app-store";
import { RUN_RESET, getAnalysisInputSignature } from "../../../store/helpers";
import { RibbonGroup, RibbonButton } from "./RibbonParts";

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

  const runUndo = () => {
    const before = getAnalysisInputSignature(useAppStore.getState());
    useAppStore.temporal.getState().resume();
    useAppStore.temporal.getState().undo();
    const after = getAnalysisInputSignature(useAppStore.getState());
    if (before !== after) {
      useAppStore.setState(RUN_RESET);
    }
  };

  const runRedo = () => {
    const before = getAnalysisInputSignature(useAppStore.getState());
    useAppStore.temporal.getState().resume();
    useAppStore.temporal.getState().redo();
    const after = getAnalysisInputSignature(useAppStore.getState());
    if (before !== after) {
      useAppStore.setState(RUN_RESET);
    }
  };

  const handleUndo = () => {
    runUndo();
  };

  const handleRedo = () => {
    runRedo();
  };

  // ── Keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y) ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;

      // Ctrl+Z  →  Undo
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (canUndo) {
          runUndo();
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
          runRedo();
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
                icon={<UndoIcon />}
                label="Undo"
                shortcut="Ctrl+Z"
                onClick={handleUndo}
                disabled={!canUndo}
              />
              <RibbonButton
                icon={<RedoIcon />}
                label="Redo"
                shortcut="Ctrl+Shift+Z"
                onClick={handleRedo}
                disabled={!canRedo}
              />
            </RibbonGroup>
          </div>,
          panelHost,
        )}
    </div>
  );
}

// ── Icons ──

function UndoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 10h9a5 5 0 0 1 0 10h-3"
        stroke="#5c6bc0"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M9 14L5 10l4-4"
        stroke="#5c6bc0"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M5 10l4 4" stroke="#90a4d8" strokeWidth="1" opacity="0.5" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M19 10h-9a5 5 0 0 0 0 10h3"
        stroke="#5c6bc0"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M15 14l4-4-4-4"
        stroke="#5c6bc0"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M19 10l-4 4" stroke="#90a4d8" strokeWidth="1" opacity="0.5" />
    </svg>
  );
}
