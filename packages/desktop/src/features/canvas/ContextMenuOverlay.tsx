import { useLayoutEffect, useRef, useState } from "react";
import type { ContextMenuItem, ContextMenuState } from "./types";
import { DISABLED_COLOR } from "../../components/ui/disabled-style";

interface ContextMenuOverlayProps {
  menu: ContextMenuState | null;
}

const MENU_STYLE = {
  background: "var(--color-vsc-input-bg)",
  border: "1px solid var(--color-vsc-border)",
  boxShadow: "var(--color-vsc-shadow-float)",
} as const;

/** The box a menu must stay in: the canvas area the menu is placed in (it clips what sticks out). */
function boundsOf(el: HTMLElement): DOMRect {
  const menu = el.closest("[data-context-menu]") as HTMLElement | null;
  const host = (menu?.offsetParent as HTMLElement | null) ?? document.body;
  return host.getBoundingClientRect();
}

/** A submenu beside its item, moved to the left or up where it would stick out. */
function SubMenu({ label, items }: { label: string; items: ContextMenuItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState({ left: false, up: false });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const b = boundsOf(el);
    setFlip({ left: r.right > b.right, up: r.bottom > b.bottom });
  }, []);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="absolute py-1 rounded-md shadow-xl min-w-[160px]"
      style={{
        ...MENU_STYLE,
        ...(flip.left ? { right: "100%" } : { left: "100%" }),
        ...(flip.up ? { bottom: 0 } : { top: 0 }),
      }}
    >
      <MenuItems items={items} />
    </div>
  );
}

function MenuItems({ items }: { items: ContextMenuItem[] }) {
  // The submenu shown: that of the item last hovered.
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      {items.map((item) => (
        <div key={item.label} className="relative" onMouseEnter={() => setOpen(item.submenu && !item.disabled ? item.label : null)}>
          {item.separator && <div className="my-1 h-px" style={{ background: "var(--color-vsc-border)" }} />}
          <button
            role="menuitem"
            aria-haspopup={item.submenu ? "menu" : undefined}
            aria-expanded={item.submenu ? open === item.label : undefined}
            onClick={item.disabled ? undefined : item.submenu ? () => setOpen(item.label) : item.action}
            disabled={item.disabled}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left cursor-pointer transition-colors disabled:cursor-default"
            style={{
              color: item.disabled ? DISABLED_COLOR : item.danger ? "var(--color-vsc-error)" : "var(--color-vsc-text)",
              background: open === item.label ? "var(--color-vsc-list-hover)" : undefined,
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) (e.currentTarget as HTMLElement).style.background = "var(--color-vsc-list-hover)";
            }}
            onMouseLeave={(e) => {
              if (open !== item.label) (e.currentTarget as HTMLElement).style.background = "";
            }}
          >
            <span className="flex-1">{item.label}</span>
            {item.submenu && (
              <span aria-hidden style={{ color: "var(--color-vsc-text-muted)" }}>
                ›
              </span>
            )}
          </button>
          {item.submenu && open === item.label && <SubMenu label={item.label} items={item.submenu} />}
        </div>
      ))}
    </>
  );
}

function Menu({ menu }: { menu: ContextMenuState }) {
  const ref = useRef<HTMLDivElement>(null);
  // Placed at the pointer, moved up or left so that it stays in view.
  const [at, setAt] = useState({ left: menu.screenX, top: menu.screenY });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const b = boundsOf(el);
    const left = r.right > b.right ? Math.max(0, menu.screenX - (r.right - b.right) - 4) : menu.screenX;
    const top = r.bottom > b.bottom ? Math.max(0, menu.screenY - r.height) : menu.screenY;
    if (left !== menu.screenX || top !== menu.screenY) setAt({ left, top });
  }, [menu.screenX, menu.screenY]);
  return (
    <div
      ref={ref}
      role="menu"
      data-context-menu
      className="absolute z-50 py-1 rounded-md shadow-xl min-w-[140px]"
      style={{ ...at, ...MENU_STYLE }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <MenuItems items={menu.items} />
    </div>
  );
}

export function ContextMenuOverlay({ menu }: ContextMenuOverlayProps) {
  if (!menu) return null;
  return <Menu key={`${menu.screenX},${menu.screenY},${menu.items.map((i) => i.label).join("|")}`} menu={menu} />;
}
