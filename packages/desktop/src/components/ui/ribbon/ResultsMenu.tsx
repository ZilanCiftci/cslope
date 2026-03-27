import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../../../store/app-store";
import { isElectron } from "../../../utils/is-electron";
import { exportVectorPdf } from "../../../features/pdf/pdf-export";
import {
  computeInnerFrame,
  computePaperFrame,
} from "../../../features/view/paper";
import { RibbonButton, RibbonGroup, RibbonSep } from "./RibbonParts";
import type { SurfaceDisplayMode } from "../../../store/types";

interface Props {
  isOpen: boolean;
  onActivate: () => void;
  panelHost: HTMLElement | null;
}

export function ResultsMenu({ isOpen, onActivate, panelHost }: Props) {
  const result = useAppStore((s) => s.result);
  const hasResult = Boolean(result?.allSurfaces?.length);
  const addAnnotation = useAppStore((s) => s.addAnnotation);
  const rvs = useAppStore((s) => s.resultViewSettings);
  const setRvs = useAppStore((s) => s.setResultViewSettings);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const [displayMenuOpen, setDisplayMenuOpen] = useState(false);
  const displayMenuRef = useRef<HTMLDivElement | null>(null);

  const getInnerFrameWorldBounds = (
    state: ReturnType<typeof useAppStore.getState>,
  ): { xMin: number; xMax: number; yMin: number; yMax: number } | undefined => {
    if (state.resultViewScale <= 0) return undefined;
    const canvas = document.querySelector<HTMLCanvasElement>(
      "[data-testid='slope-canvas']",
    );
    if (!canvas) return undefined;

    const rect = canvas.getBoundingClientRect();
    const { paperSize, landscape, zoom, offsetX, offsetY } =
      state.resultViewSettings.paperFrame;
    const pf = computePaperFrame(
      rect.width,
      rect.height,
      paperSize,
      landscape,
      zoom ?? 1,
      offsetX ?? 0,
      offsetY ?? 0,
    );
    const inner = computeInnerFrame(pf);

    const vs = state.resultViewScale;
    const [ox, oy] = state.resultViewOffset;

    const xMin = (inner.x - rect.width / 2) / vs - ox;
    const xMax = (inner.x + inner.w - rect.width / 2) / vs - ox;
    const yMax = -(inner.y - rect.height / 2) / vs - oy;
    const yMin = -(inner.y + inner.h - rect.height / 2) / vs - oy;

    return { xMin, xMax, yMin, yMax };
  };

  const handleExportPng = () => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "[data-testid='slope-canvas']",
    );
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const { paperFrame } = useAppStore.getState().resultViewSettings;
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;
    const pf = computePaperFrame(
      cssW,
      cssH,
      paperFrame.paperSize,
      paperFrame.landscape,
      paperFrame.zoom ?? 1,
      paperFrame.offsetX ?? 0,
      paperFrame.offsetY ?? 0,
    );

    const sx = pf.x * dpr;
    const sy = pf.y * dpr;
    const sw = pf.w * dpr;
    const sh = pf.h * dpr;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = sw;
    exportCanvas.height = sh;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, sw, sh);
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

    const link = document.createElement("a");
    link.download = "slope-analysis.png";
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
  };

  const handleExportPdf = () => {
    const state = useAppStore.getState();
    if (!state.result) return;

    const vl = state.resultViewSettings.viewLock;
    let viewBounds:
      | { xMin: number; xMax: number; yMin: number; yMax: number }
      | undefined;

    if (vl) {
      viewBounds = {
        xMin: vl.bottomLeft[0],
        xMax: vl.topRight[0],
        yMin: vl.bottomLeft[1],
        yMax: vl.topRight[1],
      };
    } else {
      viewBounds = getInnerFrameWorldBounds(state);
    }

    exportVectorPdf({
      coordinates: state.coordinates,
      materials: state.materials,
      materialBoundaries: state.materialBoundaries,
      regionMaterials: state.regionMaterials,
      result: state.result,
      resultViewSettings: state.resultViewSettings,
      piezometricLine: state.piezometricLine,
      udls: state.udls,
      lineLoads: state.lineLoads,
      analysisLimits: state.analysisLimits,
      orientation: state.orientation,
      projectInfo: state.projectInfo,
      parameters: state.parameters,
      viewBounds,
    });
  };

  useEffect(() => {
    if (!exportMenuOpen && !displayMenuOpen) return;

    const onDocumentPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        exportMenuOpen &&
        exportMenuRef.current &&
        !exportMenuRef.current.contains(target)
      ) {
        setExportMenuOpen(false);
      }
      if (
        displayMenuOpen &&
        displayMenuRef.current &&
        !displayMenuRef.current.contains(target)
      ) {
        setDisplayMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", onDocumentPointerDown);
    return () =>
      document.removeEventListener("mousedown", onDocumentPointerDown);
  }, [exportMenuOpen, displayMenuOpen]);

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
            <RibbonSep />
            <RibbonGroup label="Display">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-0.5">
                  <div className="relative" ref={displayMenuRef}>
                    <SmallButton
                      icon={<SurfaceDisplayIcon />}
                      title={`Surfaces: ${rvs.surfaceDisplay === "critical" ? "Critical" : rvs.surfaceDisplay === "all" ? "All" : "Filter"}`}
                      onClick={() => setDisplayMenuOpen((o) => !o)}
                      active={false}
                      hasDropdown
                    />
                    {displayMenuOpen && (
                      <div
                        className="absolute top-[1.7rem] left-0 rounded py-1 z-20"
                        style={{
                          background: "var(--color-vsc-panel)",
                          border: "1px solid var(--color-vsc-border)",
                          minWidth: 110,
                          boxShadow: "0 6px 16px rgba(0,0,0,0.2)",
                        }}
                        role="menu"
                      >
                        {(
                          [
                            { value: "critical", label: "Critical only" },
                            { value: "all", label: "All surfaces" },
                            { value: "filter", label: "Filter by FOS" },
                          ] as { value: SurfaceDisplayMode; label: string }[]
                        ).map((item) => (
                          <button
                            key={item.value}
                            onClick={() => {
                              setRvs({ surfaceDisplay: item.value });
                              setDisplayMenuOpen(false);
                            }}
                            className="w-full text-left px-3 py-1.5 text-[11px] cursor-pointer flex items-center gap-2"
                            style={{
                              background:
                                rvs.surfaceDisplay === item.value
                                  ? "var(--color-vsc-list-active)"
                                  : "transparent",
                              border: "none",
                              color: "var(--color-vsc-text)",
                            }}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <SmallButton
                    icon={<SlicesIcon />}
                    title="Show slices"
                    onClick={() => setRvs({ showSlices: !rvs.showSlices })}
                    active={rvs.showSlices}
                  />
                  <SmallButton
                    icon={<FosLabelIcon />}
                    title="Show FOS label"
                    onClick={() => setRvs({ showFosLabel: !rvs.showFosLabel })}
                    active={rvs.showFosLabel}
                  />
                </div>
                <div className="flex items-center gap-0.5">
                  <SmallButton
                    icon={<CentreMarkIcon />}
                    title="Show centre mark"
                    onClick={() =>
                      setRvs({ showCentreMarker: !rvs.showCentreMarker })
                    }
                    active={rvs.showCentreMarker}
                  />
                  <SmallButton
                    icon={<GridIcon />}
                    title="Grid lines"
                    onClick={() => setRvs({ showGrid: !rvs.showGrid })}
                    active={rvs.showGrid}
                  />
                  <SmallButton
                    icon={<SoilColorIcon />}
                    title="Soil colors"
                    onClick={() =>
                      setRvs({ showSoilColor: !(rvs.showSoilColor ?? true) })
                    }
                    active={rvs.showSoilColor ?? true}
                  />
                </div>
              </div>
              <RibbonButton
                icon={<ViewSettingsIcon />}
                label="Settings"
                onClick={openViewSettings}
              />
            </RibbonGroup>
            <RibbonSep />
            <RibbonGroup label="Annotations">
              <SmallButton
                icon={<AnnoTextIcon />}
                title="Add Text"
                onClick={() => addAnnotation("text")}
                active={false}
              />
              <SmallButton
                icon={<AnnoPlotIcon />}
                title="Add Plot"
                onClick={() => addAnnotation("plot")}
                active={false}
              />
              <SmallButton
                icon={<AnnoTableIcon />}
                title="Add Material Table"
                onClick={() => addAnnotation("material-table")}
                active={false}
              />
              <SmallButton
                icon={<AnnoColorBarIcon />}
                title="Add Color Bar"
                onClick={() => addAnnotation("color-bar")}
                active={false}
              />
            </RibbonGroup>
            <RibbonSep />
            <RibbonGroup label="Templates">
              <RibbonButton
                icon={<TemplateSaveIcon />}
                label="Export"
                onClick={() => {
                  const template = {
                    version: 1,
                    resultViewSettings: rvs,
                  };
                  const blob = new Blob([JSON.stringify(template, null, 2)], {
                    type: "application/json",
                  });
                  const link = document.createElement("a");
                  link.download = "view-template.json";
                  link.href = URL.createObjectURL(blob);
                  link.click();
                  URL.revokeObjectURL(link.href);
                }}
              />
              <RibbonButton
                icon={<TemplateLoadIcon />}
                label="Import"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = ".json";
                  input.onchange = () => {
                    const file = input.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      try {
                        const data = JSON.parse(reader.result as string);
                        if (data?.resultViewSettings) {
                          setRvs(data.resultViewSettings);
                        }
                      } catch {
                        alert("Invalid template file.");
                      }
                    };
                    reader.readAsText(file);
                  };
                  input.click();
                }}
              />
            </RibbonGroup>
            <RibbonSep />
            <RibbonGroup label="Export">
              <div className="relative" ref={exportMenuRef}>
                <button
                  onClick={handleExportPdf}
                  disabled={!hasResult}
                  className="w-14 h-12 rounded flex flex-col items-center justify-center gap-0.5 cursor-pointer"
                  style={{
                    color: !hasResult
                      ? "var(--color-vsc-text-muted)"
                      : "var(--color-vsc-text-bright)",
                    background: "transparent",
                    opacity: hasResult ? 1 : 0.35,
                    filter: hasResult ? "none" : "grayscale(1)",
                    border: "none",
                  }}
                  title="Export PDF"
                  role="menuitem"
                  aria-disabled={!hasResult}
                >
                  <span className="flex items-center justify-center">
                    <ExportPdfIcon />
                  </span>
                  <span className="text-[10px] leading-tight">PDF</span>
                </button>

                <button
                  onClick={() => setExportMenuOpen((open) => !open)}
                  disabled={!hasResult}
                  className="absolute bottom-0 right-0 w-4 h-4 flex items-center justify-center cursor-pointer"
                  style={{
                    color: "var(--color-vsc-text-muted)",
                    background: "transparent",
                    border: "none",
                    fontSize: 8,
                    opacity: hasResult ? 0.7 : 0.3,
                  }}
                  aria-haspopup="menu"
                  aria-expanded={exportMenuOpen}
                  title="More export options"
                >
                  ▾
                </button>

                {exportMenuOpen && hasResult && (
                  <div
                    className="absolute top-[3.2rem] right-0 rounded py-1 z-20"
                    style={{
                      background: "var(--color-vsc-panel)",
                      border: "1px solid var(--color-vsc-border)",
                      minWidth: 120,
                      boxShadow: "0 6px 16px rgba(0,0,0,0.2)",
                    }}
                    role="menu"
                  >
                    <button
                      onClick={() => {
                        setExportMenuOpen(false);
                        handleExportPdf();
                      }}
                      className="w-full text-left px-3 py-1.5 text-[11px] cursor-pointer"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--color-vsc-text)",
                      }}
                    >
                      Export as PDF
                    </button>
                    <button
                      onClick={() => {
                        setExportMenuOpen(false);
                        handleExportPng();
                      }}
                      className="w-full text-left px-3 py-1.5 text-[11px] cursor-pointer"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--color-vsc-text)",
                      }}
                    >
                      Export as PNG
                    </button>
                  </div>
                )}
              </div>
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

function ExportPdfIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      {/* Document body */}
      <path
        d="M7 3h12l7 7v18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"
        fill="#e8eaed"
        stroke="#90a4ae"
        strokeWidth="1.2"
      />
      {/* Folded corner */}
      <path d="M19 3v7h7" fill="#cfd8dc" stroke="#90a4ae" strokeWidth="1.2" />
      {/* Red label banner */}
      <rect x="3" y="16" width="18" height="9" rx="1.5" fill="#d32f2f" />
      {/* P */}
      <path
        d="M6 17.8h1.6c1.1 0 1.7.5 1.7 1.3s-.6 1.3-1.7 1.3H7v1.8H6z"
        fill="#fff"
      />
      {/* D */}
      <path
        d="M10.5 17.8h1.4c1.4 0 2.2.8 2.2 2.2s-.8 2.2-2.2 2.2h-1.4z"
        fill="#fff"
      />
      {/* F */}
      <path d="M15.5 17.8h2.8v1h-1.8v.7h1.5v.9h-1.5v1.8h-1z" fill="#fff" />
    </svg>
  );
}

function ViewSettingsIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Gear body — outer path */}
      <path
        d="M21.848 14.572l-1.93-1.63a1.232 1.232 0 0 1 0-1.884l1.93-1.63a.62.62 0 0 0 .189-.662a10.5 10.5 0 0 0-2.209-3.804a.62.62 0 0 0-.668-.168l-2.381.848a1.3 1.3 0 0 1-.419.073a1.24 1.24 0 0 1-1.219-1.014l-.454-2.478a.62.62 0 0 0-.482-.493a10.7 10.7 0 0 0-4.408 0a.62.62 0 0 0-.482.493l-.453 2.478a1.24 1.24 0 0 1-1.638.942l-2.38-.848a.62.62 0 0 0-.669.168a10.5 10.5 0 0 0-2.21 3.805a.615.615 0 0 0 .189.661l1.929 1.63q.077.066.143.143c.444.52.379 1.299-.143 1.742l-1.929 1.63a.62.62 0 0 0-.189.662a10.5 10.5 0 0 0 2.21 3.803a.62.62 0 0 0 .669.168l2.38-.847a1.3 1.3 0 0 1 .419-.072c.588 0 1.11.417 1.219 1.014l.453 2.478a.62.62 0 0 0 .482.493a10.7 10.7 0 0 0 4.408 0a.62.62 0 0 0 .482-.493l.454-2.478q.018-.099.053-.194a1.24 1.24 0 0 1 1.585-.748l2.379.848q.105.036.208.036a.62.62 0 0 0 .461-.204a10.5 10.5 0 0 0 2.208-3.804a.615.615 0 0 0-.189-.662zm-2.756 3.017l-1.81-.645a2.747 2.747 0 0 0-3.615 2.085l-.345 1.877a9.2 9.2 0 0 1-2.642-.002l-.344-1.876a2.737 2.737 0 0 0-3.616-2.085l-1.81.644a8.9 8.9 0 0 1-1.319-2.266l1.461-1.235c.56-.472.9-1.135.96-1.864a2.7 2.7 0 0 0-.645-1.995a3 3 0 0 0-.315-.315L3.591 8.677A8.9 8.9 0 0 1 4.91 6.412l1.81.645q.447.158.921.159a2.75 2.75 0 0 0 2.695-2.244l.344-1.876a9.3 9.3 0 0 1 2.642-.002l.343 1.877a2.737 2.737 0 0 0 3.617 2.085l1.81-.645c.552.69.993 1.449 1.319 2.266l-1.46 1.235a2.7 2.7 0 0 0-.96 1.864a2.71 2.71 0 0 0 .962 2.31l1.46 1.234a8.9 8.9 0 0 1-1.318 2.267z"
        fill="#78909c"
      />
      {/* Center ring */}
      <circle
        cx="12"
        cy="12"
        r="3"
        fill="none"
        stroke="#78909c"
        strokeWidth="1.5"
      />
      {/* Center accent dot */}
      <circle cx="12" cy="12" r="1.5" fill="#42a5f5" />
    </svg>
  );
}

// ── Small toggle button for ribbon ──

function SmallButton({
  icon,
  title,
  onClick,
  active,
  hasDropdown,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  active: boolean;
  hasDropdown?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="h-[22px] rounded flex items-center justify-center cursor-pointer"
      style={{
        width: hasDropdown ? 30 : 22,
        color: active
          ? "var(--color-vsc-text-bright)"
          : "var(--color-vsc-text-muted)",
        background: active ? "var(--color-vsc-list-active)" : "transparent",
        border: "1px solid",
        borderColor: active ? "var(--color-vsc-accent)" : "transparent",
      }}
    >
      {icon}
      {hasDropdown && (
        <span style={{ fontSize: 7, marginLeft: 1, opacity: 0.6 }}>▾</span>
      )}
    </button>
  );
}

// ── Small icons (16×16) ──

function SurfaceDisplayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M2 11C4 7.5 6.5 6 8 8.5S11.5 6 14 5"
        stroke="#42a5f5"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="8" cy="8.5" r="1.2" fill="#ef5350" />
    </svg>
  );
}

function SlicesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect
        x="2"
        y="3"
        width="12"
        height="10"
        rx="1"
        fill="#5c6bc0"
        opacity="0.1"
      />
      <path
        d="M5 4v8M8 4v8M11 4v8"
        stroke="#5c6bc0"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M2 12.5h12"
        stroke="#78909c"
        strokeWidth="0.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FosLabelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect
        x="1.5"
        y="3"
        width="13"
        height="10"
        rx="1.5"
        fill="#26a69a"
        opacity="0.12"
      />
      <text
        x="8"
        y="11.5"
        fontSize="8.5"
        fontWeight="bold"
        fontFamily="sans-serif"
        fill="#26a69a"
        textAnchor="middle"
      >
        Fs
      </text>
    </svg>
  );
}

function CentreMarkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle
        cx="8"
        cy="8"
        r="3.2"
        stroke="#e53935"
        strokeWidth="1.2"
        opacity="0.25"
      />
      <circle cx="8" cy="8" r="1" fill="#e53935" />
      <path
        d="M8 3v2.5M8 10.5v2.5M3 8h2.5M10.5 8h2.5"
        stroke="#e53935"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect
        x="2"
        y="2"
        width="12"
        height="12"
        rx="1"
        fill="#78909c"
        opacity="0.08"
      />
      <path
        d="M2 6h12M2 10h12M6 2v12M10 2v12"
        stroke="#78909c"
        strokeWidth="0.9"
      />
      <rect
        x="2"
        y="2"
        width="12"
        height="12"
        rx="1"
        stroke="#78909c"
        strokeWidth="0.7"
        opacity="0.5"
      />
    </svg>
  );
}

function SoilColorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect
        x="2"
        y="2"
        width="12"
        height="12"
        rx="1.5"
        fill="#8d6e63"
        opacity="0.1"
      />
      <rect x="3" y="3" width="4.5" height="4.5" rx="1" fill="#a1887f" />
      <rect x="8.5" y="3" width="4.5" height="4.5" rx="1" fill="#6d4c41" />
      <rect x="3" y="8.5" width="4.5" height="4.5" rx="1" fill="#bcaaa4" />
      <rect x="8.5" y="8.5" width="4.5" height="4.5" rx="1" fill="#8d6e63" />
    </svg>
  );
}

function AnnoTextIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect
        x="2"
        y="2"
        width="12"
        height="12"
        rx="1.5"
        fill="#ff9800"
        opacity="0.12"
      />
      <path
        d="M5 5h6M8 5v7"
        stroke="#ff9800"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M6 12h4"
        stroke="#ff9800"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}

function AnnoTableIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect
        x="2"
        y="2"
        width="12"
        height="12"
        rx="1.5"
        fill="#42a5f5"
        opacity="0.12"
      />
      <rect
        x="3"
        y="3"
        width="10"
        height="10"
        rx="1"
        stroke="#42a5f5"
        strokeWidth="0.8"
      />
      <path d="M3 6h10M3 9.5h10M7 3v10" stroke="#42a5f5" strokeWidth="0.8" />
      <rect
        x="3"
        y="3"
        width="10"
        height="3"
        rx="0.5"
        fill="#42a5f5"
        opacity="0.2"
      />
    </svg>
  );
}

function AnnoPlotIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect
        x="2"
        y="2"
        width="12"
        height="12"
        rx="1.5"
        fill="#26a69a"
        opacity="0.12"
      />
      <path d="M4 12V4h8" stroke="#78909c" strokeWidth="0.9" />
      <path
        d="M5 10l2-2 2 1.2L11.5 6"
        stroke="#26a69a"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="11.5" cy="6" r="1" fill="#26a69a" />
    </svg>
  );
}

function AnnoColorBarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <defs>
        <linearGradient id="cb" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ef5350" />
          <stop offset="50%" stopColor="#ffee58" />
          <stop offset="100%" stopColor="#66bb6a" />
        </linearGradient>
      </defs>
      <rect x="5" y="2" width="4" height="12" rx="1" fill="url(#cb)" />
      <rect
        x="5"
        y="2"
        width="4"
        height="12"
        rx="1"
        stroke="#78909c"
        strokeWidth="0.6"
        opacity="0.4"
      />
      <path
        d="M10.5 3.5h2M10.5 8h2M10.5 12.5h2"
        stroke="#78909c"
        strokeWidth="0.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TemplateSaveIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      {/* Paper background */}
      <rect
        x="3"
        y="2"
        width="22"
        height="24"
        rx="1.5"
        fill="#5c6bc0"
        opacity="0.07"
      />
      <rect
        x="3"
        y="2"
        width="22"
        height="24"
        rx="1.5"
        stroke="#5c6bc0"
        strokeWidth="1"
        opacity="0.4"
      />
      {/* Axes */}
      <path
        d="M7 6v14h16"
        stroke="#5c6bc0"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      {/* Axis ticks */}
      <path
        d="M10 20v1.5M13 20v1.5M16 20v1.5M19 20v1.5"
        stroke="#5c6bc0"
        strokeWidth="0.8"
        strokeLinecap="round"
      />
      <path
        d="M7 17h-1.5M7 14h-1.5M7 11h-1.5M7 8h-1.5"
        stroke="#5c6bc0"
        strokeWidth="0.8"
        strokeLinecap="round"
      />
      {/* Slope model */}
      <path
        d="M8 18h4l5-7h4v7"
        stroke="#5c6bc0"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="#5c6bc0"
        fillOpacity="0.12"
      />
      {/* Export arrow */}
      <circle cx="21" cy="5.5" r="3" fill="#5c6bc0" opacity="0.15" />
      <path
        d="M21 4v3.5M19.5 6.5L21 8l1.5-1.5"
        stroke="#5c6bc0"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TemplateLoadIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      {/* Paper background */}
      <rect
        x="3"
        y="2"
        width="22"
        height="24"
        rx="1.5"
        fill="#5c6bc0"
        opacity="0.07"
      />
      <rect
        x="3"
        y="2"
        width="22"
        height="24"
        rx="1.5"
        stroke="#5c6bc0"
        strokeWidth="1"
        opacity="0.4"
      />
      {/* Axes */}
      <path
        d="M7 6v14h16"
        stroke="#5c6bc0"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      {/* Axis ticks */}
      <path
        d="M10 20v1.5M13 20v1.5M16 20v1.5M19 20v1.5"
        stroke="#5c6bc0"
        strokeWidth="0.8"
        strokeLinecap="round"
      />
      <path
        d="M7 17h-1.5M7 14h-1.5M7 11h-1.5M7 8h-1.5"
        stroke="#5c6bc0"
        strokeWidth="0.8"
        strokeLinecap="round"
      />
      {/* Slope model */}
      <path
        d="M8 18h4l5-7h4v7"
        stroke="#5c6bc0"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="#5c6bc0"
        fillOpacity="0.12"
      />
      {/* Import arrow */}
      <circle cx="21" cy="5.5" r="3" fill="#5c6bc0" opacity="0.15" />
      <path
        d="M21 7.5V4M19.5 5L21 3.5 22.5 5"
        stroke="#5c6bc0"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
