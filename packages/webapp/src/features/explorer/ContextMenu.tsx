import { useEffect, useRef } from "react";

export interface MenuPos {
  x: number;
  y: number;
  modelId: string;
  modelName: string;
}

interface Props {
  pos: MenuPos;
  onClose: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onProperties: () => void;
  canDelete: boolean;
}

export function ContextMenu({
  pos,
  onClose,
  onRename,
  onDuplicate,
  onDelete,
  onProperties,
  canDelete,
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
    icon: string;
    action: () => void;
    danger?: boolean;
    disabled?: boolean;
  }[] = [
    {
      label: "Properties",
      icon: "M10 20a10 10 0 100-20 10 10 0 000 20zm0-2a8 8 0 100-16 8 8 0 000 16zm-1-11a1 1 0 112 0 1 1 0 01-2 0zm0 4a1 1 0 112 0v5a1 1 0 11-2 0V11z",
      action: () => {
        onProperties();
        onClose();
      },
    },
    {
      label: "Rename",
      icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
      action: () => {
        onRename();
        onClose();
      },
    },
    {
      label: "Duplicate",
      icon: "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z",
      action: () => {
        onDuplicate();
        onClose();
      },
    },
    {
      label: "Delete",
      icon: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
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
      className="fixed z-50 py-1 rounded-md shadow-xl min-w-[160px]"
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
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
          >
            <path d={item.icon} />
          </svg>
          {item.label}
        </button>
      ))}
    </div>
  );
}
