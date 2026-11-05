import { useState } from "react";
import { useAppStore } from "../../../store/app-store";
import { Section } from "../../../components/ui/Section";
import { Label } from "../../../components/ui/Label";
import { DraftNumberInput } from "../../../components/ui/DraftNumberInput";
import { formatPolyline, parsePolyline } from "../../../utils/polyline";
import { isElectron } from "../../../utils/is-electron";

/** Whether this is one of the dialog windows (their store is a copy of the main window's). */
const inDialogWindow = () => typeof window !== "undefined" && /-dialog$/.test(window.location.hash);

/**
 * Copies a plane into a reference annotation of the result view. A dialog
 * window has no result view of its own: it asks the main window through
 * the analysis sync (referenceFromPlaneId on the payload).
 */
function addPlaneAsReference(planeId: string) {
  const s = useAppStore.getState();
  if (isElectron && inDialogWindow()) {
    window.cslope.sendAnalysisChanged({
      coordinates: s.coordinates,
      orientation: s.orientation,
      analysisLimits: s.analysisLimits,
      customSearchPlanes: s.customSearchPlanes,
      customPlanesOnly: s.customPlanesOnly,
      blockSearchObjects: s.blockSearchObjects,
      options: s.options,
      referenceFromPlaneId: planeId,
    });
    return;
  }
  s.addReferenceFromCustomPlane(planeId);
}

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
  // The canvas selection: a surface picked here is selected on the canvas,
  // and one selected there is highlighted here.
  const selectedPlaneId = useAppStore((s) =>
    s.canvasSelection?.object.type === "customPlane" ? s.canvasSelection.object.id : null,
  );
  const selectCanvasObject = useAppStore((s) => s.selectCanvasObject);
  const rowProps = (id: string) => ({
    onClick: () => {
      if (selectedPlaneId !== id) selectCanvasObject({ type: "customPlane", id });
    },
    "aria-selected": selectedPlaneId === id,
    style:
      selectedPlaneId === id
        ? { background: "var(--color-vsc-list-active)", borderRadius: 4, boxShadow: "0 0 0 3px var(--color-vsc-list-active)" }
        : undefined,
  });

  const content = (
    <>
      <div
        className="text-[10px] mb-1.5"
        style={{ color: "var(--color-vsc-text-muted)" }}
      >
        Define specific failure surfaces to analyze: circles, or non-circular
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
          Only analyze these surfaces (skip the search)
        </label>
      )}
      {planes.map((p) => {
        if (p.points) {
          return (
            <div key={p.id} className="flex items-end gap-1 text-[12px]" {...rowProps(p.id)}>
              <label className="flex flex-col flex-1 min-w-0">
                <Label>Points x, y (m); x, y; …</Label>
                <PolylineInput
                  points={p.points}
                  onChange={(points) => updatePlane(p.id, { points })}
                />
              </label>
              <AddAsReferenceButton planeId={p.id} />
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
          <div key={p.id} className="flex items-end gap-1 text-[12px]" {...rowProps(p.id)}>
            <label className="flex flex-col">
              <Label>cx (m)</Label>
              <DraftNumberInput
                step="0.5"
                value={p.cx}
                onValueChange={(v) => updatePlane(p.id, { cx: v })}
                className="w-20"
                aria-label="Circle center X"
              />
            </label>
            <label className="flex flex-col">
              <Label>cy (m)</Label>
              <DraftNumberInput
                step="0.5"
                value={p.cy}
                onValueChange={(v) => updatePlane(p.id, { cy: v })}
                className="w-20"
                aria-label="Circle center Y"
              />
            </label>
            <label className="flex flex-col">
              <Label>R (m)</Label>
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
                className="w-20"
                aria-label="Circle radius"
              />
            </label>
            <AddAsReferenceButton planeId={p.id} />
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
          + Add circle
        </button>
        <button
          onClick={() => addPlane("polyline")}
          className="text-[11px] mt-1 cursor-pointer hover:underline font-medium"
          style={{ color: "var(--color-vsc-accent)" }}
        >
          + Add non-circular surface
        </button>
      </div>
    </>
  );

  if (plain) {
    return <div className="space-y-2.5">{content}</div>;
  }

  return <Section title="Custom search planes">{content}</Section>;
}

/** "Add as reference line": the plane drawn over the result, labelled "Custom surface n". */
function AddAsReferenceButton({ planeId }: { planeId: string }) {
  return (
    <button
      onClick={() => addPlaneAsReference(planeId)}
      className="h-5 px-1 flex items-center rounded hover:bg-[var(--color-vsc-list-hover)] cursor-pointer transition-colors text-[10px] whitespace-nowrap"
      style={{ color: "var(--color-vsc-accent)" }}
      title="Draw this surface over the result as a reference line (Results view)"
      aria-label="Add as reference line"
    >
      + Reference line
    </button>
  );
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
  // A new, empty surface is not flagged until something is typed.
  const [touched, setTouched] = useState(points.length > 0);
  const text = draft ?? formatPolyline(points);
  const parsed = parsePolyline(text);
  const invalid = touched && (parsed === null || parsed.length < 2);
  return (
    <input
      type="text"
      value={text}
      placeholder="e.g. 10, 5; 18, 1; 30, 2; 38, 9"
      onChange={(e) => {
        setDraft(e.target.value);
        setTouched(true);
        const next = parsePolyline(e.target.value);
        // A surface needs two points; a single pair is still being typed.
        if (next && next.length >= 2) onChange(next);
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
