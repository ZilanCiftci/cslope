import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { useAppStore } from "../store/app-store";
import { RUN_RESET } from "../store/helpers";

export function EditMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const canUndo = useStore(
    useAppStore.temporal,
    (s) => s.pastStates.length > 0,
  );
  const canRedo = useStore(
    useAppStore.temporal,
    (s) => s.futureStates.length > 0,
  );

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (!open) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const handleUndo = () => {
    useAppStore.temporal.getState().undo();
    // Invalidate stale analysis results after undo
    useAppStore.setState(RUN_RESET);
    setOpen(false);
  };

  const handleRedo = () => {
    useAppStore.temporal.getState().redo();
    // Invalidate stale analysis results after redo
    useAppStore.setState(RUN_RESET);
    setOpen(false);
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
          useAppStore.temporal.getState().undo();
          useAppStore.setState(RUN_RESET);
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
          useAppStore.temporal.getState().redo();
          useAppStore.setState(RUN_RESET);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canUndo, canRedo]);

  return (
    <div
      className="relative"
      ref={menuRef}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-8 px-3 rounded text-[12px] font-medium flex items-center cursor-pointer"
        style={{
          color: "var(--color-vsc-text-muted)",
          background: open ? "var(--color-vsc-list-active)" : "transparent",
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Edit
      </button>

      {open && (
        <div
          className="absolute left-0 mt-0.5 w-56 rounded shadow-lg py-1 text-[12px]"
          style={{
            background: "var(--color-vsc-panel)",
            border: "1px solid var(--color-vsc-border)",
            color: "var(--color-vsc-text)",
            zIndex: 60,
          }}
          role="menu"
        >
          <MenuItem
            label="Undo"
            shortcut="Ctrl+Z"
            onClick={handleUndo}
            disabled={!canUndo}
          />
          <MenuItem
            label="Redo"
            shortcut="Ctrl+Shift+Z"
            onClick={handleRedo}
            disabled={!canRedo}
          />
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──

function MenuItem({
  label,
  shortcut,
  onClick,
  disabled,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="w-full text-left px-3 py-1.5 flex items-center justify-between"
      style={{
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
      onClick={disabled ? undefined : onClick}
      role="menuitem"
      aria-disabled={disabled}
    >
      <span>{label}</span>
      {shortcut && (
        <span
          className="text-[11px] ml-6"
          style={{ color: "var(--color-vsc-text-muted)" }}
        >
          {shortcut}
        </span>
      )}
    </button>
  );
}
