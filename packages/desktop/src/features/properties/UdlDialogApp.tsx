import { useEffect, useRef, useState } from "react";
import { isElectron } from "../../utils/is-electron";
import { Label } from "../../components/ui/Label";
import {
  SpreadsheetNumberInput,
  SpreadsheetRemoveButton,
  SpreadsheetTable,
  type SpreadsheetColumn,
} from "../../components/ui/SpreadsheetTable";
import { useAppStore } from "../../store/app-store";
import type { LineLoadRow, UdlRow } from "../../store/types";

interface LoadsStatePayload {
  udls: UdlRow[];
  lineLoads: LineLoadRow[];
}

export function UdlDialogApp() {
  const udls = useAppStore((s) => s.udls);
  const lineLoads = useAppStore((s) => s.lineLoads);
  const addUdl = useAppStore((s) => s.addUdl);
  const updateUdl = useAppStore((s) => s.updateUdl);
  const removeUdl = useAppStore((s) => s.removeUdl);
  const [isHydrated, setIsHydrated] = useState(!isElectron);
  const suppressNextBroadcastRef = useRef(false);

  useEffect(() => {
    if (!isElectron) return;

    const applyState = (_event: unknown, next: LoadsStatePayload) => {
      suppressNextBroadcastRef.current = true;
      useAppStore.setState({
        udls: next.udls,
        lineLoads: next.lineLoads,
      });
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

    window.cslope.sendLoadsChanged({ udls, lineLoads });
  }, [udls, lineLoads, isHydrated]);

  const clampNumber = (value: string, min: number) => {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) return min;
    return parsed < min ? min : parsed;
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
        <SpreadsheetNumberInput
          value={row.magnitude}
          step="1"
          ariaLabel="UDL magnitude"
          onChange={(v) => updateUdl(row.id, { magnitude: parseFloat(v) || 0 })}
          onBlur={(v) => updateUdl(row.id, { magnitude: clampNumber(v, 0.1) })}
        />
      ),
    },
    {
      header: <Label>x1</Label>,
      renderCell: (row) => (
        <SpreadsheetNumberInput
          value={row.x1}
          ariaLabel="UDL x1"
          onChange={(v) => updateUdl(row.id, { x1: parseFloat(v) || 0 })}
        />
      ),
    },
    {
      header: <Label>x2</Label>,
      renderCell: (row) => (
        <SpreadsheetNumberInput
          value={row.x2}
          ariaLabel="UDL x2"
          onChange={(v) => updateUdl(row.id, { x2: parseFloat(v) || 0 })}
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
