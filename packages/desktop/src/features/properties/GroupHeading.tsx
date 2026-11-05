import type { ReactNode } from "react";
import { HelpButton } from "../../components/ui/HelpButton";

/**
 * Section header inside a dialog window: 10 px bold uppercase in the muted
 * text color with a rule below, as every group heading in the windows, and
 * a "?" at the right that opens the documentation (`help`).
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
      className={`text-[10px] font-bold uppercase tracking-[0.08em] mt-4 first:mt-0 mb-2 pb-1${help ? " flex items-center" : ""}`}
      style={{
        color: "var(--color-vsc-text-muted)",
        borderBottom: "1px solid var(--color-vsc-border)",
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
