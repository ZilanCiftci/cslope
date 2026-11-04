import type React from "react";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

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
        color: active
          ? "var(--color-vsc-text-bright)"
          : "var(--color-vsc-text)",
        background: active ? "var(--color-vsc-list-active)" : "transparent",
        opacity: disabled ? 0.4 : 1,
      }}
      role="menuitem"
      aria-disabled={disabled}
      data-size="large"
    >
      <span className="flex items-center justify-center">{icon}</span>
      <span className="text-[11px] leading-none">{label}</span>
    </button>
  );
}

// ── RibbonMenuButton ──

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
  items: { label: string; title?: string; onClick: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
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
        role="menuitem"
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
      {open && (
        <div
          className="absolute top-[1.6rem] left-0 rounded py-1 z-20"
          style={{
            background: "var(--color-vsc-panel)",
            border: "1px solid var(--color-vsc-border)",
            minWidth: 140,
            boxShadow: "0 6px 16px rgba(0,0,0,0.2)",
          }}
          role="menu"
          aria-label={label}
        >
          {items.map((it) => (
            <button
              key={it.label}
              title={it.title ?? it.label}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className="w-full text-left px-3 py-1.5 text-[11px] cursor-pointer whitespace-nowrap"
              style={{ background: "transparent", border: "none", color: "var(--color-vsc-text)" }}
              role="menuitem"
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
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
}: {
  icon: React.ReactNode;
  label: string;
  /** Tooltip; the label by default. */
  title?: string;
  shortcut?: string;
  onClick: () => void;
  /** A toggle's state; leave undefined for a plain button. */
  active?: boolean;
  hasDropdown?: boolean;
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
      aria-haspopup={hasDropdown ? "menu" : undefined}
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
