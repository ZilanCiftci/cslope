import { useCallback, useState } from "react";
import { useAppStore, type ProjectInfo } from "../../store/app-store";
import { ContextMenu, type MenuPos } from "./ContextMenu";
import { ModelRow } from "./ModelRow";
import { ProjectInfoDialog } from "./ProjectInfoDialog";

export function Explorer() {
  const models = useAppStore((s) => s.models);
  const activeModelId = useAppStore((s) => s.activeModelId);
  const switchModel = useAppStore((s) => s.switchModel);
  const deleteModel = useAppStore((s) => s.deleteModel);
  const duplicateModel = useAppStore((s) => s.duplicateModel);
  const renameModel = useAppStore((s) => s.renameModel);
  const updateModelProjectInfo = useAppStore((s) => s.updateModelProjectInfo);
  const explorerOpen = useAppStore((s) => s.explorerOpen);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [menu, setMenu] = useState<MenuPos | null>(null);
  const [propertiesLog, setPropertiesLog] = useState<string | null>(null);
  const [modelsOpen, setModelsOpen] = useState(true);

  const closeMenu = useCallback(() => setMenu(null), []);

  if (!explorerOpen) return null;

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
    setMenu({ x: e.clientX, y: e.clientY, modelId, modelName });
  };

  const modelForProperties = propertiesLog
    ? models.find((m) => m.id === propertiesLog)
    : null;

  const handleSaveProperties = (info: ProjectInfo) => {
    if (propertiesLog) {
      updateModelProjectInfo(propertiesLog, info);
      setPropertiesLog(null);
    }
  };

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
            const isEditing = model.id === editingId;
            return (
              <ModelRow
                key={model.id}
                model={model}
                isActive={isActive}
                isEditing={isEditing}
                editName={editName}
                onChangeName={setEditName}
                onCommitRename={commitRename}
                onCancelRename={cancelRename}
                onStartRename={startRename}
                onSelect={() => switchModel(model.id)}
                onContextMenu={handleContextMenu}
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
          onDelete={() => deleteModel(menu.modelId)}
          onProperties={() => setPropertiesLog(menu.modelId)}
          canDelete={models.length > 1}
        />
      )}

      {modelForProperties && (
        <ProjectInfoDialog
          initialInfo={{
            title:
              modelForProperties.projectInfo?.title || modelForProperties.name,
            subtitle: modelForProperties.projectInfo?.subtitle || "",
            client: modelForProperties.projectInfo?.client || "",
            projectNumber: modelForProperties.projectInfo?.projectNumber || "",
            revision: modelForProperties.projectInfo?.revision || "0",
            author: modelForProperties.projectInfo?.author || "",
            checker: modelForProperties.projectInfo?.checker || "",
            date:
              modelForProperties.projectInfo?.date ||
              new Date().toISOString().split("T")[0],
            description: modelForProperties.projectInfo?.description || "",
            canvasWidth: modelForProperties.projectInfo?.canvasWidth ?? 1000,
            canvasHeight: modelForProperties.projectInfo?.canvasHeight ?? 1000,
          }}
          onSave={handleSaveProperties}
          onClose={() => setPropertiesLog(null)}
        />
      )}
    </div>
  );
}
