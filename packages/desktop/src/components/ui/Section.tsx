import { type ReactNode } from "react";
import { useAppStore } from "../../store/app-store";

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
        className="w-full flex items-center gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] select-none cursor-pointer"
        style={{
          background: "var(--color-vsc-surface-tint)",
          color: "var(--color-vsc-text-muted)",
        }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="currentColor"
          className="transition-transform"
          style={{ transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
        >
          <path d="M2 3l3 3.5L8 3z" />
        </svg>
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
