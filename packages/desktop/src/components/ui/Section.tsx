import { type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useAppStore } from "../../store/app-store";

/**
 * The type of a sidebar's section heading (MODELS, ATTACHMENTS, SUMMARY,
 * LAYERS, ...): 10 px bold uppercase with 0.08 em tracking.
 */
export const SECTION_HEADING_TEXT = "text-[10px] font-bold uppercase tracking-[0.08em] select-none";

/**
 * The height and padding of a section heading row, the same in both
 * sidebars (24 px, the icon buttons' height, between 1 px borders).
 */
export const SECTION_HEADING_ROW = "flex items-center gap-1.5 h-6 px-4";

/** The fold chevron of a section or a tree row: down when open, right when folded. */
export function FoldChevron({ open, size = 12 }: { open: boolean; size?: number }) {
  const Icon = open ? ChevronDown : ChevronRight;
  return <Icon size={size} strokeWidth={1.75} className="shrink-0" aria-hidden />;
}

interface SectionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Optional override for the activeSection key (e.g., prefixing for result view). */
  sectionKey?: string;
  /** Optional controlled mode: parent owns open state and toggling. */
  open?: boolean;
  onToggle?: () => void;
}

export function Section({
  title,
  children,
  defaultOpen,
  sectionKey,
  open,
  onToggle,
}: SectionProps) {
  const activeSection = useAppStore((s) => s.activeSection);
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const key = sectionKey ?? title;
  const isOpen =
    open ?? (activeSection === key || (defaultOpen && activeSection === null));

  const handleToggle = () => {
    if (onToggle) {
      onToggle();
      return;
    }
    setActiveSection(isOpen ? null : key);
  };

  return (
    <div style={{ borderBottom: "1px solid var(--color-vsc-border)" }}>
      <button
        onClick={handleToggle}
        aria-expanded={!!isOpen}
        className={`w-full ${SECTION_HEADING_ROW} ${SECTION_HEADING_TEXT} cursor-pointer`}
        style={{
          background: "var(--color-vsc-surface-tint)",
          color: "var(--color-vsc-text-muted)",
        }}
      >
        <FoldChevron open={!!isOpen} />
        {title}
      </button>
      {isOpen && (
        <div
          className="px-4 py-3 space-y-2.5"
          style={{ color: "var(--color-vsc-text)" }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
