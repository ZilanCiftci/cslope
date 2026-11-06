/**
 * ResultSidebar — right sidebar for result view settings.
 */

import { DraftNumberInput } from "../../components/ui/DraftNumberInput";
import { parseDecimalText } from "../../utils/decimal";
import { ExperimentalBadge } from "../../components/ui/ExperimentalBadge";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { PAPER_DIMENSIONS, useAppStore } from "../../store/app-store";
import { Section } from "../../components/ui/Section";
import { HelpButton } from "../../components/ui/HelpButton";
import { PanelHeaderRow } from "../../components/SidePanelChrome";
import { Label } from "../../components/ui/Label";
import { MultiSelectComboboxChips } from "../../components/ui/MultiSelectComboboxChips";
import {
  DEFAULT_MATERIAL_TABLE_COLUMNS,
  MATERIAL_TABLE_COLUMNS,
  getAnnotationBoundsPx,
} from "../canvas/helpers";
import {
  computePaperFrame,
  getPlotAspectRatio as getSharedPlotAspectRatio,
} from "../view/paper";
import {
  anchoredTopLeft,
  anchorPointFromTopLeft,
} from "../annotations/anchorPosition";
import { customSurfaceGeometryText, customSurfaceName, customSurfaceValueText, surfaceCountText } from "../../utils/result-summary";
import { ResultNotes } from "./ResultNotes";
import { ColorBarProperties } from "./ColorBarProperties";
import { resolveAnnotationText } from "../annotations/resolveAnnotationText";
import { InsertVariableMenu } from "../annotations/InsertVariableMenu";
import { isPaperAnnotation, isReferenceAnnotation } from "../annotations/reference";
import { ReferenceProperties } from "./ReferenceProperties";
import { LayersList } from "./LayersList";
import { LayerProperties } from "./LayerProperties";
import { DISPLAY_LAYER_NAMES, displayLayerShown } from "./layers";
import { openSearchLimits } from "../analysis/open-search-limits";
import { isNoSlipSurfaceError } from "../analysis/analysis-error";
import { modelViewLock } from "../view/viewLock";
import { paperContentOf } from "../view/extents";
import { fosStatusColor } from "../../utils/fos-color";
import type { FemResultSummary } from "@cslope/engine";
import type {
  Annotation,
  MaterialTableColumnKey,
  AnchorPosition,
  PlotAxisMode,
  PlotMetricKey,
  PaperSize,
  ResultViewSettings,
} from "../../store/types";
import { SCREEN_PAPER_BOTTOM_RESERVE_PX } from "../../constants";

const FONT_SIZES = [6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32];
const FONT_FAMILIES = [
  { label: "Sans-serif", value: "sans-serif" },
  { label: "Serif", value: "serif" },
  { label: "Monospace", value: "monospace" },
];
const COLORS = [
  "#000000",
  "#333333",
  "#666666",
  "#999999",
  "#cc0000",
  "#cc6600",
  "#cccc00",
  "#00cc00",
  "#0066cc",
  "#6600cc",
  "#ffffff",
];

/** The material table's column headers without their units, for the column chips. */
const SHORT_COLUMN_LABELS: Record<MaterialTableColumnKey, string> = {
  model: "Material model",
  unitWeight: "Unit weight",
  cohesion: "Cohesion / Su",
  piezometricLine: "Piezometric surface",
  depthRef: "Datum",
  cDatum: "C-datum",
  cRate: "C-rate",
  frictionAngle: "Friction angle",
};

const MATERIAL_TABLE_COLUMN_OPTIONS = MATERIAL_TABLE_COLUMNS.map((col) => ({
  value: col.key,
  label: SHORT_COLUMN_LABELS[col.key],
}));

const PLOT_AXIS_X_OPTIONS: Array<{ value: PlotAxisMode; label: string }> = [
  { value: "slice", label: "Slice number" },
  { value: "x", label: "X coordinate" },
];

const PLOT_AXIS_Y_OPTIONS: Array<{ value: PlotMetricKey; label: string }> = [
  { value: "shearStrength", label: "Shear strength" },
  { value: "frictionAngle", label: "Friction angle" },
  { value: "cohesion", label: "Cohesion" },
  { value: "baseCohesion", label: "Base cohesion" },
  { value: "porePressure", label: "Pore pressure" },
  { value: "pwp", label: "PWP" },
  { value: "sliceWeight", label: "Slice weight" },
  { value: "cohesionStrength", label: "Cohesion strength" },
  { value: "resistingForce", label: "Resisting force" },
  { value: "pullingForce", label: "Pulling force" },
];

type SidebarSection = "summary" | "layers" | "properties";
type ExtentField = "bl_x" | "bl_y" | "tr_x" | "tr_y";

function commonValue<T>(values: T[]): T | undefined {
  if (values.length === 0) return undefined;
  const first = values[0];
  return values.every((v) => v === first) ? first : undefined;
}

/** What one kind of annotation is called (as in the ribbon). */
const ANNOTATION_KIND_NAMES: Record<Annotation["type"], string> = {
  text: "Text",
  "material-table": "Material table",
  "color-bar": "Color bar",
  plot: "Plot",
  reference: "Reference line",
};

/**
 * The heading of the result sidebar's last section: what is selected
 * ("Sheet", "Text", "Material table"), or "Selection" for nothing or a mix.
 */
function selectionSectionTitle(selected: readonly Annotation[], paperFrameSelected: boolean): string {
  if (paperFrameSelected) return "Sheet";
  const kinds = new Set(selected.map((a) => a.type));
  if (kinds.size !== 1) return "Selection";
  return ANNOTATION_KIND_NAMES[selected[0].type];
}

/** "top-left" → "Top left": an annotation anchor in sentence case. */
function anchorLabel(anchor: string): string {
  const text = anchor.replace("-", " ");
  return text[0].toUpperCase() + text.slice(1);
}

export function ResultSidebar() {
  // Ties each field label to its control (the control's accessible name).
  const uid = useId();
  const fieldId = (key: string) => `${uid}-${key}`;
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const propertiesLocation = useAppStore((s) => s.propertiesLocation);
  const setPropertiesLocation = useAppStore((s) => s.setPropertiesLocation);
  const result = useAppStore((s) => s.result);
  const designValues = useAppStore((s) => !!s.options.partialFactors);
  const runState = useAppStore((s) => s.runState);
  const errorMessage = useAppStore((s) => s.errorMessage);
  const runStage = useAppStore((s) => s.runStage);
  const rvs = useAppStore((s) => s.resultViewSettings);
  const setRvs = useAppStore((s) => s.setResultViewSettings);
  const updateAnnotation = useAppStore((s) => s.updateAnnotation);
  const selectedAnnotationIds = useAppStore((s) => s.selectedAnnotationIds);
  const selectedResultObject = useAppStore((s) => s.selectedResultObject);
  const selectedResultLayer = useAppStore((s) => s.selectedResultLayer);
  const backgrounds = useAppStore((s) => s.backgrounds);
  const projectInfo = useAppStore((s) => s.projectInfo);
  const parameters = useAppStore((s) => s.parameters);
  // Text as the sheet shows it: #Title, {{expressions}} and \n resolved.
  const resolveText = useCallback(
    (text: string) =>
      resolveAnnotationText({ text, projectInfo, result, parameters }),
    [projectInfo, result, parameters],
  );
  const tagContext = useMemo(
    () => ({ projectInfo, result }),
    [projectInfo, result],
  );
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const [openSections, setOpenSections] = useState<
    Record<SidebarSection, boolean>
  >({
    summary: true,
    layers: true,
    properties: true,
  });

  const extentFieldValue = useCallback(
    (field: ExtentField): number => {
      if (field === "bl_x") return rvs.viewLock?.bottomLeft[0] ?? -1;
      if (field === "bl_y") return rvs.viewLock?.bottomLeft[1] ?? -1;
      if (field === "tr_x") return rvs.viewLock?.topRight[0] ?? 26;
      return rvs.viewLock?.topRight[1] ?? 18;
    },
    [rvs.viewLock],
  );

  const formatExtentValue = useCallback((value: number) => {
    const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
    return rounded.toFixed(2);
  }, []);

  const [extentDraft, setExtentDraft] = useState<Record<ExtentField, string>>({
    bl_x: formatExtentValue(extentFieldValue("bl_x")),
    bl_y: formatExtentValue(extentFieldValue("bl_y")),
    tr_x: formatExtentValue(extentFieldValue("tr_x")),
    tr_y: formatExtentValue(extentFieldValue("tr_y")),
  });
  const [activeExtentField, setActiveExtentField] =
    useState<ExtentField | null>(null);

  const extentInputValue = (field: ExtentField) =>
    activeExtentField === field
      ? extentDraft[field]
      : formatExtentValue(extentFieldValue(field));

  const handleExtentFocus = (field: ExtentField) => {
    setActiveExtentField(field);
    setExtentDraft((prev) => ({
      ...prev,
      [field]: formatExtentValue(extentFieldValue(field)),
    }));
  };

  const handleLockUpdate = useCallback(
    (field: ExtentField, val: number) => {
      const source =
        rvs.viewLock ?? ({ bottomLeft: [-1, -1], topRight: [26, 18] } as const);
      const newVl = {
        bottomLeft: [...source.bottomLeft] as [number, number],
        topRight: [...source.topRight] as [number, number],
      };

      if (field === "bl_x") newVl.bottomLeft[0] = val;
      else if (field === "bl_y") newVl.bottomLeft[1] = val;
      else if (field === "tr_x") newVl.topRight[0] = val;
      else if (field === "tr_y") newVl.topRight[1] = val;

      const ar = getSharedPlotAspectRatio(
        rvs.paperFrame.paperSize,
        rvs.paperFrame.landscape,
      );
      if (field === "tr_y") {
        const w = newVl.topRight[0] - newVl.bottomLeft[0];
        const newH = w / ar;
        newVl.bottomLeft[1] = newVl.topRight[1] - newH;
      } else {
        const w = newVl.topRight[0] - newVl.bottomLeft[0];
        const newH = w / ar;
        newVl.topRight[1] = newVl.bottomLeft[1] + newH;
      }

      setRvs({ viewLock: newVl });
    },
    [rvs.paperFrame.landscape, rvs.paperFrame.paperSize, rvs.viewLock, setRvs],
  );

  const commitExtentField = (field: ExtentField) => {
    const raw = extentDraft[field].trim();
    if (raw === "" || raw === "-" || raw === "+") {
      setExtentDraft((prev) => ({
        ...prev,
        [field]: formatExtentValue(extentFieldValue(field)),
      }));
      return;
    }

    const parsed = parseDecimalText(raw);
    if (!Number.isFinite(parsed)) {
      setExtentDraft((prev) => ({
        ...prev,
        [field]: formatExtentValue(extentFieldValue(field)),
      }));
      return;
    }

    handleLockUpdate(field, parsed);
  };

  const handleExtentChange = (field: ExtentField, raw: string) => {
    setExtentDraft((prev) => ({ ...prev, [field]: raw }));
  };

  // The frame the model starts with (and the automatic refit gives): at
  // true scale around everything it draws, below the title block.
  const setViewLockToModelBounds = useCallback(() => {
    const state = useAppStore.getState();
    setRvs({ viewLock: modelViewLock(paperContentOf(state), state.resultViewSettings) });
  }, [setRvs]);

  const toggleSection = useCallback((section: SidebarSection) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  const selectedAnnotations = useMemo(
    () =>
      rvs.annotations.filter((anno) => selectedAnnotationIds.includes(anno.id)),
    [rvs.annotations, selectedAnnotationIds],
  );

  // Paper annotations share a position and anchor; reference annotations
  // (model coordinates) have their own properties.
  const selectedPaperAnnotations = useMemo(
    () => selectedAnnotations.filter(isPaperAnnotation),
    [selectedAnnotations],
  );
  const selectedReferenceAnnotations = useMemo(
    () => selectedAnnotations.filter(isReferenceAnnotation),
    [selectedAnnotations],
  );
  const allSelectedAreReference =
    selectedAnnotations.length > 0 &&
    selectedReferenceAnnotations.length === selectedAnnotations.length;

  const selectedTextAnnotations = useMemo(
    () => selectedAnnotations.filter((anno) => anno.type === "text"),
    [selectedAnnotations],
  );
  const selectedMaterialTableAnnotations = useMemo(
    () => selectedAnnotations.filter((anno) => anno.type === "material-table"),
    [selectedAnnotations],
  );
  const selectedPlotAnnotations = useMemo(
    () => selectedAnnotations.filter((anno) => anno.type === "plot"),
    [selectedAnnotations],
  );
  const selectedColorBarAnnotations = useMemo(
    () => selectedAnnotations.filter((anno) => anno.type === "color-bar"),
    [selectedAnnotations],
  );
  const allSelectedAreColorBar =
    selectedAnnotations.length > 0 &&
    selectedColorBarAnnotations.length === selectedAnnotations.length;

  const allSelectedAreText =
    selectedAnnotations.length > 0 &&
    selectedTextAnnotations.length === selectedAnnotations.length;
  const allSelectedAreMaterialTable =
    selectedAnnotations.length > 0 &&
    selectedMaterialTableAnnotations.length === selectedAnnotations.length;
  const allSelectedArePlot =
    selectedAnnotations.length > 0 &&
    selectedPlotAnnotations.length === selectedAnnotations.length;

  const textValue = commonValue(
    selectedTextAnnotations.map((a) => a.text ?? ""),
  );
  const fontFamilyValue = commonValue(
    selectedTextAnnotations.map((a) => a.fontFamily ?? "sans-serif"),
  );
  const fontSizeValue = commonValue(
    selectedTextAnnotations.map((a) => a.fontSize ?? 12),
  );
  const boldValue = commonValue(selectedTextAnnotations.map((a) => !!a.bold));
  const italicValue = commonValue(
    selectedTextAnnotations.map((a) => !!a.italic),
  );
  const colorValue = commonValue(
    selectedTextAnnotations.map((a) => a.color ?? "#000000"),
  );

  // Shared position values (all paper annotation types)
  const xValue = commonValue(selectedPaperAnnotations.map((a) => a.x));
  const yValue = commonValue(selectedPaperAnnotations.map((a) => a.y));
  const anchorValue = commonValue(
    selectedPaperAnnotations.map((a) => a.anchor ?? "top-left"),
  );

  const applyToAll = useCallback(
    (patch: { x?: number; y?: number; anchor?: AnchorPosition }) => {
      for (const anno of selectedPaperAnnotations) {
        updateAnnotation(anno.id, patch);
      }
    },
    [selectedPaperAnnotations, updateAnnotation],
  );

  const handleAnchorChange = useCallback(
    (newAnchor: AnchorPosition) => {
      const s = useAppStore.getState();
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 800;
      const ctx = canvas.getContext("2d");
      if (!ctx || !s.result) {
        applyToAll({ anchor: newAnchor });
        return;
      }
      const pfSettings = s.resultViewSettings.paperFrame;
      const pf = computePaperFrame(
        1200,
        800,
        pfSettings.paperSize,
        pfSettings.landscape,
        pfSettings.zoom ?? 1,
        0,
        0,
        SCREEN_PAPER_BOTTOM_RESERVE_PX,
      );
      for (const anno of selectedPaperAnnotations) {
        const oldAnchor = anno.anchor ?? "top-left";
        if (oldAnchor === newAnchor) {
          updateAnnotation(anno.id, { anchor: newAnchor });
          continue;
        }
        const bounds = getAnnotationBoundsPx(ctx, {
          annotation: anno,
          paperFrame: pf,
          result: s.result,
          materials: s.materials,
          piezometricLine: s.piezometricLine,
          projectInfo: s.projectInfo,
          parameters: s.parameters,
          resultView: s.resultViewSettings,
        });
        const hitPad = 4;
        const wFrac = (bounds.w - 2 * hitPad) / pf.w;
        const hFrac = (bounds.h - 2 * hitPad) / pf.h;
        const oldTL = anchoredTopLeft(anno.x, anno.y, wFrac, hFrac, oldAnchor);
        const newPos = anchorPointFromTopLeft(
          oldTL.x,
          oldTL.y,
          wFrac,
          hFrac,
          newAnchor,
        );
        updateAnnotation(anno.id, {
          anchor: newAnchor,
          x: newPos.x,
          y: newPos.y,
        });
      }
    },
    [selectedPaperAnnotations, updateAnnotation, applyToAll],
  );

  const mtFontSize = commonValue(
    selectedMaterialTableAnnotations.map((a) => a.fontSize ?? 6),
  );

  const plotWidthValue = commonValue(
    selectedPlotAnnotations.map((a) => a.width ?? 0.24),
  );
  const plotHeightValue = commonValue(
    selectedPlotAnnotations.map((a) => a.height ?? 0.18),
  );
  const plotAxisXValue = commonValue(
    selectedPlotAnnotations.map((a) => a.plotAxisX ?? "slice"),
  );
  const plotAxisYValue = commonValue(
    selectedPlotAnnotations.map((a) => a.plotAxisY ?? "shearStrength"),
  );

  const applyToSelectedText = useCallback(
    (patch: {
      text?: string;
      fontFamily?: string;
      fontSize?: number;
      bold?: boolean;
      italic?: boolean;
      color?: string;
    }) => {
      for (const anno of selectedTextAnnotations) {
        updateAnnotation(anno.id, patch);
      }
    },
    [selectedTextAnnotations, updateAnnotation],
  );

  const applyToSelectedMaterialTables = useCallback(
    (patch: { tableColumns?: MaterialTableColumnKey[]; fontSize?: number }) => {
      for (const anno of selectedMaterialTableAnnotations) {
        updateAnnotation(anno.id, patch);
      }
    },
    [selectedMaterialTableAnnotations, updateAnnotation],
  );

  const applyToSelectedPlots = useCallback(
    (patch: {
      width?: number;
      height?: number;
      plotAxisX?: PlotAxisMode;
      plotAxisY?: PlotMetricKey;
    }) => {
      for (const anno of selectedPlotAnnotations) {
        updateAnnotation(anno.id, patch);
      }
    },
    [selectedPlotAnnotations, updateAnnotation],
  );

  const visibleColumnsValue = useMemo(() => {
    if (selectedMaterialTableAnnotations.length === 0) return [];
    const first =
      selectedMaterialTableAnnotations[0].tableColumns ?? DEFAULT_MATERIAL_TABLE_COLUMNS;
    return first.filter((column) =>
      selectedMaterialTableAnnotations.every((anno) =>
        (anno.tableColumns ?? DEFAULT_MATERIAL_TABLE_COLUMNS).includes(column),
      ),
    );
  }, [selectedMaterialTableAnnotations]);

  const paperFrameSelected = selectedResultObject === "paper-frame";
  // A display layer selected in Layers, while it is drawn: its properties.
  const selectedLayer =
    selectedResultLayer && displayLayerShown(selectedResultLayer, { resultViewSettings: rvs, result, backgrounds })
      ? selectedResultLayer
      : null;

  // Results › Sheet settings: open Properties, bring the paper's fields
  // into view and put the cursor in the first one.
  const paperFocusPending = useAppStore((s) => s.paperPropertiesFocusPending);
  const clearPaperPropertiesFocus = useAppStore((s) => s.clearPaperPropertiesFocus);
  const paperPropertiesRef = useRef<HTMLDivElement>(null);
  if (paperFocusPending && !openSections.properties) {
    setOpenSections((prev) => ({ ...prev, properties: true }));
  }
  useEffect(() => {
    if (!paperFocusPending) return;
    const el = paperPropertiesRef.current;
    if (!el) return;
    el.scrollIntoView?.({ block: "nearest" });
    el.querySelector<HTMLElement>("input, select")?.focus({ preventScroll: true });
    clearPaperPropertiesFocus();
  }, [paperFocusPending, paperFrameSelected, openSections.properties, clearPaperPropertiesFocus]);

  // The last section is named after the selection and comes into view when
  // something is selected: under an open summary and layer list it began
  // below the panel's edge.
  const selectionTitle = selectionSectionTitle(selectedAnnotations, paperFrameSelected);
  const selectionSectionRef = useRef<HTMLDivElement>(null);
  const selectionKey = paperFrameSelected ? "paper-frame" : selectedLayer ? `layer:${selectedLayer}` : selectedAnnotationIds.join("\n");
  useEffect(() => {
    if (!selectionKey) return;
    selectionSectionRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [selectionKey]);

  const setVisibleColumnsForAll = useCallback(
    (next: string[]) => {
      const normalized = next.filter((value): value is MaterialTableColumnKey =>
        MATERIAL_TABLE_COLUMNS.some((col) => col.key === value),
      );
      applyToSelectedMaterialTables({ tableColumns: normalized });
    },
    [applyToSelectedMaterialTables],
  );

  return (
    <div
      className="h-full flex flex-col"
      style={{
        background: "var(--color-vsc-panel)",
        color: "var(--color-vsc-text)",
      }}
    >
      <PanelHeaderRow
        side={propertiesLocation}
        label="Results"
        onCollapse={toggleSidebar}
        onMove={() =>
          setPropertiesLocation(propertiesLocation === "left" ? "right" : "left")
        }
      >
        <div className="px-4 py-1.5">Results</div>
      </PanelHeaderRow>
      <div className="flex-1 min-h-0 overflow-y-auto">
      <Section
        title="Summary"
        open={openSections.summary}
        onToggle={() => toggleSection("summary")}
      >
        {result ? (
          <div className="space-y-1 text-[12px]">
            <div className="flex justify-between">
              <Label
                title={
                  designValues
                    ? "Over-design factor on design values (partial factors applied); ≥ 1.0 satisfies the design"
                    : undefined
                }
              >
                {designValues ? "Min FOS (design values)" : "Min FOS"}
              </Label>
              <span
                className="font-bold tabular-nums"
                style={{ color: fosStatusColor(result.minFOS, designValues) }}
              >
                {result.minFOS.toFixed(3)}
              </span>
            </div>
            {result.slidingDirection && (
              <>
                <div className="flex justify-between">
                  <Label>Sliding direction</Label>
                  <span>
                    {result.slidingDirection === "ltr" ? "→ right" : "← left"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <Label>Other direction</Label>
                  <span className="tabular-nums">
                    {result.otherDirectionMinFOS != null
                      ? result.otherDirectionMinFOS.toFixed(3)
                      : "no surface"}
                  </span>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <Label>Method</Label>
              <span>{result.method}</span>
            </div>
            <div className="flex justify-between">
              <Label>Surfaces</Label>
              <span className="tabular-nums">{surfaceCountText(result)}</span>
            </div>
            <div className="flex justify-between">
              <Label>Elapsed</Label>
              <span className="tabular-nums">
                {result.elapsedMs.toFixed(0)} ms
              </span>
            </div>
            {result.sgi3d && (
              <div className="mt-1.5 space-y-1 border-t pt-1.5" style={{ borderColor: "var(--color-vsc-border)" }}>
                <div className="flex justify-between">
                  <Label
                    title={`SGI Vägledning 8, eq. ${result.sgi3d.equation}: the smallest F3D over the circular surfaces, stage length ${result.sgi3d.options.length} m${
                      result.sgi3d.options.overstrongF2D != null ? `, adjacent F2D ${result.sgi3d.options.overstrongF2D}` : ", infinitely overstrong adjacent stability"
                    }${result.sgi3d.options.excludeMaterials.length ? `; not in the end faces: ${result.sgi3d.options.excludeMaterials.join(", ")}` : ""}`}
                  >
                    {`F3D (SGI, L = ${result.sgi3d.options.length} m)`}
                  </Label>
                  <span className="font-bold tabular-nums" style={{ color: fosStatusColor(result.sgi3d.factorOfSafety, designValues) }}>
                    {result.sgi3d.factorOfSafety.toFixed(3)}
                  </span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <Label>Its surface: F2D, FP</Label>
                  <span className="tabular-nums">
                    {result.sgi3d.critical.f2d.toFixed(3)}, {result.sgi3d.critical.fp.toFixed(3)}
                  </span>
                </div>
                {result.sgi3d.warnings.map((w) => (
                  <p key={w} className="text-[11px]" style={{ color: "var(--color-vsc-warning-text)" }}>
                    {w}
                  </p>
                ))}
              </div>
            )}
            {!result.sgi3d && result.sgi3dError && (
              <p className="mt-1.5 border-t pt-1.5 text-[11px]" style={{ borderColor: "var(--color-vsc-border)", color: "var(--color-vsc-warning-text)" }}>
                3D effects (SGI): {result.sgi3dError}
              </p>
            )}
            {result.customSurfaces && result.customSurfaces.length > 0 && (
              // Each custom search plane of the run with its factor of safety, or why it has none.
              <div className="mt-1.5 space-y-1 border-t pt-1.5" style={{ borderColor: "var(--color-vsc-border)" }}>
                {result.customSurfaces.map((c, i) => (
                  <div key={`${c.kind}-${c.index}`} className="flex justify-between gap-2" data-testid="custom-surface-row">
                    <Label title={customSurfaceGeometryText(c)}>{customSurfaceName(i)}</Label>
                    {c.surface ? (
                      <span className="tabular-nums">{c.surface.fos.toFixed(3)}</span>
                    ) : (
                      <span className="text-[11px] text-right" style={{ color: "var(--color-vsc-warning-text)" }}>
                        {customSurfaceValueText(c)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <ResultNotes result={result} />
            {/* The finite element rows come last: the notes above belong to the limit equilibrium result. */}
            {result.fem && <FemSummaryRows fem={result.fem} designValues={designValues} />}
            {!result.fem && !result.femError && runState === "running" && (
              // the limit equilibrium result is shown while the finite elements run
              <p
                data-testid="fem-running"
                className="mt-1.5 border-t pt-1.5 text-[11px]"
                style={{ borderColor: "var(--color-vsc-border)", color: "var(--color-vsc-accent)" }}
              >
                Finite elements running{runStage ? ` (${runStage.replace(/^Finite elements: /, "")})` : ""}
              </p>
            )}
            {!result.fem && result.femError && (
              <p className="mt-1.5 border-t pt-1.5 text-[11px]" style={{ borderColor: "var(--color-vsc-border)", color: "var(--color-vsc-warning-text)" }}>
                Strength reduction (FE) failed: {result.femError}
              </p>
            )}
          </div>
        ) : runState === "error" ? (
          // The reason is in the banner over the canvas; here only that it
          // failed, and the way to the cause when it is the search limits.
          <div className="space-y-1.5" data-testid="summary-run-failed">
            <p className="text-[12px]" style={{ color: "var(--color-vsc-text-muted)" }}>
              Analysis failed.
            </p>
            {isNoSlipSurfaceError(errorMessage) && (
              <button type="button" className="btn" onClick={openSearchLimits}>
                Search limits
              </button>
            )}
          </div>
        ) : (
          <p
            className="text-[12px]"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            No results yet.
          </p>
        )}
      </Section>

      <Section
        title="Layers"
        open={openSections.layers}
        onToggle={() => toggleSection("layers")}
      >
        {/* What the sheet draws, topmost first: the annotations and the
            display layers turned on in the ribbon, in an order of the
            model's (drag a row or Alt+Up/Down). */}
        <LayersList resolveText={resolveText} />
      </Section>

      <div ref={selectionSectionRef} data-testid="selection-section">
      <Section
        // Named after what is selected (a display layer: its name): its fields are below.
        title={selectedLayer ? DISPLAY_LAYER_NAMES[selectedLayer] : selectionTitle}
        open={openSections.properties}
        onToggle={() => toggleSection("properties")}
      >
        {selectedLayer && <LayerProperties layer={selectedLayer} />}

        {selectedAnnotations.length === 0 && !paperFrameSelected && !selectedLayer && (
          <p
            className="text-[11px]"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            Select an object on the canvas to edit its properties.
          </p>
        )}

        {paperFrameSelected && (
          <div ref={paperPropertiesRef} className="space-y-2 mb-3" role="group" aria-label="Paper">
            <div
              className="grid gap-2"
              style={{
                gridTemplateColumns: "repeat(auto-fit, minmax(64px, 1fr))",
              }}
            >
              <div>
                <label
                  htmlFor={fieldId("left-x-m")}
                  className="text-[10px] block mb-0.5"
                  style={{ color: "var(--color-vsc-text-muted)" }}
                >
                  Left x (m)
                </label>
                <input
                  id={fieldId("left-x-m")}
                  type="text"
                  inputMode="decimal"
                  value={extentInputValue("bl_x")}
                  onFocus={() => handleExtentFocus("bl_x")}
                  onChange={(e) => handleExtentChange("bl_x", e.target.value)}
                  onBlur={() => {
                    commitExtentField("bl_x");
                    setActiveExtentField(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      commitExtentField("bl_x");
                      (e.currentTarget as HTMLInputElement).blur();
                    }
                  }}
                  className="w-full tabular-nums"
                />
              </div>

              <div>
                <label
                  htmlFor={fieldId("right-x-m")}
                  className="text-[10px] block mb-0.5"
                  style={{ color: "var(--color-vsc-text-muted)" }}
                >
                  Right x (m)
                </label>
                <input
                  id={fieldId("right-x-m")}
                  type="text"
                  inputMode="decimal"
                  value={extentInputValue("tr_x")}
                  onFocus={() => handleExtentFocus("tr_x")}
                  onChange={(e) => handleExtentChange("tr_x", e.target.value)}
                  onBlur={() => {
                    commitExtentField("tr_x");
                    setActiveExtentField(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      commitExtentField("tr_x");
                      (e.currentTarget as HTMLInputElement).blur();
                    }
                  }}
                  className="w-full tabular-nums"
                />
              </div>
            </div>

            <div
              className="grid gap-2"
              style={{
                gridTemplateColumns: "repeat(auto-fit, minmax(64px, 1fr))",
              }}
            >
              <div>
                <label
                  htmlFor={fieldId("bottom-y-m")}
                  className="text-[10px] block mb-0.5"
                  style={{ color: "var(--color-vsc-text-muted)" }}
                >
                  Bottom y (m)
                </label>
                <input
                  id={fieldId("bottom-y-m")}
                  type="text"
                  inputMode="decimal"
                  value={extentInputValue("bl_y")}
                  onFocus={() => handleExtentFocus("bl_y")}
                  onChange={(e) => handleExtentChange("bl_y", e.target.value)}
                  onBlur={() => {
                    commitExtentField("bl_y");
                    setActiveExtentField(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      commitExtentField("bl_y");
                      (e.currentTarget as HTMLInputElement).blur();
                    }
                  }}
                  className="w-full tabular-nums"
                />
              </div>

              <div>
                <label
                  htmlFor={fieldId("top-y-m")}
                  className="text-[10px] block mb-0.5"
                  style={{ color: "var(--color-vsc-text-muted)" }}
                >
                  Top y (m)
                </label>
                <input
                  id={fieldId("top-y-m")}
                  type="text"
                  inputMode="decimal"
                  value={extentInputValue("tr_y")}
                  onFocus={() => handleExtentFocus("tr_y")}
                  onChange={(e) => handleExtentChange("tr_y", e.target.value)}
                  onBlur={() => {
                    commitExtentField("tr_y");
                    setActiveExtentField(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      commitExtentField("tr_y");
                      (e.currentTarget as HTMLInputElement).blur();
                    }
                  }}
                  className="w-full tabular-nums"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={setViewLockToModelBounds}
              className="btn self-start"
            >
              Use model bounds
            </button>

            <div
              className="grid gap-2"
              style={{
                gridTemplateColumns: "repeat(auto-fit, minmax(64px, 1fr))",
              }}
            >
              <div>
                <label
                  htmlFor={fieldId("tick-spacing-m")}
                  className="text-[10px] block mb-0.5"
                  style={{ color: "var(--color-vsc-text-muted)" }}
                >
                  Tick spacing (m)
                </label>
                <DraftNumberInput
                  id={fieldId("tick-spacing-m")}
                  min={0}
                  step="any"
                  placeholder="Auto"
                  value={rvs.gridSpacing}
                  onValueChange={(value) =>
                    setRvs({ gridSpacing: value > 0 ? value : undefined })
                  }
                  onClear={() => setRvs({ gridSpacing: undefined })}
                  className="w-full tabular-nums"
                />
              </div>

              <div>
                <label
                  htmlFor={fieldId("minor-ticks")}
                  className="text-[10px] block mb-0.5"
                  style={{ color: "var(--color-vsc-text-muted)" }}
                >
                  Minor ticks
                </label>
                <DraftNumberInput
                  id={fieldId("minor-ticks")}
                  min={0}
                  max={20}
                  step={1}
                  value={rvs.minorTicks ?? 0}
                  onValueChange={(parsed) => {
                    const value = Math.max(0, Math.min(20, Math.round(parsed)));
                    setRvs({ minorTicks: value || undefined });
                  }}
                  onClear={() => setRvs({ minorTicks: undefined })}
                  className="w-full tabular-nums"
                />
              </div>
            </div>

            <div
              className="grid gap-2 items-end"
              style={{
                gridTemplateColumns: "repeat(auto-fit, minmax(64px, 1fr))",
              }}
            >
              <label className="flex items-center gap-1.5 text-[11px] pb-1">
                <input
                  type="checkbox"
                  checked={rvs.showGrid}
                  onChange={(e) => setRvs({ showGrid: e.target.checked })}
                  aria-label="Grid lines"
                />
                Grid
              </label>
              {rvs.showGrid && (
                <div>
                  <label
                    htmlFor={fieldId("grid-spacing-m")}
                    className="text-[10px] block mb-0.5"
                    style={{ color: "var(--color-vsc-text-muted)" }}
                  >
                    Grid spacing (m)
                  </label>
                  <DraftNumberInput
                    id={fieldId("grid-spacing-m")}
                    min={0}
                    step="any"
                    placeholder="As ticks"
                    value={rvs.gridLineSpacing}
                    onValueChange={(value) =>
                      setRvs({ gridLineSpacing: value > 0 ? value : undefined })
                    }
                    onClear={() => setRvs({ gridLineSpacing: undefined })}
                    title="Distance between the grid lines; empty: the tick spacing"
                    className="w-full tabular-nums"
                  />
                </div>
              )}
            </div>

            <div>
              <label
                htmlFor={fieldId("paper-size")}
                className="text-[10px] block mb-0.5"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                Paper size
              </label>
              <select
                id={fieldId("paper-size")}
                value={rvs.paperFrame.paperSize}
                onChange={(e) =>
                  setRvs({
                    paperFrame: {
                      ...rvs.paperFrame,
                      paperSize: e.target.value as PaperSize,
                    },
                  })
                }
                className="w-full"
              >
                {(Object.keys(PAPER_DIMENSIONS) as PaperSize[]).map((size) => (
                  <option key={size} value={size}>
                    {size} ({PAPER_DIMENSIONS[size].w} × {PAPER_DIMENSIONS[size].h} mm)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor={fieldId("paper-orientation")}
                className="text-[10px] block mb-0.5"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                Paper orientation
              </label>
              <select
                id={fieldId("paper-orientation")}
                value={rvs.paperFrame.landscape ? "landscape" : "portrait"}
                onChange={(e) => {
                  const newLandscape = e.target.value === "landscape";
                  const newAr = getSharedPlotAspectRatio(
                    rvs.paperFrame.paperSize,
                    newLandscape,
                  );
                  const updates: Partial<ResultViewSettings> = {
                    paperFrame: {
                      ...rvs.paperFrame,
                      landscape: newLandscape,
                    },
                  };
                  if (rvs.viewLock) {
                    const bl = [...rvs.viewLock.bottomLeft] as [number, number];
                    const tr = [...rvs.viewLock.topRight] as [number, number];
                    const w = tr[0] - bl[0];
                    tr[1] = bl[1] + w / newAr;
                    updates.viewLock = { bottomLeft: bl, topRight: tr };
                  }
                  setRvs(updates);
                }}
                className="w-full"
              >
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </div>
          </div>
        )}

        {allSelectedAreReference && (
          <ReferenceProperties
            annotations={selectedReferenceAnnotations}
            updateAnnotation={updateAnnotation}
          />
        )}

        {selectedPaperAnnotations.length > 0 && (
          <div className="space-y-2 mb-3">
            <div className="flex gap-2">
              <div className="flex-1">
                <label
                  htmlFor={fieldId("x")}
                  className="text-[10px] block mb-0.5"
                  style={{ color: "var(--color-vsc-text-muted)" }}
                >
                  X (%)
                </label>
                <DraftNumberInput
                  id={fieldId("x")}
                  step="1"
                  value={
                    xValue !== undefined ? Math.round(xValue * 1000) / 10 : undefined
                  }
                  placeholder={xValue === undefined ? "Mixed" : ""}
                  onValueChange={(v) => applyToAll({ x: v / 100 })}
                  className="w-full tabular-nums"
                />
              </div>
              <div className="flex-1">
                <label
                  htmlFor={fieldId("y")}
                  className="text-[10px] block mb-0.5"
                  style={{ color: "var(--color-vsc-text-muted)" }}
                >
                  Y (%)
                </label>
                <DraftNumberInput
                  id={fieldId("y")}
                  step="1"
                  value={
                    yValue !== undefined ? Math.round(yValue * 1000) / 10 : undefined
                  }
                  placeholder={yValue === undefined ? "Mixed" : ""}
                  onValueChange={(v) => applyToAll({ y: v / 100 })}
                  className="w-full tabular-nums"
                />
              </div>
            </div>

            <div>
              <span
                id={fieldId("anchor")}
                className="text-[10px] block mb-1"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                Anchor
              </span>
              <div className="flex items-center gap-2">
                {/* The four corners on a tile in the field colors (seen in both themes). */}
                <div
                  role="group"
                  aria-labelledby={fieldId("anchor")}
                  className="grid grid-cols-2 gap-0.5 p-0.5 rounded-xs"
                  style={{
                    background: "var(--color-vsc-field-bg)",
                    border: "1px solid var(--color-vsc-field-border)",
                  }}
                >
                  {(
                    [
                      "top-left",
                      "top-right",
                      "bottom-left",
                      "bottom-right",
                    ] as const
                  ).map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => handleAnchorChange(a)}
                      aria-label={anchorLabel(a)}
                      aria-pressed={(anchorValue ?? "top-left") === a}
                      className="w-5 h-5 rounded-xs cursor-pointer"
                      style={{
                        background:
                          (anchorValue ?? "top-left") === a
                            ? "var(--color-vsc-accent)"
                            : "var(--color-vsc-border)",
                        border: "none",
                      }}
                      title={anchorLabel(a)}
                    />
                  ))}
                </div>
                <span
                  className="text-[10px]"
                  style={{ color: "var(--color-vsc-text-muted)" }}
                >
                  {anchorValue !== undefined
                    ? anchorLabel(anchorValue)
                    : "Mixed"}
                </span>
              </div>
            </div>

            {selectedAnnotations.length > 1 &&
              !allSelectedAreText &&
              !allSelectedAreMaterialTable &&
              !allSelectedArePlot &&
              !allSelectedAreColorBar && (
                <div
                  className="border-t pt-2 mt-2"
                  style={{ borderColor: "var(--color-vsc-border)" }}
                >
                  <p
                    className="text-[11px]"
                    style={{ color: "var(--color-vsc-text-muted)" }}
                  >
                    {selectedAnnotations.length} object(s) selected — only
                    position and anchor are shared.
                  </p>
                </div>
              )}
          </div>
        )}

        {allSelectedAreText && (
          <div className="space-y-2">
            <div>
              <label
                htmlFor={fieldId("text")}
                className="text-[10px] block mb-0.5"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                Text
              </label>
              <textarea
                id={fieldId("text")}
                ref={textAreaRef}
                value={textValue ?? ""}
                placeholder={textValue === undefined ? "Mixed values" : ""}
                onChange={(e) => applyToSelectedText({ text: e.target.value })}
                className="w-full resize-y min-h-[48px]"
              />
              <InsertVariableMenu
                textareaRef={textAreaRef}
                text={textValue ?? ""}
                disabled={textValue === undefined}
                onChange={(text) => applyToSelectedText({ text })}
                ctx={tagContext}
                parameters={parameters}
              />
              {textValue !== undefined &&
                resolveText(textValue) !== textValue && (
                  // A template (#Title, {{H*2}}): what the sheet shows.
                  <div className="mt-0.5" aria-label="Text on the sheet">
                    <span
                      className="text-[10px]"
                      style={{ color: "var(--color-vsc-text-muted)" }}
                    >
                      On the sheet:
                    </span>
                    <p
                      className="text-[11px] whitespace-pre-wrap break-words"
                      style={{ color: "var(--color-vsc-text)" }}
                    >
                      {resolveText(textValue)}
                    </p>
                  </div>
                )}
            </div>

            <div>
              <label
                htmlFor={fieldId("font")}
                className="text-[10px] block mb-0.5"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                Font
              </label>
              <select
                id={fieldId("font")}
                value={fontFamilyValue ?? "__mixed__"}
                onChange={(e) => {
                  if (e.target.value === "__mixed__") return;
                  applyToSelectedText({ fontFamily: e.target.value });
                }}
                className="w-full"
              >
                {fontFamilyValue === undefined && (
                  <option value="__mixed__">Mixed values</option>
                )}
                {FONT_FAMILIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor={fieldId("size")}
                className="text-[10px] block mb-0.5"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                Size (px)
              </label>
              <select
                id={fieldId("size")}
                value={fontSizeValue ?? "__mixed__"}
                onChange={(e) => {
                  if (e.target.value === "__mixed__") return;
                  applyToSelectedText({ fontSize: Number(e.target.value) });
                }}
                className="w-full"
              >
                {fontSizeValue === undefined && (
                  <option value="__mixed__">Mixed values</option>
                )}
                {FONT_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-1.5">
              <button
                onClick={() =>
                  applyToSelectedText({ bold: boldValue !== true })
                }
                className="btn w-[28px] px-0 font-bold"
                aria-pressed={boldValue === true}
              >
                B
              </button>
              <button
                onClick={() =>
                  applyToSelectedText({ italic: italicValue !== true })
                }
                className="btn w-[28px] px-0 italic"
                aria-pressed={italicValue === true}
              >
                I
              </button>
            </div>

            <div>
              <span
                id={fieldId("color")}
                className="text-[10px] block mb-0.5"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                Color
              </span>
              <div className="flex flex-wrap gap-1" role="group" aria-labelledby={fieldId("color")}>
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Color ${c}`}
                    aria-pressed={(colorValue ?? "") === c}
                    onClick={() => applyToSelectedText({ color: c })}
                    className="w-5 h-5 rounded-sm cursor-pointer"
                    style={{
                      background: c,
                      border:
                        (colorValue ?? "") === c
                          ? "2px solid var(--color-vsc-accent)"
                          : "1px solid var(--color-vsc-border)",
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {allSelectedAreColorBar && (
          <ColorBarProperties
            annotations={selectedColorBarAnnotations}
            result={result}
            fosFilterMax={rvs.fosFilterMax}
            updateAnnotation={updateAnnotation}
          />
        )}

        {allSelectedAreMaterialTable && (
          <div className="space-y-2">
            <div>
              <label
                htmlFor={fieldId("text-size")}
                className="text-[10px] block mb-1"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                Text size (px)
              </label>
              <select
                id={fieldId("text-size")}
                value={mtFontSize ?? "__mixed__"}
                onChange={(e) => {
                  if (e.target.value === "__mixed__") return;
                  applyToSelectedMaterialTables({
                    fontSize: Number(e.target.value),
                  });
                }}
                className="w-full"
              >
                {mtFontSize === undefined && (
                  <option value="__mixed__">Mixed values</option>
                )}
                {FONT_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span
                className="text-[10px] block mb-1"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                Visible columns
              </span>
              <MultiSelectComboboxChips
                options={MATERIAL_TABLE_COLUMN_OPTIONS}
                ariaLabel="Visible columns"
                value={visibleColumnsValue}
                onValueChange={setVisibleColumnsForAll}
                placeholder="Select columns"
                emptyText="No columns found."
              />
            </div>
          </div>
        )}

        {allSelectedArePlot && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <label
                  htmlFor={fieldId("width")}
                  className="text-[10px] block mb-0.5"
                  style={{ color: "var(--color-vsc-text-muted)" }}
                >
                  Width (%)
                </label>
                <DraftNumberInput
                  id={fieldId("width")}
                  min={5}
                  max={95}
                  step="1"
                  value={
                    plotWidthValue !== undefined
                      ? Math.round(plotWidthValue * 1000) / 10
                      : undefined
                  }
                  placeholder={plotWidthValue === undefined ? "Mixed" : ""}
                  onValueChange={(v) => {
                    const clamped = Math.max(5, Math.min(95, v));
                    applyToSelectedPlots({ width: clamped / 100 });
                  }}
                  className="w-full tabular-nums"
                />
              </div>
              <div className="flex-1">
                <label
                  htmlFor={fieldId("height")}
                  className="text-[10px] block mb-0.5"
                  style={{ color: "var(--color-vsc-text-muted)" }}
                >
                  Height (%)
                </label>
                <DraftNumberInput
                  id={fieldId("height")}
                  min={5}
                  max={95}
                  step="1"
                  value={
                    plotHeightValue !== undefined
                      ? Math.round(plotHeightValue * 1000) / 10
                      : undefined
                  }
                  placeholder={plotHeightValue === undefined ? "Mixed" : ""}
                  onValueChange={(v) => {
                    const clamped = Math.max(5, Math.min(95, v));
                    applyToSelectedPlots({ height: clamped / 100 });
                  }}
                  className="w-full tabular-nums"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor={fieldId("x-axis")}
                className="text-[10px] block mb-0.5"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                X axis
              </label>
              <select
                id={fieldId("x-axis")}
                value={plotAxisXValue ?? "__mixed__"}
                onChange={(e) => {
                  if (e.target.value === "__mixed__") return;
                  applyToSelectedPlots({
                    plotAxisX: e.target.value as PlotAxisMode,
                  });
                }}
                className="w-full"
              >
                {plotAxisXValue === undefined && (
                  <option value="__mixed__">Mixed values</option>
                )}
                {PLOT_AXIS_X_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor={fieldId("y-axis")}
                className="text-[10px] block mb-0.5"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                Y axis
              </label>
              <select
                id={fieldId("y-axis")}
                value={plotAxisYValue ?? "__mixed__"}
                onChange={(e) => {
                  if (e.target.value === "__mixed__") return;
                  applyToSelectedPlots({
                    plotAxisY: e.target.value as PlotMetricKey,
                  });
                }}
                className="w-full"
              >
                {plotAxisYValue === undefined && (
                  <option value="__mixed__">Mixed values</option>
                )}
                {PLOT_AXIS_Y_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </Section>
      </div>
      </div>
    </div>
  );
}

/**
 * The F–displacement curve of the strength reduction: the largest nodal
 * displacement of each converged trial against its reduction factor. Near
 * failure the curve turns flat (displacements grow without a rise in F),
 * which shows whether the factor of safety marks a collapse.
 */
function FemCurve({ curve, fos }: { curve: { F: number; displacement: number }[]; fos: number }) {
  const W = 220, H = 120, L = 34, R = 6, T = 6, B = 24;
  const dMax = Math.max(...curve.map((p) => p.displacement));
  const maxD = dMax > 0 ? dMax : 1;
  const fs = curve.map((p) => p.F);
  const fMin = Math.min(...fs), fMax = Math.max(...fs, fos);
  const fLo = fMin - 0.05 * (fMax - fMin || 1), fHi = fMax + 0.05 * (fMax - fMin || 1);
  const px = (d: number) => L + (d / maxD) * (W - L - R);
  const py = (f: number) => T + (1 - (f - fLo) / (fHi - fLo)) * (H - T - B);
  const unit = dMax < 0.01 ? { k: 1000, name: "mm" } : { k: 1, name: "m" };
  const muted = "var(--color-vsc-text-muted)";
  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Reduction factor against the largest displacement of the converged trials"
      >
        <line x1={L} y1={T} x2={L} y2={H - B} stroke="var(--color-vsc-border)" />
        <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke="var(--color-vsc-border)" />
        {Number.isFinite(fos) && fos > 0 && (
          <line x1={L} y1={py(fos)} x2={W - R} y2={py(fos)} stroke={muted} strokeDasharray="3 3" />
        )}
        <polyline
          points={curve.map((p) => `${px(p.displacement)},${py(p.F)}`).join(" ")}
          fill="none"
          stroke="var(--color-vsc-accent)"
          strokeWidth={1.5}
        />
        {curve.map((p, k) => (
          <circle key={k} cx={px(p.displacement)} cy={py(p.F)} r={2} fill="var(--color-vsc-accent)">
            <title>{`F = ${p.F.toFixed(3)}: ${(p.displacement * unit.k).toPrecision(3)} ${unit.name}`}</title>
          </circle>
        ))}
        <text x={L - 3} y={py(fHi) + 8} textAnchor="end" fontSize={9} fill={muted}>
          {fHi.toFixed(2)}
        </text>
        <text x={L - 3} y={H - B} textAnchor="end" fontSize={9} fill={muted}>
          {fLo.toFixed(2)}
        </text>
        <text x={L} y={H - B + 11} fontSize={9} fill={muted}>
          0
        </text>
        <text x={W - R} y={H - B + 11} textAnchor="end" fontSize={9} fill={muted}>
          {`${(dMax * unit.k).toPrecision(3)} ${unit.name}`}
        </text>
        <text x={(L + W - R) / 2} y={H - 3} textAnchor="middle" fontSize={9} fill={muted}>
          Largest displacement
        </text>
        <text x={9} y={(T + H - B) / 2} textAnchor="middle" fontSize={9} fill={muted} transform={`rotate(-90 9 ${(T + H - B) / 2})`}>
          F
        </text>
      </svg>
    </figure>
  );
}

/** The bounds as a range, or the one that was found. */
function boundsText(lower: number | null, upper: number | null): string {
  if (lower !== null && upper !== null) return `${lower.toFixed(3)} – ${upper.toFixed(3)}`;
  if (upper !== null) return `≤ ${upper.toFixed(3)} (no lower bound)`;
  if (lower !== null) return `≥ ${lower.toFixed(3)} (no upper bound)`;
  return "not found";
}

const FLOW_RULE_NAMES = { "davis-b": "Davis B", associated: "associated", "non-associated": "non-associated" } as const;

/** The finite element strength reduction of the run. */
function FemSummaryRows({ fem, designValues }: { fem: FemResultSummary; designValues: boolean }) {
  const last = fem.levels[fem.levels.length - 1];
  const srf = Number.isFinite(fem.factorOfSafety) && fem.factorOfSafety > 0 ? fem.factorOfSafety.toFixed(3) : "–";
  // With the limit analysis bounds they are the factor of safety, the
  // strength reduction a comparison with other programs (see the docs).
  const headline = !!fem.bounds && (fem.bounds.lower !== null || fem.bounds.upper !== null);
  const srfTitle =
    fem.flowRule === "non-associated"
      ? "Strength reduction with non-associated flow, as other programs compute it. It falls on every mesh refinement, so it is computed on the first mesh: a comparison, not the factor of safety."
      : "Strength reduction: the largest factor on c and tan φ at which the slope is still in equilibrium. No slip surface needed; the plastic zone on the canvas shows the mechanism.";
  return (
    <div className="mt-1.5 space-y-1 border-t pt-1.5" style={{ borderColor: "var(--color-vsc-border)" }}>
      <h4 className="flex items-center text-[11px] font-semibold">
        Finite elements
        <ExperimentalBadge />
        <span className="ml-auto">
          <HelpButton topic="Finite element results" page="analysis#finite-element-results" />
        </span>
      </h4>
      {fem.bounds && (
        <div className="flex justify-between">
          <Label
            title={`Limit analysis on ${fem.bounds.elements} elements${fem.bounds.refinements ? `, ${fem.bounds.refinements} refinement${fem.bounds.refinements > 1 ? "s" : ""}` : ""}, ${(fem.bounds.elapsedMs / 1000).toFixed(0)} s: lower and upper bounds of rigid–plastic soil with associated flow. The factor of safety lies between them.`}
          >
            FOS, limit analysis (FE)
          </Label>
          <span className="font-bold tabular-nums">{boundsText(fem.bounds.lower, fem.bounds.upper)}</span>
        </div>
      )}
      {fem.bounds?.davis && (
        <div className="flex justify-between">
          <Label title="The same bounds with Davis B's reduced strength, which stands for non-associated flow, usually conservatively. A wide gap to the range above: the flow rule matters here.">
            Davis B (non-associated)
          </Label>
          <span className="tabular-nums">{boundsText(fem.bounds.davis.lower, fem.bounds.davis.upper)}</span>
        </div>
      )}
      <div className="flex justify-between">
        <Label title={srfTitle}>{headline ? "Strength reduction (comparison)" : "FOS, strength reduction (FE)"}</Label>
        <span className={headline ? "tabular-nums" : "font-bold tabular-nums"}>{srf}</span>
      </div>
      <div className="flex justify-between">
        <Label>Flow rule</Label>
        <span>{FLOW_RULE_NAMES[fem.flowRule]}</span>
      </div>
      {last && (
        <div className="flex justify-between">
          <Label title={fem.levels.map((l) => `${l.elements} elements: ${l.fos.toFixed(3)}`).join("\n")}>Elements</Label>
          <span className="tabular-nums">
            {last.elements}
            {fem.levels.length > 1 ? ` (${fem.levels.length - 1} refinement${fem.levels.length > 2 ? "s" : ""})` : ""}
          </span>
        </div>
      )}
      <div className="flex justify-between">
        <Label>Elapsed (FE)</Label>
        <span className="tabular-nums">{((fem.elapsedMs + (fem.bounds?.elapsedMs ?? 0)) / 1000).toFixed(1)} s</span>
      </div>
      {fem.piles?.map((p) => (
        <div key={p.pile} className="flex justify-between">
          <Label title="Largest bending moment, shear and axial force of the pile (per pile) at the factor of safety, the pile modeled as an elastic beam on springs that let the soil flow between the piles.">
            Pile {p.pile + 1} (FE)
          </Label>
          <span className="tabular-nums">
            M {p.maxMoment.toFixed(0)} kNm, V {p.maxShearForce.toFixed(0)} kN
          </span>
        </div>
      ))}
      {fem.curve && fem.curve.length >= 2 && <FemCurve curve={fem.curve} fos={fem.factorOfSafety} />}
      {designValues && (
        <p className="text-[11px]" style={{ color: "var(--color-vsc-text-muted)" }}>
          The finite element factor uses the characteristic strengths, without partial factors.
        </p>
      )}
      {[...fem.warnings, ...(fem.bounds?.warnings ?? [])].map((w) => (
        <p key={w} className="text-[11px]" style={{ color: "var(--color-vsc-warning-text)" }}>
          {w}
        </p>
      ))}
    </div>
  );
}
