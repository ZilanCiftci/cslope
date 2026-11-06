import type { ReactNode } from "react";
import { HelpButton } from "../../components/ui/HelpButton";

/**
 * The top of a tool window: the heading (12 px semibold), an optional "?"
 * next to it that opens the documentation, and one muted 11 px sentence
 * saying what the window is for (docs/design-rules.md, "Dialogs and windows").
 */
export function DialogHeader({
  title,
  description,
  help,
}: {
  title: string;
  /** One sentence: what the window is for. */
  description: ReactNode;
  help?: { topic: string; page: string };
}) {
  return (
    <div className="pb-2">
      <div className="flex items-center gap-1.5">
        <h2 className="text-[12px] font-semibold">{title}</h2>
        {help && <HelpButton topic={help.topic} page={help.page} />}
      </div>
      <p className="text-[11px] mt-0.5" style={{ color: "var(--color-vsc-text-muted)" }}>
        {description}
      </p>
    </div>
  );
}

/**
 * A group heading inside a window body (10 px bold uppercase, 0.08 em
 * tracking, muted), as `h3` under the window's `h2`.
 */
export function WindowSubheading({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h3
      className={`text-[10px] font-bold uppercase tracking-[0.08em] ${className}`}
      style={{ color: "var(--color-vsc-text-muted)" }}
    >
      {children}
    </h3>
  );
}
