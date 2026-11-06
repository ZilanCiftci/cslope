import type { ReactNode } from "react";
import { HelpButton } from "../../components/ui/HelpButton";

/**
 * Section header inside a dialog window: small caps with a rule below,
 * and a "?" at the right that opens the documentation (`help`).
 */
export function GroupHeading({
  children,
  help,
}: {
  children: ReactNode;
  /** The documentation of the section: a page under /docs at a heading. */
  help?: { topic: string; page: string };
}) {
  return (
    <h3
      className={`text-[10px] font-semibold uppercase tracking-wider mt-4 first:mt-0 mb-2 pb-1${help ? " flex items-center" : ""}`}
      style={{
        // Muted text (4.5:1 on the panels), a faded rule below.
        color: "var(--color-vsc-text-muted)",
        borderBottom: "1px solid color-mix(in srgb, var(--color-vsc-border) 60%, transparent)",
      }}
    >
      {children}
      {help && (
        <span className="ml-auto pl-2">
          <HelpButton topic={help.topic} page={help.page} />
        </span>
      )}
    </h3>
  );
}
