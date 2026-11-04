import { Box } from "lucide-react";
import type React from "react";
import type { ModelEntry } from "../../store/types";

interface Props {
  model: ModelEntry;
  isActive: boolean;
  isSelected: boolean;
  isEditing: boolean;
  hasResult: boolean;
  /** The model's analysis is running (a single run or Run All). */
  isRunning?: boolean;
  editName: string;
  onChangeName: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onStartRename: (id: string, name: string) => void;
  onSelect: (e: React.MouseEvent) => void;
  onContextMenu: (
    e: React.MouseEvent,
    modelId: string,
    modelName: string,
  ) => void;
  isDragSource: boolean;
  isDropBefore: boolean;
  isDropAfter: boolean;
  onDragStart: (modelId: string) => void;
  onDragOver: (e: React.DragEvent<HTMLElement>, modelId: string) => void;
  onDrop: (e: React.DragEvent<HTMLElement>, modelId: string) => void;
  onDragEnd: () => void;
}

export function ModelRow({
  model,
  isActive,
  isSelected,
  isEditing,
  hasResult,
  isRunning = false,
  editName,
  onChangeName,
  onCommitRename,
  onCancelRename,
  onStartRename,
  onSelect,
  onContextMenu,
  isDragSource,
  isDropBefore,
  isDropAfter,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: Props) {

  return (
    <div
      className="group flex items-center gap-2 px-4 py-[5px] cursor-pointer text-[12px] select-none rounded-sm mx-1 transition-colors"
      style={{
        background: isActive
          ? "var(--color-vsc-list-active)"
          : isSelected
            ? "var(--color-vsc-list-hover)"
            : undefined,
        color:
          isActive || isSelected
            ? "var(--color-vsc-text-bright)"
            : "var(--color-vsc-text)",
        opacity: isDragSource ? 0.5 : 1,
        borderTop: isDropBefore
          ? "1px solid var(--color-vsc-accent)"
          : "1px solid transparent",
        borderBottom: isDropAfter
          ? "1px solid var(--color-vsc-accent)"
          : "1px solid transparent",
      }}
      onMouseEnter={(e) => {
        if (!isActive && !isSelected)
          (e.currentTarget as HTMLElement).style.background =
            "var(--color-vsc-list-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isActive && !isSelected)
          (e.currentTarget as HTMLElement).style.background = "";
      }}
      onClick={(e) => {
        if (!isEditing) {
          // Forward click modifiers so Explorer can do range/toggle selection.
          onSelect(e);
        }
      }}
      onDoubleClick={() => onStartRename(model.id, model.name)}
      onContextMenu={(e) => onContextMenu(e, model.id, model.name)}
      draggable={!isEditing}
      onDragStart={() => onDragStart(model.id)}
      onDragOver={(e) => onDragOver(e, model.id)}
      onDrop={(e) => onDrop(e, model.id)}
      onDragEnd={onDragEnd}
      role="treeitem"
      aria-selected={isActive || isSelected}
      aria-label={model.name}
    >
      <Box
        size={16}
        strokeWidth={1.75}
        className="shrink-0"
        aria-hidden
        color={isActive ? "var(--color-vsc-text-bright)" : hasResult ? "var(--color-vsc-text)" : "var(--color-vsc-text-muted)"}
      />

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
          className="flex-1 min-w-0 py-0"
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="truncate flex-1" title={model.name}>
          {model.name}
        </span>
      )}
      {isRunning && (
        <span
          data-testid="model-running"
          role="img"
          aria-label="Analysing"
          title="Analysing"
          className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse"
          style={{ background: "var(--color-vsc-accent)" }}
        />
      )}
    </div>
  );
}
