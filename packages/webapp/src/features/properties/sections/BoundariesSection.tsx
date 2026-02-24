import { useAppStore } from "../../../store/app-store";
import { Section } from "../../../components/ui/Section";
import { Label } from "../../../components/ui/Label";
import {
  SpreadsheetNumberInput,
  SpreadsheetTable,
  type SpreadsheetColumn,
} from "../../../components/ui/SpreadsheetTable";

export function BoundariesSection() {
  const boundaries = useAppStore((s) => s.materialBoundaries);
  const addMaterialBoundary = useAppStore((s) => s.addMaterialBoundary);
  const removeMaterialBoundary = useAppStore((s) => s.removeMaterialBoundary);
  const addBoundaryPoint = useAppStore((s) => s.addBoundaryPoint);
  const updateBoundaryPoint = useAppStore((s) => s.updateBoundaryPoint);
  const removeBoundaryPoint = useAppStore((s) => s.removeBoundaryPoint);
  const coordinates = useAppStore((s) => s.coordinates);

  const xs = coordinates.map((c) => c[0]);
  const ys = coordinates.map((c) => c[1]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMid = Math.round(((Math.min(...ys) + Math.max(...ys)) / 2) * 10) / 10;

  return (
    <Section title="Interior Boundaries">
      <div
        className="text-[11px] mb-2"
        style={{ color: "var(--color-vsc-text-muted)" }}
      >
        Add boundaries to divide the slope into regions.
      </div>
      {boundaries.map((b, bIdx) => (
        <div
          key={b.id}
          className="p-2.5 rounded-md space-y-2 mb-2"
          style={{
            background: "var(--color-vsc-surface-tint)",
            border: "1px solid var(--color-vsc-border)",
          }}
        >
          <div className="flex items-center justify-between">
            <span
              className="text-[11px] font-medium"
              style={{ color: "var(--color-vsc-text-bright)" }}
            >
              Boundary {bIdx + 1}
            </span>
            <button
              onClick={() => removeMaterialBoundary(b.id)}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/20 hover:text-red-400 cursor-pointer transition-colors"
              style={{
                color: "var(--color-vsc-text-muted)",
                fontSize: "10px",
              }}
              aria-label="Remove boundary"
            >
              ✕
            </button>
          </div>

          <SpreadsheetTable
            rows={b.coordinates}
            getRowKey={(_row, i) => `${b.id}-${i}`}
            columns={
              [
                {
                  header: <Label>#</Label>,
                  widthClassName: "w-8",
                  renderCell: (_row, i) => (
                    <span
                      style={{
                        color: "var(--color-vsc-text-muted)",
                        fontSize: "10px",
                      }}
                    >
                      {i + 1}
                    </span>
                  ),
                },
                {
                  header: <Label>X</Label>,
                  renderCell: ([x, y], i) => (
                    <SpreadsheetNumberInput
                      value={x}
                      ariaLabel={`Boundary ${bIdx + 1} point ${i + 1} X`}
                      onChange={(value) => {
                        const num = parseFloat(value);
                        if (!isNaN(num)) updateBoundaryPoint(b.id, i, [num, y]);
                      }}
                    />
                  ),
                },
                {
                  header: <Label>Y</Label>,
                  renderCell: ([x, y], i) => (
                    <SpreadsheetNumberInput
                      value={y}
                      ariaLabel={`Boundary ${bIdx + 1} point ${i + 1} Y`}
                      onChange={(value) => {
                        const num = parseFloat(value);
                        if (!isNaN(num)) updateBoundaryPoint(b.id, i, [x, num]);
                      }}
                    />
                  ),
                },
                {
                  header: null,
                  widthClassName: "w-8",
                  align: "right",
                  renderCell: (_row, i) =>
                    b.coordinates.length > 2 ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeBoundaryPoint(b.id, i);
                        }}
                        className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/20 hover:text-red-400 cursor-pointer transition-colors"
                        style={{
                          color: "var(--color-vsc-text-muted)",
                          fontSize: "10px",
                        }}
                        aria-label={`Remove point ${i + 1}`}
                      >
                        ✕
                      </button>
                    ) : null,
                },
              ] satisfies SpreadsheetColumn<[number, number]>[]
            }
          />
          <button
            onClick={() => {
              const last = b.coordinates[b.coordinates.length - 1] ?? [
                xMax,
                yMid,
              ];
              addBoundaryPoint(b.id, [last[0] + 2, last[1]]);
            }}
            className="text-[11px] cursor-pointer hover:underline font-medium"
            style={{ color: "var(--color-vsc-accent)" }}
          >
            + Add Point
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          addMaterialBoundary([
            [xMin, yMid],
            [xMax, yMid],
          ])
        }
        className="text-[11px] mt-1 cursor-pointer hover:underline font-medium"
        style={{ color: "var(--color-vsc-accent)" }}
      >
        + Add Boundary
      </button>
    </Section>
  );
}
