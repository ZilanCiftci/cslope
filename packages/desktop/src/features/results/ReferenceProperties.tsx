/**
 * Properties of the selected reference annotations (result sidebar): the
 * label, colour, dash, width and edit-view visibility of all of them, and
 * the geometry of a single one (a circle's centre, radius and clip; a
 * polyline's points as "x, y; x, y").
 */

import { useState } from "react";
import { DraftNumberInput } from "../../components/ui/DraftNumberInput";
import { formatPolyline, parsePolyline } from "../../utils/polyline";
import type { Annotation, ReferenceAnnotation, ReferenceDash } from "../../store/types";
import { MIN_REFERENCE_RADIUS, REFERENCE_DEFAULT_WIDTH } from "../annotations/reference";

const COLORS = ["#a21caf", "#e879f9", "#cc0000", "#cc6600", "#00cc00", "#0066cc", "#000000", "#666666", "#ffffff"];
const DASHES: { value: ReferenceDash; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];

function commonValue<T>(values: T[]): T | undefined {
  if (values.length === 0) return undefined;
  const first = values[0];
  return values.every((v) => v === first) ? first : undefined;
}

const labelStyle = { color: "var(--color-vsc-text-muted)" };

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="text-[10px] block mb-0.5" style={labelStyle}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function ReferenceProperties({
  annotations,
  updateAnnotation,
}: {
  annotations: ReferenceAnnotation[];
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
}) {
  const apply = (patch: Partial<Annotation>) => {
    for (const a of annotations) updateAnnotation(a.id, patch);
  };
  const labelValue = commonValue(annotations.map((a) => a.label ?? ""));
  const colorValue = commonValue(annotations.map((a) => a.color ?? ""));
  const dashValue = commonValue(annotations.map((a) => a.dash ?? "solid"));
  const widthValue = commonValue(annotations.map((a) => a.width ?? REFERENCE_DEFAULT_WIDTH));
  const showInEditValue = commonValue(annotations.map((a) => a.showInEdit === true));
  const single = annotations.length === 1 ? annotations[0] : null;

  return (
    <div className="space-y-2" aria-label="Reference line properties">
      <Field label="Label">
        <input
          type="text"
          value={labelValue ?? ""}
          placeholder={labelValue === undefined ? "Mixed values" : "e.g. F = 1.23 (other program)"}
          onChange={(e) => apply({ label: e.target.value })}
          className="w-full"
          aria-label="Reference label"
        />
      </Field>

      {single?.shape === "circle" && (
        <div className="flex gap-2">
          <Field label="cx (m)" className="flex-1 min-w-0">
            <DraftNumberInput
              step="0.5"
              value={single.cx}
              onValueChange={(v) => updateAnnotation(single.id, { cx: v })}
              className="w-full tabular-nums"
              aria-label="Reference circle centre X"
            />
          </Field>
          <Field label="cy (m)" className="flex-1 min-w-0">
            <DraftNumberInput
              step="0.5"
              value={single.cy}
              onValueChange={(v) => updateAnnotation(single.id, { cy: v })}
              className="w-full tabular-nums"
              aria-label="Reference circle centre Y"
            />
          </Field>
          <Field label="R (m)" className="flex-1 min-w-0">
            <DraftNumberInput
              step="0.5"
              min={MIN_REFERENCE_RADIUS}
              value={single.radius}
              onValueChange={(v) => {
                if (v >= MIN_REFERENCE_RADIUS) updateAnnotation(single.id, { radius: v });
              }}
              className="w-full tabular-nums"
              aria-label="Reference circle radius"
            />
          </Field>
        </div>
      )}
      {single?.shape === "circle" && (
        <Field label="Drawn">
          <select
            value={single.clip ?? "ground"}
            onChange={(e) => updateAnnotation(single.id, { clip: e.target.value as "ground" | "none" })}
            className="w-full"
            aria-label="Reference circle clip"
          >
            <option value="ground">Arc below the ground</option>
            <option value="none">Whole circle</option>
          </select>
        </Field>
      )}
      {single?.shape === "polyline" && (
        <Field label="Points x, y (m); x, y; …">
          <PointsInput points={single.points} onChange={(points) => updateAnnotation(single.id, { points })} />
        </Field>
      )}
      {annotations.length > 1 && (
        <p className="text-[11px]" style={labelStyle}>
          Select one reference line to edit its points.
        </p>
      )}

      <Field label="Color">
        <div className="flex flex-wrap gap-1 items-center">
          <button
            onClick={() => apply({ color: undefined })}
            className="h-5 px-1.5 rounded-sm cursor-pointer text-[10px]"
            aria-pressed={colorValue === ""}
            title="The theme's reference colour"
            style={{
              border: colorValue === "" ? "2px solid var(--color-vsc-accent)" : "1px solid var(--color-vsc-border)",
              color: "var(--color-vsc-text)",
              background: "transparent",
            }}
          >
            Theme
          </button>
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => apply({ color: c })}
              className="w-5 h-5 rounded-sm cursor-pointer"
              aria-label={`Color ${c}`}
              aria-pressed={colorValue === c}
              style={{
                background: c,
                border: colorValue === c ? "2px solid var(--color-vsc-accent)" : "1px solid var(--color-vsc-border)",
              }}
            />
          ))}
        </div>
      </Field>

      <div className="flex gap-2">
        <Field label="Line" className="flex-1 min-w-0">
          <select
            value={dashValue ?? "__mixed__"}
            onChange={(e) => {
              if (e.target.value !== "__mixed__") apply({ dash: e.target.value as ReferenceDash });
            }}
            className="w-full"
            aria-label="Reference line dash"
          >
            {dashValue === undefined && <option value="__mixed__">Mixed values</option>}
            {DASHES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Width (px)" className="flex-1 min-w-0">
          <DraftNumberInput
            step="0.5"
            min={0.25}
            value={widthValue}
            placeholder={widthValue === undefined ? "Mixed" : ""}
            onValueChange={(v) => {
              if (v > 0) apply({ width: v });
            }}
            className="w-full tabular-nums"
            aria-label="Reference line width"
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-[11px]">
        <input
          type="checkbox"
          checked={showInEditValue === true}
          ref={(el) => {
            if (el) el.indeterminate = showInEditValue === undefined;
          }}
          onChange={(e) => apply({ showInEdit: e.target.checked })}
          className="accent-blue-500"
          aria-label="Show in edit view"
        />
        Also show in the edit view
      </label>
    </div>
  );
}

/** Text input for the points that keeps the user's text while typing (as the custom planes dialog). */
function PointsInput({ points, onChange }: { points: [number, number][]; onChange: (points: [number, number][]) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? formatPolyline(points);
  const parsed = parsePolyline(text);
  const invalid = parsed === null || parsed.length < 2;
  return (
    <textarea
      value={text}
      onChange={(e) => {
        setDraft(e.target.value);
        const next = parsePolyline(e.target.value);
        if (next && next.length >= 2) onChange(next);
      }}
      onBlur={() => setDraft(null)}
      aria-invalid={invalid}
      aria-label="Reference polyline points"
      title="Points of the line, separated by semicolons; at least two"
      style={invalid ? { borderColor: "var(--color-vsc-error)" } : undefined}
      className="w-full resize-y min-h-[40px] tabular-nums"
    />
  );
}
