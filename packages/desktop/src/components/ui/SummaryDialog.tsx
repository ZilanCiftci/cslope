import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  /** The dialog's heading, e.g. "Import from Dike.stix". */
  title: string;
  /** The summary, as plain text with line breaks. */
  text: string;
  onClose: () => void;
}

/**
 * A modal with a long plain-text summary (what an import or export did and
 * what did not carry over), scrollable, with a button that copies it.
 * Styled like the app's other modal dialogs (Model Properties).
 */
export function SummaryDialog({ title, text, onClose }: Props) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);

  // Escape closes; captured so that the canvas shortcuts below do not react.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-[560px] max-w-[92vw] rounded-lg shadow-2xl flex flex-col max-h-[80vh]"
        style={{
          background: "var(--color-vsc-bg)",
          color: "var(--color-vsc-text)",
          border: "1px solid var(--color-vsc-border)",
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-vsc-border)]">
          <h3 className="font-semibold text-sm">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            className="w-6 h-6 flex items-center justify-center hover:bg-[var(--color-vsc-list-hover)] rounded cursor-pointer"
          >
            ✕
          </button>
        </div>
        <div
          className="flex-1 overflow-y-auto px-4 py-3 text-xs whitespace-pre-wrap select-text"
          data-testid="summary-text"
        >
          {text}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-vsc-border)]">
          {copied && (
            <span className="text-[11px] mr-auto" role="status">
              {copied === "yes" ? "Copied to the clipboard." : "Could not copy; select the text instead."}
            </span>
          )}
          <button
            type="button"
            onClick={() => void copy()}
            className="btn min-w-[80px]"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-primary min-w-[80px]"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
