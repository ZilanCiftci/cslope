import type { ReactNode } from "react";

/**
 * The layout of a tool window (Sensitivity, Probabilistic analysis): a
 * heading, one scrolling body and a row of buttons ending in Close, as in
 * the other dialog windows.
 */
export function ToolWindowFrame({
  title,
  description,
  waiting,
  footer,
  children,
}: {
  title: string;
  description: string;
  /** The main window has not sent the model yet. */
  waiting?: boolean;
  /** Buttons left of Close. */
  footer?: ReactNode;
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
        <p className="text-[10px] mt-0.5" style={{ color: "var(--color-vsc-text-muted)" }}>
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
        className="pt-3 mt-2 border-t flex items-center gap-2"
        style={{ borderColor: "var(--color-vsc-border)" }}
      >
        <div className="flex-1 min-w-0">{footer}</div>
        <button onClick={() => window.close()} className="btn min-w-[80px]">
          Close
        </button>
      </div>
    </div>
  );
}
