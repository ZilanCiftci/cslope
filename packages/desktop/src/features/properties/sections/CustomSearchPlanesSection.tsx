import { useState } from "react";
import { useAppStore } from "../../../store/app-store";
import { Section } from "../../../components/ui/Section";
import { Label } from "../../../components/ui/Label";
import { DraftNumberInput } from "../../../components/ui/DraftNumberInput";
import { formatPolyline, parsePolyline } from "../../../utils/polyline";

interface CustomSearchPlanesSectionProps {
  plain?: boolean;
}

export function CustomSearchPlanesSection({
  plain = false,
}: CustomSearchPlanesSectionProps) {
  const planes = useAppStore((s) => s.customSearchPlanes);
  const customPlanesOnly = useAppStore((s) => s.customPlanesOnly);
  const addPlane = useAppStore((s) => s.addCustomSearchPlane);
  const updatePlane = useAppStore((s) => s.updateCustomSearchPlane);
  const removePlane = useAppStore((s) => s.removeCustomSearchPlane);
  const setCustomPlanesOnly = useAppStore((s) => s.setCustomPlanesOnly);

  const content = (
    <>
      <div
        className="text-[10px] mb-1.5"
        style={{ color: "var(--color-vsc-text-muted)" }}
      >
        Define specific failure surfaces to analyse: circles, or non-circular
        surfaces as points through the soil (the ends are extended to the
        ground).
      </div>
      {planes.length > 0 && (
        <label className="flex items-center gap-2 text-[12px] mb-1.5">
          <input
            type="checkbox"
            checked={customPlanesOnly}
            onChange={(e) => setCustomPlanesOnly(e.target.checked)}
            className="accent-blue-500"
          />
          Custom planes only (skip random search)
        </label>
      )}
      {planes.map((p) => {
        if (p.points) {
          return (
            <div key={p.id} className="flex items-end gap-1 text-[12px]">
              <label className="flex flex-col flex-1 min-w-0">
                <Label>Points x,y; x,y; …</Label>
                <PolylineInput
                  points={p.points}
                  onChange={(points) => updatePlane(p.id, { points })}
                />
              </label>
              <button
                onClick={() => removePlane(p.id)}
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/20 hover:text-red-400 cursor-pointer transition-colors"
                style={{ color: "var(--color-vsc-text-muted)", fontSize: "10px" }}
                aria-label="Remove non-circular surface"
              >
                ✕
              </button>
            </div>
          );
        }
        const radiusInvalid = p.radius <= 0;
        return (
          <div key={p.id} className="flex items-end gap-1 text-[12px]">
            <label className="flex flex-col">
              <Label>cx</Label>
              <DraftNumberInput
                step="0.5"
                value={p.cx}
                onValueChange={(v) => updatePlane(p.id, { cx: v })}
                className="w-16"
                aria-label="Circle centre X"
              />
            </label>
            <label className="flex flex-col">
              <Label>cy</Label>
              <DraftNumberInput
                step="0.5"
                value={p.cy}
                onValueChange={(v) => updatePlane(p.id, { cy: v })}
                className="w-16"
                aria-label="Circle centre Y"
              />
            </label>
            <label className="flex flex-col">
              <Label>R</Label>
              <DraftNumberInput
                step="0.5"
                min="0.1"
                value={p.radius}
                onValueChange={(v) => updatePlane(p.id, { radius: v })}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!Number.isFinite(v) || v <= 0) {
                    updatePlane(p.id, { radius: 0.1 });
                  }
                }}
                aria-invalid={radiusInvalid}
                style={
                  radiusInvalid
                    ? { borderColor: "var(--color-vsc-error)" }
                    : undefined
                }
                className="w-16"
                aria-label="Circle radius"
              />
            </label>
            <button
              onClick={() => removePlane(p.id)}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/20 hover:text-red-400 cursor-pointer transition-colors"
              style={{ color: "var(--color-vsc-text-muted)", fontSize: "10px" }}
              aria-label="Remove search plane"
            >
              ✕
            </button>
          </div>
        );
      })}
      <div className="flex gap-3">
        <button
          onClick={() => addPlane("circle")}
          className="text-[11px] mt-1 cursor-pointer hover:underline font-medium"
          style={{ color: "var(--color-vsc-accent)" }}
        >
          + Add Search Plane
        </button>
        <button
          onClick={() => addPlane("polyline")}
          className="text-[11px] mt-1 cursor-pointer hover:underline font-medium"
          style={{ color: "var(--color-vsc-accent)" }}
        >
          + Add Non-circular Surface
        </button>
      </div>
    </>
  );

  if (plain) {
    return <div className="space-y-2.5">{content}</div>;
  }

  return <Section title="Custom Search Planes">{content}</Section>;
}

/** Text input for polyline points that keeps the user's text while typing. */
function PolylineInput({
  points,
  onChange,
}: {
  points: [number, number][];
  onChange: (points: [number, number][]) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? formatPolyline(points);
  const parsed = parsePolyline(text);
  const invalid = parsed === null || parsed.length < 2;
  return (
    <input
      type="text"
      value={text}
      placeholder="e.g. 10, 5; 18, 1; 30, 2; 38, 9"
      onChange={(e) => {
        setDraft(e.target.value);
        const next = parsePolyline(e.target.value);
        if (next) onChange(next);
      }}
      onBlur={() => setDraft(null)}
      aria-invalid={invalid}
      aria-label="Non-circular surface points"
      title="Points of the surface, separated by semicolons; at least two, with x increasing"
      style={invalid ? { borderColor: "var(--color-vsc-error)" } : undefined}
      className="w-full"
    />
  );
}
