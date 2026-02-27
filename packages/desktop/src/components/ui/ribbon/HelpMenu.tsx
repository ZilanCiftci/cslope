import { createPortal } from "react-dom";
import { useAppStore } from "../../../store/app-store";
import { isElectron } from "../../../utils/is-electron";
import { RibbonGroup, RibbonButton } from "./RibbonParts";

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
        className="h-9 px-4 text-[12px] font-medium flex items-center cursor-pointer relative"
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

// ── Icons ──

function BenchmarkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 3v18h18"
        stroke="#78909c"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <rect x="6" y="14" width="3" height="6" rx="0.5" fill="#66bb6a" />
      <rect x="11" y="8" width="3" height="12" rx="0.5" fill="#42a5f5" />
      <rect x="16" y="5" width="3" height="15" rx="0.5" fill="#ffa726" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="#42a5f5"
        opacity="0.15"
        stroke="#42a5f5"
        strokeWidth="1.5"
      />
      <line
        x1="12"
        y1="16"
        x2="12"
        y2="12"
        stroke="#1e88e5"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="8.5" r="1.3" fill="#1e88e5" />
    </svg>
  );
}
