import { type ReactNode } from "react";

export function Label({ children }: { children: ReactNode }) {
  return (
    <span
      className="text-[10px] font-medium uppercase tracking-wider"
      style={{ color: "var(--color-vsc-text-muted)" }}
    >
      {children}
    </span>
  );
}
