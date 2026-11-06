import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface Props {
  /** The dialog's heading, also its accessible name. */
  title: string;
  /** One muted sentence under the heading saying what the dialog is for. */
  description?: ReactNode;
  onClose: () => void;
  /** Close (the X and Escape) does nothing, e.g. while a save runs. */
  closeDisabled?: boolean;
  /** Width class of the dialog, e.g. "w-[560px]". */
  widthClassName?: string;
  /** Status text at the left of the button row. */
  status?: ReactNode;
  /** The buttons, the default one (.btn-primary) last. */
  buttons: ReactNode;
  children: ReactNode;
}

/**
 * The frame of a modal dialog inside the main window (Model properties,
 * Save as anonymized, import and export summaries): a 12 px heading with a
 * muted sentence under it, a close button, a scrolling body and the
 * `.dialog-buttons` row under a top border. Escape closes; it is captured so
 * that the canvas shortcuts underneath do not react.
 */
export function ModalFrame({
  title,
  description,
  onClose,
  closeDisabled,
  widthClassName = "w-[560px]",
  status,
  buttons,
  children,
}: Props) {
  const headingId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (!closeDisabled) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, closeDisabled]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "var(--color-vsc-backdrop)" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={description ? descriptionId : undefined}
        className={`${widthClassName} max-w-[94vw] max-h-[90vh] rounded flex flex-col text-[12px]`}
        style={{
          background: "var(--color-vsc-bg)",
          color: "var(--color-vsc-text)",
          border: "1px solid var(--color-vsc-border)",
          boxShadow: "var(--color-vsc-shadow-float)",
        }}
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[var(--color-vsc-border)]">
          <div className="min-w-0">
            <h3 id={headingId} className="text-[12px] font-semibold">
              {title}
            </h3>
            {description && (
              <p id={descriptionId} className="text-[11px] mt-0.5" style={{ color: "var(--color-vsc-text-muted)" }}>
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label="Close"
            title="Close (Esc)"
            className="w-6 h-6 shrink-0 flex items-center justify-center rounded-xs cursor-pointer hover:bg-[var(--color-vsc-list-hover)] disabled:cursor-default disabled:opacity-50"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            <X size={13} strokeWidth={1.75} aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>

        <div className="dialog-buttons items-center px-4 py-3 border-t border-[var(--color-vsc-border)]">
          {status && <div className="text-[11px] mr-auto min-w-0">{status}</div>}
          {buttons}
        </div>
      </div>
    </div>,
    document.body,
  );
}
