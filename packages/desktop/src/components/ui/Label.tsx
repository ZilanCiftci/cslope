import { type ReactNode } from "react";

export function Label({
  children,
  title,
}: {
  children: ReactNode;
  /** Optional tooltip explaining the field. */
  title?: string;
}) {
  return (
    <span
      title={title}
      className="text-[10px] font-medium uppercase tracking-wider"
      style={{ color: "var(--color-vsc-text-muted)" }}
    >
      {children}
    </span>
  );
}
