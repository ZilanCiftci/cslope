import { Label } from "../../../../components/ui/Label";
import { DraftNumberInput } from "../../../../components/ui/DraftNumberInput";
import { NO_SPINNER } from "./styles";
import { HelpButton } from "../../../../components/ui/HelpButton";

interface Props {
  /** B̄ of the material; undefined: no excess pore pressure. */
  bBar: number | undefined;
  /** Whether the material's weight is a fill raising the pore pressure below. */
  bBarLoad: boolean | undefined;
  /** The pore pressure ratio rᵤ; undefined: none. */
  ru?: number;
  onChange: (patch: { bBar?: number; bBarLoad?: boolean; ru?: number }) => void;
}

/**
 * Excess pore pressure from a fill, common to every material model: B̄ of
 * the material (the excess pore pressure at a slice base in it is B̄ times
 * the vertical stress of the fill above), and whether the material's own
 * weight is such a fill. An empty B̄ field means none. Also the pore
 * pressure ratio rᵤ (rᵤ × the vertical stress of the soil above the base).
 * Out-of-range values are kept, and the error shows under the field.
 */
/** The error of an out-of-range value, shown under its field; null when it is fine. */
function rangeError(value: number | undefined, ok: (v: number) => boolean, message: string): string | null {
  return value === undefined || ok(value) ? null : message;
}

/** A hint (the allowed range) or, when the value is out of range, the error, under a field. */
function FieldHint({ id, hint, error }: { id: string; hint: string; error: string | null }) {
  return (
    <span
      id={id}
      role={error ? "alert" : undefined}
      className="text-[10px]"
      style={{ color: error ? "var(--color-vsc-error, #f44747)" : "var(--color-vsc-text-muted)" }}
    >
      {error ?? hint}
    </span>
  );
}

const errorOutline = (error: string | null) =>
  error ? { outline: "1px solid var(--color-vsc-error, #f44747)", outlineOffset: -1 } : undefined;

export function BBarFields({ bBar, bBarLoad, ru, onChange }: Props) {
  const bBarError = rangeError(bBar, (v) => v >= 0 && v <= 1.5, "B̄ must be between 0 and 1.5.");
  const ruError = rangeError(ru, (v) => v >= 0 && v < 1, "rᵤ must be at least 0 and below 1.");
  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby="bbar-ru-heading">
      <div className="col-span-2 flex items-center gap-1.5">
        <div id="bbar-ru-heading" className="text-[11px] font-medium">
          Additional pore pressure (added to the water line)
        </div>
        <HelpButton topic="Additional pore pressure" page="materials#additional-pore-pressure" />
      </div>
      <label
        className="flex flex-col gap-0.5"
        title="Excess pore pressure: B̄ × the vertical stress of the fill above the slice base, added to the water line's. Empty: none (default). Not used by finite elements."
      >
        <Label>B̄ (excess pore pressure from fill above)</Label>
        <DraftNumberInput
          value={bBar}
          min={0}
          max={1.5}
          step={0.1}
          placeholder="None"
          className={NO_SPINNER}
          style={errorOutline(bBarError)}
          // Out of range too: the error under the field says why.
          onValueChange={(v) => {
            if (Number.isFinite(v)) onChange({ bBar: v });
          }}
          onClear={() => onChange({ bBar: undefined })}
          aria-label="B̄ (excess pore pressure from fill above)"
          aria-invalid={bBarError ? true : undefined}
          aria-describedby="bbar-hint"
        />
        <FieldHint id="bbar-hint" hint="0 to 1.5; empty: none" error={bBarError} />
      </label>
      <label
        className="flex flex-col gap-0.5"
        title="Pore pressure ratio: rᵤ × the vertical stress γ·h at the slice base, added to the water line's pore pressure. Empty: none (default). Not used by finite elements."
      >
        <Label>rᵤ (pore pressure ratio)</Label>
        <DraftNumberInput
          value={ru}
          min={0}
          max={0.99}
          step={0.05}
          placeholder="None"
          className={NO_SPINNER}
          style={errorOutline(ruError)}
          // Out of range too: the error under the field says why.
          onValueChange={(v) => {
            if (Number.isFinite(v)) onChange({ ru: v });
          }}
          onClear={() => onChange({ ru: undefined })}
          aria-label="rᵤ (pore pressure ratio)"
          aria-invalid={ruError ? true : undefined}
          aria-describedby="ru-hint"
        />
        <FieldHint id="ru-hint" hint="0 to below 1; empty: none" error={ruError} />
      </label>
      <label
        className="col-span-2 flex items-center gap-1.5"
        title="The weight of this material (a fill) raises the pore pressure of the materials with B̄ below it."
      >
        <input
          type="checkbox"
          checked={bBarLoad === true}
          onChange={(e) => onChange({ bBarLoad: e.target.checked ? true : undefined })}
          aria-label="This material is a fill that loads the B̄ materials below"
        />
        <Label>This material is a fill that loads the B̄ materials below</Label>
      </label>
    </div>
  );
}
