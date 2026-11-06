/**
 * The properties of a display layer selected in Properties › Layers (the
 * result sidebar): how the layer is drawn on the sheet and in the PDF
 * (the model's `layerStyles`). Every field starts empty, showing the
 * drawing's own value; a change is one undo step, an emptied field or
 * "Default" goes back to that value.
 */
import { cloneElement, isValidElement, useId, type ReactNode } from "react";
import { ColorSwatches } from "../../components/ui/ColorSwatches";
import { DraftNumberInput } from "../../components/ui/DraftNumberInput";
import { useAppStore } from "../../store/app-store";
import type { ResultLayerStyles } from "../../store/types";
import {
  CENTER_DOT_RADIUS_PX,
  CRITICAL_SURFACE_LINE_WIDTH_PX,
  CUSTOM_SURFACE_LINE_WIDTH_PX,
  FEM_MESH_LINE_WIDTH_PX,
  FEM_MESH_OPACITY,
  FEM_PLASTIC_ZONE_OPACITY,
  FOS_LABEL_DECIMALS,
  FOS_LABEL_FONT_PX,
  SLICE_LINE_WIDTH_PX,
  SLIP_SURFACE_LINE_WIDTH_PX,
  SLIP_SURFACE_OPACITY,
} from "../rendering/style-spec";
import { DISPLAY_LAYER_NAMES, type DisplayLayerKey } from "./layers";
import { LAYER_FONT_FAMILIES, LAYER_STYLE_LIMITS, layerStyleCleared, layerStylePatch } from "./layer-styles";

const FONT_SIZES = [6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32];
const labelStyle = { color: "var(--color-vsc-text-muted)" };

/** A label over its control, tied to it; with `group`, the label names a group of controls. */
function Field({ label, children, className, group }: { label: string; children: ReactNode; className?: string; group?: boolean }) {
  const id = useId();
  if (group) {
    return (
      <div className={className} role="group" aria-labelledby={id}>
        <span id={id} className="text-[10px] block mb-0.5" style={labelStyle}>
          {label}
        </span>
        {children}
      </div>
    );
  }
  return (
    <div className={className}>
      <label htmlFor={id} className="text-[10px] block mb-0.5" style={labelStyle}>
        {label}
      </label>
      {isValidElement<{ id?: string }>(children) ? cloneElement(children, { id }) : children}
    </div>
  );
}

/** A number of the style: empty shows the default (placeholder); out of bounds is not taken. */
function NumberField({
  label,
  value,
  placeholder,
  min,
  max,
  title,
  onChange,
}: {
  label: string;
  value: number | undefined;
  placeholder: number;
  min: number;
  max: number;
  title?: string;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <Field label={label} className="flex-1 min-w-0">
      <DraftNumberInput
        value={value}
        placeholder={String(placeholder)}
        title={title ?? `From ${min} to ${max}; empty: ${placeholder}`}
        onValueChange={(v) => {
          if (v >= min && v <= max) onChange(v);
        }}
        onClear={() => onChange(undefined)}
        className="w-full tabular-nums"
      />
    </Field>
  );
}

/** A percentage field for an opacity (stored 0 to 1). */
function OpacityField({ value, placeholder, onChange }: { value: number | undefined; placeholder: number; onChange: (v: number | undefined) => void }) {
  const pct = (v: number) => Math.round(v * 1000) / 10;
  return (
    <NumberField
      label="Opacity (%)"
      value={value === undefined ? undefined : pct(value)}
      placeholder={pct(placeholder)}
      min={0}
      max={100}
      onChange={(v) => onChange(v === undefined ? undefined : v / 100)}
    />
  );
}

const LINE_WIDTH = "Line width (px)";

export function LayerProperties({ layer }: { layer: DisplayLayerKey }) {
  const rvs = useAppStore((s) => s.resultViewSettings);
  const setRvs = useAppStore((s) => s.setResultViewSettings);
  const styles = rvs.layerStyles ?? {};
  const set = <K extends keyof ResultLayerStyles>(key: K, patch: Partial<NonNullable<ResultLayerStyles[K]>>) =>
    setRvs(layerStylePatch(rvs, key, patch));
  const W = LAYER_STYLE_LIMITS.width;

  const colorField = <K extends "femMesh" | "femPlasticZone" | "customSurfaces" | "criticalSurface" | "slices" | "center" | "fosLabel">(
    key: K,
    title?: string,
  ) => (
    <Field label="Color" group>
      <ColorSwatches
        value={styles[key]?.color}
        onChange={(color) => set(key, { color } as Partial<NonNullable<ResultLayerStyles[K]>>)}
        defaultTitle={title}
      />
    </Field>
  );

  let body: ReactNode = null;
  switch (layer) {
    case "soilColor":
      body = (
        <OpacityField value={styles.soilColor?.opacity} placeholder={1} onChange={(opacity) => set("soilColor", { opacity })} />
      );
      break;
    case "femMesh":
      body = (
        <>
          {colorField("femMesh", "The theme's line color")}
          <div className="flex gap-2">
            <NumberField
              label={LINE_WIDTH}
              value={styles.femMesh?.width}
              placeholder={FEM_MESH_LINE_WIDTH_PX}
              {...W}
              onChange={(v) => set("femMesh", { width: v })}
            />
            <OpacityField value={styles.femMesh?.opacity} placeholder={FEM_MESH_OPACITY} onChange={(opacity) => set("femMesh", { opacity })} />
          </div>
        </>
      );
      break;
    case "femPlasticZone":
      body = (
        <>
          {colorField("femPlasticZone", "The drawing's own color (red)")}
          <OpacityField
            value={styles.femPlasticZone?.opacity}
            placeholder={FEM_PLASTIC_ZONE_OPACITY}
            onChange={(opacity) => set("femPlasticZone", { opacity })}
          />
        </>
      );
      break;
    case "surfaces":
      body = (
        <div className="flex gap-2">
          <NumberField
            label={LINE_WIDTH}
            value={styles.surfaces?.width}
            placeholder={SLIP_SURFACE_LINE_WIDTH_PX}
            {...W}
            onChange={(v) => set("surfaces", { width: v })}
          />
          <OpacityField value={styles.surfaces?.opacity} placeholder={SLIP_SURFACE_OPACITY} onChange={(opacity) => set("surfaces", { opacity })} />
        </div>
      );
      break;
    case "customSurfaces":
      body = (
        <>
          {colorField("customSurfaces", "The drawing's own color for custom surfaces")}
          <div className="flex gap-2">
            <NumberField
              label={LINE_WIDTH}
              value={styles.customSurfaces?.width}
              placeholder={CUSTOM_SURFACE_LINE_WIDTH_PX}
              {...W}
              onChange={(v) => set("customSurfaces", { width: v })}
            />
            <NumberField
              label="Label size (px)"
              value={styles.customSurfaces?.fontSize}
              placeholder={styles.fosLabel?.fontSize ?? FOS_LABEL_FONT_PX}
              {...LAYER_STYLE_LIMITS.fontSize}
              title="Size of their factors of safety (shown with the F label); empty: as the F label"
              onChange={(v) => set("customSurfaces", { fontSize: v })}
            />
          </div>
        </>
      );
      break;
    case "criticalSurface":
      body = (
        <>
          {colorField("criticalSurface")}
          <NumberField
            label={LINE_WIDTH}
            value={styles.criticalSurface?.width}
            placeholder={CRITICAL_SURFACE_LINE_WIDTH_PX}
            {...W}
            onChange={(v) => set("criticalSurface", { width: v })}
          />
        </>
      );
      break;
    case "slices":
      body = (
        <>
          {colorField("slices", "The drawing's own color: the theme's ink, white over a dark soil")}
          <NumberField
            label={LINE_WIDTH}
            value={styles.slices?.width}
            placeholder={SLICE_LINE_WIDTH_PX}
            {...W}
            title="Thinner where the slices lie close together on the sheet"
            onChange={(v) => set("slices", { width: v })}
          />
        </>
      );
      break;
    case "center":
      body = (
        <>
          {colorField("center", "The critical surface's color")}
          <NumberField
            label="Dot radius (px)"
            value={styles.center?.size}
            placeholder={CENTER_DOT_RADIUS_PX}
            {...LAYER_STYLE_LIMITS.size}
            onChange={(v) => set("center", { size: v })}
          />
          <label className="flex items-center gap-2 text-[11px]">
            <input
              type="checkbox"
              checked={styles.center?.radiusLines !== false}
              onChange={(e) => set("center", { radiusLines: e.target.checked ? undefined : false })}
            />
            Radius lines to the entry and exit
          </label>
        </>
      );
      break;
    case "fosLabel": {
      const s = styles.fosLabel;
      body = (
        <>
          <div className="flex gap-2">
            <Field label="Font" className="flex-1 min-w-0">
              <select
                value={s?.fontFamily ?? "sans-serif"}
                onChange={(e) => set("fosLabel", { fontFamily: e.target.value === "sans-serif" ? undefined : e.target.value })}
                className="w-full"
              >
                {LAYER_FONT_FAMILIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Size (px)" className="w-16 shrink-0">
              <select
                value={s?.fontSize ?? FOS_LABEL_FONT_PX}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  set("fosLabel", { fontSize: v === FOS_LABEL_FONT_PX ? undefined : v });
                }}
                className="w-full"
              >
                {[...new Set([...FONT_SIZES, s?.fontSize ?? FOS_LABEL_FONT_PX])]
                  .sort((a, b) => a - b)
                  .map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <div className="flex gap-2 items-end">
            <Field label="Decimals" className="flex-1 min-w-0">
              <select
                value={s?.decimals ?? FOS_LABEL_DECIMALS}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  set("fosLabel", { decimals: v === FOS_LABEL_DECIMALS ? undefined : v });
                }}
                className="w-full"
              >
                {[0, 1, 2, 3, 4].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <button
              type="button"
              onClick={() => set("fosLabel", { bold: s?.bold === false ? undefined : false })}
              className="btn w-[28px] px-0 font-bold shrink-0"
              aria-pressed={s?.bold !== false}
              aria-label="Bold"
              title="Bold"
            >
              B
            </button>
          </div>
          {colorField("fosLabel")}
        </>
      );
      break;
    }
  }

  const name = DISPLAY_LAYER_NAMES[layer];
  const styled = styles[layer] !== undefined;
  return (
    <div className="space-y-2" role="group" aria-label={`${name} properties`}>
      {body}
      <button type="button" className="btn" disabled={!styled} onClick={() => setRvs(layerStyleCleared(rvs, layer))}>
        Reset to default
      </button>
    </div>
  );
}
