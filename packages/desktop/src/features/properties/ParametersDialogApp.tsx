import { useEffect, useMemo, useRef, useState } from "react";
import { Label } from "../../components/ui/Label";
import {
  SpreadsheetRemoveButton,
  SpreadsheetTable,
  type SpreadsheetColumn,
} from "../../components/ui/SpreadsheetTable";
import { useAppStore } from "../../store/app-store";
import type { ParameterDef } from "../../store/types";
import { isElectron } from "../../utils/is-electron";
import { resolveParameters } from "../../utils/expression";

interface ParametersStatePayload {
  parameters: ParameterDef[];
}

export function ParametersDialogApp() {
  const parameters = useAppStore((s) => s.parameters);
  const setParameters = useAppStore((s) => s.setParameters);
  const addParameter = useAppStore((s) => s.addParameter);
  const removeParameter = useAppStore((s) => s.removeParameter);

  const [isHydrated, setIsHydrated] = useState(!isElectron);
  const suppressNextBroadcastRef = useRef(false);

  useEffect(() => {
    if (!isElectron) return;

    const applyState = (_event: unknown, next: ParametersStatePayload) => {
      suppressNextBroadcastRef.current = true;
      setParameters(next.parameters);
      setIsHydrated(true);
    };

    window.cslope.onParametersState(applyState);
    window.cslope.onParametersChanged(applyState);
    window.cslope.requestParametersState();

    return () => {
      window.cslope.offParametersState(applyState);
      window.cslope.offParametersChanged(applyState);
    };
  }, [setParameters]);

  useEffect(() => {
    if (!isElectron || !isHydrated) return;

    if (suppressNextBroadcastRef.current) {
      suppressNextBroadcastRef.current = false;
      return;
    }

    window.cslope.sendParametersChanged({ parameters });
  }, [isHydrated, parameters]);

  const resolution = useMemo(() => resolveParameters(parameters), [parameters]);

  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of parameters) {
      const name = p.name.trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return counts;
  }, [parameters]);

  const updateParam = (id: string, patch: Partial<ParameterDef>) => {
    setParameters(
      parameters.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  };

  const columns: SpreadsheetColumn<ParameterDef>[] = [
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
      header: <Label>Name</Label>,
      renderCell: (row) => {
        const trimmed = row.name.trim();
        const hasDuplicate =
          !!trimmed && (duplicateNames.get(trimmed) ?? 0) > 1;
        const hasError =
          hasDuplicate || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed);

        return (
          <input
            type="text"
            value={row.name}
            onChange={(e) => updateParam(row.id, { name: e.target.value })}
            className="w-full h-full py-1 px-2 text-[12px] outline-none border-2 border-transparent focus:border-[var(--color-vsc-accent)]"
            style={{
              background: "var(--color-vsc-input-bg)",
              color: "var(--color-vsc-text)",
              borderRadius: 0,
              boxShadow: "none",
              margin: 0,
              borderColor: hasError ? "var(--color-vsc-error)" : "transparent",
            }}
            aria-label="Parameter name"
          />
        );
      },
    },
    {
      header: <Label>Value</Label>,
      renderCell: (row) => (
        <input
          type="text"
          value={row.expression}
          onChange={(e) => updateParam(row.id, { expression: e.target.value })}
          className="w-full h-full py-1 px-2 text-[12px] outline-none border-2 border-transparent focus:border-[var(--color-vsc-accent)]"
          style={{
            background: "var(--color-vsc-input-bg)",
            color: "var(--color-vsc-text)",
            borderRadius: 0,
            boxShadow: "none",
            margin: 0,
          }}
          aria-label="Parameter expression"
        />
      ),
    },
    {
      header: <Label>Resolved</Label>,
      cellClassName: "py-1 px-2",
      renderCell: (row) => {
        const key = row.name.trim();
        const value = key ? resolution.resolved[key] : undefined;
        const error = key ? resolution.errors[key] : "Parameter name is empty.";

        if (typeof value === "number" && Number.isFinite(value)) {
          return (
            <span
              className="text-[11px]"
              style={{ color: "var(--color-vsc-text)" }}
            >
              {value}
            </span>
          );
        }

        return (
          <span
            className="text-[10px]"
            style={{ color: "var(--color-vsc-error)" }}
          >
            {error ?? "Invalid expression"}
          </span>
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
          ariaLabel={`Remove parameter ${i + 1}`}
          onClick={(e) => {
            e.stopPropagation();
            removeParameter(row.id);
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
        <h2 className="text-[12px] font-semibold">Parameters</h2>
        <p
          className="text-[10px] mt-0.5"
          style={{ color: "var(--color-vsc-text-muted)" }}
        >
          Define named variables and reuse them in coordinates and material
          properties.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto pr-1 space-y-2.5">
        <SpreadsheetTable
          rows={parameters}
          columns={columns}
          getRowKey={(row) => row.id}
        />

        <button
          onClick={addParameter}
          className="text-[11px] mt-1 cursor-pointer hover:underline font-medium"
          style={{ color: "var(--color-vsc-accent)" }}
        >
          + Add Parameter
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
