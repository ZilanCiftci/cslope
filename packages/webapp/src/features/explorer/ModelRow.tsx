import type React from "react";
import type { ModelEntry } from "../../store/types";

interface Props {
  model: ModelEntry;
  isActive: boolean;
  isEditing: boolean;
  editName: string;
  onChangeName: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onStartRename: (id: string, name: string) => void;
  onSelect: () => void;
  onContextMenu: (
    e: React.MouseEvent,
    modelId: string,
    modelName: string,
  ) => void;
}

export function ModelRow({
  model,
  isActive,
  isEditing,
  editName,
  onChangeName,
  onCommitRename,
  onCancelRename,
  onStartRename,
  onSelect,
  onContextMenu,
}: Props) {
  const gradientId = `fg-${model.id}`;

  return (
    <div
      className="group flex items-center gap-2 px-4 py-[5px] cursor-pointer text-[12px] select-none rounded-sm mx-1 transition-colors"
      style={{
        background: isActive ? "var(--color-vsc-list-active)" : undefined,
        color: isActive
          ? "var(--color-vsc-text-bright)"
          : "var(--color-vsc-text)",
      }}
      onMouseEnter={(e) => {
        if (!isActive)
          (e.currentTarget as HTMLElement).style.background =
            "var(--color-vsc-list-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.background = "";
      }}
      onClick={() => {
        if (!isEditing) onSelect();
      }}
      onDoubleClick={() => onStartRename(model.id, model.name)}
      onContextMenu={(e) => onContextMenu(e, model.id, model.name)}
      role="treeitem"
      aria-selected={isActive}
      aria-label={model.name}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        className="shrink-0"
        aria-hidden
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop
              offset="0%"
              stopColor={isActive ? "#4361ee" : "var(--color-vsc-text-muted)"}
            />
            <stop
              offset="100%"
              stopColor={isActive ? "#06d6a0" : "var(--color-vsc-text-muted)"}
            />
          </linearGradient>
        </defs>
        <path
          d="M2.1 3.8H6.1L9.2 6.8H13.7V12.2H2.1Z"
          fill={`url(#${gradientId})`}
          opacity={0.2}
        />
        <path
          d="M2.1 3.8H6.1L9.2 6.8H13.7V12.2H2.1Z"
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="1.2"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.98}
        />
      </svg>

      {isEditing ? (
        <input
          type="text"
          value={editName}
          onChange={(e) => onChangeName(e.target.value)}
          onBlur={onCommitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitRename();
            if (e.key === "Escape") onCancelRename();
          }}
          className="flex-1 min-w-0 px-1.5 py-0 text-[12px] rounded"
          style={{
            background: "var(--color-vsc-input-bg)",
            border: "1px solid var(--color-vsc-accent)",
            color: "var(--color-vsc-text)",
          }}
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="truncate flex-1">{model.name}</span>
      )}
    </div>
  );
}
