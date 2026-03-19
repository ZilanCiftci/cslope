import { createPortal } from "react-dom";
import { useAppStore } from "../../../store/app-store";
import { isElectron } from "../../../utils/is-electron";
import { RibbonButton, RibbonGroup } from "./RibbonParts";

interface Props {
  isOpen: boolean;
  onActivate: () => void;
  panelHost: HTMLElement | null;
}

export function ResultsMenu({ isOpen, onActivate, panelHost }: Props) {
  const result = useAppStore((s) => s.result);
  const hasResult = Boolean(result?.allSurfaces?.length);

  const openResultsPlot = () => {
    if (isElectron) {
      window.cslope.openResultsPlotDialog();
      return;
    }

    window.alert(
      "Results plotting dialog is available in the desktop app window mode.",
    );
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
        Results
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
            <RibbonGroup label="Plots">
              <RibbonButton
                icon={<ResultsPlotIcon />}
                label="Results Plot"
                onClick={openResultsPlot}
                disabled={!hasResult}
              />
            </RibbonGroup>
          </div>,
          panelHost,
        )}
    </div>
  );
}

function ResultsPlotIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="4"
        width="18"
        height="16"
        rx="2"
        fill="#42a5f5"
        opacity="0.15"
      />
      <path
        d="M5 18V6M5 18H20"
        stroke="#78909c"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M6.5 16.2L10.2 12.4L13 13.7L17.5 8.8"
        stroke="#26a69a"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10.2" cy="12.4" r="1.3" fill="#ef5350" />
      <circle cx="17.5" cy="8.8" r="1.3" fill="#ef5350" />
    </svg>
  );
}
