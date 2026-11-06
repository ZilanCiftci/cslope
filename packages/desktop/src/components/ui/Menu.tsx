import type React from "react";
import { forwardRef, useLayoutEffect, useRef } from "react";
import { Check } from "lucide-react";
import { DISABLED_COLOR } from "./disabled-style";
import { MENU_FRAME_CLASS, MENU_FRAME_STYLE } from "./menu-parts";

/**
 * The one menu of the app: every menu (the Models context menu, the
 * canvas context menus, the ribbon dropdowns, the run menu, Insert
 * variable, the material picker) is a `Menu` of `MenuItem`s. Text only,
 * 12 px, items 22 px high; the input background, a 1 px border, 2 px
 * corners and the floating shadow. No icons: a color swatch or a check
 * mark is content, not an icon.
 *
 * The keyboard: the arrows, Home and End move between the enabled items,
 * Enter or Space runs the focused one, Escape (and Tab) close the menu
 * when it has `onClose`. Hovering an item focuses it, so the pointer and
 * the keyboard share one highlight.
 */

/** The items of `menu` itself, not those of a submenu inside it. */
function ownItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
    (el) => el.closest('[role="menu"]') === menu,
  );
}

function enabled(items: HTMLElement[]): HTMLElement[] {
  return items.filter((el) => el.getAttribute("aria-disabled") !== "true");
}

function focusItem(el: HTMLElement | undefined) {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView?.({ block: "nearest" });
}

export type MenuProps = Omit<React.HTMLAttributes<HTMLDivElement>, "role"> & {
  /** The menu's accessible name. */
  label?: string;
  /** Closes the menu: Escape and Tab in it call this. */
  onClose?: () => void;
  /** Focus an item when the menu opens: the first or the last enabled one. */
  initialFocus?: "first" | "last";
  /** Minimum width in px (160 by default). */
  minWidth?: number;
};

/** A menu: its frame, its keyboard and the `menu` role. */
export const Menu = forwardRef<HTMLDivElement, MenuProps>(function Menu(
  { label, onClose, initialFocus, minWidth = 160, className = "", style, onKeyDown, children, ...rest },
  forwarded,
) {
  const own = useRef<HTMLDivElement | null>(null);
  const setRef = (el: HTMLDivElement | null) => {
    own.current = el;
    if (typeof forwarded === "function") forwarded(el);
    else if (forwarded) forwarded.current = el;
  };

  useLayoutEffect(() => {
    if (!initialFocus || !own.current) return;
    const items = enabled(ownItems(own.current));
    focusItem(initialFocus === "first" ? items[0] : items.at(-1));
    // Only when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    const menu = own.current;
    if (e.defaultPrevented || !menu) return;
    // A key in a submenu is that submenu's.
    if ((e.target as HTMLElement).closest?.('[role="menu"]') !== menu && e.target !== menu) return;
    const items = enabled(ownItems(menu));
    const at = items.indexOf(document.activeElement as HTMLElement);
    const n = items.length;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        e.stopPropagation();
        if (n === 0) return;
        const step = e.key === "ArrowDown" ? 1 : -1;
        const next = at < 0 ? (step > 0 ? 0 : n - 1) : (at + step + n) % n;
        focusItem(items[next]);
        return;
      }
      case "Home":
      case "End":
        e.preventDefault();
        e.stopPropagation();
        focusItem(e.key === "Home" ? items[0] : items[n - 1]);
        return;
      case "Enter":
      case " ":
        if (at >= 0) {
          e.preventDefault();
          e.stopPropagation();
          items[at].click();
        }
        return;
      case "Escape":
        if (onClose) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
        return;
      case "Tab":
        onClose?.();
        return;
    }
  };

  return (
    <div
      ref={setRef}
      role="menu"
      aria-label={label}
      onKeyDown={handleKey}
      className={`${MENU_FRAME_CLASS} ${className}`}
      style={{ ...MENU_FRAME_STYLE, minWidth, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
});

export type MenuItemProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "role"> & {
  /** Off: shown in the disabled color, skipped by the keyboard, does nothing. */
  disabled?: boolean;
  /** Tooltip while disabled: why the item cannot be used. */
  disabledTitle?: string;
  /** A destructive command (Delete): the error color. */
  danger?: boolean;
  /** Opens a submenu: a "›" at the end. */
  submenu?: boolean;
  /** Highlighted without hover or focus (its submenu is open). */
  highlighted?: boolean;
  /** A choice among several: a check mark before the current one. */
  checked?: boolean;
  /** A second line, 10 px muted (what the item is). */
  detail?: React.ReactNode;
  /** `menuitem` in a menu; `null` in a panel of choices that is not a menu (a plain button). */
  role?: "menuitem" | null;
};

/** One command of a menu: 22 px high, 12 px text. */
export const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(function MenuItem(
  {
    disabled,
    disabledTitle,
    danger,
    submenu,
    highlighted,
    checked,
    detail,
    role = "menuitem",
    title,
    onClick,
    onMouseEnter,
    className = "",
    style,
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role={role ?? undefined}
      tabIndex={role ? -1 : undefined}
      title={disabled && disabledTitle ? disabledTitle : title}
      aria-disabled={disabled || undefined}
      aria-haspopup={submenu ? "menu" : undefined}
      aria-pressed={role === null && checked !== undefined ? checked : undefined}
      onClick={(e) => {
        if (disabled) return;
        onClick?.(e);
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.focus({ preventScroll: true });
        onMouseEnter?.(e);
      }}
      className={`w-full min-h-[22px] flex items-center gap-2 pl-3 pr-4 text-left text-[12px] whitespace-nowrap outline-none border-0 ${
        disabled ? "cursor-default" : "cursor-pointer hover:bg-[var(--color-vsc-list-hover)] focus:bg-[var(--color-vsc-list-hover)]"
      } ${className}`}
      style={{
        color: disabled ? DISABLED_COLOR : danger ? "var(--color-vsc-error)" : "var(--color-vsc-text)",
        background: highlighted ? "var(--color-vsc-list-hover)" : undefined,
        ...style,
      }}
      {...rest}
    >
      {checked !== undefined && (
        <span className="w-3 shrink-0 flex items-center justify-center" aria-hidden>
          {checked && <Check size={12} strokeWidth={1.75} style={{ color: "var(--color-vsc-text-muted)" }} />}
        </span>
      )}
      {detail === undefined ? (
        <span className="flex-1 min-w-0">{children}</span>
      ) : (
        <span className="flex-1 min-w-0 py-0.5">
          <span className="block">{children}</span>
          <span className="block text-[10px] leading-tight whitespace-normal" style={{ color: "var(--color-vsc-text-muted)" }}>
            {detail}
          </span>
        </span>
      )}
      {submenu && (
        <span aria-hidden style={{ color: "var(--color-vsc-text-muted)" }}>
          ›
        </span>
      )}
    </button>
  );
});

/** A line between groups of items. */
export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px" style={{ background: "var(--color-vsc-border)" }} />;
}

/** A heading over items (not focusable): 11 px muted. */
export function MenuHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="pl-3 pr-4 pt-0.5 pb-0.5 text-[11px]" style={{ color: "var(--color-vsc-text-muted)" }} aria-hidden>
      {children}
    </div>
  );
}

/** A row of fields in a dropdown panel (a checkbox, a number): the items' padding and height. */
export function MenuField({
  children,
  title,
  separator,
}: {
  children: React.ReactNode;
  title?: string;
  /** A line above the row. */
  separator?: boolean;
}) {
  return (
    <label
      className="min-h-[22px] flex items-center gap-2 pl-3 pr-4 text-[12px] cursor-pointer select-none whitespace-nowrap"
      style={{ borderTop: separator ? "1px solid var(--color-vsc-border)" : undefined }}
      title={title}
    >
      {children}
    </label>
  );
}
