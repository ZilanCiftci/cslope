import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../../../store/app-store";
import { normalizeResultView } from "../../../store/persistence";
import { fileTooLarge } from "../../../features/project/file-limits";
import { DraftNumberInput } from "../DraftNumberInput";
import { isElectron } from "../../../utils/is-electron";
import {
  buildExportFilename,
  exportVectorPdf,
  pdfPageOptions,
} from "../../../features/pdf/pdf-export";
import {
  computeInnerFrame,
  computePaperFrame,
} from "../../../features/view/paper";
import {
  CentreIcon,
  ColorBarIcon,
  ExportTemplateIcon,
  FeMeshIcon,
  FosLabelIcon,
  ImportTemplateIcon,
  MaterialTableIcon,
  PdfIcon,
  PlasticZoneIcon,
  PlotIcon,
  ProbabilisticIcon,
  ReferenceLineIcon,
  ResultsPlotIcon,
  SensitivityIcon,
  SettingsIcon,
  SlicesIcon,
  SoilColorsIcon,
  SurfacesIcon,
  TextIcon,
} from "../../icons/ribbon";
import {
  Chevron,
  RibbonButton,
  RibbonGroup,
  RibbonMenuButton,
  RibbonSep,
  RibbonSmallButton,
  RibbonStack,
} from "./RibbonParts";
import {
  defaultReferenceCircle,
  defaultReferencePolyline,
  paperAnnotations,
  referenceAnnotations,
  type WorldBounds,
} from "../../../features/annotations/reference";
import { surfaceYAtX } from "../../../features/view/surface";
import { LARGE_ICON, SMALL_ICON } from "./icon-props";
import type { SurfaceDisplayMode } from "../../../store/types";
import { buildSliceTable, toCsv } from "../../../features/export/sliceTable";
import { buildAnalysisSummary } from "../../../features/export/analysisSummary";
import { APP_VERSION } from "../../../utils/app-version";
import { paperPngDataUrl } from "../../../features/export/paper-png";
import { buildXlsx } from "../../../utils/xlsx";
import { downloadFile, safeFileName } from "../../../utils/download";

interface Props {
  isOpen: boolean;
  onActivate: () => void;
  panelHost: HTMLElement | null;
}

export function ResultsMenu({ isOpen, onActivate, panelHost }: Props) {
  const result = useAppStore((s) => s.result);
  const hasResult = Boolean(result?.allSurfaces?.length);
  const addAnnotation = useAppStore((s) => s.addAnnotation);
  const removeAnnotation = useAppStore((s) => s.removeAnnotation);
  // The table and the colour bar are one per paper: their buttons toggle.
  const toggleAnnotation = (type: "material-table" | "color-bar") => {
    const present = rvs.annotations.filter((a) => a.type === type);
    if (present.length > 0) present.forEach((a) => removeAnnotation(a.id));
    else addAnnotation(type);
  };
  const addReferenceAnnotation = useAppStore((s) => s.addReferenceAnnotation);
  const rvs = useAppStore((s) => s.resultViewSettings);
  const setRvs = useAppStore((s) => s.setResultViewSettings);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  // The export menu opens under its button, to the right; near the right
  // edge of the window it opens to the left instead.
  const [exportMenuToLeft, setExportMenuToLeft] = useState(false);
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

  // Where a new reference line goes: the plot area of the sheet (the model's
  // bounds without a canvas, as in tests).
  const referenceViewBounds = (): WorldBounds => {
    const state = useAppStore.getState();
    const inner = getInnerFrameWorldBounds(state);
    if (inner && inner.xMax > inner.xMin && inner.yMax > inner.yMin) return inner;
    const xs = state.coordinates.map((c) => c[0]);
    const ys = state.coordinates.map((c) => c[1]);
    if (xs.length === 0) return { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };
    return { xMin: Math.min(...xs), xMax: Math.max(...xs), yMin: Math.min(...ys), yMax: Math.max(...ys) };
  };
  const addReferencePolyline = () => {
    const coords = useAppStore.getState().coordinates;
    addReferenceAnnotation(defaultReferencePolyline(referenceViewBounds(), (x) => surfaceYAtX(coords, x)));
  };
  const addReferenceCircle = () => addReferenceAnnotation(defaultReferenceCircle(referenceViewBounds()));

  // The paper drawn again for the PNG, without the selection outlines.
  const handleExportPng = () => {
    const href = paperPngDataUrl();
    if (!href) return;
    const link = document.createElement("a");
    link.download = buildExportFilename(useAppStore.getState().projectInfo, "png");
    link.href = href;
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
      waternet: state.waternet,
      udls: state.udls,
      lineLoads: state.lineLoads,
      reinforcements: state.reinforcements,
      piles: state.piles,
      analysisLimits: state.analysisLimits,
      options: state.options,
      customPlanesOnly: state.customPlanesOnly && state.customSearchPlanes.length > 0,
      orientation: state.orientation,
      projectInfo: state.projectInfo,
      parameters: state.parameters,
      viewBounds,
      summary: {
        sections: buildAnalysisSummary({
          result: state.result,
          options: state.options,
          analysisLimits: state.analysisLimits,
          orientation: state.orientation,
          piezometricLine: state.piezometricLine,
          materials: state.materials,
          udls: state.udls,
          lineLoads: state.lineLoads,
          reinforcements: state.reinforcements,
          piles: state.piles,
          // Only with surfaces to analyse (as buildSlopeDTOFromModel).
          customPlanesOnly: state.customPlanesOnly && state.customSearchPlanes.length > 0,
          customSurfaceCount: state.customSearchPlanes.length,
          waternet: state.waternet,
          earlierStage: state.earlierStage,
        }),
        header: {
          projectInfo: state.projectInfo,
          modelName: state.models.find((m) => m.id === state.activeModelId)?.name,
          version: APP_VERSION,
          date: new Date().toISOString().slice(0, 10),
        },
      },
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

  // Their own windows; the analyses run here, in the main window.
  const openSensitivity = () => {
    if (isElectron) window.cslope.openSensitivityDialog();
    else window.alert("The sensitivity analysis is available in the desktop app.");
  };

  const openReliability = () => {
    if (isElectron) window.cslope.openReliabilityDialog();
    else window.alert("The probabilistic analysis is available in the desktop app.");
  };

  // The paper's settings are its properties in the result sidebar.
  const showSheetSettings = () => useAppStore.getState().showPaperProperties();

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
          <div className="h-full flex items-stretch gap-0" role="menu">
            <RibbonGroup label="Plots">
              <RibbonButton
                icon={<ResultsPlotIcon {...LARGE_ICON} />}
                label="Results plot"
                onClick={openResultsPlot}
                disabled={!hasResult}
                disabledTitle="Run the analysis first"
              />
              <RibbonButton
                icon={<SensitivityIcon {...LARGE_ICON} />}
                label="Sensitivity"
                onClick={openSensitivity}
              />
              <RibbonButton
                icon={<ProbabilisticIcon {...LARGE_ICON} />}
                label="Probabilistic"
                onClick={openReliability}
              />
            </RibbonGroup>
            <RibbonSep />
            <RibbonGroup label="Display">
              <RibbonStack>
                <div className="relative" ref={displayMenuRef}>
                  <RibbonSmallButton
                    icon={<SurfacesIcon {...SMALL_ICON} />}
                    label="Surfaces"
                    title={`Surfaces: ${rvs.surfaceDisplay === "critical" ? "Critical" : rvs.surfaceDisplay === "all" ? "All" : "Filter"}`}
                    onClick={() => setDisplayMenuOpen((o) => !o)}
                    hasDropdown
                  />
                  {displayMenuOpen && (
                    <div
                      className="absolute top-[1.6rem] left-0 rounded py-1 z-20"
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
                          className="w-full text-left px-3 py-1.5 text-[11px] cursor-pointer flex items-center gap-2 whitespace-nowrap"
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
                      {(result?.customSurfaces?.length ?? 0) > 0 && (
                        <label
                          className="flex items-center gap-2 px-3 py-1.5 text-[11px] cursor-pointer whitespace-nowrap"
                          style={{
                            color: "var(--color-vsc-text)",
                            borderTop: "1px solid var(--color-vsc-border)",
                          }}
                          title="Draw the custom search planes' surfaces, dashed, each with its factor of safety"
                        >
                          <input
                            type="checkbox"
                            className="accent-blue-500"
                            checked={rvs.showCustomSurfaces === true}
                            onChange={(e) => setRvs({ showCustomSurfaces: e.target.checked })}
                            aria-label="Show custom surfaces"
                          />
                          Custom surfaces
                        </label>
                      )}
                      {rvs.surfaceDisplay === "filter" && (
                        <label
                          className="flex items-center gap-2 px-3 py-1.5 text-[11px]"
                          style={{
                            color: "var(--color-vsc-text)",
                            borderTop: "1px solid var(--color-vsc-border)",
                          }}
                        >
                          FOS ≤
                          <DraftNumberInput
                            min={0.01}
                            step={0.05}
                            value={rvs.fosFilterMax}
                            onValueChange={(value) => {
                              if (value > 0) setRvs({ fosFilterMax: value });
                            }}
                            aria-label="Maximum FOS shown"
                            className="w-16 tabular-nums"
                          />
                        </label>
                      )}
                    </div>
                  )}
                </div>
                <RibbonSmallButton
                  icon={<SlicesIcon {...SMALL_ICON} />}
                  label="Slices"
                  title="Show slices"
                  onClick={() => setRvs({ showSlices: !rvs.showSlices })}
                  active={rvs.showSlices}
                />
                <RibbonSmallButton
                  icon={<FosLabelIcon {...SMALL_ICON} />}
                  label="FOS label"
                  title="Show FOS label"
                  onClick={() => setRvs({ showFosLabel: !rvs.showFosLabel })}
                  active={rvs.showFosLabel}
                />
                <RibbonSmallButton
                  icon={<CentreIcon {...SMALL_ICON} />}
                  label="Center"
                  title="Show center mark"
                  onClick={() =>
                    setRvs({ showCentreMarker: !rvs.showCentreMarker })
                  }
                  active={rvs.showCentreMarker}
                />
                <RibbonSmallButton
                  icon={<SoilColorsIcon {...SMALL_ICON} />}
                  label="Soil colors"
                  onClick={() =>
                    setRvs({ showSoilColor: !(rvs.showSoilColor ?? true) })
                  }
                  active={rvs.showSoilColor ?? true}
                />
                {result?.fem && (
                  <RibbonSmallButton
                    icon={<PlasticZoneIcon {...SMALL_ICON} />}
                    label="Plastic zone"
                    title="Shade the plastic zone (the failure mechanism) of the finite element analysis, which is experimental."
                    onClick={() =>
                      setRvs({ showFemPlasticZone: !(rvs.showFemPlasticZone ?? true) })
                    }
                    active={rvs.showFemPlasticZone ?? true}
                  />
                )}
                {result?.fem && (
                  <RibbonSmallButton
                    icon={<FeMeshIcon {...SMALL_ICON} />}
                    label="FE mesh"
                    title="Draw the last mesh of the finite element analysis, finer where the failure mechanism lies. Finite elements are experimental."
                    onClick={() => setRvs({ showFemMesh: !(rvs.showFemMesh ?? false) })}
                    active={rvs.showFemMesh ?? false}
                  />
                )}
                <RibbonSmallButton
                  icon={<SettingsIcon {...SMALL_ICON} />}
                  label="Sheet settings"
                  onClick={showSheetSettings}
                />
              </RibbonStack>
            </RibbonGroup>
            <RibbonSep />
            <RibbonGroup label="Annotations">
              <RibbonStack>
                <RibbonSmallButton
                  icon={<TextIcon {...SMALL_ICON} />}
                  label="Text"
                  title="Add text"
                  onClick={() => addAnnotation("text")}
                />
                <RibbonSmallButton
                  icon={<PlotIcon {...SMALL_ICON} />}
                  label="Plot"
                  title="Add plot"
                  onClick={() => addAnnotation("plot")}
                />
                <RibbonSmallButton
                  icon={<MaterialTableIcon {...SMALL_ICON} />}
                  label="Material table"
                  title={rvs.annotations.some((a) => a.type === "material-table") ? "Remove material table" : "Add material table"}
                  onClick={() => toggleAnnotation("material-table")}
                  active={rvs.annotations.some((a) => a.type === "material-table")}
                />
                <RibbonSmallButton
                  icon={<ColorBarIcon {...SMALL_ICON} />}
                  label="Color bar"
                  title={rvs.annotations.some((a) => a.type === "color-bar") ? "Remove color bar" : "Add color bar"}
                  onClick={() => toggleAnnotation("color-bar")}
                  active={rvs.annotations.some((a) => a.type === "color-bar")}
                />
                <RibbonMenuButton
                  icon={<ReferenceLineIcon {...SMALL_ICON} />}
                  label="Reference line"
                  items={[
                    {
                      label: "Polyline",
                      title: "Add a reference polyline (model coordinates): drag its points, right-click to add or remove one",
                      onClick: addReferencePolyline,
                    },
                    {
                      label: "Circle",
                      title: "Add a reference circle, drawn below the ground like a slip circle: drag its center or rim",
                      onClick: addReferenceCircle,
                    },
                  ]}
                />
              </RibbonStack>
            </RibbonGroup>
            <RibbonSep />
            <RibbonGroup label="Templates">
              <RibbonStack>
                <RibbonSmallButton
                  icon={<ExportTemplateIcon {...SMALL_ICON} />}
                  label="Export template"
                  onClick={() => {
                    // A template carries the sheet's layout (paper space);
                    // reference annotations are the model's own geometry
                    // and stay out of it.
                    const template = {
                      version: 1,
                      resultViewSettings: { ...rvs, annotations: paperAnnotations(rvs.annotations) },
                    };
                    downloadFile(
                      "view-template.json",
                      JSON.stringify(template, null, 2),
                      "application/json",
                    );
                  }}
                />
                <RibbonSmallButton
                  icon={<ImportTemplateIcon {...SMALL_ICON} />}
                  label="Import template"
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".json";
                    input.onchange = () => {
                      const file = input.files?.[0];
                      if (!file) return;
                      const tooLarge = fileTooLarge(file);
                      if (tooLarge) {
                        alert(tooLarge);
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = () => {
                        try {
                          const data = JSON.parse(reader.result as string);
                          if (
                            !data?.resultViewSettings ||
                            typeof data.resultViewSettings !== "object"
                          ) {
                            alert("Invalid template file.");
                            return;
                          }
                          // Validate like a project file; unset optional
                          // fields so values from the current view don't
                          // leak into the template's settings.
                          const imported = normalizeResultView(data.resultViewSettings);
                          setRvs({
                            gridSpacing: undefined,
                            gridLineSpacing: undefined,
                            minorTicks: undefined,
                            showCustomSurfaces: undefined,
                            showFemMesh: undefined,
                            showFemPlasticZone: undefined,
                            viewLock: undefined,
                            pdfSummaryPages: undefined,
                            pdfTitleLine: undefined,
                            ...imported,
                            // The model keeps its own reference lines; a
                            // template's (if any) belong to another model.
                            annotations: [
                              ...paperAnnotations(imported.annotations),
                              ...referenceAnnotations(useAppStore.getState().resultViewSettings.annotations),
                            ],
                          });
                        } catch {
                          alert("Invalid template file.");
                        }
                      };
                      reader.readAsText(file);
                    };
                    input.click();
                  }}
                />
              </RibbonStack>
            </RibbonGroup>
            <RibbonSep />
            <RibbonGroup label="Export">
              <div className="relative" ref={exportMenuRef}>
                <button
                  onClick={handleExportPdf}
                  disabled={!hasResult}
                  className={`min-w-[58px] h-[50px] pl-2 pr-4 rounded-xs flex flex-col items-center justify-center gap-[5px] cursor-pointer ${hasResult ? "hover:bg-[var(--color-vsc-list-hover)]" : ""}`}
                  style={{
                    color: "var(--color-vsc-text)",
                    background: "transparent",
                    opacity: hasResult ? 1 : 0.4,
                    border: "none",
                  }}
                  title={hasResult ? "Export PDF" : "Run the analysis first"}
                  aria-label="Export PDF"
                  role="menuitem"
                  aria-disabled={!hasResult}
                  data-size="large"
                >
                  <span className="flex items-center justify-center">
                    <PdfIcon {...LARGE_ICON} />
                  </span>
                  <span className="text-[11px] leading-none">Export</span>
                </button>

                <button
                  onClick={() => {
                    if (!exportMenuOpen) {
                      const box = exportMenuRef.current?.getBoundingClientRect();
                      setExportMenuToLeft(
                        !!box && box.left + EXPORT_MENU_WIDTH > window.innerWidth - 8,
                      );
                    }
                    setExportMenuOpen(!exportMenuOpen);
                  }}
                  disabled={!hasResult}
                  className="absolute bottom-[3px] right-0 w-4 h-4 flex items-center justify-center cursor-pointer"
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    opacity: hasResult ? 1 : 0.4,
                  }}
                  aria-haspopup="menu"
                  aria-expanded={exportMenuOpen}
                  title="More export options"
                >
                  <Chevron />
                </button>

                {exportMenuOpen && hasResult && (
                  <div
                    className={`absolute top-[3.25rem] ${exportMenuToLeft ? "right-0" : "left-0"} rounded py-1 z-20`}
                    style={{
                      background: "var(--color-vsc-panel)",
                      border: "1px solid var(--color-vsc-border)",
                      minWidth: 160,
                      boxShadow: "0 6px 16px rgba(0,0,0,0.2)",
                    }}
                    role="menu"
                  >
                    <button
                      onClick={() => {
                        setExportMenuOpen(false);
                        handleExportPdf();
                      }}
                      className="w-full text-left px-3 py-1.5 text-[11px] cursor-pointer whitespace-nowrap"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--color-vsc-text)",
                      }}
                    >
                      Export as PDF
                    </button>
                    {/* What the PDF holds besides the drawing; kept with the
                        model's result view (saved in the project file and
                        in view templates). */}
                    <div
                      className="px-3 py-1 flex flex-col gap-1"
                      style={{ borderBottom: "1px solid var(--color-vsc-border)" }}
                    >
                      {(
                        [
                          ["pdfSummaryPages", "summaryPages", "Analysis summary pages", "Append the calculation basis (method, search, water, partial factors, materials and loads) as pages after the drawing"],
                          ["pdfTitleLine", "titleLine", "Title line above the drawing", "Write the model name, factor of safety and method in the top margin above the drawing frame"],
                        ] as const
                      ).map(([key, option, label, tip]) => (
                        <label
                          key={key}
                          className="flex items-center gap-2 text-[11px] cursor-pointer select-none whitespace-nowrap"
                          style={{ color: "var(--color-vsc-text)" }}
                          title={tip}
                        >
                          <input
                            type="checkbox"
                            checked={pdfPageOptions(rvs)[option]}
                            onChange={(e) => setRvs({ [key]: e.target.checked })}
                            className="accent-blue-500 w-3 h-3"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        setExportMenuOpen(false);
                        handleExportPng();
                      }}
                      className="w-full text-left px-3 py-1.5 text-[11px] cursor-pointer whitespace-nowrap"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--color-vsc-text)",
                      }}
                    >
                      Export as PNG
                    </button>
                    {(
                      [
                        ["xlsx", "Slice data (Excel)", "Slices of the critical surface as an Excel workbook"],
                        ["csv", "Slice data (CSV)", "Slices of the critical surface; comma separator, decimal point"],
                        ["csv-se", "Slice data (CSV, decimal comma)", "Slices of the critical surface; semicolon separator, decimal comma (Excel with a comma locale)"],
                      ] as const
                    ).map(([format, label, tip]) => (
                      <button
                        key={format}
                        onClick={() => {
                          setExportMenuOpen(false);
                          exportSliceData(format);
                        }}
                        className="w-full text-left px-3 py-1.5 text-[11px] cursor-pointer whitespace-nowrap"
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "var(--color-vsc-text)",
                        }}
                        title={tip}
                      >
                        {label}
                      </button>
                    ))}
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

/** About the export menu's width, to keep it inside the window. */
const EXPORT_MENU_WIDTH = 220;

/** Export the critical surface's slices of the active model. */
function exportSliceData(format: "xlsx" | "csv" | "csv-se"): void {
  const state = useAppStore.getState();
  const result = state.result;
  if (!result) return;
  const modelName =
    state.models.find((m) => m.id === state.activeModelId)?.name ?? "cslope";
  const rows = buildSliceTable(result, {
    modelName,
    date: new Date().toISOString().slice(0, 10),
    partialFactors: state.options.partialFactors ?? null,
  });
  const base = `${modelName} slices`;
  if (format === "xlsx") {
    downloadFile(
      safeFileName(base, "xlsx"),
      buildXlsx("Slices", rows),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  } else {
    // BOM so Excel reads the file as UTF-8 (°, ², ').
    downloadFile(
      safeFileName(base, "csv"),
      "\uFEFF" + toCsv(rows, format === "csv-se"),
      "text/csv;charset=utf-8",
    );
  }
}
