import { useAppStore } from "../../../store/app-store";
import { Section } from "../../../components/ui/Section";
import { Label } from "../../../components/ui/Label";
import {
  SpreadsheetNumberInput,
  SpreadsheetTable,
  type SpreadsheetColumn,
} from "../../../components/ui/SpreadsheetTable";

export function PiezometricLineSection() {
  const pl = useAppStore((s) => s.piezometricLine);
  const materials = useAppStore((s) => s.materials);
  const addPiezoLine = useAppStore((s) => s.addPiezoLine);
  const removePiezoLine = useAppStore((s) => s.removePiezoLine);
  const renamePiezoLine = useAppStore((s) => s.renamePiezoLine);
  const setActivePiezoLine = useAppStore((s) => s.setActivePiezoLine);
  const setPiezoCoordinate = useAppStore((s) => s.setPiezoCoordinate);
  const addPiezoPoint = useAppStore((s) => s.addPiezoPoint);
  const removePiezoPoint = useAppStore((s) => s.removePiezoPoint);
  const setPiezoMaterialAssignment = useAppStore(
    (s) => s.setPiezoMaterialAssignment,
  );
  const coordinates = useAppStore((s) => s.coordinates);

  const activeLine =
    pl.lines.find((l) => l.id === pl.activeLineId) ?? pl.lines[0] ?? null;
  const hasLines = pl.lines.length > 0;

  const lineColumns: SpreadsheetColumn<(typeof pl.lines)[number]>[] = [
    {
      header: <Label>#</Label>,
      widthClassName: "w-8",
      renderCell: (_line, i) => (
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
      header: <Label>Line</Label>,
      renderCell: (line) => (
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
            style={{ background: line.color }}
          />
          <input
            type="text"
            value={line.name}
            onChange={(e) => renamePiezoLine(line.id, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className="bg-transparent border-none outline-none text-[12px] w-full min-w-0"
            style={{ color: "var(--color-vsc-text)" }}
          />
        </div>
      ),
    },
    {
      header: null,
      widthClassName: "w-8",
      align: "right",
      renderCell: (line) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            removePiezoLine(line.id);
          }}
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/20 hover:text-red-400 cursor-pointer transition-colors"
          style={{
            color: "var(--color-vsc-text-muted)",
            fontSize: "10px",
          }}
          title="Remove line"
          aria-label={`Remove ${line.name}`}
        >
          ✕
        </button>
      ),
    },
  ];

  const coordinateColumns: SpreadsheetColumn<[number, number]>[] = [
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
          ariaLabel={`Piezometric point ${i + 1} X`}
          onChange={(value) =>
            setPiezoCoordinate(i, [parseFloat(value) || 0, y])
          }
        />
      ),
    },
    {
      header: <Label>Y</Label>,
      renderCell: ([x, y], i) => (
        <SpreadsheetNumberInput
          value={y}
          ariaLabel={`Piezometric point ${i + 1} Y`}
          onChange={(value) =>
            setPiezoCoordinate(i, [x, parseFloat(value) || 0])
          }
        />
      ),
    },
    {
      header: null,
      widthClassName: "w-8",
      align: "right",
      renderCell: (_row, i) =>
        activeLine && activeLine.coordinates.length > 2 ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              removePiezoPoint(i);
            }}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/20 hover:text-red-400 cursor-pointer transition-colors"
            style={{
              color: "var(--color-vsc-text-muted)",
              fontSize: "10px",
            }}
            title="Remove point"
            aria-label={`Remove piezometric point ${i + 1}`}
          >
            ✕
          </button>
        ) : null,
    },
  ];

  const addDefaultPoint = () => {
    if (!activeLine) return;
    const allX = coordinates.map((c) => c[0]);
    const allY = coordinates.map((c) => c[1]);
    const midY = (Math.min(...allY) + Math.max(...allY)) / 2;
    if (activeLine.coordinates.length === 0) {
      addPiezoPoint([Math.min(...allX), midY]);
    } else {
      const last = activeLine.coordinates[activeLine.coordinates.length - 1];
      addPiezoPoint([last[0] + 5, last[1]]);
    }
  };

  const handleAddLine = () => {
    const allX = coordinates.map((c) => c[0]);
    const allY = coordinates.map((c) => c[1]);
    const minX = Math.min(...allX);
    const maxX = Math.max(...allX);
    const midY = (Math.min(...allY) + Math.max(...allY)) / 2;
    addPiezoLine([
      [minX, midY],
      [maxX, midY],
    ]);
  };

  return (
    <Section title="Piezometric Lines">
      {!hasLines && (
        <div className="space-y-2 text-[12px]">
          <p style={{ color: "var(--color-vsc-text-muted)" }}>
            No piezometric line yet. Add one to model groundwater.
          </p>
          <button
            onClick={handleAddLine}
            className="text-[11px] px-2 py-1 rounded cursor-pointer"
            style={{
              border: "1px solid var(--color-vsc-border)",
              color: "var(--color-vsc-text-muted)",
            }}
          >
            + Add Line
          </button>
        </div>
      )}

      {hasLines && (
        <div className="space-y-2 mt-1">
          <div
            className="text-[10px] font-bold uppercase tracking-[0.1em]"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            Lines
          </div>
          <SpreadsheetTable
            rows={pl.lines}
            columns={lineColumns}
            getRowKey={(line) => line.id}
            selectedRowIndex={pl.lines.findIndex((l) => l.id === pl.activeLineId)}
            onRowClick={(line) => setActivePiezoLine(line.id)}
            getRowStyle={(line) => {
              const isActive = line.id === pl.activeLineId;
              if (!isActive) return undefined;
              return {
                boxShadow: `inset 2px 0 0 0 ${line.color}`,
              };
            }}
          />
          <button
            onClick={handleAddLine}
            className="text-[11px] px-2 py-0.5 rounded cursor-pointer"
            style={{
              border: "1px solid var(--color-vsc-border)",
              color: "var(--color-vsc-text-muted)",
            }}
          >
            + Add Line
          </button>

          {activeLine && (
            <>
              <div
                className="text-[10px] font-bold uppercase tracking-[0.1em] mt-2"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                {activeLine.name} — Coordinates
              </div>
              <SpreadsheetTable
                rows={activeLine.coordinates}
                columns={coordinateColumns}
                getRowKey={(_row, i) => `${activeLine.id}-${i}`}
              />
              <button
                onClick={addDefaultPoint}
                className="text-[11px] px-2 py-0.5 rounded cursor-pointer"
                style={{
                  border: "1px solid var(--color-vsc-border)",
                  color: "var(--color-vsc-text-muted)",
                }}
              >
                + Add Point
              </button>
            </>
          )}

          {pl.lines.length > 1 && materials.length > 0 && (
            <>
              <div
                className="text-[10px] font-bold uppercase tracking-[0.1em] mt-2"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                Material Assignment
              </div>
              <p
                className="text-[10px]"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                Choose which piezometric line applies to each material.
              </p>
              {materials.map((m) => {
                const assignedId =
                  pl.materialAssignment[m.id] ?? pl.lines[0]?.id ?? "";
                return (
                  <div
                    key={m.id}
                    className="flex items-center gap-2 text-[12px]"
                  >
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                      style={{ background: m.color }}
                    />
                    <span className="flex-1 min-w-0 truncate">{m.name}</span>
                    <select
                      value={assignedId}
                      onChange={(e) =>
                        setPiezoMaterialAssignment(m.id, e.target.value)
                      }
                      className="text-[11px] px-1 py-0.5 rounded"
                      style={{
                        background: "var(--color-vsc-input-bg)",
                        color: "var(--color-vsc-text)",
                        border: "1px solid var(--color-vsc-border)",
                      }}
                    >
                      {pl.lines.map((line) => (
                        <option key={line.id} value={line.id}>
                          {line.name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </Section>
  );
}
