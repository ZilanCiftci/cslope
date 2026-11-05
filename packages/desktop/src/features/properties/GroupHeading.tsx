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
      style={
        help
          ? {
              // Faded text and rule as below, but the ? at full strength.
              color: "color-mix(in srgb, var(--color-vsc-text) 60%, transparent)",
              borderBottom: "1px solid color-mix(in srgb, var(--color-vsc-border) 60%, transparent)",
            }
          : {
              color: "var(--color-vsc-text)",
              opacity: 0.6,
              borderBottom: "1px solid var(--color-vsc-border)",
            }
      }
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
