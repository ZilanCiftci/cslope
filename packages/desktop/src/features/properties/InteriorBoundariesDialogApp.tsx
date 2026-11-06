import { useEffect, useRef, useState } from "react";
import { Label } from "../../components/ui/Label";
import {
  SpreadsheetTable,
  type SpreadsheetColumn,
} from "../../components/ui/SpreadsheetTable";
import { RecordTable } from "../../components/ui/RecordTable";
import { SpreadsheetExpressionInput } from "../../components/ui/SpreadsheetExpressionInput";
import { isElectron } from "../../utils/is-electron";
import { useAppStore } from "../../store/app-store";
import type { MaterialBoundaryRow, ParameterDef } from "../../store/types";
import { resolveParameters } from "../../utils/expression";
import { DialogHeader, WindowSubheading } from "./DialogHeader";

interface InteriorBoundariesStatePayload {
  coordinates: [number, number][];
  materialBoundaries: MaterialBoundaryRow[];
  selectedMaterialBoundaryId: string | null;
  parameters?: ParameterDef[];
}

export function InteriorBoundariesDialogApp() {
  const coordinates = useAppStore((s) => s.coordinates);
  const materialBoundaries = useAppStore((s) => s.materialBoundaries);
  const addMaterialBoundary = useAppStore((s) => s.addMaterialBoundary);
  const removeMaterialBoundary = useAppStore((s) => s.removeMaterialBoundary);
  const addBoundaryPoint = useAppStore((s) => s.addBoundaryPoint);
  const updateBoundaryPoint = useAppStore((s) => s.updateBoundaryPoint);
  const removeBoundaryPoint = useAppStore((s) => s.removeBoundaryPoint);
  const updateMaterialBoundary = useAppStore((s) => s.updateMaterialBoundary);
  const parameters = useAppStore((s) => s.parameters);
  const selectedMaterialBoundaryId = useAppStore(
    (s) => s.selectedMaterialBoundaryId,
  );
  const setSelectedMaterialBoundary = useAppStore(
    (s) => s.setSelectedMaterialBoundary,
  );
  // The canvas selection: a row picked here selects its boundary (or
  // point) on the canvas, and one selected there is the selected row here.
  const canvasSelection = useAppStore((s) => s.canvasSelection);
  const selectCanvasObject = useAppStore((s) => s.selectCanvasObject);
  const [isHydrated, setIsHydrated] = useState(!isElectron);
  const suppressNextBroadcastRef = useRef(false);

  const selectedBoundary =
    materialBoundaries.find((b) => b.id === selectedMaterialBoundaryId) ??
    materialBoundaries[0] ??
    null;

  const xs = coordinates.map((c) => c[0]);
  const ys = coordinates.map((c) => c[1]);
  const xMin = xs.length > 0 ? Math.min(...xs) : 0;
  const xMax = xs.length > 0 ? Math.max(...xs) : 10;
  const yMin = ys.length > 0 ? Math.min(...ys) : 0;
  const yMax = ys.length > 0 ? Math.max(...ys) : 10;
  const yMid = Math.round(((yMin + yMax) / 2) * 10) / 10;
  const parameterValues = resolveParameters(parameters).resolved;

  const setBoundaryCoordinateExpression = (
    boundary: MaterialBoundaryRow,
    pointIndex: number,
    axis: "x" | "y",
    expr: string | undefined,
  ) => {
    const current = boundary.coordinateExpressions ?? [];
    const next = boundary.coordinates.map((_, i) => ({
      ...(current[i] ?? {}),
    }));
    const cell = { ...(next[pointIndex] ?? {}) };
    if (!expr || expr.trim().length === 0) {
      delete cell[axis];
    } else {
      cell[axis] = expr;
    }
    next[pointIndex] = cell;
    updateMaterialBoundary(boundary.id, { coordinateExpressions: next });
  };

  useEffect(() => {
    if (!isElectron) return;

    const applyState = (
      _event: unknown,
      next: InteriorBoundariesStatePayload,
    ) => {
      suppressNextBroadcastRef.current = true;
      const patch: {
        coordinates: [number, number][];
        materialBoundaries: MaterialBoundaryRow[];
        selectedMaterialBoundaryId: string | null;
        parameters?: ParameterDef[];
      } = {
        coordinates: next.coordinates,
        materialBoundaries: next.materialBoundaries,
        selectedMaterialBoundaryId: next.selectedMaterialBoundaryId,
      };

      if (Array.isArray(next.parameters)) {
        patch.parameters = next.parameters;
      }

      useAppStore.setState(patch);
      setIsHydrated(true);
    };

    const unsubscribeInteriorBoundariesState = window.cslope.onInteriorBoundariesState(applyState);
    const unsubscribeInteriorBoundariesChanged = window.cslope.onInteriorBoundariesChanged(applyState);
    window.cslope.requestInteriorBoundariesState();

    return () => {
      unsubscribeInteriorBoundariesState();
      unsubscribeInteriorBoundariesChanged();
    };
  }, []);

  useEffect(() => {
    if (!isElectron || !isHydrated) return;

    if (suppressNextBroadcastRef.current) {
      suppressNextBroadcastRef.current = false;
      return;
    }

    window.cslope.sendInteriorBoundariesChanged({
      coordinates,
      materialBoundaries,
      selectedMaterialBoundaryId,
      parameters,
    });
  }, [
    coordinates,
    materialBoundaries,
    selectedMaterialBoundaryId,
    parameters,
    isHydrated,
  ]);

  useEffect(() => {
    // Local fallback selection only: don't send it back. Sending would
    // push this window's whole (possibly outdated) geometry copy to the
    // main window, e.g. in the middle of a vertex drag there.
    if (selectedBoundary) {
      if (selectedMaterialBoundaryId !== selectedBoundary.id) {
        suppressNextBroadcastRef.current = true;
        setSelectedMaterialBoundary(selectedBoundary.id);
      }
      return;
    }
    if (selectedMaterialBoundaryId !== null) {
      suppressNextBroadcastRef.current = true;
      setSelectedMaterialBoundary(null);
    }
  }, [
    materialBoundaries,
    selectedBoundary,
    selectedMaterialBoundaryId,
    setSelectedMaterialBoundary,
  ]);

  const handleAddBoundary = () => {
    addMaterialBoundary([
      [xMin, yMid],
      [xMax, yMid],
    ]);
    const nextBoundaries = useAppStore.getState().materialBoundaries;
    const last = nextBoundaries[nextBoundaries.length - 1];
    setSelectedMaterialBoundary(last?.id ?? null);
  };

  const handleDeleteBoundary = (id: string) => {
    const index = materialBoundaries.findIndex((b) => b.id === id);
    const wasShown = id === selectedBoundary?.id;
    removeMaterialBoundary(id);
    const remaining = useAppStore.getState().materialBoundaries;
    if (wasShown) setSelectedMaterialBoundary(remaining[Math.min(index, remaining.length - 1)]?.id ?? null);
  };

  const selectedBoundaryIndex = selectedBoundary
    ? materialBoundaries.findIndex((b) => b.id === selectedBoundary.id)
    : -1;

  return (
    <div
      className="h-screen flex flex-col p-3"
      style={{
        background: "var(--color-vsc-bg)",
        color: "var(--color-vsc-text)",
      }}
    >
      <DialogHeader
        title="Interior boundaries"
        description="Lines inside the model that divide it into regions of different materials."
      />
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        <RecordTable
          mode="records"
          label="Interior boundaries list"
          rows={materialBoundaries}
          getRowKey={(boundary) => boundary.id}
          selectedRowIndex={selectedBoundaryIndex >= 0 ? selectedBoundaryIndex : null}
          onRowClick={(boundary) => {
            setSelectedMaterialBoundary(boundary.id);
            selectCanvasObject({ type: "boundary", id: boundary.id });
          }}
          emptyText="No interior boundaries."
          onRemove={(boundary) => handleDeleteBoundary(boundary.id)}
          removeLabel={(_boundary, idx) => `Remove boundary ${idx + 1}`}
          addActions={[{ label: "+ Add boundary", onClick: handleAddBoundary }]}
          columns={[
            {
              header: "Boundary",
              renderCell: (_boundary, idx) => `Boundary ${idx + 1}`,
            },
            {
              header: "Points",
              widthClassName: "w-24",
              align: "right",
              renderCell: (boundary) => boundary.coordinates.length,
            },
          ]}
        />

        {selectedBoundary && (
          <div className="pt-1 space-y-2">
            <WindowSubheading>
              Boundary {selectedBoundaryIndex + 1} coordinates
            </WindowSubheading>

            <SpreadsheetTable
              rows={selectedBoundary.coordinates}
              getRowKey={(_row, i) => `${selectedBoundary.id}-${i}`}
              selectedRowIndex={
                canvasSelection?.object.type === "boundary" &&
                canvasSelection.object.id === selectedBoundary.id &&
                typeof canvasSelection.point === "number"
                  ? canvasSelection.point
                  : null
              }
              onRowClick={(_row, i) => selectCanvasObject({ type: "boundary", id: selectedBoundary.id }, i)}
              onRemove={(_row, i) => removeBoundaryPoint(selectedBoundary.id, i)}
              removeLabel={(_row, i) => `Remove point ${i + 1}`}
              // A boundary keeps at least two points.
              canRemove={() => selectedBoundary.coordinates.length > 2}
              addActions={[
                {
                  label: "+ Add point",
                  onClick: () => {
                    const last = selectedBoundary.coordinates[
                      selectedBoundary.coordinates.length - 1
                    ] ?? [xMax, yMid];
                    addBoundaryPoint(selectedBoundary.id, [last[0] + 2, last[1]]);
                  },
                },
              ]}
              columns={
                [
                  {
                    header: <Label>#</Label>,
                    widthClassName: "w-8",
                    cellClassName: "py-1 px-2",
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
                    header: <Label>x (m)</Label>,
                    renderCell: ([x, y], i) => (
                      <SpreadsheetExpressionInput
                        value={x}
                        expression={
                          selectedBoundary.coordinateExpressions?.[i]?.x
                        }
                        vars={parameterValues}
                        ariaLabel={`Boundary ${selectedBoundaryIndex + 1} point ${i + 1} X`}
                        onResolvedValue={(nextX) =>
                          updateBoundaryPoint(selectedBoundary.id, i, [
                            nextX,
                            y,
                          ])
                        }
                        onExpressionChange={(expr) =>
                          setBoundaryCoordinateExpression(
                            selectedBoundary,
                            i,
                            "x",
                            expr,
                          )
                        }
                      />
                    ),
                  },
                  {
                    header: <Label>y (m)</Label>,
                    renderCell: ([x, y], i) => (
                      <SpreadsheetExpressionInput
                        value={y}
                        expression={
                          selectedBoundary.coordinateExpressions?.[i]?.y
                        }
                        vars={parameterValues}
                        ariaLabel={`Boundary ${selectedBoundaryIndex + 1} point ${i + 1} Y`}
                        onResolvedValue={(nextY) =>
                          updateBoundaryPoint(selectedBoundary.id, i, [
                            x,
                            nextY,
                          ])
                        }
                        onExpressionChange={(expr) =>
                          setBoundaryCoordinateExpression(
                            selectedBoundary,
                            i,
                            "y",
                            expr,
                          )
                        }
                      />
                    ),
                  },
                ] satisfies SpreadsheetColumn<[number, number]>[]
              }
            />

          </div>
        )}
      </div>
      <div
        className="pt-3 mt-2 border-t dialog-buttons"
        style={{ borderColor: "var(--color-vsc-border)" }}
      >
        <button
          onClick={() => window.close()}
          className="btn btn-primary"
        >
          Close
        </button>
      </div>
    </div>
  );
}
