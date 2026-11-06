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

/**
 * The frame of a workspace window (Place drawing, New models from
 * drawing): the same heading and sentence as the other windows, a body
 * that fills the window edge to edge (strips, a viewer, side panels) and
 * the full-width `.dialog-buttons` row under a top border: status and
 * secondary actions at the left, Cancel and the primary action (last) at
 * the right.
 */
export function WorkspaceWindowFrame({
  title,
  description,
  status,
  buttons,
  children,
}: {
  title: string;
  description: ReactNode;
  /** Status text and secondary actions, at the left of the button row. */
  status?: ReactNode;
  /** The buttons at the right, the default one (.btn-primary) last. */
  buttons: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className="h-screen flex flex-col text-[12px]"
      style={{
        background: "var(--color-vsc-bg)",
        color: "var(--color-vsc-text)",
      }}
    >
      <div className="px-3 pt-3 pb-2 shrink-0">
        <h2 className="text-[12px] font-semibold">{title}</h2>
        <p className="text-[11px] mt-0.5" style={{ color: "var(--color-vsc-text-muted)" }}>
          {description}
        </p>
      </div>

      <div className="flex-1 min-h-0 flex flex-col border-t" style={{ borderColor: "var(--color-vsc-border)" }}>
        {children}
      </div>

      <div
        className="p-3 border-t dialog-buttons items-center text-[11px] shrink-0"
        style={{ borderColor: "var(--color-vsc-border)" }}
      >
        {status}
        <span className="flex-1" />
        {buttons}
      </div>
    </div>
  );
}
