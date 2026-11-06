import { useEffect, useMemo, useRef, useState } from "react";
import { Label } from "../../components/ui/Label";
import {
  SpreadsheetTable,
  type SpreadsheetColumn,
} from "../../components/ui/SpreadsheetTable";
import { CELL_EDITOR_CLASS, cellEditorStyle } from "../../components/ui/cell-editor";
import { useAppStore } from "../../store/app-store";
import type { ParameterDef } from "../../store/types";
import { isElectron } from "../../utils/is-electron";
import { resolveParameters } from "../../utils/expression";
import { DialogHeader } from "./DialogHeader";

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

    const unsubscribeParametersState = window.cslope.onParametersState(applyState);
    const unsubscribeParametersChanged = window.cslope.onParametersChanged(applyState);
    window.cslope.requestParametersState();

    return () => {
      unsubscribeParametersState();
      unsubscribeParametersChanged();
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

  const sortedParameters = useMemo(() => {
    const normalized = (name: string) => name.trim().toLocaleLowerCase();
    return [...parameters].sort((a, b) => {
      const aName = normalized(a.name);
      const bName = normalized(b.name);

      // Keep unnamed/new parameters at the bottom by default.
      const aEmpty = aName.length === 0;
      const bEmpty = bName.length === 0;
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;

      const byName = aName.localeCompare(bName);
      if (byName !== 0) return byName;
      return a.id.localeCompare(b.id);
    });
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
            className={CELL_EDITOR_CLASS}
            style={{
              ...cellEditorStyle,
              borderColor: hasError ? "var(--color-vsc-error)" : undefined,
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
          className={CELL_EDITOR_CLASS}
          style={{
            ...cellEditorStyle,
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
  ];

  return (
    <div
      className="h-screen flex flex-col p-3"
      style={{
        background: "var(--color-vsc-bg)",
        color: "var(--color-vsc-text)",
      }}
    >
      <DialogHeader
        title="Parameters"
        description="Named values to use in coordinates and material properties."
      />

      <div className="flex-1 overflow-y-auto pr-1 space-y-2.5">
        <SpreadsheetTable
          rows={sortedParameters}
          columns={columns}
          getRowKey={(row) => row.id}
          emptyText="No parameters."
          onRemove={(row) => removeParameter(row.id)}
          removeLabel={(_row, i) => `Remove parameter ${i + 1}`}
          addActions={[{ label: "+ Add parameter", onClick: addParameter }]}
        />
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
