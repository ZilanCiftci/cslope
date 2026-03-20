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

  const openViewSettings = () => {
    if (isElectron) {
      window.cslope.openViewSettingsDialog();
      return;
    }

    window.alert(
      "View settings dialog is available in the desktop app window mode.",
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
            <RibbonGroup label="View">
              <RibbonButton
                icon={<ViewSettingsIcon />}
                label="View Settings"
                onClick={openViewSettings}
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

function ViewSettingsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="2"
        fill="#7e57c2"
        opacity="0.15"
      />
      <circle cx="12" cy="12" r="3" stroke="#7e57c2" strokeWidth="1.6" />
      <path
        d="M12 5v2M12 17v2M5 12h2M17 12h2M7.05 7.05l1.41 1.41M15.54 15.54l1.41 1.41M7.05 16.95l1.41-1.41M15.54 8.46l1.41-1.41"
        stroke="#78909c"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
