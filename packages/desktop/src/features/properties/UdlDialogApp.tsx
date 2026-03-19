import { useEffect, useRef, useState } from "react";
import { isElectron } from "../../utils/is-electron";
import { Label } from "../../components/ui/Label";
import {
  SpreadsheetRemoveButton,
  SpreadsheetTable,
  type SpreadsheetColumn,
} from "../../components/ui/SpreadsheetTable";
import { SpreadsheetExpressionInput } from "../../components/ui/SpreadsheetExpressionInput";
import { useAppStore } from "../../store/app-store";
import type { LineLoadRow, ParameterDef, UdlRow } from "../../store/types";
import { resolveParameters } from "../../utils/expression";

interface LoadsStatePayload {
  udls: UdlRow[];
  lineLoads: LineLoadRow[];
  parameters?: ParameterDef[];
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

export function UdlDialogApp() {
  const udls = useAppStore((s) => s.udls);
  const lineLoads = useAppStore((s) => s.lineLoads);
  const addUdl = useAppStore((s) => s.addUdl);
  const updateUdl = useAppStore((s) => s.updateUdl);
  const removeUdl = useAppStore((s) => s.removeUdl);
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
      } = {
        udls: normalized.udls,
        lineLoads: normalized.lineLoads,
      };

      if (Array.isArray(normalized.parameters)) {
        patch.parameters = normalized.parameters;
      }

      useAppStore.setState(patch);
      setIsHydrated(true);
    };

    window.cslope.onLoadsState(applyState);
    window.cslope.onLoadsChanged(applyState);
    window.cslope.requestLoadsState();

    return () => {
      window.cslope.offLoadsState(applyState);
      window.cslope.offLoadsChanged(applyState);
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

  const setUdlExpression = (
    row: UdlRow,
    field: "magnitude" | "x1" | "x2",
    expression: string | undefined,
  ) => {
    const nextExpressions = { ...(row.expressions ?? {}) };
    if (!expression || expression.trim().length === 0) {
      delete nextExpressions[field];
    } else {
      nextExpressions[field] = expression;
    }
    updateUdl(row.id, { expressions: nextExpressions });
  };

  const columns: SpreadsheetColumn<UdlRow>[] = [
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
      header: <Label>q (kPa)</Label>,
      renderCell: (row) => (
        <SpreadsheetExpressionInput
          value={row.magnitude}
          expression={row.expressions?.magnitude}
          vars={parameterValues}
          ariaLabel="UDL magnitude"
          onResolvedValue={(nextMagnitude) =>
            updateUdl(row.id, { magnitude: Math.max(0.1, nextMagnitude) })
          }
          onExpressionChange={(expr) =>
            setUdlExpression(row, "magnitude", expr)
          }
        />
      ),
    },
    {
      header: <Label>x1</Label>,
      renderCell: (row) => (
        <SpreadsheetExpressionInput
          value={row.x1}
          expression={row.expressions?.x1}
          vars={parameterValues}
          ariaLabel="UDL x1"
          onResolvedValue={(nextX1) => updateUdl(row.id, { x1: nextX1 })}
          onExpressionChange={(expr) => setUdlExpression(row, "x1", expr)}
        />
      ),
    },
    {
      header: <Label>x2</Label>,
      renderCell: (row) => (
        <SpreadsheetExpressionInput
          value={row.x2}
          expression={row.expressions?.x2}
          vars={parameterValues}
          ariaLabel="UDL x2"
          onResolvedValue={(nextX2) => updateUdl(row.id, { x2: nextX2 })}
          onExpressionChange={(expr) => setUdlExpression(row, "x2", expr)}
        />
      ),
    },
    {
      header: null,
      widthClassName: "w-8",
      cellClassName: "py-1 px-2",
      align: "right",
      renderCell: (row, i) => (
        <SpreadsheetRemoveButton
          ariaLabel={`Remove UDL ${i + 1}`}
          onClick={(e) => {
            e.stopPropagation();
            removeUdl(row.id);
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
        <h2 className="text-[12px] font-semibold">UDL</h2>
      </div>
      <div className="flex-1 overflow-y-auto pr-1">
        <SpreadsheetTable
          rows={udls}
          columns={columns}
          getRowKey={(row) => row.id}
        />
        <button
          onClick={addUdl}
          className="text-[11px] mt-1 cursor-pointer hover:underline font-medium"
          style={{ color: "var(--color-vsc-accent)" }}
        >
          + Add UDL
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
