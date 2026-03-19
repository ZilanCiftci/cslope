import { useCallback, useMemo, useState } from "react";
import { useAppStore, type ProjectInfo } from "../../store/app-store";
import { ContextMenu, type MenuPos } from "./ContextMenu";
import { ModelRow } from "./ModelRow";
import { ProjectInfoDialog } from "./ProjectInfoDialog";
import type { ModelEntry } from "../../store/types";

type DropPosition = "before" | "after";

function buildProjectInfo(model: ModelEntry): ProjectInfo {
  return {
    title: model.projectInfo?.title || model.name,
    subtitle: model.projectInfo?.subtitle || "",
    client: model.projectInfo?.client || "",
    projectNumber: model.projectInfo?.projectNumber || "",
    revision: model.projectInfo?.revision || "0",
    author: model.projectInfo?.author || "",
    checker: model.projectInfo?.checker || "",
    date: model.projectInfo?.date || new Date().toISOString().split("T")[0],
    description: model.projectInfo?.description || "",
    canvasWidth: model.projectInfo?.canvasWidth ?? 1000,
    canvasHeight: model.projectInfo?.canvasHeight ?? 1000,
  };
}

export function Explorer() {
  const models = useAppStore((s) => s.models);
  const activeModelId = useAppStore((s) => s.activeModelId);
  const switchModel = useAppStore((s) => s.switchModel);
  const setMode = useAppStore((s) => s.setMode);
  const deleteModel = useAppStore((s) => s.deleteModel);
  const duplicateModel = useAppStore((s) => s.duplicateModel);
  const renameModel = useAppStore((s) => s.renameModel);
  const reorderModels = useAppStore((s) => s.reorderModels);
  const updateModelProjectInfo = useAppStore((s) => s.updateModelProjectInfo);
  const explorerOpen = useAppStore((s) => s.explorerOpen);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [menu, setMenu] = useState<MenuPos | null>(null);
  const [propertiesModelIds, setPropertiesModelIds] = useState<string[] | null>(
    null,
  );
  const [modelsOpen, setModelsOpen] = useState(true);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([
    activeModelId,
  ]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(
    activeModelId,
  );
  const [draggedModelId, setDraggedModelId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    modelId: string;
    position: DropPosition;
  } | null>(null);

  const existingModelIds = useMemo(
    () => new Set(models.map((m) => m.id)),
    [models],
  );

  const effectiveSelectedModelIds = useMemo(() => {
    const filtered = selectedModelIds.filter((id) => existingModelIds.has(id));
    if (filtered.length > 0) return filtered;
    if (activeModelId && existingModelIds.has(activeModelId)) {
      return [activeModelId];
    }
    return models[0] ? [models[0].id] : [];
  }, [activeModelId, existingModelIds, models, selectedModelIds]);

  const effectiveAnchorId =
    selectionAnchorId && existingModelIds.has(selectionAnchorId)
      ? selectionAnchorId
      : activeModelId && existingModelIds.has(activeModelId)
        ? activeModelId
        : (models[0]?.id ?? null);

  const handleSelect = useCallback(
    (e: React.MouseEvent, model: ModelEntry) => {
      const isToggleSelect = e.ctrlKey || e.metaKey;
      const isRangeSelect = e.shiftKey;

      if (isRangeSelect && effectiveAnchorId) {
        const allIds = models.map((m) => m.id);
        const anchorIndex = allIds.indexOf(effectiveAnchorId);
        const currentIndex = allIds.indexOf(model.id);
        if (anchorIndex >= 0 && currentIndex >= 0) {
          const start = Math.min(anchorIndex, currentIndex);
          const end = Math.max(anchorIndex, currentIndex);
          setSelectedModelIds(allIds.slice(start, end + 1));
        }
      } else if (isToggleSelect) {
        setSelectedModelIds((prev) => {
          const set = new Set(prev);
          if (!set.has(model.id)) {
            set.add(model.id);
          }
          return Array.from(set);
        });
        setSelectionAnchorId(model.id);
      } else {
        setSelectedModelIds([model.id]);
        setSelectionAnchorId(model.id);
      }

      switchModel(model.id);
      if (model.result) {
        setMode("result");
      }
    },
    [effectiveAnchorId, models, switchModel, setMode],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  const startRename = (id: string, currentName: string) => {
    setEditingId(id);
    setEditName(currentName);
  };

  const commitRename = () => {
    if (editingId && editName.trim()) {
      renameModel(editingId, editName.trim());
    }
    setEditingId(null);
    setEditName("");
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditName("");
  };

  const handleContextMenu = (
    e: React.MouseEvent,
    modelId: string,
    modelName: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    let ids = effectiveSelectedModelIds;
    if (!effectiveSelectedModelIds.includes(modelId)) {
      ids = [modelId];
      setSelectedModelIds(ids);
      setSelectionAnchorId(modelId);
    }

    setMenu({
      x: e.clientX,
      y: e.clientY,
      modelId,
      modelName,
      selectedModelIds: ids,
    });
  };

  const modelsForProperties = useMemo(
    () =>
      propertiesModelIds
        ? models.filter((m) => propertiesModelIds.includes(m.id))
        : [],
    [models, propertiesModelIds],
  );

  const handleSaveProperties = (changes: Partial<ProjectInfo>) => {
    if (modelsForProperties.length > 0) {
      for (const model of modelsForProperties) {
        updateModelProjectInfo(model.id, {
          ...buildProjectInfo(model),
          ...changes,
        });
      }
      setPropertiesModelIds(null);
    }
  };

  const handleDeleteSelected = useCallback(() => {
    const ids = menu?.selectedModelIds ?? effectiveSelectedModelIds;
    for (const id of ids) {
      deleteModel(id);
    }
    setSelectedModelIds((prev) => {
      const deleteSet = new Set(ids);
      return prev.filter((id) => !deleteSet.has(id));
    });
  }, [deleteModel, menu?.selectedModelIds, effectiveSelectedModelIds]);

  const clearDragState = useCallback(() => {
    setDraggedModelId(null);
    setDropTarget(null);
  }, []);

  const handleDragStart = useCallback((modelId: string) => {
    setDraggedModelId(modelId);
    setDropTarget(null);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, modelId: string) => {
      if (!draggedModelId || draggedModelId === modelId) return;
      e.preventDefault();

      const rect = e.currentTarget.getBoundingClientRect();
      const offsetY = e.clientY - rect.top;
      const position: DropPosition =
        offsetY < rect.height / 2 ? "before" : "after";

      setDropTarget((prev) => {
        if (prev?.modelId === modelId && prev.position === position) {
          return prev;
        }
        return { modelId, position };
      });
    },
    [draggedModelId],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, modelId: string) => {
      e.preventDefault();
      if (!draggedModelId || draggedModelId === modelId) {
        clearDragState();
        return;
      }

      const position: DropPosition =
        dropTarget?.modelId === modelId ? dropTarget.position : "before";
      reorderModels(draggedModelId, modelId, position);
      clearDragState();
    },
    [clearDragState, draggedModelId, dropTarget, reorderModels],
  );

  if (!explorerOpen) return null;

  return (
    <div
      className="flex flex-col h-full"
      style={{
        background: "var(--color-vsc-sidebar)",
      }}
    >
      <button
        className="flex items-center gap-1.5 px-4 py-1.5 text-[10px] font-bold tracking-[0.08em] select-none cursor-pointer w-full text-left"
        style={{
          background: "var(--color-vsc-surface-tint)",
          color: "var(--color-vsc-text-muted)",
          borderTop: "1px solid var(--color-vsc-border)",
          borderBottom: "1px solid var(--color-vsc-border)",
        }}
        onClick={() => setModelsOpen((v) => !v)}
        aria-expanded={modelsOpen}
        aria-label="Toggle models list"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="currentColor"
          style={{ transform: modelsOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
        >
          <path d="M2 3l3 3.5L8 3z" />
        </svg>
        MODELS
      </button>

      {modelsOpen && (
        <div className="flex-1 overflow-y-auto py-1">
          {models.map((model) => {
            const isActive = model.id === activeModelId;
            const isSelected = effectiveSelectedModelIds.includes(model.id);
            const isEditing = model.id === editingId;
            return (
              <ModelRow
                key={model.id}
                model={model}
                isActive={isActive}
                isSelected={isSelected}
                isEditing={isEditing}
                hasResult={!!model.result}
                editName={editName}
                onChangeName={setEditName}
                onCommitRename={commitRename}
                onCancelRename={cancelRename}
                onStartRename={startRename}
                onSelect={(e) => handleSelect(e, model)}
                onContextMenu={handleContextMenu}
                isDragSource={draggedModelId === model.id}
                isDropBefore={
                  dropTarget?.modelId === model.id &&
                  dropTarget.position === "before"
                }
                isDropAfter={
                  dropTarget?.modelId === model.id &&
                  dropTarget.position === "after"
                }
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={clearDragState}
              />
            );
          })}
        </div>
      )}

      {menu && (
        <ContextMenu
          pos={menu}
          onClose={closeMenu}
          onRename={() => startRename(menu.modelId, menu.modelName)}
          onDuplicate={() => duplicateModel(menu.modelId)}
          onDelete={handleDeleteSelected}
          onProperties={() =>
            setPropertiesModelIds(
              menu.selectedModelIds.length > 0
                ? menu.selectedModelIds
                : [menu.modelId],
            )
          }
          canDelete={models.length - menu.selectedModelIds.length >= 1}
          multiSelect={menu.selectedModelIds.length > 1}
        />
      )}

      {modelsForProperties.length > 0 && (
        <ProjectInfoDialog
          initialInfos={modelsForProperties.map(buildProjectInfo)}
          onSave={handleSaveProperties}
          onClose={() => setPropertiesModelIds(null)}
        />
      )}
    </div>
  );
}
