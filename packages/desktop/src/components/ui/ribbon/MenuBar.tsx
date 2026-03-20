import { useState } from "react";
import { DevMenu } from "./DevMenu";
import { EditMenu } from "./EditMenu";
import { FileMenu } from "./FileMenu";
import { HelpMenu } from "./HelpMenu";
import { ResultsMenu } from "./ResultsMenu";

const isDev = import.meta.env.DEV;

interface Props {
  activeModelName?: string;
}

type MenuKey = "file" | "edit" | "results" | "help" | "dev";

export function MenuBar({ activeModelName }: Props) {
  const [activeMenu, setActiveMenu] = useState<MenuKey>("file");
  const [panelHost, setPanelHost] = useState<HTMLDivElement | null>(null);

  const effectiveMenu = activeMenu;

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
          isOpen={effectiveMenu === "edit"}
          onActivate={() => setActiveMenu("edit")}
          panelHost={panelHost}
        />
        <ResultsMenu
          isOpen={effectiveMenu === "results"}
          onActivate={() => setActiveMenu("results")}
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
