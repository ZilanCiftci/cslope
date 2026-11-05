import { createPortal } from "react-dom";
import { isProjectDirty, useAppStore } from "../../../store/app-store";
import { HAS_LOCAL_LOVO_MODELS } from "../../../store/local-models";
import { confirmUnsavedChanges } from "../../../features/project/unsavedGuard";
import { adoptProjectAssets } from "../../../features/drawings/asset-registry";

/**
 * Before replacing the project: offer to save unsaved changes, or else
 * ask the plain confirmation question.
 */
async function confirmReplace(question: string): Promise<boolean> {
  if (isProjectDirty(useAppStore.getState())) return confirmUnsavedChanges();
  return window.confirm(question);
}
import { isElectron } from "../../../utils/is-electron";
import { Mountain, RefreshCw, RotateCcw, ScrollText, SquareCode } from "lucide-react";
import { RibbonGroup, RibbonSep, RibbonSmallButton, RibbonStack } from "./RibbonParts";
import { SMALL_ICON } from "./icon-props";

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

  const handleResetStore = async () => {
    const ok = await confirmReplace(
      "Reset the entire app store to defaults? This cannot be undone.",
    );
    if (!ok) return;
    adoptProjectAssets([]);
    useAppStore.getState().newProject();
    if (isElectron) window.cslope.menuNew();
  };

  const handleLoadLovo = async () => {
    const ok = await confirmReplace(
      "Open the Lovö models as a new project? The current project will be closed.",
    );
    if (!ok) return;
    adoptProjectAssets([]);
    await useAppStore.getState().loadLovoModels();
    useAppStore.temporal.getState().clear();
    if (isElectron) window.cslope.menuNew();
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
          <div className="h-full flex items-stretch gap-0" role="menu">
            <RibbonGroup label="Window">
              <RibbonStack>
                <RibbonSmallButton
                  icon={<RefreshCw {...SMALL_ICON} />}
                  label="Reload"
                  shortcut="Ctrl+R"
                  onClick={handleReloadWindow}
                />
                {isElectron && (
                  <RibbonSmallButton
                    icon={<SquareCode {...SMALL_ICON} />}
                    label="DevTools"
                    shortcut="F12"
                    onClick={handleToggleDevTools}
                  />
                )}
              </RibbonStack>
            </RibbonGroup>
            <RibbonSep />
            {HAS_LOCAL_LOVO_MODELS && (
              <>
                <RibbonGroup label="Models">
                  <RibbonStack>
                    <RibbonSmallButton
                      icon={<Mountain {...SMALL_ICON} />}
                      label="Lovö"
                      onClick={handleLoadLovo}
                    />
                  </RibbonStack>
                </RibbonGroup>
                <RibbonSep />
              </>
            )}
            <RibbonGroup label="Store">
              <RibbonStack>
                <RibbonSmallButton
                  icon={<ScrollText {...SMALL_ICON} />}
                  label="Log"
                  onClick={handleLogState}
                />
                <RibbonSmallButton
                  icon={<RotateCcw {...SMALL_ICON} />}
                  label="Reset"
                  onClick={handleResetStore}
                />
              </RibbonStack>
            </RibbonGroup>
          </div>,
          panelHost,
        )}
    </div>
  );
}
