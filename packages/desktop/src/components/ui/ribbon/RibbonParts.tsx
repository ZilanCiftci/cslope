import type React from "react";

// ── RibbonGroup ──

export function RibbonGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center h-full justify-between py-0.5 px-0.5">
      <div className="flex items-center gap-1 flex-1">{children}</div>
      {label && (
        <span
          className="text-[9px] uppercase tracking-wider whitespace-nowrap"
          style={{ color: "var(--color-vsc-text-muted)" }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

// ── RibbonButton ──

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
      // At least 3.5 rem wide; a longer label widens the button (or wraps
      // onto two lines) instead of running into its neighbours.
      className="min-w-14 max-w-[5.75rem] h-12 px-1 rounded flex flex-col items-center justify-center gap-0.5 cursor-pointer"
      style={{
        color: active
          ? "var(--color-vsc-text-bright)"
          : "var(--color-vsc-text-muted)",
        background: active ? "var(--color-vsc-list-active)" : "transparent",
        opacity: disabled ? 0.35 : 1,
        filter: disabled ? "grayscale(1)" : "none",
      }}
      role="menuitem"
      aria-disabled={disabled}
    >
      <span className="flex items-center justify-center">{icon}</span>
      <span className="text-[10px] leading-tight text-center">{label}</span>
    </button>
  );
}

// ── RibbonSmallButton ──

/**
 * A compact ribbon button: a 16 px icon with its label beside it, for
 * groups that stack two rows of buttons (Display, Annotations).
 */
export function RibbonSmallButton({
  icon,
  label,
  title,
  onClick,
  active,
  hasDropdown,
}: {
  icon: React.ReactNode;
  label: string;
  /** Tooltip; the label by default. */
  title?: string;
  onClick: () => void;
  /** A toggle's state; leave undefined for a plain button. */
  active?: boolean;
  hasDropdown?: boolean;
}) {
  return (
    <button
      title={title ?? label}
      onClick={onClick}
      className="h-[22px] pl-1 pr-1.5 rounded flex items-center gap-1 cursor-pointer whitespace-nowrap"
      style={{
        color: active
          ? "var(--color-vsc-text-bright)"
          : "var(--color-vsc-text-muted)",
        background: active ? "var(--color-vsc-list-active)" : "transparent",
        border: "1px solid",
        borderColor: active ? "var(--color-vsc-accent)" : "transparent",
      }}
      aria-pressed={active}
      aria-haspopup={hasDropdown ? "menu" : undefined}
    >
      <span className="flex items-center justify-center shrink-0">{icon}</span>
      <span className="text-[10px] leading-none">{label}</span>
      {hasDropdown && (
        <span style={{ fontSize: 7, opacity: 0.6 }} aria-hidden>
          ▾
        </span>
      )}
    </button>
  );
}

// ── RibbonSep ──

export function RibbonSep() {
  return (
    <div
      className="w-px h-14 mx-1.5 shrink-0"
      style={{ background: "var(--color-vsc-border)" }}
    />
  );
}
