/**
 * The style of the selected slice plots (Properties › Plot, under their
 * size and axes): the series' color, line and markers, the axes' fixed
 * ends, gridlines and titles, the border and the text size (`plotStyle`
 * of each plot). Every field starts at the plot's default; a change is one
 * undo step for all the selected plots, "Reset to default" removes the
 * style. The view and the PDF draw it alike (plotStyle.ts).
 */
import { useId, type ReactNode } from "react";
import { ColorSwatches } from "../../components/ui/ColorSwatches";
import { DraftNumberInput } from "../../components/ui/DraftNumberInput";
import { GroupHeading } from "../properties/GroupHeading";
import { useAppStore } from "../../store/app-store";
import type { Annotation, PlotStyle } from "../../store/types";
import { getPaperDimensions } from "../view/paper";
import { ANNOTATION_SCALE_DIVISOR, PLOT_AXIS_FONT_PX } from "../rendering/style-spec";
import {
  defaultPlotLineWidthMm,
  defaultPlotMarkerSizeMm,
  PLOT_FONT_SIZES,
  PLOT_LINE_STYLES,
  PLOT_MARKERS,
  PLOT_STYLE_LIMITS,
  plotStylePatched,
  resolvePlotStyle,
  type ResolvedPlotStyle,
} from "../annotations/plotStyle";

const labelStyle = { color: "var(--color-vsc-text-muted)" };
const MIXED = "__mixed__";

/** The value all the plots share, else null (mixed). */
function common<K extends keyof ResolvedPlotStyle>(styles: ResolvedPlotStyle[], key: K): ResolvedPlotStyle[K] | null {
  const first = styles[0]?.[key];
  return styles.every((s) => s[key] === first) ? first : null;
}

/** The stored value all the plots share (undefined: the default), else null (mixed). */
function stored<K extends keyof PlotStyle>(plots: Annotation[], key: K): PlotStyle[K] | null {
  const first = plots[0]?.plotStyle?.[key];
  return plots.every((p) => p.plotStyle?.[key] === first) ? first : null;
}

function Field({ label, children, className }: { label: string; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="text-[10px] block mb-0.5" style={labelStyle}>
        {label}
      </label>
      {children(id)}
    </div>
  );
}

/** A number of the style: empty shows the default (placeholder); out of bounds is not taken. */
function NumberField({
  label,
  value,
  placeholder,
  min = -Infinity,
  max = Infinity,
  title,
  onChange,
}: {
  label: string;
  value: number | undefined | null;
  placeholder: string;
  min?: number;
  max?: number;
  title: string;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <Field label={label} className="flex-1 min-w-0">
      {(id) => (
        <DraftNumberInput
          id={id}
          value={value ?? undefined}
          placeholder={value === null ? "Mixed" : placeholder}
          title={title}
          onValueChange={(v) => {
            if (v >= min && v <= max) onChange(v);
          }}
          onClear={() => onChange(undefined)}
          className="w-full tabular-nums"
        />
      )}
    </Field>
  );
}

function Check({ label, checked, title, onChange }: { label: string; checked: boolean | null; title?: string; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[11px]" title={title}>
      <input
        type="checkbox"
        checked={checked === true}
        ref={(el) => {
          if (el) el.indeterminate = checked === null;
        }}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/** Two decimals, without trailing zeros. */
const mmText = (v: number) => String(Math.round(v * 100) / 100);

export function PlotProperties({ plots }: { plots: Annotation[] }) {
  const rvs = useAppStore((s) => s.resultViewSettings);
  const setRvs = useAppStore((s) => s.setResultViewSettings);
  const paper = getPaperDimensions(rvs.paperFrame.paperSize, rvs.paperFrame.landscape);
  const mmPerAnnoPx = Math.min(paper.width, paper.height) / ANNOTATION_SCALE_DIVISOR;
  const styles = plots.map((p) => resolvePlotStyle(p.plotStyle, mmPerAnnoPx));
  const ids = new Set(plots.map((p) => p.id));

  // One undo step for every selected plot.
  const set = (patch: Partial<PlotStyle>) =>
    setRvs({
      annotations: rvs.annotations.map((a) => {
        if (!ids.has(a.id) || a.type !== "plot") return a;
        const { plotStyle, ...rest } = a;
        const next = plotStylePatched(plotStyle, patch);
        return next ? { ...rest, plotStyle: next } : rest;
      }),
    });
  const styled = plots.some((p) => p.plotStyle !== undefined);

  const line = common(styles, "line");
  const marker = common(styles, "marker");
  const showLine = line !== "none";
  const filledShape = marker === "circle" || marker === "square" || marker === "triangle";
  const color = stored(plots, "color");
  const fontSize = common(styles, "textScale");
  const textValue = fontSize === null ? null : Math.round(fontSize * PLOT_AXIS_FONT_PX * 100) / 100;

  const end = (key: "xMin" | "xMax" | "yMin" | "yMax", label: string, title: string) => (
    <NumberField
      label={label}
      value={stored(plots, key)}
      placeholder="Auto"
      title={title}
      onChange={(v) => set({ [key]: v })}
    />
  );

  return (
    <div className="space-y-2" role="group" aria-label="Plot style">
      <div role="group" aria-label="Series" className="space-y-2">
        <GroupHeading>Series</GroupHeading>
        <div role="group" aria-label="Color">
          <span className="text-[10px] block mb-0.5" style={labelStyle}>
            Color
          </span>
          <ColorSwatches
            value={color}
            onChange={(c) => set({ color: c })}
            defaultTitle="The plot's own color (the theme's)"
          />
        </div>
        <div role="group" aria-label="Line">
          <span className="text-[10px] block mb-0.5" style={labelStyle}>
            Line
          </span>
          <div className="flex gap-1">
            {PLOT_LINE_STYLES.map((o) => (
              <button
                key={o.value}
                type="button"
                className="btn flex-1"
                aria-pressed={line === o.value}
                onClick={() => set({ line: o.value === "solid" ? undefined : o.value })}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          {showLine && (
            <NumberField
              label="Line width (mm)"
              value={stored(plots, "lineWidth")}
              placeholder={mmText(defaultPlotLineWidthMm(mmPerAnnoPx))}
              {...PLOT_STYLE_LIMITS.lineWidth}
              title={`From ${PLOT_STYLE_LIMITS.lineWidth.min} to ${PLOT_STYLE_LIMITS.lineWidth.max} mm on the paper; empty: the default`}
              onChange={(v) => set({ lineWidth: v })}
            />
          )}
          <Field label="Markers" className="flex-1 min-w-0">
            {(id) => (
              <select
                id={id}
                value={marker ?? MIXED}
                onChange={(e) => {
                  if (e.target.value === MIXED) return;
                  set({ marker: e.target.value === "circle" ? undefined : (e.target.value as PlotStyle["marker"]) });
                }}
                className="w-full"
              >
                {marker === null && <option value={MIXED}>Mixed values</option>}
                {PLOT_MARKERS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {marker !== "none" && (
          <div className="flex gap-2 items-end">
            <NumberField
              label="Marker size (mm)"
              value={stored(plots, "markerSize")}
              placeholder={mmText(defaultPlotMarkerSizeMm(mmPerAnnoPx))}
              {...PLOT_STYLE_LIMITS.markerSize}
              title={`The markers' width, from ${PLOT_STYLE_LIMITS.markerSize.min} to ${PLOT_STYLE_LIMITS.markerSize.max} mm on the paper; empty: the default`}
              onChange={(v) => set({ markerSize: v })}
            />
            <div className="flex-1 min-w-0 h-[22px] flex items-center">
              {filledShape && (
                <Check
                  label="Open markers"
                  checked={common(styles, "markerOpen")}
                  title="Draw the markers as outlines"
                  onChange={(v) => set({ markerOpen: v || undefined })}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <div role="group" aria-label="Axes" className="space-y-2">
        <GroupHeading>Axes</GroupHeading>
        <div className="flex gap-2">
          {end("xMin", "X min", "The left end of the x axis; empty: from the data")}
          {end("xMax", "X max", "The right end of the x axis; empty: from the data")}
        </div>
        <div className="flex gap-2">
          {end("yMin", "Y min", "The bottom of the y axis; empty: from the data")}
          {end("yMax", "Y max", "The top of the y axis; empty: from the data")}
        </div>
        <Check label="Gridlines" checked={common(styles, "showGrid")} onChange={(v) => set({ showGrid: v ? undefined : false })} />
        <Check
          label="Axis title"
          checked={common(styles, "showAxisTitle")}
          title="The x axis's title: Slice or x (m)"
          onChange={(v) => set({ showAxisTitle: v ? undefined : false })}
        />
      </div>

      <div role="group" aria-label="Plot" className="space-y-2">
        <GroupHeading>Plot</GroupHeading>
        <div className="flex gap-2 items-end">
          <Field label="Text size (px)" className="flex-1 min-w-0">
            {(id) => (
              <select
                id={id}
                value={textValue ?? MIXED}
                title="The tick values and the axis title; the title is a little larger"
                onChange={(e) => {
                  if (e.target.value === MIXED) return;
                  const v = Number(e.target.value);
                  set({ fontSize: v === PLOT_AXIS_FONT_PX ? undefined : v });
                }}
                className="w-full"
              >
                {textValue === null && <option value={MIXED}>Mixed values</option>}
                {[...new Set([...PLOT_FONT_SIZES, ...(textValue === null ? [] : [textValue])])]
                  .sort((a, b) => a - b)
                  .map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
              </select>
            )}
          </Field>
          <div className="flex-1 min-w-0" />
        </div>
        <Check
          label="Title"
          checked={common(styles, "showTitle")}
          title="The quantity and its unit, above the chart"
          onChange={(v) => set({ showTitle: v ? undefined : false })}
        />
        <Check label="Border" checked={common(styles, "showBorder")} onChange={(v) => set({ showBorder: v ? undefined : false })} />
      </div>

      <button type="button" className="btn" disabled={!styled} onClick={() => set(RESET)}>
        Reset to default
      </button>
    </div>
  );
}

/** Every member of the style cleared. */
const RESET: Partial<PlotStyle> = {
  color: undefined,
  line: undefined,
  lineWidth: undefined,
  marker: undefined,
  markerSize: undefined,
  markerOpen: undefined,
  showTitle: undefined,
  showAxisTitle: undefined,
  showGrid: undefined,
  showBorder: undefined,
  fontSize: undefined,
  xMin: undefined,
  xMax: undefined,
  yMin: undefined,
  yMax: undefined,
};
