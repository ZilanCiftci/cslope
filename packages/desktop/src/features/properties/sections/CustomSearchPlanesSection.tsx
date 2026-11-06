import { useState } from "react";
import { Spline } from "lucide-react";
import { useAppStore } from "../../../store/app-store";
import { Section } from "../../../components/ui/Section";
import { Label } from "../../../components/ui/Label";
import { DraftNumberInput } from "../../../components/ui/DraftNumberInput";
import { RecordTable, RowIconButton } from "../../../components/ui/RecordTable";
import { WindowSubheading } from "../DialogHeader";
import { customPlanesInResultOrder } from "../../../store/helpers";
import type { CustomSearchPlane } from "../../../store/types";
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

/** A coordinate as shown in the list: at most 2 decimals. */
const coord = (v: number) => String(Number(v.toFixed(2)));

/** A plane's geometry in one line: "cx 30, cy 5, R 17.5" or "(0, 6) (20, 5)". */
function definitionText(plane: CustomSearchPlane): string {
  if (plane.points) {
    return plane.points.length > 0
      ? plane.points.map(([x, y]) => `(${coord(x)}, ${coord(y)})`).join(" ")
      : "No points yet";
  }
  return `cx ${coord(plane.cx)}, cy ${coord(plane.cy)}, R ${coord(plane.radius)}`;
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
  // and one selected there is the one shown here.
  const selectedPlaneId = useAppStore((s) =>
    s.canvasSelection?.object.type === "customPlane" ? s.canvasSelection.object.id : null,
  );
  const selectCanvasObject = useAppStore((s) => s.selectCanvasObject);

  // Listed, numbered and named as the canvas and the result do: circles
  // first, then the non-circular surfaces; one without two points yet has
  // no number.
  const resultOrder = customPlanesInResultOrder(planes);
  const rows = [...resultOrder, ...planes.filter((p) => !resultOrder.includes(p))];
  const nameOf = (plane: CustomSearchPlane) => {
    const n = resultOrder.indexOf(plane);
    return `${plane.points ? "Custom surface" : "Custom circle"}${n >= 0 ? ` ${n + 1}` : ""}`;
  };
  const shown = rows.find((p) => p.id === selectedPlaneId) ?? rows[0] ?? null;
  const shownIndex = shown ? rows.indexOf(shown) : -1;

  const select = (id: string) => {
    if (selectedPlaneId !== id) selectCanvasObject({ type: "customPlane", id });
  };
  const add = (kind: "circle" | "polyline") => {
    addPlane(kind);
    const last = useAppStore.getState().customSearchPlanes.at(-1);
    if (last) selectCanvasObject({ type: "customPlane", id: last.id });
  };
  const remove = (id: string) => {
    const wasShown = id === shown?.id;
    const index = rows.findIndex((p) => p.id === id);
    removePlane(id);
    if (!wasShown) return;
    const rest = rows.filter((p) => p.id !== id);
    const next = rest[Math.min(index, rest.length - 1)];
    if (next) selectCanvasObject({ type: "customPlane", id: next.id });
  };

  const content = (
    <>
      {planes.length > 0 && (
        <label className="flex items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            checked={customPlanesOnly}
            onChange={(e) => setCustomPlanesOnly(e.target.checked)}
          />
          Only analyze these surfaces (skip the search)
        </label>
      )}
      <RecordTable
        mode="records"
        label="Custom surfaces list"
        rows={rows}
        getRowKey={(p) => p.id}
        selectedRowIndex={shownIndex >= 0 ? shownIndex : null}
        onRowClick={(p) => select(p.id)}
        emptyText="No custom surfaces."
        onRemove={(p) => remove(p.id)}
        removeLabel={(p) => `Remove ${nameOf(p).toLowerCase()}`}
        rowActions={(p) =>
          resultOrder.includes(p) ? <AddAsReferenceButton planeId={p.id} name={nameOf(p)} /> : null
        }
        addActions={[
          { label: "+ Add circle", onClick: () => add("circle") },
          { label: "+ Add non-circular surface", onClick: () => add("polyline") },
        ]}
        columns={[
          {
            header: "#",
            widthClassName: "w-8",
            renderCell: (p) => {
              const n = resultOrder.indexOf(p);
              return <span style={{ color: "var(--color-vsc-text-muted)" }}>{n >= 0 ? n + 1 : "–"}</span>;
            },
          },
          {
            header: "Kind",
            widthClassName: "w-24",
            renderCell: (p) => (p.points ? "Non-circular" : "Circle"),
          },
          {
            header: "Definition",
            cellClassName: "max-w-0 w-full",
            renderCell: (p) => (
              <span className="block truncate" title={definitionText(p)}>
                {definitionText(p)}
              </span>
            ),
          },
        ]}
      />

      {shown && (
        <div className="space-y-2 pt-1">
          <WindowSubheading>{nameOf(shown)}</WindowSubheading>
          {shown.points ? (
            <label key={shown.id} className="flex flex-col gap-0.5 text-[12px]">
              <Label>Points x, y (m); x, y; …</Label>
              <PolylineInput
                points={shown.points}
                onChange={(points) => updatePlane(shown.id, { points })}
              />
            </label>
          ) : (
            <CircleFields
              key={shown.id}
              plane={shown}
              onChange={(patch) => updatePlane(shown.id, patch)}
            />
          )}
        </div>
      )}
    </>
  );

  if (plain) {
    return <div className="space-y-3">{content}</div>;
  }

  return <Section title="Custom surfaces">{content}</Section>;
}

/** The centre and radius of a custom circle. */
function CircleFields({
  plane,
  onChange,
}: {
  plane: CustomSearchPlane;
  onChange: (patch: Partial<CustomSearchPlane>) => void;
}) {
  const radiusInvalid = plane.radius <= 0;
  return (
    <div className="flex items-end gap-2 text-[12px]">
      <label className="flex flex-col gap-0.5">
        <Label>cx (m)</Label>
        <DraftNumberInput
          step="0.5"
          value={plane.cx}
          onValueChange={(v) => onChange({ cx: v })}
          className="w-20"
          aria-label="Circle center X"
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <Label>cy (m)</Label>
        <DraftNumberInput
          step="0.5"
          value={plane.cy}
          onValueChange={(v) => onChange({ cy: v })}
          className="w-20"
          aria-label="Circle center Y"
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <Label>R (m)</Label>
        <DraftNumberInput
          step="0.5"
          min="0.1"
          value={plane.radius}
          onValueChange={(v) => onChange({ radius: v })}
          onBlur={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isFinite(v) || v <= 0) {
              onChange({ radius: 0.1 });
            }
          }}
          aria-invalid={radiusInvalid}
          style={radiusInvalid ? { borderColor: "var(--color-vsc-error)" } : undefined}
          className="w-20"
          aria-label="Circle radius"
        />
      </label>
    </div>
  );
}

/** "Add as reference line": the plane drawn over the result, labelled "Custom surface n". */
function AddAsReferenceButton({ planeId, name }: { planeId: string; name: string }) {
  return (
    <RowIconButton
      ariaLabel={`Add ${name.toLowerCase()} as reference line`}
      title="Draw this surface over the result as a reference line (Results view)"
      onClick={(e) => {
        e.stopPropagation();
        addPlaneAsReference(planeId);
      }}
    >
      <Spline size={12} strokeWidth={1.75} aria-hidden />
    </RowIconButton>
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
