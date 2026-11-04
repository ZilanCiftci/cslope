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
  /** The model's last analysis failed. */
  hasError?: boolean;
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
  hasError = false,
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
  const state = isRunning
    ? { label: "Analysing", fill: "var(--color-vsc-accent)" }
    : hasError
      ? { label: "Analysis failed", fill: "var(--color-vsc-error)" }
      : hasResult
        ? { label: "Analysed", fill: "var(--color-vsc-success)" }
        : { label: "Not analysed", fill: null };

  return (
    <div
      className="group flex items-center gap-2 px-4 py-[5px] cursor-pointer text-[12px] select-none rounded-sm mx-1 transition-colors"
      style={{
        background: isActive
          ? "var(--color-vsc-selected-bg)"
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
      {/* The run state as a dot before the box: green analysed, blue
          running, red failed, hollow grey not run. Selection is shown
          by the row background only. */}
      <span
        data-testid={isRunning ? "model-running" : undefined}
        role="img"
        aria-label={state.label}
        title={state.label}
        className={`w-[7px] h-[7px] rounded-full shrink-0 box-border${isRunning ? " animate-pulse" : ""}`}
        style={{
          background: state.fill ?? "transparent",
          border: state.fill ? undefined : "1px solid var(--color-vsc-text-muted)",
        }}
      />
      <Box size={16} strokeWidth={1.75} className="shrink-0" aria-hidden color="var(--color-vsc-text-muted)" />

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
        // Up to two lines: long names (the examples, the verification
        // problems) were cut off after about 25 characters.
        <span className="line-clamp-2 break-words flex-1 min-w-0" title={model.name}>
          {model.name}
        </span>
      )}
    </div>
  );
}
