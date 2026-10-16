import { createPortal } from "react-dom";
import { isProjectDirty, useAppStore } from "../../../store/app-store";
import { confirmUnsavedChanges } from "../../../features/project/unsavedGuard";

/**
 * Before replacing the project: offer to save unsaved changes, or else
 * ask the plain confirmation question.
 */
async function confirmReplace(question: string): Promise<boolean> {
  if (isProjectDirty(useAppStore.getState())) return confirmUnsavedChanges();
  return window.confirm(question);
}
import { isElectron } from "../../../utils/is-electron";
import { RibbonGroup, RibbonButton } from "./RibbonParts";
import { BenchmarkIcon, ExamplesIcon, InfoIcon } from "../../icons/HelpIcons";

interface Props {
  isOpen: boolean;
  onActivate: () => void;
  panelHost: HTMLElement | null;
}

export function HelpMenu({ isOpen, onActivate, panelHost }: Props) {
  // Replace the project with a set of models, as a new unsaved project.
  const loadModels = async (what: string, load: () => void) => {
    const ok = await confirmReplace(`Load ${what} into the current workspace? This will replace current models.`);
    if (!ok) return;
    load();
    useAppStore.temporal.getState().clear();
    // The examples are a new, unsaved project: Ctrl+S must not write them
    // over the file that was open before.
    if (isElectron) window.cslope.menuNew();
  };

  const handleLoadExamples = () => loadModels("the example models", () => useAppStore.getState().loadExamples());
  const handleLoadBenchmarks = () =>
    loadModels("the verification problems", () => useAppStore.getState().loadBenchmarks());

  const handleAbout = () => {
    if (isElectron) {
      window.cslope.menuAbout();
    } else {
      window.alert("cSlope — Slope Stability Analysis\nhttps://cslope.com");
    }
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
          color: isOpen
            ? "var(--color-vsc-text-bright)"
            : "var(--color-vsc-text-muted)",
          background: isOpen ? "var(--color-vsc-tab-active)" : "transparent",
        }}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        Help
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
            <RibbonGroup label="Help">
              <RibbonButton
                icon={<ExamplesIcon />}
                label="Examples"
                onClick={handleLoadExamples}
              />
              <RibbonButton
                icon={<BenchmarkIcon />}
                label="Benchmarks"
                onClick={handleLoadBenchmarks}
              />
              <RibbonButton
                icon={<InfoIcon />}
                label="About"
                onClick={handleAbout}
              />
            </RibbonGroup>
          </div>,
          panelHost,
        )}
    </div>
  );
}
