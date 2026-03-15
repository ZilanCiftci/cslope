import { Label } from "../../../../components/ui/Label";
import { NumericInput } from "../../../../components/ui/NumericInput";
import type { HighStrengthModel } from "@cslope/engine";

interface Props {
  model: HighStrengthModel;
  onChange: (patch: Partial<HighStrengthModel>) => void;
}

export function HighStrengthFields({ model, onChange }: Props) {
  return (
    <div className="grid grid-cols-1 gap-2">
      <label className="flex flex-col gap-0.5">
        <Label>γ (kN/m³)</Label>
        <NumericInput
          value={model.unitWeight}
          onValueChange={(unitWeight) => onChange({ unitWeight })}
          min={0.01}
          fallbackValue={0.1}
          allowNegative={false}
          aria-label="γ (kN/m³)"
        />
      </label>
      <p
        className="text-[10px] italic"
        style={{ color: "var(--color-vsc-text-muted)" }}
      >
        Infinite strength — slip surfaces passing through this material are
        skipped.
      </p>
    </div>
  );
}
