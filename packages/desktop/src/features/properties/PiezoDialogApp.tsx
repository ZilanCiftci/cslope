import { type ReactNode, useEffect, useRef, useState } from "react";
import { isElectron } from "../../utils/is-electron";
import { useAppStore } from "../../store/app-store";
import type {
  MaterialRow,
  ParameterDef,
  PiezometricLineState,
} from "../../store/types";
import { Label } from "../../components/ui/Label";
import {
  SpreadsheetRemoveButton,
  SpreadsheetTable,
  type SpreadsheetColumn,
} from "../../components/ui/SpreadsheetTable";
import { SpreadsheetExpressionInput } from "../../components/ui/SpreadsheetExpressionInput";
import { resolveParameters } from "../../utils/expression";

interface PiezoStatePayload {
  piezometricLine: PiezometricLineState;
  coordinates: [number, number][];
  materials: MaterialRow[];
  parameters?: ParameterDef[];
}

function normalizePiezoPayload(
  payload: PiezoStatePayload | null | undefined,
): PiezoStatePayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (
    !payload.piezometricLine ||
    !Array.isArray(payload.coordinates) ||
    !Array.isArray(payload.materials)
  ) {
    return null;
  }
  return payload;
}

export function PiezoDialogApp() {
  const pl = useAppStore((s) => s.piezometricLine);
  const materials = useAppStore((s) => s.materials);
  const coordinates = useAppStore((s) => s.coordinates);
  const addPiezoLine = useAppStore((s) => s.addPiezoLine);
  const removePiezoLine = useAppStore((s) => s.removePiezoLine);
  const setActivePiezoLine = useAppStore((s) => s.setActivePiezoLine);
  const setPiezoCoordinate = useAppStore((s) => s.setPiezoCoordinate);
  const addPiezoPoint = useAppStore((s) => s.addPiezoPoint);
  const removePiezoPoint = useAppStore((s) => s.removePiezoPoint);
  const setPiezoMaterialAssignment = useAppStore(
    (s) => s.setPiezoMaterialAssignment,
  );
  const setPiezometricLine = useAppStore((s) => s.setPiezometricLine);
  const parameters = useAppStore((s) => s.parameters);

  const [isHydrated, setIsHydrated] = useState(!isElectron);
  const suppressNextBroadcastRef = useRef(false);

  useEffect(() => {
    if (!isElectron) return;

    const applyState = (_event: unknown, next: PiezoStatePayload) => {
      const normalized = normalizePiezoPayload(next);
      if (!normalized) return;
      suppressNextBroadcastRef.current = true;
      const patch: {
        piezometricLine: PiezometricLineState;
        coordinates: [number, number][];
        materials: MaterialRow[];
        parameters?: ParameterDef[];
      } = {
        piezometricLine: normalized.piezometricLine,
        coordinates: normalized.coordinates,
        materials: normalized.materials,
      };

      if (Array.isArray(normalized.parameters)) {
        patch.parameters = normalized.parameters;
      }

      useAppStore.setState(patch);
      setIsHydrated(true);
    };

    window.cslope.onPiezoState(applyState);
    window.cslope.onPiezoChanged(applyState);
    window.cslope.requestPiezoState();

    return () => {
      window.cslope.offPiezoState(applyState);
      window.cslope.offPiezoChanged(applyState);
    };
  }, []);

  useEffect(() => {
    if (!isElectron || !isHydrated) return;

    if (suppressNextBroadcastRef.current) {
      suppressNextBroadcastRef.current = false;
      return;
    }

    window.cslope.sendPiezoChanged({
      piezometricLine: pl,
      coordinates,
      materials,
      parameters,
    });
  }, [pl, coordinates, materials, parameters, isHydrated]);

  const activeLine =
    pl.lines.find((l) => l.id === pl.activeLineId) ?? pl.lines[0] ?? null;
  const parameterValues = resolveParameters(parameters).resolved;

  const setPiezoCoordinateExpression = (
    lineId: string,
    pointIndex: number,
    axis: "x" | "y",
    expr: string | undefined,
  ) => {
    const lines = pl.lines.map((line) => {
      if (line.id !== lineId) return line;
      const current = line.coordinateExpressions ?? [];
      const next = line.coordinates.map((_, i) => ({ ...(current[i] ?? {}) }));
      const cell = { ...(next[pointIndex] ?? {}) };
      if (!expr || expr.trim().length === 0) {
        delete cell[axis];
      } else {
        cell[axis] = expr;
      }
      next[pointIndex] = cell;
      return { ...line, coordinateExpressions: next };
    });

    setPiezometricLine({ lines });
  };

  const coordinateColumns: SpreadsheetColumn<[number, number]>[] = [
    {
      header: <Label>#</Label>,
      widthClassName: "w-8",
      cellClassName: "py-1 px-2",
      renderCell: (_row, i) => (
        <span
          style={{ color: "var(--color-vsc-text-muted)", fontSize: "10px" }}
        >
          {i + 1}
        </span>
      ),
    },
    {
      header: <Label>X</Label>,
      renderCell: ([x, y], i) => (
        <SpreadsheetExpressionInput
          value={x}
          expression={activeLine?.coordinateExpressions?.[i]?.x}
          vars={parameterValues}
          ariaLabel={`Piezometric point ${i + 1} X`}
          onResolvedValue={(nextX) => setPiezoCoordinate(i, [nextX, y])}
          onExpressionChange={(expr) => {
            if (!activeLine) return;
            setPiezoCoordinateExpression(activeLine.id, i, "x", expr);
          }}
        />
      ),
    },
    {
      header: <Label>Y</Label>,
      renderCell: ([x, y], i) => (
        <SpreadsheetExpressionInput
          value={y}
          expression={activeLine?.coordinateExpressions?.[i]?.y}
          vars={parameterValues}
          ariaLabel={`Piezometric point ${i + 1} Y`}
          onResolvedValue={(nextY) => setPiezoCoordinate(i, [x, nextY])}
          onExpressionChange={(expr) => {
            if (!activeLine) return;
            setPiezoCoordinateExpression(activeLine.id, i, "y", expr);
          }}
        />
      ),
    },
    {
      header: null,
      widthClassName: "w-8",
      cellClassName: "py-1 px-2",
      align: "right",
      renderCell: (_row, i) =>
        activeLine && activeLine.coordinates.length > 2 ? (
          <SpreadsheetRemoveButton
            ariaLabel={`Remove piezometric point ${i + 1}`}
            onClick={(e) => {
              e.stopPropagation();
              removePiezoPoint(i);
            }}
          />
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
    const nextLines = useAppStore.getState().piezometricLine.lines;
    const last = nextLines[nextLines.length - 1];
    if (last) setActivePiezoLine(last.id);
  };

  const handleDeleteLine = () => {
    if (!activeLine) return;
    removePiezoLine(activeLine.id);
    const remaining = useAppStore.getState().piezometricLine.lines;
    if (remaining.length > 0) {
      setActivePiezoLine(remaining[0].id);
    }
  };

  return (
    <div
      className="h-screen flex flex-col p-3"
      style={{
        background: "var(--color-vsc-bg)",
        color: "var(--color-vsc-text)",
      }}
    >
      <div className="pb-2">
        <h2 className="text-[12px] font-semibold">Piezometric Lines</h2>
      </div>
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {/* ── Line list table + Add/Delete buttons ── */}
        <div className="flex gap-3">
          <div
            className="flex-1 rounded border overflow-hidden"
            style={{ borderColor: "var(--color-vsc-border)" }}
          >
            <table className="w-full text-[11px]">
              <thead>
                <tr
                  style={{
                    background: "var(--color-vsc-surface-tint)",
                    color: "var(--color-vsc-text-muted)",
                  }}
                >
                  <th className="text-left px-2 py-1.5 font-semibold">Line</th>
                  <th className="text-right px-2 py-1.5 font-semibold w-24">
                    Points
                  </th>
                </tr>
              </thead>
              <tbody>
                {pl.lines.map((line) => {
                  const isSelected = activeLine?.id === line.id;
                  return (
                    <tr
                      key={line.id}
                      onClick={() => setActivePiezoLine(line.id)}
                      className="cursor-pointer transition-colors"
                      style={{
                        background: isSelected
                          ? "var(--color-vsc-list-active)"
                          : "transparent",
                        color: isSelected
                          ? "var(--color-vsc-text-bright)"
                          : "var(--color-vsc-text)",
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.background =
                            "var(--color-vsc-list-hover)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.background = "transparent";
                        }
                      }}
                    >
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                            style={{ background: line.color }}
                          />
                          {line.name}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {line.coordinates.length}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-1.5">
            <DialogButton onClick={handleAddLine}>Add</DialogButton>
            <DialogButton onClick={handleDeleteLine} disabled={!activeLine}>
              Delete
            </DialogButton>
          </div>
        </div>

        {/* ── Coordinate editor for selected line ── */}
        {activeLine ? (
          <div
            className="p-3 rounded space-y-2.5"
            style={{
              background: "var(--color-vsc-surface-tint)",
              border: "1px solid var(--color-vsc-border)",
            }}
          >
            <h4
              className="text-[10px] font-bold uppercase tracking-[0.1em]"
              style={{ color: "var(--color-vsc-text-muted)" }}
            >
              {activeLine.name} Coordinates
            </h4>

            <SpreadsheetTable
              rows={activeLine.coordinates}
              columns={coordinateColumns}
              getRowKey={(_row, i) => `${activeLine.id}-${i}`}
            />

            <button
              onClick={addDefaultPoint}
              className="text-[11px] cursor-pointer hover:underline font-medium"
              style={{ color: "var(--color-vsc-accent)" }}
            >
              + Add Point
            </button>
          </div>
        ) : (
          <div
            className="text-[11px] p-2 rounded border"
            style={{
              color: "var(--color-vsc-text-muted)",
              borderColor: "var(--color-vsc-border)",
              background: "var(--color-vsc-surface-tint)",
            }}
          >
            Add a piezometric line to start editing coordinates.
          </div>
        )}

        {/* ── Material assignment (only when >1 line) ── */}
        {pl.lines.length > 1 && materials.length > 0 && (
          <div
            className="p-3 rounded space-y-2.5"
            style={{
              background: "var(--color-vsc-surface-tint)",
              border: "1px solid var(--color-vsc-border)",
            }}
          >
            <h4
              className="text-[10px] font-bold uppercase tracking-[0.1em]"
              style={{ color: "var(--color-vsc-text-muted)" }}
            >
              Material Assignment
            </h4>
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
                <div key={m.id} className="flex items-center gap-2 text-[12px]">
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
          </div>
        )}
      </div>
      <div
        className="pt-3 mt-2 border-t"
        style={{ borderColor: "var(--color-vsc-border)" }}
      >
        <button
          onClick={() => window.close()}
          className="w-full text-[11px] py-1 rounded cursor-pointer font-medium"
          style={{
            background: "var(--color-vsc-accent)",
            color: "#fff",
            border: "1px solid var(--color-vsc-accent)",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

function DialogButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className="px-3 py-1.5 text-[11px] font-medium rounded border transition-colors cursor-pointer min-w-[64px]"
      style={{
        background: disabled ? "transparent" : "var(--color-vsc-surface-tint)",
        color: disabled
          ? "var(--color-vsc-text-muted)"
          : "var(--color-vsc-text)",
        borderColor: "var(--color-vsc-border)",
        opacity: disabled ? 0.5 : 1,
      }}
      aria-disabled={disabled}
    >
      {children}
    </button>
  );
}
