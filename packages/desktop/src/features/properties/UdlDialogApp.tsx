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
  /** From the main window: keeps new loads inside the model. */
  coordinates?: [number, number][];
  /** From the main window: names the materials of excess pore pressure. */
  materialNames?: { id: string; name: string }[];
}

/** A percentage for the notes, without trailing zeros. */
const percent = (ratio: number) => `${Number((ratio * 100).toFixed(1))} %`;

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
  const storeMaterials = useAppStore((s) => s.materials);
  // In a separate window the materials come with the loads.
  const [sentMaterialNames, setSentMaterialNames] = useState<{ id: string; name: string }[] | null>(null);
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
      if (Array.isArray(normalized.materialNames)) setSentMaterialNames(normalized.materialNames);
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
  const materialName = new Map((sentMaterialNames ?? storeMaterials).map((m) => [m.id, m.name]));

  /** Remove one material's excess pore pressure from a load (it then consolidates fully). */
  const removeExcess = (row: UdlRow, materialId: string) => {
    const rest = (row.excessPorePressure ?? []).filter((e) => e.materialId !== materialId);
    updateUdl(row.id, { excessPorePressure: rest.length > 0 ? rest : undefined });
  };
  const excessNotes = udls.flatMap((row, i) =>
    (row.excessPorePressure ?? [])
      .filter((e) => materialName.has(e.materialId))
      .map((e) => ({ row, i, entry: e, name: materialName.get(e.materialId) ?? "" })),
  );

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
      header: (
        <Label title="Pressure between x1 and x2: vertical, per horizontal metre; or normal to the ground, per metre of ground">
          q (kPa)
        </Label>
      ),
      widthClassName: "w-[22%]",
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
      header: <Label title="Start of the load">x1 (m)</Label>,
      widthClassName: "w-[22%]",
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
      header: <Label title="End of the load">x2 (m)</Label>,
      widthClassName: "w-[22%]",
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
      header: (
        <Label title="Vertical, or normal to the ground: water or earth pressure against a slope, which also pushes horizontally into it">
          Direction
        </Label>
      ),
      widthClassName: "w-[24%]",
      renderCell: (row, i) => (
        <select
          value={row.direction ?? "vertical"}
          onChange={(e) => updateUdl(row.id, { direction: e.target.value === "normal" ? "normal" : undefined })}
          aria-label={`UDL ${i + 1} direction`}
          className="w-full text-[11px]"
        >
          <option value="vertical">Vertical</option>
          <option value="normal">Normal to ground</option>
        </select>
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
        <h2 className="text-[12px] font-semibold">Distributed loads</h2>
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
          + Add load
        </button>
        {excessNotes.length > 0 && (
          <div className="mt-3 space-y-1" data-testid="udl-excess-notes">
            <div className="text-[11px] font-medium">Loads not yet consolidated (imported)</div>
            {excessNotes.map(({ row, i, entry, name }) => (
              <div
                key={`${row.id}-${entry.materialId}`}
                role="note"
                className="flex items-center gap-2 text-[11px]"
              >
                <span className="flex-1">
                  UDL {i + 1}, not consolidated: Material "{name}" {percent(entry.ratio)} of q (excess pore pressure below the water)
                </span>
                <button
                  type="button"
                  onClick={() => removeExcess(row, entry.materialId)}
                  className="px-2 py-0.5 text-[11px] font-medium rounded border cursor-pointer flex-shrink-0"
                  style={{
                    background: "var(--color-vsc-surface-tint)",
                    color: "var(--color-vsc-text)",
                    borderColor: "var(--color-vsc-border)",
                  }}
                  aria-label={`Remove the excess pore pressure of UDL ${i + 1} in Material "${name}"`}
                  title="Treat the load as fully consolidated in this material"
                >
                  Remove
                </button>
              </div>
            ))}
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
