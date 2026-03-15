import { useState } from "react";
import { DevMenu } from "./DevMenu";
import { EditMenu } from "./EditMenu";
import { FileMenu } from "./FileMenu";
import { HelpMenu } from "./HelpMenu";
import { ViewMenu } from "./ViewMenu";
import type { CanvasToolbarState } from "../../../store/types";

const isDev = import.meta.env.DEV;

interface Props {
  activeModelName?: string;
  canvasToolbar: CanvasToolbarState | null;
}

type MenuKey = "file" | "edit" | "view" | "help" | "dev";

export function MenuBar({ activeModelName, canvasToolbar }: Props) {
  const [activeMenu, setActiveMenu] = useState<MenuKey>("file");
  const [panelHost, setPanelHost] = useState<HTMLDivElement | null>(null);

  // If view tab is active but there's no canvas toolbar, fall back to file
  const effectiveMenu =
    !canvasToolbar && activeMenu === "view" ? "file" : activeMenu;

  return (
    <div className="flex flex-col shrink-0">
      <div
        className="flex items-center h-[1.9rem] gap-1 px-2"
        style={{
          background: "var(--color-vsc-tab-inactive)",
          borderBottom: "1px solid var(--color-vsc-border)",
        }}
      >
        <FileMenu
          activeModelName={activeModelName}
          isOpen={effectiveMenu === "file"}
          onActivate={() => setActiveMenu("file")}
          panelHost={panelHost}
        />
        <EditMenu
          canvasToolbar={canvasToolbar}
          isOpen={effectiveMenu === "edit"}
          onActivate={() => setActiveMenu("edit")}
          panelHost={panelHost}
        />
        <ViewMenu
          canvasToolbar={canvasToolbar}
          isOpen={effectiveMenu === "view"}
          onActivate={() => setActiveMenu("view")}
          panelHost={panelHost}
        />
        <HelpMenu
          isOpen={effectiveMenu === "help"}
          onActivate={() => setActiveMenu("help")}
          panelHost={panelHost}
        />
        {isDev && (
          <DevMenu
            isOpen={effectiveMenu === "dev"}
            onActivate={() => setActiveMenu("dev")}
            panelHost={panelHost}
          />
        )}
        <div className="flex-1" />
      </div>
      <div
        ref={setPanelHost}
        className="h-[4.375rem] px-3 flex items-center"
        style={{
          background: "var(--color-vsc-panel)",
          borderBottom: "1px solid var(--color-vsc-border)",
        }}
      />
    </div>
  );
}
