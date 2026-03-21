/**
 * ResultSidebar — right sidebar for result view settings.
 */

import { useCallback, useMemo, useState } from "react";
import { useAppStore } from "../../store/app-store";
import { Section } from "../../components/ui/Section";
import { Label } from "../../components/ui/Label";
import { MultiSelectComboboxChips } from "../../components/ui/MultiSelectComboboxChips";
import {
  MATERIAL_TABLE_COLUMNS,
  getAnnotationBoundsPx,
} from "../canvas/helpers";
import { computePaperFrame } from "../view/paper";
import {
  anchoredTopLeft,
  anchorPointFromTopLeft,
} from "../annotations/anchorPosition";
import type { MaterialTableColumnKey, AnchorPosition } from "../../store/types";

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

const DEFAULT_TABLE_COLUMNS: MaterialTableColumnKey[] = [
  "model",
  "unitWeight",
  "cohesion",
  "piezometricLine",
  "depthRef",
  "cDatum",
  "cRate",
  "frictionAngle",
];

const SHORT_COLUMN_LABELS: Record<MaterialTableColumnKey, string> = {
  model: "Model",
  unitWeight: "Unit Wt.",
  cohesion: "Su",
  piezometricLine: "Piezo",
  depthRef: "Datum",
  cDatum: "C-Datum",
  cRate: "C-Rate",
  frictionAngle: "Friction",
};

const MATERIAL_TABLE_COLUMN_OPTIONS = MATERIAL_TABLE_COLUMNS.map((col) => ({
  value: col.key,
  label: SHORT_COLUMN_LABELS[col.key],
}));

type SidebarSection = "summary" | "annotations" | "properties";

function commonValue<T>(values: T[]): T | undefined {
  if (values.length === 0) return undefined;
  const first = values[0];
  return values.every((v) => v === first) ? first : undefined;
}

export function ResultSidebar() {
  const result = useAppStore((s) => s.result);
  const rvs = useAppStore((s) => s.resultViewSettings);
  const removeAnnotation = useAppStore((s) => s.removeAnnotation);
  const updateAnnotation = useAppStore((s) => s.updateAnnotation);
  const selectedAnnotationIds = useAppStore((s) => s.selectedAnnotationIds);
  const setSelectedAnnotations = useAppStore((s) => s.setSelectedAnnotations);
  const toggleAnnotationSelection = useAppStore(
    (s) => s.toggleAnnotationSelection,
  );

  const [openSections, setOpenSections] = useState<
    Record<SidebarSection, boolean>
  >({
    summary: true,
    annotations: true,
    properties: true,
  });

  const toggleSection = useCallback((section: SidebarSection) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  const selectedAnnotations = useMemo(
    () =>
      rvs.annotations.filter((anno) => selectedAnnotationIds.includes(anno.id)),
    [rvs.annotations, selectedAnnotationIds],
  );

  const selectedTextAnnotations = useMemo(
    () => selectedAnnotations.filter((anno) => anno.type === "text"),
    [selectedAnnotations],
  );
  const selectedMaterialTableAnnotations = useMemo(
    () => selectedAnnotations.filter((anno) => anno.type === "material-table"),
    [selectedAnnotations],
  );

  const allSelectedAreText =
    selectedAnnotations.length > 0 &&
    selectedTextAnnotations.length === selectedAnnotations.length;
  const allSelectedAreMaterialTable =
    selectedAnnotations.length > 0 &&
    selectedMaterialTableAnnotations.length === selectedAnnotations.length;

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

  // Shared position values (all annotation types)
  const xValue = commonValue(selectedAnnotations.map((a) => a.x));
  const yValue = commonValue(selectedAnnotations.map((a) => a.y));
  const anchorValue = commonValue(
    selectedAnnotations.map((a) => a.anchor ?? "top-left"),
  );

  const applyToAll = useCallback(
    (patch: { x?: number; y?: number; anchor?: AnchorPosition }) => {
      for (const anno of selectedAnnotations) {
        updateAnnotation(anno.id, patch);
      }
    },
    [selectedAnnotations, updateAnnotation],
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
      );
      for (const anno of selectedAnnotations) {
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
        });
        const hitPad = 4;
        const wFrac = (bounds.w - 2 * hitPad) / pf.w;
        const hFrac = (bounds.h - 2 * hitPad) / pf.h;
        const oldTL = anchoredTopLeft(
          anno.x,
          anno.y,
          wFrac,
          hFrac,
          oldAnchor,
        );
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
    [selectedAnnotations, updateAnnotation, applyToAll],
  );

  const mtFontSize = commonValue(
    selectedMaterialTableAnnotations.map((a) => a.fontSize ?? 6),
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

  const visibleColumnsValue = useMemo(() => {
    if (selectedMaterialTableAnnotations.length === 0) return [];
    const first =
      selectedMaterialTableAnnotations[0].tableColumns ?? DEFAULT_TABLE_COLUMNS;
    return first.filter((column) =>
      selectedMaterialTableAnnotations.every((anno) =>
        (anno.tableColumns ?? DEFAULT_TABLE_COLUMNS).includes(column),
      ),
    );
  }, [selectedMaterialTableAnnotations]);

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
      className="h-full overflow-y-auto"
      style={{
        background: "var(--color-vsc-panel)",
        color: "var(--color-vsc-text)",
        borderLeft: "1px solid var(--color-vsc-border)",
      }}
    >
      <Section
        title="Summary"
        open={openSections.summary}
        onToggle={() => toggleSection("summary")}
      >
        {result ? (
          <div className="space-y-1 text-[12px]">
            <div className="flex justify-between">
              <Label>Min FOS</Label>
              <span
                className="font-bold tabular-nums"
                style={{
                  color:
                    result.minFOS < 1.0
                      ? "var(--color-vsc-error)"
                      : result.minFOS < 1.5
                        ? "var(--color-vsc-warning)"
                        : "var(--color-vsc-success)",
                }}
              >
                {result.minFOS.toFixed(3)}
              </span>
            </div>
            <div className="flex justify-between">
              <Label>Max FOS</Label>
              <span className="tabular-nums">{result.maxFOS.toFixed(3)}</span>
            </div>
            <div className="flex justify-between">
              <Label>Method</Label>
              <span>{result.method}</span>
            </div>
            <div className="flex justify-between">
              <Label>Surfaces</Label>
              <span className="tabular-nums">{result.allSurfaces.length}</span>
            </div>
            <div className="flex justify-between">
              <Label>Elapsed</Label>
              <span className="tabular-nums">
                {result.elapsedMs.toFixed(0)} ms
              </span>
            </div>
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
        title="Annotations"
        open={openSections.annotations}
        onToggle={() => toggleSection("annotations")}
      >
        <div className="space-y-2">
          {rvs.annotations.length === 0 && (
            <p
              className="text-[11px]"
              style={{ color: "var(--color-vsc-text-muted)" }}
            >
              No annotations yet.
            </p>
          )}

          {rvs.annotations.map((anno) => {
            const isSelected = selectedAnnotationIds.includes(anno.id);
            return (
              <div
                key={anno.id}
                className="flex items-center gap-2 p-1.5 rounded cursor-pointer select-none"
                style={{
                  background: isSelected
                    ? "var(--color-vsc-list-active)"
                    : "var(--color-vsc-list-hover)",
                  outline: isSelected
                    ? "1px solid var(--color-vsc-focus-border)"
                    : "none",
                }}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    toggleAnnotationSelection(anno.id, true);
                  } else {
                    setSelectedAnnotations([anno.id]);
                  }
                }}
              >
                <span
                  className="text-[11px] flex-1 min-w-0 truncate"
                  style={{ color: "var(--color-vsc-text)" }}
                >
                  {anno.type === "color-bar"
                    ? "Color Bar"
                    : anno.type === "material-table"
                      ? "Material Table"
                      : "Text"}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAnnotation(anno.id);
                  }}
                  className="text-[11px] px-1.5 py-0.5 rounded cursor-pointer"
                  style={{
                    color: "var(--color-vsc-error)",
                    background: "transparent",
                    border: "none",
                  }}
                  title="Remove annotation"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title="Properties"
        open={openSections.properties}
        onToggle={() => toggleSection("properties")}
      >
        {selectedAnnotations.length === 0 && (
          <p
            className="text-[11px]"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            Select an object on the canvas to edit its properties.
          </p>
        )}

        {selectedAnnotations.length > 0 && (
          <div className="space-y-2 mb-3">
            <div className="flex gap-2">
              <div className="flex-1">
                <label
                  className="text-[10px] block mb-0.5"
                  style={{ color: "var(--color-vsc-text-muted)" }}
                >
                  X (%)
                </label>
                <input
                  type="number"
                  step="1"
                  value={
                    xValue !== undefined ? Math.round(xValue * 1000) / 10 : ""
                  }
                  placeholder={xValue === undefined ? "Mixed" : ""}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!Number.isNaN(v)) applyToAll({ x: v / 100 });
                  }}
                  className="w-full text-[11px] px-1.5 py-1 rounded tabular-nums"
                  style={{
                    background: "var(--color-vsc-bg)",
                    color: "var(--color-vsc-text)",
                    border: "1px solid var(--color-vsc-border)",
                  }}
                />
              </div>
              <div className="flex-1">
                <label
                  className="text-[10px] block mb-0.5"
                  style={{ color: "var(--color-vsc-text-muted)" }}
                >
                  Y (%)
                </label>
                <input
                  type="number"
                  step="1"
                  value={
                    yValue !== undefined ? Math.round(yValue * 1000) / 10 : ""
                  }
                  placeholder={yValue === undefined ? "Mixed" : ""}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!Number.isNaN(v)) applyToAll({ y: v / 100 });
                  }}
                  className="w-full text-[11px] px-1.5 py-1 rounded tabular-nums"
                  style={{
                    background: "var(--color-vsc-bg)",
                    color: "var(--color-vsc-text)",
                    border: "1px solid var(--color-vsc-border)",
                  }}
                />
              </div>
            </div>

            <div>
              <label
                className="text-[10px] block mb-1"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                Anchor
              </label>
              <div className="flex items-center gap-2">
                <div
                  className="grid grid-cols-2 gap-[3px] p-1 rounded"
                  style={{ background: "var(--color-vsc-bg)" }}
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
                      onClick={() => handleAnchorChange(a)}
                      className="w-[14px] h-[14px] rounded-sm cursor-pointer"
                      style={{
                        background:
                          (anchorValue ?? "top-left") === a
                            ? "var(--color-vsc-accent)"
                            : "var(--color-vsc-border)",
                        border: "none",
                      }}
                      title={a
                        .split("-")
                        .map((w) => w[0].toUpperCase() + w.slice(1))
                        .join(" ")}
                    />
                  ))}
                </div>
                <span
                  className="text-[10px]"
                  style={{ color: "var(--color-vsc-text-muted)" }}
                >
                  {anchorValue !== undefined
                    ? anchorValue
                        .split("-")
                        .map((w) => w[0].toUpperCase() + w.slice(1))
                        .join(" ")
                    : "Mixed"}
                </span>
              </div>
            </div>

            {selectedAnnotations.length > 1 &&
              !allSelectedAreText &&
              !allSelectedAreMaterialTable && (
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
                className="text-[10px] block mb-0.5"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                Text
              </label>
              <textarea
                value={textValue ?? ""}
                placeholder={textValue === undefined ? "Mixed values" : ""}
                onChange={(e) => applyToSelectedText({ text: e.target.value })}
                className="w-full text-[11px] px-1.5 py-1 rounded resize-y min-h-[48px]"
                style={{
                  background: "var(--color-vsc-bg)",
                  color: "var(--color-vsc-text)",
                  border: "1px solid var(--color-vsc-border)",
                }}
              />
            </div>

            <div>
              <label
                className="text-[10px] block mb-0.5"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                Font
              </label>
              <select
                value={fontFamilyValue ?? "__mixed__"}
                onChange={(e) => {
                  if (e.target.value === "__mixed__") return;
                  applyToSelectedText({ fontFamily: e.target.value });
                }}
                className="w-full text-[11px] px-1.5 py-1 rounded cursor-pointer"
                style={{
                  background: "var(--color-vsc-bg)",
                  color: "var(--color-vsc-text)",
                  border: "1px solid var(--color-vsc-border)",
                }}
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
                className="text-[10px] block mb-0.5"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                Size
              </label>
              <select
                value={fontSizeValue ?? "__mixed__"}
                onChange={(e) => {
                  if (e.target.value === "__mixed__") return;
                  applyToSelectedText({ fontSize: Number(e.target.value) });
                }}
                className="w-full text-[11px] px-1.5 py-1 rounded cursor-pointer"
                style={{
                  background: "var(--color-vsc-bg)",
                  color: "var(--color-vsc-text)",
                  border: "1px solid var(--color-vsc-border)",
                }}
              >
                {fontSizeValue === undefined && (
                  <option value="__mixed__">Mixed values</option>
                )}
                {FONT_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}px
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-1.5">
              <button
                onClick={() =>
                  applyToSelectedText({ bold: boldValue !== true })
                }
                className="flex-1 text-[12px] font-bold py-1 rounded cursor-pointer"
                style={{
                  background:
                    boldValue === true
                      ? "var(--color-vsc-accent)"
                      : "var(--color-vsc-bg)",
                  color: boldValue === true ? "#fff" : "var(--color-vsc-text)",
                  border: "1px solid var(--color-vsc-border)",
                }}
              >
                B
              </button>
              <button
                onClick={() =>
                  applyToSelectedText({ italic: italicValue !== true })
                }
                className="flex-1 text-[12px] italic py-1 rounded cursor-pointer"
                style={{
                  background:
                    italicValue === true
                      ? "var(--color-vsc-accent)"
                      : "var(--color-vsc-bg)",
                  color:
                    italicValue === true ? "#fff" : "var(--color-vsc-text)",
                  border: "1px solid var(--color-vsc-border)",
                }}
              >
                I
              </button>
            </div>

            <div>
              <label
                className="text-[10px] block mb-0.5"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                Color
              </label>
              <div className="flex flex-wrap gap-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
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

        {allSelectedAreMaterialTable && (
          <div className="space-y-2">
            <div>
              <label
                className="text-[10px] block mb-1"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                Text size
              </label>
              <select
                value={mtFontSize ?? "__mixed__"}
                onChange={(e) => {
                  if (e.target.value === "__mixed__") return;
                  applyToSelectedMaterialTables({
                    fontSize: Number(e.target.value),
                  });
                }}
                className="w-full text-[11px] px-1.5 py-1 rounded cursor-pointer"
                style={{
                  background: "var(--color-vsc-bg)",
                  color: "var(--color-vsc-text)",
                  border: "1px solid var(--color-vsc-border)",
                }}
              >
                {mtFontSize === undefined && (
                  <option value="__mixed__">Mixed values</option>
                )}
                {FONT_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}px
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                className="text-[10px] block mb-1"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                Visible columns
              </label>
              <MultiSelectComboboxChips
                options={MATERIAL_TABLE_COLUMN_OPTIONS}
                value={visibleColumnsValue}
                onValueChange={setVisibleColumnsForAll}
                placeholder="Select columns"
                emptyText="No columns found."
              />
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
