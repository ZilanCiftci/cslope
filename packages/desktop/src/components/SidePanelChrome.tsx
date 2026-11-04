/**
 * The chrome of a side panel: its header row with the collapse button at
 * the window edge, and the narrow strip that stands in for a collapsed
 * panel, with one button to open it again.  Right-click on either opens a
 * small menu that moves the panel to the other side of the window.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";

export type PanelSide = "left" | "right";

/** The width of a collapsed panel's strip, in pixels. */
export const COLLAPSED_STRIP_WIDTH = 22;

const HEADER_TEXT_CLASS =
  "text-[10px] font-bold uppercase tracking-[0.08em] select-none";

const otherSide = (side: PanelSide): PanelSide =>
  side === "left" ? "right" : "left";

interface MenuPos {
  x: number;
  y: number;
}

/** A right-click menu state and the handler that opens it. */
function useMoveMenu() {
  const [menu, setMenu] = useState<MenuPos | null>(null);
  const openMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);
  return { menu, openMenu, closeMenu };
}

interface HeaderRowProps {
  /** The side of the window the panel sits on. */
  side: PanelSide;
  /** The panel's name as the user sees it ("Models", "Properties"). */
  label: string;
  onCollapse: () => void;
  onMove: () => void;
  /** The title cell: a section toggle button or a plain title. */
  children: ReactNode;
}

/**
 * The header row of an open side panel.  The collapse button sits at the
 * window edge: on the right of a left panel, on the left of a right panel.
 */
export function PanelHeaderRow({
  side,
  label,
  onCollapse,
  onMove,
  children,
}: HeaderRowProps) {
  const { menu, openMenu, closeMenu } = useMoveMenu();
  const Icon = side === "left" ? PanelLeftClose : PanelRightClose;
  const button = (
    <button
      type="button"
      onClick={onCollapse}
      className="flex items-center justify-center w-6 h-6 shrink-0 rounded-sm cursor-pointer hover:bg-(--color-vsc-list-active)"
      style={{ color: "var(--color-vsc-text-muted)" }}
      title={`Collapse the ${label} panel (right-click to move it)`}
      aria-label={`Collapse ${label.toLowerCase()}`}
    >
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
  return (
    <div
      className={`flex items-center gap-1 w-full ${side === "left" ? "pr-1" : "pl-1"}`}
      style={{
        background: "var(--color-vsc-surface-tint)",
        color: "var(--color-vsc-text-muted)",
        borderTop: "1px solid var(--color-vsc-border)",
        borderBottom: "1px solid var(--color-vsc-border)",
      }}
      onContextMenu={openMenu}
      data-testid={`panel-header-${label.toLowerCase()}`}
    >
      {side === "right" && button}
      <div className={`flex-1 min-w-0 ${HEADER_TEXT_CLASS}`}>{children}</div>
      {side === "left" && button}
      {menu && (
        <MoveMenu
          x={menu.x}
          y={menu.y}
          label={`Move panel to the ${otherSide(side)}`}
          onMove={onMove}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}

interface StripProps {
  side: PanelSide;
  label: string;
  onOpen: () => void;
  onMove: () => void;
}

/**
 * A collapsed side panel: a narrow strip along the window edge with the
 * panel's name written along it and one button that opens the panel again.
 */
export function CollapsedPanelStrip({ side, label, onOpen, onMove }: StripProps) {
  const { menu, openMenu, closeMenu } = useMoveMenu();
  const Icon = side === "left" ? PanelLeftOpen : PanelRightOpen;
  return (
    <div
      className="flex flex-col shrink-0 h-full"
      style={{
        width: COLLAPSED_STRIP_WIDTH,
        background: "var(--color-vsc-sidebar)",
        borderRight: side === "left" ? "1px solid var(--color-vsc-border)" : undefined,
        borderLeft: side === "right" ? "1px solid var(--color-vsc-border)" : undefined,
      }}
      data-testid={`collapsed-${label.toLowerCase()}`}
    >
      <button
        type="button"
        onClick={onOpen}
        onContextMenu={openMenu}
        className={`flex flex-col items-center gap-2 w-full py-2 cursor-pointer hover:bg-(--color-vsc-list-active) ${HEADER_TEXT_CLASS}`}
        style={{ color: "var(--color-vsc-text-muted)" }}
        title={`Open the ${label} panel (right-click to move it)`}
        aria-label={`Open ${label.toLowerCase()}`}
      >
        <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
        <span
          style={{
            writingMode: "vertical-rl",
            transform: side === "left" ? "rotate(180deg)" : undefined,
            lineHeight: `${COLLAPSED_STRIP_WIDTH - 2}px`,
          }}
        >
          {label}
        </span>
      </button>
      {menu && (
        <MoveMenu
          x={menu.x}
          y={menu.y}
          label={`Move panel to the ${otherSide(side)}`}
          onMove={onMove}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}

/** The move-panel context menu, styled like the canvas context menu. */
function MoveMenu({
  x,
  y,
  label,
  onMove,
  onClose,
}: {
  x: number;
  y: number;
  label: string;
  onMove: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[100] py-1 rounded-md shadow-xl min-w-[160px] normal-case tracking-normal font-normal"
      style={{
        left: x,
        top: y,
        background: "var(--color-vsc-input-bg)",
        border: "1px solid var(--color-vsc-border)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
      role="menu"
    >
      <button
        type="button"
        onClick={() => {
          onMove();
          onClose();
        }}
        className="w-full px-3 py-1.5 text-[12px] text-left cursor-pointer whitespace-nowrap transition-colors"
        style={{ color: "var(--color-vsc-text)" }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--color-vsc-list-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "";
        }}
        role="menuitem"
      >
        {label}
      </button>
    </div>
  );
}
