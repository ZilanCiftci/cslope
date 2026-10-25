import { useRef, useState } from "react";
import { useAppStore } from "../../../store/app-store";
import { Label } from "../../../components/ui/Label";
import { DraftNumberInput } from "../../../components/ui/DraftNumberInput";
import { formatPolyline, parsePolyline } from "../../../utils/polyline";
import { blockObjectKind, blockObjectProblem } from "../../../utils/block-search";

/**
 * Block search settings: the angle ranges of the end segments and the
 * search objects the surfaces pass through.
 */
export function BlockSearchSection() {
  const objects = useAppStore((s) => s.blockSearchObjects);
  const options = useAppStore((s) => s.options);
  const setOptions = useAppStore((s) => s.setOptions);
  const addObject = useAppStore((s) => s.addBlockSearchObject);
  const updateObject = useAppStore((s) => s.updateBlockSearchObject);
  const removeObject = useAppStore((s) => s.removeBlockSearchObject);

  return (
    <div className="col-span-2 flex flex-col gap-2">
      <p className="text-[10px]" style={{ color: "var(--color-vsc-text-muted)" }}>
        Each surface passes through one point of every object, ordered from
        left to right, and rises to the ground at both ends. An object of one
        point is a fixed point, two points a line, three or more a window.
      </p>
      {objects.map((o, i) => (
        <div key={o.id} className="flex items-end gap-1 text-[12px]">
          <label className="flex flex-col flex-1 min-w-0">
            <Label>
              Object {i + 1} ({blockObjectKind(o.points.length)}): x, y (m); x, y; …
            </Label>
            <ObjectInput points={o.points} onChange={(points) => updateObject(o.id, points)} />
          </label>
          <button
            onClick={() => removeObject(o.id)}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/20 hover:text-red-400 cursor-pointer transition-colors"
            style={{ color: "var(--color-vsc-text-muted)", fontSize: "10px" }}
            aria-label={`Remove block search object ${i + 1}`}
          >
            ✕
          </button>
        </div>
      ))}
      {objects.filter((o) => o.points.length > 0).length === 0 && (
        <p className="text-[10px] italic" style={{ color: "var(--color-vsc-warning)" }}>
          Add at least one object to run a block search.
        </p>
      )}
      <button
        onClick={addObject}
        className="self-start text-[11px] cursor-pointer hover:underline font-medium"
        style={{ color: "var(--color-vsc-accent)" }}
      >
        + Add Search Object
      </button>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <AngleRange
          label="Upslope end angle (°)"
          title="Inclination of the upslope (active) end segment from the horizontal, drawn within the range. Empty: the Rankine active angle 45° + φ/2 of the soil above the first base point."
          value={options.blockActiveAngle ?? null}
          onChange={(blockActiveAngle) => setOptions({ blockActiveAngle })}
        />
        <AngleRange
          label="Downslope end angle (°)"
          title="Inclination of the downslope (passive) end segment from the horizontal, drawn within the range. Empty: the Rankine passive angle 45° − φ/2 of the soil above the last base point."
          value={options.blockPassiveAngle ?? null}
          onChange={(blockPassiveAngle) => setOptions({ blockPassiveAngle })}
        />
      </div>
    </div>
  );
}

/** Min and max of an angle range; both empty is automatic (Rankine). */
function AngleRange({
  label,
  title,
  value,
  onChange,
}: {
  label: string;
  title: string;
  value: [number, number] | null;
  onChange: (value: [number, number] | null) => void;
}) {
  const valid = (v: number) => v > 0 && v < 90;
  // Typing into an automatic range sets both ends until the field is left.
  const linked = useRef(false);
  /**
   * While typing only a consistent range is kept (typing 50 as the maximum
   * passes through 5); when the field is left, an inverted range is put
   * in order.
   */
  const set = (which: 0 | 1, v: number, final = false) => {
    if (!valid(v)) return;
    if (linked.current) {
      onChange([v, v]);
      return;
    }
    const other = value ? value[1 - which] : v;
    const pair: [number, number] = which === 0 ? [v, other] : [other, v];
    if (pair[0] <= pair[1]) onChange(pair);
    else if (final) onChange([pair[1], pair[0]]);
  };
  const enter = () => {
    linked.current = value === null;
  };
  const leave = (which: 0 | 1) => (e: { target: HTMLInputElement }) => {
    const text = e.target.value.trim();
    if (text !== "") set(which, Number(text), true);
    linked.current = false;
  };
  return (
    <div className="flex flex-col gap-0.5" title={title}>
      <Label>{label}</Label>
      <div className="flex items-center gap-1">
        <DraftNumberInput
          value={value?.[0]}
          min={1}
          max={89}
          step={1}
          placeholder="Auto"
          onValueChange={(v) => set(0, v)}
          onFocus={enter}
          onBlur={leave(0)}
          onClear={() => onChange(null)}
          aria-label={`${label}, minimum`}
          className="w-full min-w-0"
        />
        <span style={{ color: "var(--color-vsc-text-muted)" }}>–</span>
        <DraftNumberInput
          value={value?.[1]}
          min={1}
          max={89}
          step={1}
          placeholder="Auto"
          onValueChange={(v) => set(1, v)}
          onFocus={enter}
          onBlur={leave(1)}
          onClear={() => onChange(null)}
          aria-label={`${label}, maximum`}
          className="w-full min-w-0"
        />
      </div>
    </div>
  );
}

/** Text input for an object's points that keeps the user's text while typing. */
function ObjectInput({
  points,
  onChange,
}: {
  points: [number, number][];
  onChange: (points: [number, number][]) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // A new, empty object is not flagged until something is typed.
  const [touched, setTouched] = useState(points.length > 0);
  const text = draft ?? formatPolyline(points);
  const parsed = parsePolyline(text);
  const problem = parsed ? blockObjectProblem(parsed) : null;
  const invalid = touched && (parsed === null || parsed.length === 0 || problem !== null);
  return (
    <input
      type="text"
      value={text}
      placeholder="e.g. 25, 26.75; 50, 26.75"
      onChange={(e) => {
        setDraft(e.target.value);
        setTouched(true);
        const next = parsePolyline(e.target.value);
        if (next && next.length > 0 && !blockObjectProblem(next)) onChange(next);
      }}
      onBlur={() => setDraft(null)}
      aria-invalid={invalid}
      aria-label="Block search object points"
      title={problem ?? "One point (a fixed point), two (a line) or three or more (a window), separated by semicolons"}
      style={invalid ? { borderColor: "var(--color-vsc-error)" } : undefined}
      className="w-full"
    />
  );
}
