import { useEffect, useRef } from "react";
import { Copy, Pencil, SlidersHorizontal, Trash2, type LucideIcon } from "lucide-react";

export interface MenuPos {
  x: number;
  y: number;
  modelId: string;
  modelName: string;
  selectedModelIds: string[];
}

interface Props {
  pos: MenuPos;
  onClose: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onProperties: () => void;
  canDelete: boolean;
  multiSelect: boolean;
}

export function ContextMenu({
  pos,
  onClose,
  onRename,
  onDuplicate,
  onDelete,
  onProperties,
  canDelete,
  multiSelect,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const items: {
    label: string;
    icon: LucideIcon;
    action: () => void;
    danger?: boolean;
    disabled?: boolean;
  }[] = [
    {
      label: "Model properties…",
      icon: SlidersHorizontal,
      action: () => {
        onProperties();
        onClose();
      },
    },
    {
      label: "Rename",
      icon: Pencil,
      action: () => {
        onRename();
        onClose();
      },
      disabled: multiSelect,
    },
    {
      label: "Duplicate",
      icon: Copy,
      action: () => {
        onDuplicate();
        onClose();
      },
      disabled: multiSelect,
    },
    {
      label: multiSelect
        ? `Delete selected (${pos.selectedModelIds.length})`
        : "Delete",
      icon: Trash2,
      action: () => {
        onDelete();
        onClose();
      },
      danger: true,
      disabled: !canDelete,
    },
  ];

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] py-1 rounded-md shadow-xl min-w-[160px] whitespace-nowrap"
      style={{
        left: pos.x,
        top: pos.y,
        background: "var(--color-vsc-input-bg)",
        border: "1px solid var(--color-vsc-border)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
      role="menu"
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={item.disabled ? undefined : item.action}
          disabled={item.disabled}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-left cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            color: item.danger
              ? "var(--color-vsc-error)"
              : "var(--color-vsc-text)",
          }}
          onMouseEnter={(e) => {
            if (!item.disabled)
              (e.currentTarget as HTMLElement).style.background =
                "var(--color-vsc-list-hover)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "";
          }}
          role="menuitem"
        >
          <item.icon
            size={14}
            strokeWidth={1.75}
            className="shrink-0"
            aria-hidden
            color={item.danger ? "currentColor" : "var(--color-vsc-text-muted)"}
          />
          {item.label}
        </button>
      ))}
    </div>
  );
}
