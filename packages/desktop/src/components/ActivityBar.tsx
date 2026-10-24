import { useCallback, useEffect, useRef, useState } from "react";
import { ExplorerIcon } from "./icons/ExplorerIcon";
import { PropertiesIcon } from "./icons/PropertiesIcon";

interface Props {
  mode: "edit" | "result";
  explorerOpen: boolean;
  propertiesOpen: boolean;
  explorerLocation: "left" | "right";
  propertiesLocation: "left" | "right";
  onToggleExplorer: () => void;
  onToggleProperties: () => void;
  onToggleExplorerLocation: () => void;
  onTogglePropertiesLocation: () => void;
}

interface MenuState {
  x: number;
  y: number;
  panel: "explorer" | "properties";
}

export function ActivityBar({
  mode,
  explorerOpen,
  propertiesOpen,
  explorerLocation,
  propertiesLocation,
  onToggleExplorer,
  onToggleProperties,
  onToggleExplorerLocation,
  onTogglePropertiesLocation,
}: Props) {
  // Right-click opens a small menu; the panel moves only when chosen.
  const [menu, setMenu] = useState<MenuState | null>(null);
  const openMenu = (e: React.MouseEvent, panel: MenuState["panel"]) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, panel });
  };
  const closeMenu = useCallback(() => setMenu(null), []);

  return (
    <div
      className="flex flex-col items-center w-12 shrink-0 py-2 gap-1"
      style={{
        background: "var(--color-vsc-activitybar)",
        borderRight: "1px solid var(--color-vsc-border)",
      }}
    >
      <button
        onClick={onToggleExplorer}
        onContextMenu={(e) => openMenu(e, "explorer")}
        className="w-9 h-9 flex items-center justify-center cursor-pointer rounded-lg relative group"
        style={{
          background: explorerOpen
            ? "var(--color-vsc-list-active)"
            : "transparent",
        }}
        title="Models (Right-click to move)"
        aria-label="Toggle models"
      >
        <ExplorerIcon active={explorerOpen} location={explorerLocation} />
      </button>
      {mode === "result" ? (
        <button
          onClick={onToggleProperties}
          onContextMenu={(e) => openMenu(e, "properties")}
          className="w-9 h-9 flex items-center justify-center cursor-pointer rounded-lg relative group"
          style={{
            background: propertiesOpen
              ? "var(--color-vsc-list-active)"
              : "transparent",
          }}
          title="Properties (Right-click to move)"
          aria-label="Toggle properties"
        >
          <PropertiesIcon
            active={propertiesOpen}
            location={propertiesLocation}
          />
        </button>
      ) : null}
      {menu && (
        <MoveMenu
          x={menu.x}
          y={menu.y}
          label={`Move panel to the ${
            (menu.panel === "explorer" ? explorerLocation : propertiesLocation) ===
            "left"
              ? "right"
              : "left"
          }`}
          onMove={
            menu.panel === "explorer"
              ? onToggleExplorerLocation
              : onTogglePropertiesLocation
          }
          onClose={closeMenu}
        />
      )}
    </div>
  );
}

/** The activity bar's context menu, styled like the canvas context menu. */
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
      className="fixed z-[100] py-1 rounded-md shadow-xl min-w-[160px]"
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
