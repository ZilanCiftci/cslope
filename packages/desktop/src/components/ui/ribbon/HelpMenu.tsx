import { createPortal } from "react-dom";
import { useAppStore } from "../../../store/app-store";
import { isElectron } from "../../../utils/is-electron";
import { RibbonGroup, RibbonButton } from "./RibbonParts";
import { BenchmarkIcon, InfoIcon } from "../../icons/HelpIcons";

interface Props {
  isOpen: boolean;
  onActivate: () => void;
  panelHost: HTMLElement | null;
}

export function HelpMenu({ isOpen, onActivate, panelHost }: Props) {
  const handleLoadBenchmarks = () => {
    const ok = window.confirm(
      "Load benchmark models into the current workspace? This will replace current models.",
    );
    if (!ok) return;
    useAppStore.getState().loadBenchmarks();
    useAppStore.temporal.getState().clear();
  };

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
