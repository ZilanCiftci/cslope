import type { ReactNode } from "react";

/** Section header inside a dialog window: small caps with a rule below. */
export function GroupHeading({ children }: { children: ReactNode }) {
  return (
    <h3
      className="text-[10px] font-semibold uppercase tracking-wider mt-4 first:mt-0 mb-2 pb-1"
      style={{
        color: "var(--color-vsc-text-secondary, var(--color-vsc-text))",
        opacity: 0.6,
        borderBottom: "1px solid var(--color-vsc-border)",
      }}
    >
      {children}
    </h3>
  );
}
