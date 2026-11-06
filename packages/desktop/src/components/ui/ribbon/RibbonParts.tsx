import type React from "react";
import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { DISABLED_COLOR } from "../disabled-style";
import { Menu, MenuItem } from "../Menu";
import { MENU_Z, useMenuDismiss } from "../menu-parts";

/**
 * The compact ribbon: a tab's commands in groups with a caption under
 * each. The primary commands of a tab are large buttons (a 20 px icon
 * above an 11 px label, 50 px tall); the others are small buttons (a
 * 16 px icon with the label beside it, 24 px tall) stacked in pairs. The
 * icons (components/icons/ribbon) are monochrome at stroke 1.5; the accent
 * colour marks only the active tab and pressed toggles. The icon props are
 * in icon-props.ts.
 */

const HOVER = "hover:bg-[var(--color-vsc-list-hover)]";

// ── RibbonGroup ──

export function RibbonGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center h-full justify-between">
      <div className="flex items-start gap-0.5 flex-1">{children}</div>
      {label && (
        <span
          className="text-[11px] leading-[13px] whitespace-nowrap mt-px"
          style={{ color: "var(--color-vsc-text-muted)" }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

// ── RibbonStack ──

/**
 * Small buttons stacked in pairs: two rows of 24 px, filled column by
 * column, as tall as a large button.
 */
export function RibbonStack({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-flow-col grid-rows-[repeat(2,1.5rem)] gap-0.5">
      {children}
    </div>
  );
}

// ── RibbonButton ──

/** A large button: a primary command of its tab. */
export function RibbonButton({
  icon,
  label,
  shortcut,
  onClick,
  disabled,
  disabledTitle,
  tooltip,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  /** Tooltip when it says more than the label. */
  tooltip?: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  /** Tooltip while disabled: why the button cannot be used. */
  disabledTitle?: string;
  active?: boolean;
}) {
  const explainDisabled = disabled && disabledTitle;
  const name = tooltip ?? label;
  const title = explainDisabled
    ? disabledTitle
    : shortcut
      ? `${name} (${shortcut})`
      : name;
  return (
    <button
      title={title}
      aria-label={explainDisabled ? label : undefined}
      onClick={disabled ? undefined : onClick}
      // At least 58 px wide; a longer label widens the button.
      className={`min-w-[58px] h-[50px] px-2 rounded-xs flex flex-col items-center justify-center gap-[5px] cursor-pointer whitespace-nowrap ${disabled ? "" : HOVER}`}
      style={{
        color: disabled
          ? DISABLED_COLOR
          : active
            ? "var(--color-vsc-text-bright)"
            : "var(--color-vsc-text)",
        background: active ? "var(--color-vsc-list-active)" : "transparent",
      }}
      aria-disabled={disabled || undefined}
      data-size="large"
    >
      <span className="flex items-center justify-center">{icon}</span>
      <span className="text-[11px] leading-none">{label}</span>
    </button>
  );
}

// ── Ribbon menus ──

/**
 * The stacking level of a ribbon popup: over the canvas and its rulers
 * (the canvas is an isolated stacking context, see EditCanvas), under
 * dialogs.
 */
export const RIBBON_POPUP_Z = MENU_Z;

/** A command of a ribbon menu; a disabled one says why in its tooltip. */
export interface RibbonMenuItem {
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  /** Tooltip while disabled: why the command cannot be used. */
  disabledTitle?: string;
}

/** Open state of a ribbon menu: closes on Escape or a click outside `ref`. */
function useRibbonMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useMenuDismiss(open, [ref], () => setOpen(false));
  return { open, setOpen, ref };
}

/** The list of a ribbon menu, below its button. */
function RibbonMenuList({
  label,
  items,
  top,
  onChoose,
}: {
  label: string;
  items: RibbonMenuItem[];
  /** Tailwind top offset. */
  top: string;
  onChoose: () => void;
}) {
  return (
    <Menu label={label} onClose={onChoose} className={`absolute ${top} left-0 ${RIBBON_POPUP_Z}`}>
      {items.map((it) => (
        <MenuItem
          key={it.label}
          title={it.title ?? it.label}
          disabled={it.disabled}
          disabledTitle={it.disabledTitle}
          onClick={() => {
            onChoose();
            it.onClick();
          }}
        >
          {it.label}
        </MenuItem>
      ))}
    </Menu>
  );
}

/**
 * A small ribbon button that opens a menu of commands below it (File ›
 * Import, File › Export). Closes on a choice, Escape or a click elsewhere.
 */
export function RibbonMenuButton({
  icon,
  label,
  items,
}: {
  icon: React.ReactNode;
  label: string;
  items: RibbonMenuItem[];
}) {
  const { open, setOpen, ref } = useRibbonMenu();
  return (
    <div className="relative" ref={ref}>
      <button
        title={label}
        onClick={() => setOpen(!open)}
        className={`w-full h-6 pl-[5px] pr-[7px] rounded-xs flex items-center gap-[5px] cursor-pointer whitespace-nowrap ${HOVER}`}
        style={{
          color: "var(--color-vsc-text)",
          background: open ? "var(--color-vsc-list-active)" : "transparent",
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        data-size="small"
      >
        <span
          className="flex items-center justify-center shrink-0"
          style={{ color: "var(--color-vsc-text-muted)" }}
        >
          {icon}
        </span>
        <span className="text-[11px] leading-none">{label}</span>
        <Chevron />
      </button>
      {open && <RibbonMenuList label={label} items={items} top="top-[1.6rem]" onChoose={() => setOpen(false)} />}
    </div>
  );
}

/**
 * A large split button: a click on the button runs its main command, the
 * chevron below the label opens a menu of related commands (Model ›
 * Drawing). Closes on a choice, Escape or a click elsewhere.
 */
export function RibbonSplitButton({
  icon,
  label,
  tooltip,
  onClick,
  menuLabel,
  items,
}: {
  icon: React.ReactNode;
  label: string;
  /** Tooltip of the main command. */
  tooltip?: string;
  onClick: () => void;
  /** Tooltip and name of the menu. */
  menuLabel: string;
  items: RibbonMenuItem[];
}) {
  const { open, setOpen, ref } = useRibbonMenu();
  return (
    <div className="relative" ref={ref}>
      <button
        title={tooltip ?? label}
        onClick={() => {
          setOpen(false);
          onClick();
        }}
        className={`min-w-[58px] h-[50px] pl-2 pr-4 rounded-xs flex flex-col items-center justify-center gap-[5px] cursor-pointer whitespace-nowrap ${HOVER}`}
        style={{
          color: "var(--color-vsc-text)",
          background: open ? "var(--color-vsc-list-active)" : "transparent",
        }}
        data-size="large"
      >
        <span className="flex items-center justify-center">{icon}</span>
        <span className="text-[11px] leading-none">{label}</span>
      </button>
      <button
        onClick={() => setOpen(!open)}
        // 16 px wide in the button's right padding, 24 px tall: a target
        // as tall as an icon button, with the chevron beside the label.
        className={`absolute bottom-0 right-0 w-4 h-6 rounded-xs flex items-center justify-center cursor-pointer ${HOVER}`}
        style={{ background: "transparent", border: "none", padding: 0 }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={menuLabel}
        title={menuLabel}
      >
        <Chevron />
      </button>
      {open && <RibbonMenuList label={menuLabel} items={items} top="top-[3.25rem]" onChoose={() => setOpen(false)} />}
    </div>
  );
}

// ── RibbonSmallButton ──

/**
 * A small ribbon button: a 16 px icon with its label beside it. A toggle
 * (`active` given) shows its pressed state with the accent colour.
 */
export function RibbonSmallButton({
  icon,
  label,
  title,
  shortcut,
  onClick,
  active,
  hasDropdown,
  expanded,
}: {
  icon: React.ReactNode;
  label: string;
  /** Tooltip; the label by default. */
  title?: string;
  shortcut?: string;
  onClick: () => void;
  /** A toggle's state; leave undefined for a plain button. */
  active?: boolean;
  /** Opens a popup below it (with a chevron); `expanded` while it is open. */
  hasDropdown?: boolean;
  expanded?: boolean;
}) {
  const name = title ?? label;
  return (
    <button
      title={shortcut ? `${name} (${shortcut})` : name}
      onClick={onClick}
      className={`h-6 pl-[5px] pr-[7px] rounded-xs flex items-center gap-[5px] cursor-pointer whitespace-nowrap ${HOVER}`}
      style={{
        color: "var(--color-vsc-text)",
        background: active ? "var(--color-vsc-selected-bg)" : "transparent",
        border: "1px solid",
        borderColor: active ? "var(--color-vsc-accent)" : "transparent",
      }}
      aria-pressed={active}
      aria-expanded={hasDropdown ? (expanded ?? false) : undefined}
      data-size="small"
    >
      <span
        className="flex items-center justify-center shrink-0"
        style={{
          color: active ? "var(--color-vsc-accent)" : "var(--color-vsc-text-muted)",
        }}
      >
        {icon}
      </span>
      <span className="text-[11px] leading-none">{label}</span>
      {hasDropdown && <Chevron />}
    </button>
  );
}

/** The small chevron of a button that opens a menu. */
export function Chevron() {
  return (
    <ChevronDown
      size={11}
      strokeWidth={2}
      className="shrink-0 -ml-0.5"
      style={{ color: "var(--color-vsc-text-muted)" }}
      aria-hidden
    />
  );
}

// ── RibbonSep ──

export function RibbonSep() {
  return (
    <div
      className="w-px h-[46px] mx-[7px] mt-0.5 shrink-0 self-start"
      style={{ background: "var(--color-vsc-border)", opacity: 0.8 }}
    />
  );
}
