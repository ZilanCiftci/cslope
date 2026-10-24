import { useEffect, useRef, useState, type ReactNode } from "react";
import { isElectron } from "../../utils/is-electron";
import { Label } from "../../components/ui/Label";
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
  PILE_DIRECTION_LABELS,
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
const PILE_TYPES = Object.keys(PILE_TYPE_LABELS) as PileType[];
const PILE_DIRECTIONS = Object.keys(PILE_DIRECTION_LABELS) as NonNullable<PileRow["direction"]>[];

/** Why the analysis would refuse a pile row, if it would. */
function pileProblem(p: PileRow): string | null {
  if (p.mode !== "ito-matsui") return null;
  if (Math.abs(p.x2 - p.x1) > 1e-6) return "Ito & Matsui needs a vertical pile (x1 = x2); give the force of an inclined pile.";
  if (!(p.spacing > p.diameter)) return "Ito & Matsui needs a spacing larger than the diameter; use a given force for a wall.";
  return null;
}

/**
 * A number as shown in a field: rounded to `digits` decimals when given
 * (coordinates computed by the app carry 15), otherwise without float noise.
 * Display only; the stored value is not changed.
 */
function formatNumber(value: number, digits?: number): string {
  const shown = digits === undefined ? Number(value.toPrecision(12)) : Number(value.toFixed(digits));
  return String(shown === 0 ? 0 : shown);
}

/** Point as shown in the lists: "x, y" with 2 decimals. */
function formatPoint(x: number, y: number): string {
  const f = (v: number) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);
  return `${f(x)}, ${f(y)}`;
}

/**
 * Text field for a number: accepts a decimal comma, applies each complete
 * value that `accept` allows, and marks the field while the text is not one.
 */
function NumberInput({
  value,
  ariaLabel,
  digits,
  accept,
  onValue,
}: {
  value: number;
  ariaLabel: string;
  digits?: number;
  accept?: (v: number) => boolean;
  onValue: (v: number) => void;
}) {
  // The user's text while the field has focus; the stored value otherwise.
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft ?? formatNumber(value, digits)}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      className="w-full"
      style={invalid ? { borderColor: "var(--color-vsc-error)" } : undefined}
      onFocus={() => setDraft(formatNumber(value, digits))}
      onChange={(e) => {
        const text = e.target.value.replace(/,/g, ".");
        setDraft(text);
        const v = Number(text);
        const ok = text.trim() !== "" && Number.isFinite(v) && (accept === undefined || accept(v));
        setInvalid(!ok);
        if (ok) onValue(v);
      }}
      onBlur={() => {
        setDraft(null);
        setInvalid(false);
      }}
    />
  );
}

/** Labelled form field; `span` columns of the 4-column detail grid. */
function Field({
  label,
  title,
  span = 1,
  children,
}: {
  label: string;
  title?: string;
  span?: 1 | 2 | 4;
  children: ReactNode;
}) {
  const spanClass = span === 4 ? "col-span-4" : span === 2 ? "col-span-2" : "";
  return (
    <label className={`flex flex-col gap-0.5 min-w-0 ${spanClass}`} title={title}>
      <Label>{label}</Label>
      {children}
    </label>
  );
}

function NumberField({
  label,
  title,
  span,
  ...input
}: {
  label: string;
  title?: string;
  span?: 1 | 2 | 4;
} & Parameters<typeof NumberInput>[0]) {
  return (
    <Field label={label} title={title} span={span}>
      <NumberInput {...input} />
    </Field>
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
      className="px-3 py-1.5 text-[11px] font-medium rounded border transition-colors cursor-pointer w-full"
      style={{
        background: disabled ? "transparent" : "var(--color-vsc-surface-tint)",
        color: disabled ? "var(--color-vsc-text-muted)" : "var(--color-vsc-text)",
        borderColor: "var(--color-vsc-border)",
        opacity: disabled ? 0.5 : 1,
      }}
      aria-disabled={disabled}
    >
      {children}
    </button>
  );
}

/** Compact list, one row per element, as in the Materials dialog. */
function ElementList<T extends { id: string }>({
  rows,
  headers,
  cells,
  selectedId,
  onSelect,
  empty,
}: {
  rows: T[];
  headers: string[];
  cells: (row: T, index: number) => ReactNode[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  empty: string;
}) {
  return (
    <div
      className="flex-1 min-w-0 rounded border overflow-auto max-h-[212px]"
      style={{ borderColor: "var(--color-vsc-border)" }}
    >
      <table className="w-full text-[11px] whitespace-nowrap">
        <thead className="sticky top-0" style={{ background: "var(--color-vsc-bg)" }}>
          <tr style={{ background: "var(--color-vsc-surface-tint)", color: "var(--color-vsc-text-muted)" }}>
            {headers.map((h) => (
              <th key={h} className="text-left px-2 py-1.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={headers.length} className="px-2 py-2" style={{ color: "var(--color-vsc-text-muted)" }}>
                {empty}
              </td>
            </tr>
          )}
          {rows.map((row, i) => {
            const isSelected = row.id === selectedId;
            return (
              <tr
                key={row.id}
                onClick={() => onSelect(row.id)}
                aria-selected={isSelected}
                className="cursor-pointer transition-colors"
                style={{
                  background: isSelected ? "var(--color-vsc-list-active)" : "transparent",
                  color: isSelected ? "var(--color-vsc-text-bright)" : "var(--color-vsc-text)",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = "var(--color-vsc-list-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = "transparent";
                }}
              >
                {cells(row, i).map((cell, k) => (
                  <td key={k} className="px-2 py-1 tabular-nums">
                    {cell}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DetailPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      className="p-3 rounded space-y-2"
      style={{ background: "var(--color-vsc-surface-tint)", border: "1px solid var(--color-vsc-border)" }}
    >
      <h4
        className="text-[10px] font-bold uppercase tracking-[0.1em]"
        style={{ color: "var(--color-vsc-text-muted)" }}
      >
        {title}
      </h4>
      {children}
    </div>
  );
}

const muted = { color: "var(--color-vsc-text-muted)" };

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
  const [selectedPileId, setSelectedPileId] = useState<string | null>(null);
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

  // The selection falls back to the first element, as in the Materials
  // dialog (also when the main window replaces the list).
  const selected = reinforcements.find((r) => r.id === selectedId) ?? reinforcements[0] ?? null;
  const selectedIndex = selected ? reinforcements.indexOf(selected) : -1;
  const pile = piles.find((p) => p.id === selectedPileId) ?? piles[0] ?? null;
  const pileIndex = pile ? piles.indexOf(pile) : -1;
  const update = (id: string, patch: Partial<ReinforcementRow>) => updateReinforcement(id, patch);

  const handleAdd = () => {
    addReinforcement(newType);
    const last = useAppStore.getState().reinforcements.at(-1);
    if (last) setSelectedId(last.id);
  };
  const handleDelete = () => {
    if (!selected) return;
    removeReinforcement(selected.id);
    const rest = useAppStore.getState().reinforcements;
    setSelectedId(rest[Math.min(selectedIndex, rest.length - 1)]?.id ?? null);
  };
  const handleAddPile = () => {
    addPile(newPileType);
    const last = useAppStore.getState().piles.at(-1);
    if (last) setSelectedPileId(last.id);
  };
  const handleDeletePile = () => {
    if (!pile) return;
    removePile(pile.id);
    const rest = useAppStore.getState().piles;
    setSelectedPileId(rest[Math.min(pileIndex, rest.length - 1)]?.id ?? null);
  };

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
        <p className="text-[10px]" style={muted}>
          End 1 is the head (at the face), end 2 the embedded end. Capacities per element; forces per metre are
          capacity / spacing (a geosynthetic sheet with S = 1: per metre of slope; partial coverage A: T × A).
        </p>
      </div>
      <div className="flex-1 overflow-y-auto pr-1 space-y-3">
        <section aria-label="Reinforcement elements" className="space-y-2">
          <div className="flex gap-3">
            <ElementList
              rows={reinforcements}
              headers={["#", "Type", "End 1 x, y (m)", "End 2 x, y (m)", "Length (m)", "T (kN)", "S (m)"]}
              cells={(r, i) => [
                <span style={muted}>{i + 1}</span>,
                REINFORCEMENT_TYPE_LABELS[r.type],
                formatPoint(r.x1, r.y1),
                formatPoint(r.x2, r.y2),
                Math.hypot(r.x2 - r.x1, r.y2 - r.y1).toFixed(2),
                formatNumber(r.tensileCapacity),
                formatNumber(r.spacing),
              ]}
              selectedId={selected?.id}
              onSelect={setSelectedId}
              empty="No reinforcement. Choose a type and click Add."
            />
            <div className="flex flex-col gap-1.5 w-44 shrink-0">
              <select
                value={newType}
                aria-label="Type of the new reinforcement"
                className="w-full"
                onChange={(e) => setNewType(e.target.value as ReinforcementType)}
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {REINFORCEMENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <DialogButton onClick={handleAdd}>Add</DialogButton>
              <DialogButton onClick={handleDelete} disabled={!selected}>
                Delete
              </DialogButton>
            </div>
          </div>

          {selected && (
            <DetailPanel key={selected.id} title={`Element ${selectedIndex + 1}: ${REINFORCEMENT_TYPE_LABELS[selected.type]}`}>
              <p className="text-[10px]" style={muted}>
                Length {length.toFixed(2)} m, inclination {angle.toFixed(1)}° below horizontal.
              </p>
              <div className="grid grid-cols-4 gap-x-3 gap-y-2 items-end">
                <Field label="Type" span={2}>
                  <select
                    value={selected.type}
                    aria-label="Reinforcement type"
                    className="w-full"
                    onChange={(e) => {
                      const type = e.target.value as ReinforcementType;
                      // A new type brings its own defaults; the geometry stays.
                      update(selected.id, { ...reinforcementPreset(type) });
                    }}
                  >
                    {TYPES.map((t) => (
                      <option key={t} value={t}>
                        {REINFORCEMENT_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </Field>
                <NumberField
                  label="Tensile capacity T (kN)"
                  title="Tensile capacity per element (strip, bar), kN; per metre of slope it is T / S. A geosynthetic sheet with partial coverage A: enter T × A per metre with S = 1."
                  value={selected.tensileCapacity}
                  ariaLabel="Tensile capacity"
                  accept={(v) => v >= 0}
                  onValue={(v) => update(selected.id, { tensileCapacity: v })}
                />
                <NumberField
                  label="Spacing S (m)"
                  title="Out-of-plane spacing between elements"
                  value={selected.spacing}
                  ariaLabel="Spacing"
                  accept={(v) => v >= 1e-6}
                  onValue={(v) => update(selected.id, { spacing: v })}
                />
                {(["x1", "y1", "x2", "y2"] as const).map((key) => (
                  <NumberField
                    key={key}
                    label={`End ${key[1]}${key[1] === "1" ? " (head)" : ""} ${key[0]} (m)`}
                    value={selected[key]}
                    digits={2}
                    ariaLabel={`Reinforcement ${key}`}
                    onValue={(v) => update(selected.id, { [key]: v })}
                  />
                ))}
                <Field label="Pullout" title="How the force develops along the element" span={2}>
                  <select
                    value={selected.pullout}
                    aria-label="Pullout"
                    className="w-full"
                    onChange={(e) => update(selected.id, { pullout: e.target.value as ReinforcementRow["pullout"] })}
                  >
                    <option value="none">None — ends fully anchored</option>
                    <option value="bond">Bond strength along the element</option>
                    <option value="interface">Interface friction (overburden)</option>
                    <option value="development">Development length from each end</option>
                  </select>
                </Field>
                {selected.pullout === "bond" && (
                  <>
                    <NumberField
                      label="Bond strength (kN/m)"
                      value={selected.bondStrength}
                      ariaLabel="Bond strength"
                      accept={(v) => v >= 0}
                      onValue={(v) => update(selected.id, { bondStrength: v })}
                    />
                    <NumberField
                      label="Bonded length, end 2 (m)"
                      title="0 = the whole element (soil nail)"
                      value={selected.bondedLength}
                      ariaLabel="Bonded length"
                      accept={(v) => v >= 0}
                      onValue={(v) => update(selected.id, { bondedLength: v })}
                    />
                  </>
                )}
                {selected.pullout === "interface" && (
                  <>
                    <NumberField
                      label="Adhesion a (kPa)"
                      title="r = 2·(a + σ′v·tan δ) per metre"
                      value={selected.adhesion}
                      ariaLabel="Adhesion"
                      accept={(v) => v >= 0}
                      onValue={(v) => update(selected.id, { adhesion: v })}
                    />
                    <NumberField
                      label="Interface friction δ (°)"
                      value={selected.interfaceFriction}
                      ariaLabel="Interface friction angle"
                      accept={(v) => v >= 0 && v < 90}
                      onValue={(v) => update(selected.id, { interfaceFriction: v })}
                    />
                  </>
                )}
                {selected.pullout === "development" && (
                  <>
                    <NumberField
                      label="Development length, end 1 (m)"
                      title="The tensile capacity develops linearly over this length; 0 = end fully anchored"
                      value={selected.developmentLength1 ?? 0}
                      ariaLabel="Development length at end 1"
                      accept={(v) => v >= 0}
                      onValue={(v) => update(selected.id, { developmentLength1: v })}
                    />
                    <NumberField
                      label="Development length, end 2 (m)"
                      title="The tensile capacity develops linearly over this length; 0 = end fully anchored"
                      value={selected.developmentLength2 ?? 0}
                      ariaLabel="Development length at end 2"
                      accept={(v) => v >= 0}
                      onValue={(v) => update(selected.id, { developmentLength2: v })}
                    />
                  </>
                )}
                {selected.pullout !== "none" && (
                  <>
                    <NumberField
                      label="Plate / connection, end 1 (kN)"
                      span={2}
                      value={selected.end1Capacity}
                      ariaLabel="End 1 capacity"
                      accept={(v) => v >= 0}
                      onValue={(v) => update(selected.id, { end1Capacity: v })}
                    />
                    <NumberField
                      label="Anchorage, end 2 (kN)"
                      span={2}
                      value={selected.end2Capacity}
                      ariaLabel="End 2 capacity"
                      accept={(v) => v >= 0}
                      onValue={(v) => update(selected.id, { end2Capacity: v })}
                    />
                  </>
                )}
                <Field
                  label="Force direction"
                  title="Axial: along the element (rigid). Tangent: along the slip surface (flexible)."
                  span={2}
                >
                  <select
                    value={selected.direction}
                    aria-label="Force direction"
                    className="w-full"
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
                  span={2}
                >
                  <select
                    value={selected.application}
                    aria-label="Force application"
                    className="w-full"
                    onChange={(e) => update(selected.id, { application: e.target.value as ReinforcementRow["application"] })}
                  >
                    <option value="active">Active (not divided by F)</option>
                    <option value="passive">Passive (divided by F)</option>
                  </select>
                </Field>
              </div>
            </DetailPanel>
          )}
        </section>

        <section aria-label="Piles and sheet piles" className="space-y-2 pt-2">
          <div>
            <h2 className="text-[12px] font-semibold">Piles and sheet piles</h2>
            <p className="text-[10px]" style={muted}>
              Shear against the sliding mass where the slip surface crosses the pile: tangent to the slip surface,
              perpendicular to the pile or at angle θ above horizontal. Ito &amp; Matsui needs a vertical pile and
              S &gt; D; the shear and moment capacities per pile limit the force (0 = no limit). Forces per metre are
              force / S.
            </p>
          </div>
          <div className="flex gap-3">
            <ElementList
              rows={piles}
              headers={["#", "Type", "End 1 x, y (m)", "End 2 x, y (m)", "Shear force"]}
              cells={(p, i) => [
                <span style={muted}>P{i + 1}</span>,
                PILE_TYPE_LABELS[p.type],
                formatPoint(p.x1, p.y1),
                formatPoint(p.x2, p.y2),
                p.mode === "force" ? `${formatNumber(p.force)} kN` : "Ito & Matsui",
              ]}
              selectedId={pile?.id}
              onSelect={setSelectedPileId}
              empty="No piles. Choose a type and click Add."
            />
            <div className="flex flex-col gap-1.5 w-44 shrink-0">
              <select
                value={newPileType}
                aria-label="Type of the new pile"
                className="w-full"
                onChange={(e) => setNewPileType(e.target.value as PileType)}
              >
                {PILE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PILE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <DialogButton onClick={handleAddPile}>Add</DialogButton>
              <DialogButton onClick={handleDeletePile} disabled={!pile}>
                Delete
              </DialogButton>
            </div>
          </div>
          {piles.map((p, i) => {
            const problem = pileProblem(p);
            return problem ? (
              <p key={p.id} role="alert" className="text-[10px]" style={{ color: "var(--color-vsc-error)" }}>
                P{i + 1}: {problem}
              </p>
            ) : null;
          })}

          {pile && (
            <DetailPanel key={pile.id} title={`P${pileIndex + 1}: ${PILE_TYPE_LABELS[pile.type]}`}>
              <div className="grid grid-cols-4 gap-x-3 gap-y-2 items-end">
                <Field label="Type" span={2}>
                  <select
                    value={pile.type}
                    aria-label="Pile type"
                    className="w-full"
                    onChange={(e) => {
                      // The values entered stay; a wall carries a given force per metre.
                      const type = e.target.value as PileType;
                      const preset = pilePreset(type);
                      updatePile(
                        pile.id,
                        type === "sheet-pile"
                          ? { type, mode: "force", spacing: 1, application: preset.application, direction: preset.direction }
                          : { type, application: preset.application, direction: preset.direction },
                      );
                    }}
                  >
                    {PILE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {PILE_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Shear force" span={2}>
                  <select
                    value={pile.mode}
                    aria-label="Pile force"
                    className="w-full"
                    onChange={(e) => updatePile(pile.id, { mode: e.target.value as PileRow["mode"] })}
                  >
                    <option value="force">Given force</option>
                    <option value="ito-matsui">Ito &amp; Matsui (from the soil)</option>
                  </select>
                </Field>
                {(["x1", "y1", "x2", "y2"] as const).map((key) => (
                  <NumberField
                    key={key}
                    label={`End ${key[1]}${key[1] === "1" ? " (top)" : ""} ${key[0]} (m)`}
                    value={pile[key]}
                    digits={2}
                    ariaLabel={`Pile ${key}`}
                    onValue={(v) => updatePile(pile.id, { [key]: v })}
                  />
                ))}
                {pile.mode === "force" ? (
                  <NumberField
                    label="Shear force V per pile (kN)"
                    span={2}
                    value={pile.force}
                    ariaLabel="Shear force per pile"
                    accept={(v) => v >= 0}
                    onValue={(v) => updatePile(pile.id, { force: v })}
                  />
                ) : (
                  <div className="col-span-2 flex flex-col gap-0.5">
                    <Label>Shear force V per pile (kN)</Label>
                    <span className="text-[11px] py-1" style={muted}>
                      From the soil (Ito &amp; Matsui)
                    </span>
                  </div>
                )}
                <NumberField
                  label="Diameter D (m)"
                  value={pile.diameter}
                  ariaLabel="Pile diameter"
                  accept={(v) => v >= 1e-6}
                  onValue={(v) => updatePile(pile.id, { diameter: v })}
                />
                <NumberField
                  label="Spacing S (m)"
                  title="Centre-to-centre spacing; 1 for a wall"
                  value={pile.spacing}
                  ariaLabel="Pile spacing"
                  accept={(v) => v >= 1e-6}
                  onValue={(v) => updatePile(pile.id, { spacing: v })}
                />
                <NumberField
                  label="Shear capacity Vcap (kN, 0 = no limit)"
                  title="Shear capacity per pile; 0 = no limit"
                  span={2}
                  value={pile.shearCapacity}
                  ariaLabel="Shear capacity per pile (0 = no limit)"
                  accept={(v) => v >= 0}
                  onValue={(v) => updatePile(pile.id, { shearCapacity: v })}
                />
                <NumberField
                  label="Moment capacity Mcap (kNm, 0 = no limit)"
                  title="Bending capacity per pile; 0 = no limit"
                  span={2}
                  value={pile.momentCapacity}
                  ariaLabel="Bending capacity per pile (0 = no limit)"
                  accept={(v) => v >= 0}
                  onValue={(v) => updatePile(pile.id, { momentCapacity: v })}
                />
                <Field
                  label="Direction"
                  title="Direction of the force on the sliding mass. Tangent to the slip surface is the usual default for passive supports."
                  span={2}
                >
                  <select
                    value={pile.direction ?? "angle"}
                    aria-label="Pile force direction"
                    className="w-full"
                    onChange={(e) => updatePile(pile.id, { direction: e.target.value as NonNullable<PileRow["direction"]> })}
                  >
                    {PILE_DIRECTIONS.map((d) => (
                      <option key={d} value={d}>
                        {PILE_DIRECTION_LABELS[d]}
                      </option>
                    ))}
                  </select>
                </Field>
                {(pile.direction ?? "angle") === "angle" ? (
                  <NumberField
                    label="Angle θ above horizontal (°)"
                    span={2}
                    value={pile.angle}
                    ariaLabel="Tilt of the pile force above horizontal"
                    accept={(v) => Math.abs(v) < 90}
                    onValue={(v) => updatePile(pile.id, { angle: v })}
                  />
                ) : (
                  <div className="col-span-2" />
                )}
                <Field
                  label="Application"
                  title="Active: a known (allowable) force, not divided by F. Passive: an ultimate capacity mobilised with the soil, divided by F."
                  span={2}
                >
                  <select
                    value={pile.application}
                    aria-label="Pile force application"
                    className="w-full"
                    onChange={(e) => updatePile(pile.id, { application: e.target.value as PileRow["application"] })}
                  >
                    <option value="active">Active (not divided by F)</option>
                    <option value="passive">Passive (divided by F)</option>
                  </select>
                </Field>
              </div>
            </DetailPanel>
          )}
        </section>
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
