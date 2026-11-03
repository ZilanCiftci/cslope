import { useEffect, useRef, useState } from "react";
import { isElectron } from "../../utils/is-electron";
import { Label } from "../../components/ui/Label";
import {
  SpreadsheetNumberInput,
  SpreadsheetRemoveButton,
  SpreadsheetTable,
  type SpreadsheetColumn,
} from "../../components/ui/SpreadsheetTable";
import { DraftNumberInput } from "../../components/ui/DraftNumberInput";
import { SpreadsheetExpressionInput } from "../../components/ui/SpreadsheetExpressionInput";
import { useAppStore } from "../../store/app-store";
import type { LineLoadRow, ParameterDef, UdlRow } from "../../store/types";
import { resolveParameters } from "../../utils/expression";

interface LoadsStatePayload {
  udls: UdlRow[];
  lineLoads: LineLoadRow[];
  parameters?: ParameterDef[];
  /** From the main window: keeps new loads inside the model. */
  coordinates?: [number, number][];
}

/** A typed inclination: within ±180°, 0 (vertical) not stored. */
function parseLoadAngle(text: string): number | undefined | null {
  if (text.trim() === "") return undefined;
  const v = Number(text);
  if (!Number.isFinite(v) || Math.abs(v) > 180) return null;
  return v === 0 ? undefined : v;
}

function normalizeLoadsPayload(
  payload: LoadsStatePayload | null | undefined,
): LoadsStatePayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (!Array.isArray(payload.udls) || !Array.isArray(payload.lineLoads)) {
    return null;
  }
  return payload;
}

export function LineLoadsDialogApp() {
  const udls = useAppStore((s) => s.udls);
  const lineLoads = useAppStore((s) => s.lineLoads);
  const addLineLoad = useAppStore((s) => s.addLineLoad);
  const updateLineLoad = useAppStore((s) => s.updateLineLoad);
  const removeLineLoad = useAppStore((s) => s.removeLineLoad);
  const parameters = useAppStore((s) => s.parameters);
  const [isHydrated, setIsHydrated] = useState(!isElectron);
  const suppressNextBroadcastRef = useRef(false);

  useEffect(() => {
    if (!isElectron) return;

    const applyState = (_event: unknown, next: LoadsStatePayload) => {
      const normalized = normalizeLoadsPayload(next);
      if (!normalized) return;
      suppressNextBroadcastRef.current = true;
      const patch: {
        udls: UdlRow[];
        lineLoads: LineLoadRow[];
        parameters?: ParameterDef[];
        coordinates?: [number, number][];
      } = {
        udls: normalized.udls,
        lineLoads: normalized.lineLoads,
      };

      if (Array.isArray(normalized.parameters)) {
        patch.parameters = normalized.parameters;
      }
      if (Array.isArray(normalized.coordinates)) {
        patch.coordinates = normalized.coordinates;
      }

      useAppStore.setState(patch);
      setIsHydrated(true);
    };

    const unsubscribeLoadsState = window.cslope.onLoadsState(applyState);
    const unsubscribeLoadsChanged = window.cslope.onLoadsChanged(applyState);
    window.cslope.requestLoadsState();

    return () => {
      unsubscribeLoadsState();
      unsubscribeLoadsChanged();
    };
  }, []);

  useEffect(() => {
    if (!isElectron || !isHydrated) return;

    if (suppressNextBroadcastRef.current) {
      suppressNextBroadcastRef.current = false;
      return;
    }

    window.cslope.sendLoadsChanged({ udls, lineLoads, parameters });
  }, [udls, lineLoads, parameters, isHydrated]);

  const parameterValues = resolveParameters(parameters).resolved;

  const setLineLoadExpression = (
    row: LineLoadRow,
    field: "magnitude" | "x",
    expression: string | undefined,
  ) => {
    const nextExpressions = { ...(row.expressions ?? {}) };
    if (!expression || expression.trim().length === 0) {
      delete nextExpressions[field];
    } else {
      nextExpressions[field] = expression;
    }
    updateLineLoad(row.id, { expressions: nextExpressions });
  };

  const columns: SpreadsheetColumn<LineLoadRow>[] = [
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
      header: (
        <Label title="Line load per metre run of the slope">
          P (kN/m)
        </Label>
      ),
      widthClassName: "w-[24%]",
      renderCell: (row) => (
        <SpreadsheetExpressionInput
          value={row.magnitude}
          expression={row.expressions?.magnitude}
          vars={parameterValues}
          ariaLabel="Line load magnitude"
          onResolvedValue={(nextMagnitude) =>
            updateLineLoad(row.id, { magnitude: Math.max(0.1, nextMagnitude) })
          }
          onExpressionChange={(expr) =>
            setLineLoadExpression(row, "magnitude", expr)
          }
        />
      ),
    },
    {
      header: <Label title="Position of the load">x (m)</Label>,
      widthClassName: "w-[22%]",
      renderCell: (row) => (
        <SpreadsheetExpressionInput
          value={row.x}
          expression={row.expressions?.x}
          vars={parameterValues}
          ariaLabel="Line load x"
          onResolvedValue={(nextX) => updateLineLoad(row.id, { x: nextX })}
          onExpressionChange={(expr) => setLineLoadExpression(row, "x", expr)}
        />
      ),
    },
    {
      header: (
        <Label title="Inclination of the load from the downward vertical, positive when it points towards +x: 0 = vertical, ±90 = horizontal">
          Angle from vertical (°)
        </Label>
      ),
      widthClassName: "w-[22%]",
      renderCell: (row) => (
        <SpreadsheetNumberInput
          value={row.angle ?? 0}
          step="5"
          ariaLabel="Line load angle"
          onChange={(text) => {
            const angle = parseLoadAngle(text);
            if (angle !== null) updateLineLoad(row.id, { angle });
          }}
        />
      ),
    },
    {
      header: (
        <Label title="Elevation of the load point, for a load on a wall face; empty = on the ground at x. Used for an inclined load only.">
          Load point y (m)
        </Label>
      ),
      widthClassName: "w-[22%]",
      renderCell: (row) => {
        const vertical = !row.angle;
        return (
          <DraftNumberInput
            value={row.y}
            step="0.5"
            placeholder="ground"
            disabled={vertical}
            aria-label="Line load point y"
            onValueChange={(y) => updateLineLoad(row.id, { y })}
            onClear={() => updateLineLoad(row.id, { y: undefined })}
            className="w-full h-full py-1 px-2 text-[12px] outline-none border-2 border-transparent focus:border-[var(--color-vsc-accent)] disabled:opacity-40"
            style={{
              background: "var(--color-vsc-input-bg)",
              color: "var(--color-vsc-text)",
              borderRadius: 0,
              boxShadow: "none",
              margin: 0,
            }}
          />
        );
      },
    },
    {
      header: null,
      widthClassName: "w-8",
      cellClassName: "py-1 px-2",
      align: "right",
      renderCell: (row, i) => (
        <SpreadsheetRemoveButton
          ariaLabel={`Remove line load ${i + 1}`}
          onClick={(e) => {
            e.stopPropagation();
            removeLineLoad(row.id);
          }}
        />
      ),
    },
  ];

  return (
    <div
      className="h-screen flex flex-col p-3"
      style={{
        background: "var(--color-vsc-bg)",
        color: "var(--color-vsc-text)",
      }}
    >
      <div className="pb-2">
        <h2 className="text-[12px] font-semibold">Line Loads</h2>
      </div>
      <div className="flex-1 overflow-y-auto pr-1">
        <SpreadsheetTable
          rows={lineLoads}
          columns={columns}
          getRowKey={(row) => row.id}
        />
        <button
          onClick={addLineLoad}
          className="text-[11px] mt-1 cursor-pointer hover:underline font-medium"
          style={{ color: "var(--color-vsc-accent)" }}
        >
          + Add Line Load
        </button>
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
