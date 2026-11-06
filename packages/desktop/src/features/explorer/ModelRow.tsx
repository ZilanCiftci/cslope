import { Box } from "lucide-react";
import type React from "react";
import { FoldChevron } from "../../components/ui/Section";
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
  /** Whether the model's drawings are shown under it; undefined: it has none. */
  drawingsOpen?: boolean;
  onToggleDrawings?: () => void;
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
  drawingsOpen,
  onToggleDrawings,
}: Props) {
  const state = isRunning
    ? { label: "Analyzing", fill: "var(--color-vsc-accent)" }
    : hasError
      ? { label: "Analysis failed", fill: "var(--color-vsc-error)" }
      : hasResult
        ? { label: "Analyzed", fill: "var(--color-vsc-success)" }
        : { label: "Not analyzed", fill: null };

  return (
    <div
      // 24 px (a name on two lines grows it); the rename field fits in it.
      className="group relative flex items-center gap-2 min-h-6 py-px pl-1.5 pr-4 cursor-pointer text-[12px] select-none rounded-sm mx-1 transition-colors"
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
      aria-level={1}
      aria-expanded={drawingsOpen}
      aria-label={model.name}
      // The active model is the tree's one stop on the Tab key.
      tabIndex={isActive ? 0 : -1}
    >
      {/* The drop target: a line over or under the row (not a border, which
          would change the row's height). */}
      {(isDropBefore || isDropAfter) && (
        <span
          aria-hidden
          data-testid="model-drop-indicator"
          className="pointer-events-none absolute left-1 right-1 h-[2px] rounded-full"
          style={{ background: "var(--color-vsc-accent)", [isDropBefore ? "top" : "bottom"]: -1 }}
        />
      )}
      {/* Folds the model's drawings away (a slot of the same width without
          any). The button's 24 px hit area overhangs its 14 px slot. */}
      {drawingsOpen === undefined ? (
        <span className="w-[14px] shrink-0" aria-hidden />
      ) : (
        <button
          className="w-6 h-6 -mx-[5px] shrink-0 flex items-center justify-center rounded-sm hover:bg-(--color-vsc-list-active)"
          onClick={(e) => {
            e.stopPropagation();
            onToggleDrawings?.();
          }}
          aria-expanded={drawingsOpen}
          aria-label={drawingsOpen ? `Hide the drawings of ${model.name}` : `Show the drawings of ${model.name}`}
          title={drawingsOpen ? "Hide drawings" : "Show drawings"}
        >
          <FoldChevron open={drawingsOpen} />
        </button>
      )}
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
          className="flex-1 min-w-0 h-[22px] py-0"
          aria-label="Model name"
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
