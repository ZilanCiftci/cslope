import { useLayoutEffect, useRef, useState } from "react";
import type { ContextMenuItem, ContextMenuState } from "./types";
import { Menu, MenuItem, MenuSeparator } from "../../components/ui/Menu";

interface ContextMenuOverlayProps {
  menu: ContextMenuState | null;
}

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
    <Menu
      ref={ref}
      label={label}
      className="absolute"
      style={{
        ...(flip.left ? { right: "100%" } : { left: "100%" }),
        ...(flip.up ? { bottom: 0 } : { top: 0 }),
      }}
    >
      <MenuItems items={items} />
    </Menu>
  );
}

function MenuItems({ items }: { items: ContextMenuItem[] }) {
  // The submenu shown: that of the item last hovered.
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      {items.map((item) => (
        <div key={item.label} className="relative" onMouseEnter={() => setOpen(item.submenu && !item.disabled ? item.label : null)}>
          {item.separator && <MenuSeparator />}
          <MenuItem
            aria-expanded={item.submenu ? open === item.label : undefined}
            submenu={!!item.submenu}
            highlighted={open === item.label}
            disabled={item.disabled}
            danger={item.danger}
            onClick={item.submenu ? () => setOpen(item.label) : item.action}
          >
            {item.label}
          </MenuItem>
          {item.submenu && open === item.label && <SubMenu label={item.label} items={item.submenu} />}
        </div>
      ))}
    </>
  );
}

function CanvasMenu({ menu }: { menu: ContextMenuState }) {
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
    <Menu
      ref={ref}
      data-context-menu
      className="absolute z-50"
      style={at}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <MenuItems items={menu.items} />
    </Menu>
  );
}

export function ContextMenuOverlay({ menu }: ContextMenuOverlayProps) {
  if (!menu) return null;
  return <CanvasMenu key={`${menu.screenX},${menu.screenY},${menu.items.map((i) => i.label).join("|")}`} menu={menu} />;
}
