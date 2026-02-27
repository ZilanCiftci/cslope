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
    <div className="flex flex-col items-center h-full justify-between py-1">
      <div className="flex items-center gap-1 flex-1">{children}</div>
      {label && (
        <span
          className="text-[9px] uppercase tracking-wider"
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
  active,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={disabled ? undefined : onClick}
      className="w-14 h-12 rounded flex flex-col items-center justify-center gap-0.5 cursor-pointer"
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
      <span className="text-[10px] leading-tight">{label}</span>
    </button>
  );
}

// ── RibbonSep ──

export function RibbonSep() {
  return (
    <div
      className="w-px h-14 mx-1.5"
      style={{ background: "var(--color-vsc-border)" }}
    />
  );
}
