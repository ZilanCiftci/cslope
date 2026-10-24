import { useState } from "react";
import { Label } from "../../../../components/ui/Label";
import { DraftNumberInput } from "../../../../components/ui/DraftNumberInput";
import { NO_SPINNER } from "./styles";

interface Props {
  /** Current cutoff (kPa); undefined: none. */
  value: number | undefined;
  /** Rate of change of Su with depth (kPa/m); positive: Su increases downwards. */
  rate: number;
  onChange: (suMax: number | undefined) => void;
}

/**
 * Optional Su cutoff; an empty field means none. A maximum when Su
 * increases with depth, a minimum when it decreases. It is shown only when
 * Su varies with depth, or when a cutoff is already set (so it can be
 * cleared). While the field is being edited it stays, so clearing it to
 * type a new cutoff does not remove it from under the cursor.
 */
export function CutoffField({ value, rate, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  if (rate === 0 && value === undefined && !editing) return null;
  const minimum = rate < 0;
  const label = minimum ? "Min Su (cutoff) (kPa)" : "Max Su (cutoff) (kPa)";
  const hint = minimum
    ? "Lower limit of Su where it decreases with depth. Leave empty for no cutoff."
    : "Upper limit of Su where it increases with depth. Leave empty for no cutoff.";
  return (
    <label className="flex flex-col gap-0.5" title={hint}>
      <Label>{label}</Label>
      <DraftNumberInput
        value={value}
        min={0}
        placeholder="None"
        className={NO_SPINNER}
        onValueChange={(v) => {
          if (v > 0) onChange(v);
        }}
        onClear={() => onChange(undefined)}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        aria-label={label}
      />
    </label>
  );
}
