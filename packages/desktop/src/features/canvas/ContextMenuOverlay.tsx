import type { ContextMenuState } from "./types";

interface ContextMenuOverlayProps {
  menu: ContextMenuState | null;
}

export function ContextMenuOverlay({ menu }: ContextMenuOverlayProps) {
  if (!menu) return null;

  return (
    <div
      className="absolute z-50 py-1 rounded-md shadow-xl min-w-[140px]"
      style={{
        left: menu.screenX,
        top: menu.screenY,
        background: "var(--color-vsc-input-bg)",
        border: "1px solid var(--color-vsc-border)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {menu.items.map((item) => (
        <button
          key={item.label}
          onClick={item.disabled ? undefined : item.action}
          disabled={item.disabled}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            color: item.danger
              ? "var(--color-vsc-error)"
              : "var(--color-vsc-text)",
          }}
          onMouseEnter={(e) => {
            if (!item.disabled)
              (e.currentTarget as HTMLElement).style.background =
                "var(--color-vsc-list-hover)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "";
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
