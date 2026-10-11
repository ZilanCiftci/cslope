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
  ModelOrientation,
  ParameterDef,
  PileRow,
  PileType,
  ReinforcementRow,
  ReinforcementType,
  UdlRow,
} from "../../store/types";
import {
  PILE_TYPE_LABELS,
  REINFORCEMENT_TYPE_LABELS,
  pilePreset,
  reinforcementPreset,
} from "../../utils/reinforcement";

interface LoadsStatePayload {
  udls: UdlRow[];
  lineLoads: LineLoadRow[];
  reinforcements?: ReinforcementRow[];
  piles?: PileRow[];
  parameters?: ParameterDef[];
  /** From the main window: where a new element is placed. */
  coordinates?: [number, number][];
  orientation?: ModelOrientation;
}

const TYPES = Object.keys(REINFORCEMENT_TYPE_LABELS) as ReinforcementType[];

/** Why the analysis would refuse a pile row, if it would. */
function pileProblem(p: PileRow): string | null {
  if (p.mode !== "ito-matsui") return null;
  if (Math.abs(p.x2 - p.x1) > 1e-6) return "Ito & Matsui needs a vertical pile (x1 = x2); give the force of an inclined pile.";
  if (!(p.spacing > p.diameter)) return "Ito & Matsui needs a spacing larger than the diameter; use a given force for a wall.";
  return null;
}

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
  const piles = useAppStore((s) => s.piles);
  const addPile = useAppStore((s) => s.addPile);
  const updatePile = useAppStore((s) => s.updatePile);
  const removePile = useAppStore((s) => s.removePile);
  const [newPileType, setNewPileType] = useState<PileType>("pile");
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
        ...(Array.isArray(next.piles) ? { piles: next.piles } : {}),
        ...(Array.isArray(next.parameters) ? { parameters: next.parameters } : {}),
        ...(Array.isArray(next.coordinates) ? { coordinates: next.coordinates } : {}),
        ...(next.orientation === "ltr" || next.orientation === "rtl" ? { orientation: next.orientation } : {}),
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
    window.cslope.sendLoadsChanged({ udls, lineLoads, reinforcements, piles, parameters });
  }, [udls, lineLoads, reinforcements, piles, parameters, isHydrated]);

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
      header: (
        <Label title="Tensile capacity per element (strip, bar), kN; per metre of slope it is T / S. A geosynthetic sheet with partial coverage A: enter T × A per metre with S = 1.">
          T (kN)
        </Label>
      ),
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

  const pileColumns: SpreadsheetColumn<PileRow>[] = [
    {
      header: <Label>#</Label>,
      widthClassName: "w-8",
      cellClassName: "py-1 px-2",
      renderCell: (_row, i) => (
        <span style={{ color: "var(--color-vsc-text-muted)", fontSize: "10px" }}>P{i + 1}</span>
      ),
    },
    {
      header: <Label>Type</Label>,
      renderCell: (row) => (
        <select
          value={row.type}
          aria-label="Pile type"
          className="w-full text-[11px] py-1"
          onChange={(e) => {
            // The values entered stay; a wall carries a given force per metre.
            const type = e.target.value as PileType;
            const preset = pilePreset(type);
            updatePile(row.id, type === "sheet-pile" ? { type, mode: "force", spacing: 1 } : { type, application: preset.application });
          }}
        >
          {(Object.keys(PILE_TYPE_LABELS) as PileType[]).map((t) => (
            <option key={t} value={t}>
              {PILE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      ),
    },
    ...(["x1", "y1", "x2", "y2"] as const).map(
      (key): SpreadsheetColumn<PileRow> => ({
        header: <Label>{key}</Label>,
        renderCell: (row) => (
          <NumberCell value={row[key]} label={`Pile ${key}`} onValue={(v) => updatePile(row.id, { [key]: v })} />
        ),
      }),
    ),
    {
      header: <Label>Force</Label>,
      renderCell: (row) => (
        <select
          value={row.mode}
          aria-label="Pile force"
          className="w-full text-[11px] py-1"
          onChange={(e) => updatePile(row.id, { mode: e.target.value as PileRow["mode"] })}
        >
          <option value="force">Given</option>
          <option value="ito-matsui">Ito &amp; Matsui</option>
        </select>
      ),
    },
    {
      header: <Label>V (kN)</Label>,
      renderCell: (row) =>
        row.mode === "force" ? (
          <NumberCell value={row.force} label="Shear force per pile" min={0} onValue={(v) => updatePile(row.id, { force: v })} />
        ) : (
          <span className="px-2 text-[10px]" style={{ color: "var(--color-vsc-text-muted)" }}>
            from soil
          </span>
        ),
    },
    {
      header: <Label>D (m)</Label>,
      renderCell: (row) => (
        <NumberCell value={row.diameter} label="Pile diameter" min={1e-6} onValue={(v) => updatePile(row.id, { diameter: v })} />
      ),
    },
    {
      header: <Label>S (m)</Label>,
      renderCell: (row) => (
        <NumberCell value={row.spacing} label="Pile spacing" min={1e-6} onValue={(v) => updatePile(row.id, { spacing: v })} />
      ),
    },
    {
      header: <Label>Vcap</Label>,
      renderCell: (row) => (
        <NumberCell value={row.shearCapacity} label="Shear capacity per pile (0 = no limit)" min={0} onValue={(v) => updatePile(row.id, { shearCapacity: v })} />
      ),
    },
    {
      header: <Label>Mcap</Label>,
      renderCell: (row) => (
        <NumberCell value={row.momentCapacity} label="Bending capacity per pile (0 = no limit)" min={0} onValue={(v) => updatePile(row.id, { momentCapacity: v })} />
      ),
    },
    {
      header: <Label>θ (°)</Label>,
      renderCell: (row) => (
        <NumberCell
          value={row.angle}
          label="Tilt of the pile force above horizontal"
          onValue={(v) => Math.abs(v) < 90 && updatePile(row.id, { angle: v })}
        />
      ),
    },
    {
      header: <Label>Appl.</Label>,
      renderCell: (row) => (
        <select
          value={row.application}
          aria-label="Pile force application"
          className="w-full text-[11px] py-1"
          onChange={(e) => updatePile(row.id, { application: e.target.value as PileRow["application"] })}
        >
          <option value="active">Active</option>
          <option value="passive">Passive /F</option>
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
          ariaLabel={`Remove pile ${i + 1}`}
          onClick={(e) => {
            e.stopPropagation();
            removePile(row.id);
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
          capacity / spacing (a geosynthetic sheet with S = 1: per metre of slope; partial coverage A: T × A).
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
        <div className="mt-5">
          <h2 className="text-[12px] font-semibold">Piles and sheet piles</h2>
          <p className="text-[10px] pb-1" style={{ color: "var(--color-vsc-text-muted)" }}>
            Shear against the sliding mass where the slip surface crosses the pile (horizontal). Ito &amp; Matsui needs a
            vertical pile and S &gt; D; Vcap/Mcap per pile limit the force (0 = no limit). Forces per metre are force / S.
          </p>
          <SpreadsheetTable rows={piles} columns={pileColumns} getRowKey={(row) => row.id} />
          {piles.map((p, i) => {
            const problem = pileProblem(p);
            return problem ? (
              <p key={p.id} className="text-[10px] mt-1" style={{ color: "#c62828" }}>
                P{i + 1}: {problem}
              </p>
            ) : null;
          })}
          <div className="flex items-center gap-2 mt-1">
            <select
              value={newPileType}
              aria-label="Type of the new pile"
              className="text-[11px] py-0.5"
              onChange={(e) => setNewPileType(e.target.value as PileType)}
            >
              {(Object.keys(PILE_TYPE_LABELS) as PileType[]).map((t) => (
                <option key={t} value={t}>
                  {PILE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <button
              onClick={() => addPile(newPileType)}
              className="text-[11px] cursor-pointer hover:underline font-medium"
              style={{ color: "var(--color-vsc-accent)" }}
            >
              + Add
            </button>
          </div>
        </div>
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
