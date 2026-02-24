import { ExplorerIcon } from "./icons/ExplorerIcon";
import { PropertiesIcon } from "./icons/PropertiesIcon";

interface Props {
  explorerOpen: boolean;
  propertiesOpen: boolean;
  explorerLocation: "left" | "right";
  propertiesLocation: "left" | "right";
  onToggleExplorer: () => void;
  onToggleProperties: () => void;
  onToggleExplorerLocation: () => void;
  onTogglePropertiesLocation: () => void;
}

export function ActivityBar({
  explorerOpen,
  propertiesOpen,
  explorerLocation,
  propertiesLocation,
  onToggleExplorer,
  onToggleProperties,
  onToggleExplorerLocation,
  onTogglePropertiesLocation,
}: Props) {
  return (
    <div
      className="flex flex-col items-center w-12 shrink-0 py-2 gap-1"
      style={{
        background: "var(--color-vsc-activitybar)",
        borderRight: "1px solid var(--color-vsc-border)",
      }}
    >
      <button
        onClick={onToggleExplorer}
        onContextMenu={(e) => {
          e.preventDefault();
          onToggleExplorerLocation();
        }}
        className="w-9 h-9 flex items-center justify-center cursor-pointer rounded-lg relative group"
        style={{
          background: explorerOpen
            ? "var(--color-vsc-list-active)"
            : "transparent",
        }}
        title="Models (Right-click to move)"
        aria-label="Toggle models"
      >
        <ExplorerIcon active={explorerOpen} location={explorerLocation} />
      </button>
      <button
        onClick={onToggleProperties}
        onContextMenu={(e) => {
          e.preventDefault();
          onTogglePropertiesLocation();
        }}
        className="w-9 h-9 flex items-center justify-center cursor-pointer rounded-lg relative group"
        style={{
          background: propertiesOpen
            ? "var(--color-vsc-list-active)"
            : "transparent",
        }}
        title="Properties (Right-click to move)"
        aria-label="Toggle properties"
      >
        <PropertiesIcon active={propertiesOpen} location={propertiesLocation} />
      </button>
    </div>
  );
}
