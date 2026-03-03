import { useEffect } from "react";
import { createPortal } from "react-dom";
import { isElectron } from "../../../utils/is-electron";
import { useProjectActions } from "../../../features/project/useProjectActions";
import { RibbonGroup, RibbonButton, RibbonSep } from "./RibbonParts";
import {
  NewIcon,
  OpenIcon,
  SaveIcon,
  SaveAsIcon,
  ExitIcon,
} from "../../icons/FileActionIcons";

interface Props {
  activeModelName?: string;
  isOpen: boolean;
  onActivate: () => void;
  panelHost: HTMLElement | null;
}

export function FileMenu({
  activeModelName,
  isOpen,
  onActivate,
  panelHost,
}: Props) {
  const defaultBaseName = activeModelName?.trim() || "cslope-project";
  const {
    fileInputRef,
    handleNew,
    handleOpen,
    handleSave,
    handleSaveAs,
    handleFileChange,
  } = useProjectActions(defaultBaseName);

  // ── Keyboard shortcuts (Ctrl+N/O/S/Shift+S) ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        handleNew();
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        void handleOpen();
      } else if (e.shiftKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        void handleSaveAs();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div
      className="relative"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <button
        onClick={onActivate}
        className="h-[1.9rem] px-4 text-[11px] font-medium flex items-center cursor-pointer relative"
        style={{
          color: isOpen
            ? "var(--color-vsc-text-bright)"
            : "var(--color-vsc-text-muted)",
          background: isOpen ? "var(--color-vsc-tab-active)" : "transparent",
        }}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        File
        {isOpen && (
          <div
            className="absolute bottom-0 left-0 right-0 h-0.5"
            style={{ background: "var(--color-vsc-accent)" }}
          />
        )}
      </button>

      {isOpen &&
        panelHost &&
        createPortal(
          <div className="h-full flex items-center gap-0" role="menu">
            <RibbonGroup label="Project">
              <RibbonButton
                icon={<NewIcon />}
                label="New"
                shortcut="Ctrl+N"
                onClick={handleNew}
              />
              <RibbonButton
                icon={<OpenIcon />}
                label="Open"
                shortcut="Ctrl+O"
                onClick={handleOpen}
              />
            </RibbonGroup>
            <RibbonSep />
            <RibbonGroup label="Save">
              <RibbonButton
                icon={<SaveIcon />}
                label="Save"
                shortcut="Ctrl+S"
                onClick={handleSave}
              />
              <RibbonButton
                icon={<SaveAsIcon />}
                label="Save As"
                shortcut="Ctrl+Shift+S"
                onClick={handleSaveAs}
              />
            </RibbonGroup>
            {isElectron && (
              <>
                <RibbonSep />
                <RibbonGroup label="">
                  <RibbonButton
                    icon={<ExitIcon />}
                    label="Exit"
                    onClick={() => window.cslope.close()}
                  />
                </RibbonGroup>
              </>
            )}
          </div>,
          panelHost,
        )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
