import { Label } from "../../../../components/ui/Label";
import { NumericInput } from "../../../../components/ui/NumericInput";
import type { StrengthFromDatumModel } from "@cslope/engine";

interface Props {
  model: StrengthFromDatumModel;
  onChange: (patch: Partial<StrengthFromDatumModel>) => void;
}

export function SfDatumFields({ model, onChange }: Props) {
  return (
    <div className="space-y-2">
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
          <Label>Su ref (kPa)</Label>
          <NumericInput
            value={model.suRef}
            onValueChange={(suRef) => onChange({ suRef })}
            min={0}
            fallbackValue={0}
            allowNegative={false}
            aria-label="Su ref (kPa)"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <Label>Y ref (m)</Label>
          <NumericInput
            value={model.yRef}
            onValueChange={(yRef) => onChange({ yRef })}
            fallbackValue={0}
            aria-label="Y ref (m)"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <Label>Rate (kPa/m)</Label>
          <NumericInput
            value={model.rate}
            onValueChange={(rate) => onChange({ rate })}
            fallbackValue={0}
            aria-label="Rate (kPa/m)"
          />
        </label>
      </div>
    </div>
  );
}
