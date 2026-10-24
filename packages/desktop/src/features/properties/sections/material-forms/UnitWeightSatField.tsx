import { Label } from "../../../../components/ui/Label";
import { DraftNumberInput } from "../../../../components/ui/DraftNumberInput";
import { NO_SPINNER } from "./styles";

interface Props {
  /** Saturated unit weight (kN/m³); undefined: γ throughout. */
  value: number | undefined;
  onChange: (unitWeightSat: number | undefined) => void;
}

/** γsat below the material's piezometric line; an empty field means γ. */
export function UnitWeightSatField({ value, onChange }: Props) {
  return (
    <label
      className="flex flex-col gap-0.5"
      title="Unit weight of the soil below the material's piezometric line. Empty: γ throughout."
    >
      <Label>γsat below water (kN/m³)</Label>
      <DraftNumberInput
        value={value}
        min={0.01}
        placeholder="= γ"
        className={NO_SPINNER}
        onValueChange={(v) => {
          if (v > 0) onChange(v);
        }}
        onClear={() => onChange(undefined)}
        aria-label="Saturated unit weight"
      />
    </label>
  );
}
