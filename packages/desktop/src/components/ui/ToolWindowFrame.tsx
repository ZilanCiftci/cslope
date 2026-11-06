import type { ReactNode } from "react";

/**
 * The layout of a tool window (Sensitivity, Probabilistic analysis): a
 * heading with one muted sentence under it, one scrolling body and the
 * `.dialog-buttons` row as in the other dialog windows: secondary actions
 * at the left, then the primary action and Close at the right.
 */
export function ToolWindowFrame({
  title,
  description,
  waiting,
  footer,
  primary,
  children,
}: {
  title: string;
  description: string;
  /** The main window has not sent the model yet. */
  waiting?: boolean;
  /** Secondary actions (export), at the left of the button row. */
  footer?: ReactNode;
  /** The primary action (Run) and its status, just left of Close. */
  primary?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className="h-screen flex flex-col p-3"
      style={{
        background: "var(--color-vsc-bg)",
        color: "var(--color-vsc-text)",
      }}
    >
      <div className="pb-2">
        <h2 className="text-[12px] font-semibold">{title}</h2>
        <p className="text-[11px] mt-0.5" style={{ color: "var(--color-vsc-text-muted)" }}>
          {description}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        {waiting ? (
          <p role="status" className="text-[11px]" style={{ color: "var(--color-vsc-text-muted)" }}>
            Waiting for the main window…
          </p>
        ) : (
          children
        )}
      </div>

      <div
        className="pt-3 mt-2 border-t dialog-buttons items-center text-[11px]"
        style={{ borderColor: "var(--color-vsc-border)" }}
      >
        {footer}
        <span className="flex-1" />
        {primary}
        <button onClick={() => window.close()} className="btn">
          Close
        </button>
      </div>
    </div>
  );
}
