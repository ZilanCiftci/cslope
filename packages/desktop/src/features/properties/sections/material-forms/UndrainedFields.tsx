import { Label } from "../../../../components/ui/Label";
import { NumericInput } from "../../../../components/ui/NumericInput";
import type { UndrainedModel } from "@cslope/engine";

interface Props {
  model: UndrainedModel;
  onChange: (patch: Partial<UndrainedModel>) => void;
}

export function UndrainedFields({ model, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2">
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
      <label className="flex flex-col gap-0.5">
        <Label>Su (kPa)</Label>
        <NumericInput
          value={model.undrainedShearStrength}
          onValueChange={(undrainedShearStrength) =>
            onChange({ undrainedShearStrength })
          }
          min={0}
          fallbackValue={0}
          allowNegative={false}
          aria-label="Su (kPa)"
        />
      </label>
    </div>
  );
}
