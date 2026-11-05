import { openDocumentation } from "../../utils/docs";

/**
 * A small "?" at a section heading: opens the documentation at the part
 * that explains the section (what the tooltips leave out).
 */
export function HelpButton({ topic, page }: { topic: string; page: string }) {
  return (
    <button
      type="button"
      aria-label={`Help: ${topic}`}
      title={`Help: ${topic} (opens the documentation)`}
      onClick={(e) => {
        // Not the label or summary it may sit in.
        e.preventDefault();
        e.stopPropagation();
        openDocumentation(page);
      }}
      className="inline-flex shrink-0 items-center justify-center w-[15px] h-[15px] rounded-full text-[10px] font-semibold leading-none cursor-pointer hover:bg-[var(--color-vsc-list-hover)]"
      style={{
        color: "var(--color-vsc-text-muted)",
        border: "1px solid var(--color-vsc-border)",
        textTransform: "none",
        letterSpacing: 0,
      }}
    >
      ?
    </button>
  );
}
