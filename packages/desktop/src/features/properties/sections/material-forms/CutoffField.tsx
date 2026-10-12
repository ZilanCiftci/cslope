import { Label } from "../../../../components/ui/Label";
import { DraftNumberInput } from "../../../../components/ui/DraftNumberInput";

interface Props {
  /** Current cutoff (kPa); undefined: none. */
  value: number | undefined;
  onChange: (suMax: number | undefined) => void;
}

const HINT =
  "Strength cutoff. A maximum when Su is " +
  "constant or increases with depth; a minimum when the rate is negative. " +
  "Leave empty for no cutoff.";

/** Optional maximum Su (strength cutoff); an empty field means none. */
export function CutoffField({ value, onChange }: Props) {
  return (
    <label className="flex flex-col gap-0.5" title={HINT}>
      <Label>Max Su (cutoff) (kPa)</Label>
      <DraftNumberInput
        value={value}
        min={0}
        placeholder="None"
        onValueChange={(v) => {
          if (v > 0) onChange(v);
        }}
        onClear={() => onChange(undefined)}
        aria-label="Max Su (cutoff) (kPa)"
      />
    </label>
  );
}
