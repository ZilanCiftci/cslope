import { createPortal } from "react-dom";
import { useAppStore } from "../../../store/app-store";
import { isElectron } from "../../../utils/is-electron";
import { RibbonGroup, RibbonButton, RibbonSep } from "./RibbonParts";
import {
  ReloadIcon,
  DevToolsIcon,
  LogIcon,
  ResetIcon,
} from "../../icons/DevIcons";
import { BenchmarkIcon } from "../../icons/HelpIcons";

interface Props {
  isOpen: boolean;
  onActivate: () => void;
  panelHost: HTMLElement | null;
}

export function DevMenu({ isOpen, onActivate, panelHost }: Props) {
  const handleReloadWindow = () => {
    window.location.reload();
  };

  const handleToggleDevTools = () => {
    if (isElectron) {
      window.cslope.toggleDevTools();
    }
  };

  const handleResetStore = () => {
    const ok = window.confirm(
      "Reset the entire app store to defaults? This cannot be undone.",
    );
    if (!ok) return;
    useAppStore.getState().newProject();
  };

  const handleLoadLovo = () => {
    const ok = window.confirm(
      "Load Lovö models into the current workspace? This will replace current models.",
    );
    if (!ok) return;
    useAppStore.getState().loadLovoModels();
    useAppStore.temporal.getState().clear();
  };

  const handleLogState = () => {
    console.log("App store state:", useAppStore.getState());
  };

  return (
    <div
      className="relative"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <button
        onClick={onActivate}
        className="h-[1.9rem] px-4 text-[11px] font-medium flex items-center cursor-pointer relative"
        style={{
          color: "#e5a00d",
          background: isOpen ? "var(--color-vsc-tab-active)" : "transparent",
        }}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        Dev
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
            <RibbonGroup label="Window">
              <RibbonButton
                icon={<ReloadIcon />}
                label="Reload"
                shortcut="Ctrl+R"
                onClick={handleReloadWindow}
              />
              {isElectron && (
                <RibbonButton
                  icon={<DevToolsIcon />}
                  label="DevTools"
                  shortcut="F12"
                  onClick={handleToggleDevTools}
                />
              )}
            </RibbonGroup>
            <RibbonSep />
            <RibbonGroup label="Models">
              <RibbonButton
                icon={<BenchmarkIcon />}
                label="Lovö"
                onClick={handleLoadLovo}
              />
            </RibbonGroup>
            <RibbonSep />
            <RibbonGroup label="Store">
              <RibbonButton
                icon={<LogIcon />}
                label="Log"
                onClick={handleLogState}
              />
              <RibbonButton
                icon={<ResetIcon />}
                label="Reset"
                onClick={handleResetStore}
              />
            </RibbonGroup>
          </div>,
          panelHost,
        )}
    </div>
  );
}
