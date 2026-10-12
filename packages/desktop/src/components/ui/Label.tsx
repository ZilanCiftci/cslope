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
      className="text-[11px] font-medium"
      style={{ color: "var(--color-vsc-text-muted)" }}
    >
      {children}
    </span>
  );
}
