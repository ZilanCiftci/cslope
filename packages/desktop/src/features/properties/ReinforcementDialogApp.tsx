import { useEffect, useRef, useState, type ReactNode } from "react";
import { isElectron } from "../../utils/is-electron";
import { Label } from "../../components/ui/Label";
import {
  SpreadsheetNumberInput,
  SpreadsheetRemoveButton,
  SpreadsheetTable,
  type SpreadsheetColumn,
} from "../../components/ui/SpreadsheetTable";
import { useAppStore } from "../../store/app-store";
import type {
  LineLoadRow,
  ParameterDef,
  ReinforcementRow,
  ReinforcementType,
  UdlRow,
} from "../../store/types";
import {
  REINFORCEMENT_TYPE_LABELS,
  reinforcementPreset,
} from "../../utils/reinforcement";

interface LoadsStatePayload {
  udls: UdlRow[];
  lineLoads: LineLoadRow[];
  reinforcements?: ReinforcementRow[];
  parameters?: ParameterDef[];
}

const TYPES = Object.keys(REINFORCEMENT_TYPE_LABELS) as ReinforcementType[];

/** Number cell: applies finite values (≥ min when given). */
function NumberCell({
  value,
  label,
  min,
  onValue,
}: {
  value: number;
  label: string;
  min?: number;
  onValue: (v: number) => void;
}) {
  return (
    <SpreadsheetNumberInput
      value={value}
      ariaLabel={label}
      onChange={(text) => {
        const v = Number(text);
        if (text.trim() !== "" && Number.isFinite(v) && (min === undefined || v >= min)) onValue(v);
      }}
    />
  );
}

function Field({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-[11px]" title={title}>
      <span className="w-44 shrink-0" style={{ color: "var(--color-vsc-text-muted)" }}>
        {label}
      </span>
      <span className="flex-1 border rounded-sm" style={{ borderColor: "var(--color-vsc-border)" }}>
        {children}
      </span>
    </label>
  );
}

export function ReinforcementDialogApp() {
  const udls = useAppStore((s) => s.udls);
  const lineLoads = useAppStore((s) => s.lineLoads);
  const reinforcements = useAppStore((s) => s.reinforcements);
  const parameters = useAppStore((s) => s.parameters);
  const addReinforcement = useAppStore((s) => s.addReinforcement);
  const updateReinforcement = useAppStore((s) => s.updateReinforcement);
  const removeReinforcement = useAppStore((s) => s.removeReinforcement);
  const [isHydrated, setIsHydrated] = useState(!isElectron);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newType, setNewType] = useState<ReinforcementType>("anchor");
  const suppressNextBroadcastRef = useRef(false);

  useEffect(() => {
    if (!isElectron) return;
    const applyState = (_event: unknown, next: LoadsStatePayload) => {
      if (!next || !Array.isArray(next.udls) || !Array.isArray(next.lineLoads)) return;
      suppressNextBroadcastRef.current = true;
      useAppStore.setState({
        udls: next.udls,
        lineLoads: next.lineLoads,
        // The UDL and line-load windows send no reinforcement.
        ...(Array.isArray(next.reinforcements) ? { reinforcements: next.reinforcements } : {}),
        ...(Array.isArray(next.parameters) ? { parameters: next.parameters } : {}),
      });
      setIsHydrated(true);
    };
    const unsubscribeState = window.cslope.onLoadsState(applyState);
    const unsubscribeChanged = window.cslope.onLoadsChanged(applyState);
    window.cslope.requestLoadsState();
    return () => {
      unsubscribeState();
      unsubscribeChanged();
    };
  }, []);

  useEffect(() => {
    if (!isElectron || !isHydrated) return;
    if (suppressNextBroadcastRef.current) {
      suppressNextBroadcastRef.current = false;
      return;
    }
    window.cslope.sendLoadsChanged({ udls, lineLoads, reinforcements, parameters });
  }, [udls, lineLoads, reinforcements, parameters, isHydrated]);

  const selected = reinforcements.find((r) => r.id === selectedId) ?? null;
  const update = (id: string, patch: Partial<ReinforcementRow>) => updateReinforcement(id, patch);

  const columns: SpreadsheetColumn<ReinforcementRow>[] = [
    {
      header: <Label>#</Label>,
      widthClassName: "w-8",
      cellClassName: "py-1 px-2",
      renderCell: (_row, i) => (
        <span style={{ color: "var(--color-vsc-text-muted)", fontSize: "10px" }}>{i + 1}</span>
      ),
    },
    {
      header: <Label>Type</Label>,
      renderCell: (row) => (
        <select
          value={row.type}
          aria-label="Reinforcement type"
          className="w-full text-[11px] py-1"
          onChange={(e) => {
            const type = e.target.value as ReinforcementType;
            // A new type brings its own defaults; the geometry stays.
            update(row.id, { ...reinforcementPreset(type) });
          }}
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {REINFORCEMENT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      ),
    },
    ...(["x1", "y1", "x2", "y2"] as const).map(
      (key): SpreadsheetColumn<ReinforcementRow> => ({
        header: <Label>{key}</Label>,
        renderCell: (row) => (
          <NumberCell value={row[key]} label={`Reinforcement ${key}`} onValue={(v) => update(row.id, { [key]: v })} />
        ),
      }),
    ),
    {
      header: <Label>T (kN)</Label>,
      renderCell: (row) => (
        <NumberCell
          value={row.tensileCapacity}
          label="Tensile capacity"
          min={0}
          onValue={(v) => update(row.id, { tensileCapacity: v })}
        />
      ),
    },
    {
      header: <Label>S (m)</Label>,
      renderCell: (row) => (
        <NumberCell
          value={row.spacing}
          label="Spacing"
          min={1e-6}
          onValue={(v) => update(row.id, { spacing: v })}
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
          ariaLabel={`Remove reinforcement ${i + 1}`}
          onClick={(e) => {
            e.stopPropagation();
            if (selectedId === row.id) setSelectedId(null);
            removeReinforcement(row.id);
          }}
        />
      ),
    },
  ];

  const length = selected ? Math.hypot(selected.x2 - selected.x1, selected.y2 - selected.y1) : 0;
  const angle = selected
    ? (Math.atan2(selected.y1 - selected.y2, Math.abs(selected.x2 - selected.x1)) * 180) / Math.PI
    : 0;

  return (
    <div
      className="h-screen flex flex-col p-3"
      style={{ background: "var(--color-vsc-bg)", color: "var(--color-vsc-text)" }}
    >
      <div className="pb-2">
        <h2 className="text-[12px] font-semibold">Reinforcement</h2>
        <p className="text-[10px]" style={{ color: "var(--color-vsc-text-muted)" }}>
          End 1 is the head (at the face), end 2 the embedded end. Capacities per element; forces per metre are
          capacity / spacing.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto pr-1">
        <SpreadsheetTable
          rows={reinforcements}
          columns={columns}
          getRowKey={(row) => row.id}
          selectedRowIndex={selected ? reinforcements.indexOf(selected) : null}
          onRowClick={(row) => setSelectedId(row.id)}
        />
        <div className="flex items-center gap-2 mt-1">
          <select
            value={newType}
            aria-label="Type of the new reinforcement"
            className="text-[11px] py-0.5"
            onChange={(e) => setNewType(e.target.value as ReinforcementType)}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {REINFORCEMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <button
            onClick={() => addReinforcement(newType)}
            className="text-[11px] cursor-pointer hover:underline font-medium"
            style={{ color: "var(--color-vsc-accent)" }}
          >
            + Add
          </button>
        </div>

        {selected && (
          <div className="mt-4 flex flex-col gap-1.5">
            <h3 className="text-[11px] font-semibold">
              Element {reinforcements.indexOf(selected) + 1}: {REINFORCEMENT_TYPE_LABELS[selected.type]}
            </h3>
            <p className="text-[10px]" style={{ color: "var(--color-vsc-text-muted)" }}>
              Length {length.toFixed(2)} m, inclination {angle.toFixed(1)}° below horizontal.
            </p>
            <Field label="Pullout" title="How the force develops along the element">
              <select
                value={selected.pullout}
                aria-label="Pullout"
                className="w-full text-[11px] py-1"
                onChange={(e) => update(selected.id, { pullout: e.target.value as ReinforcementRow["pullout"] })}
              >
                <option value="none">None — ends fully anchored</option>
                <option value="bond">Bond strength along the element</option>
                <option value="interface">Interface friction (overburden)</option>
              </select>
            </Field>
            {selected.pullout === "bond" && (
              <>
                <Field label="Bond strength (kN/m)">
                  <NumberCell value={selected.bondStrength} label="Bond strength" min={0} onValue={(v) => update(selected.id, { bondStrength: v })} />
                </Field>
                <Field label="Bonded length at end 2 (m)" title="0 = the whole element (soil nail)">
                  <NumberCell value={selected.bondedLength} label="Bonded length" min={0} onValue={(v) => update(selected.id, { bondedLength: v })} />
                </Field>
              </>
            )}
            {selected.pullout === "interface" && (
              <>
                <Field label="Adhesion a (kPa)" title="r = 2·(a + σ′v·tan δ) per metre">
                  <NumberCell value={selected.adhesion} label="Adhesion" min={0} onValue={(v) => update(selected.id, { adhesion: v })} />
                </Field>
                <Field label="Interface friction δ (°)">
                  <NumberCell
                    value={selected.interfaceFriction}
                    label="Interface friction angle"
                    min={0}
                    onValue={(v) => v < 90 && update(selected.id, { interfaceFriction: v })}
                  />
                </Field>
              </>
            )}
            {selected.pullout !== "none" && (
              <>
                <Field label="Plate / connection at end 1 (kN)">
                  <NumberCell value={selected.end1Capacity} label="End 1 capacity" min={0} onValue={(v) => update(selected.id, { end1Capacity: v })} />
                </Field>
                <Field label="Anchorage at end 2 (kN)">
                  <NumberCell value={selected.end2Capacity} label="End 2 capacity" min={0} onValue={(v) => update(selected.id, { end2Capacity: v })} />
                </Field>
              </>
            )}
            <Field label="Force direction" title="Axial: along the element (rigid). Tangent: along the slip surface (flexible).">
              <select
                value={selected.direction}
                aria-label="Force direction"
                className="w-full text-[11px] py-1"
                onChange={(e) => update(selected.id, { direction: e.target.value as ReinforcementRow["direction"] })}
              >
                <option value="axial">Along the element</option>
                <option value="tangent">Tangent to the slip surface</option>
                <option value="bisector">Bisector of the two</option>
              </select>
            </Field>
            <Field
              label="Application"
              title="Active: a known (allowable) force, not divided by F. Passive: an ultimate capacity mobilised with the soil, divided by F."
            >
              <select
                value={selected.application}
                aria-label="Force application"
                className="w-full text-[11px] py-1"
                onChange={(e) => update(selected.id, { application: e.target.value as ReinforcementRow["application"] })}
              >
                <option value="active">Active (not divided by F)</option>
                <option value="passive">Passive (divided by F)</option>
              </select>
            </Field>
          </div>
        )}
      </div>
      <div className="pt-3 mt-2 border-t" style={{ borderColor: "var(--color-vsc-border)" }}>
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
