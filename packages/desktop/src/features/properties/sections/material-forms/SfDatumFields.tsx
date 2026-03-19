import { Label } from "../../../../components/ui/Label";
import { ExpressionNumericInput } from "../../../../components/ui/ExpressionNumericInput";
import type { StrengthFromDatumModel } from "@cslope/engine";
import type { MaterialExpressions } from "../../../../store/types";

interface Props {
  model: StrengthFromDatumModel;
  onChange: (patch: Partial<StrengthFromDatumModel>) => void;
  modelExpressions: MaterialExpressions | undefined;
  parameterValues: Record<string, number>;
  onExpressionChange: (field: string, expression: string | undefined) => void;
}

export function SfDatumFields({
  model,
  onChange,
  modelExpressions,
  parameterValues,
  onExpressionChange,
}: Props) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5">
          <Label>γ (kN/m³)</Label>
          <ExpressionNumericInput
            value={model.unitWeight}
            expression={modelExpressions?.unitWeight}
            vars={parameterValues}
            onValueChange={(unitWeight) => onChange({ unitWeight })}
            onExpressionChange={(expr) =>
              onExpressionChange("unitWeight", expr)
            }
            min={0.01}
            fallbackValue={0.1}
            allowNegative={false}
            aria-label="γ (kN/m³)"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <Label>Su ref (kPa)</Label>
          <ExpressionNumericInput
            value={model.suRef}
            expression={modelExpressions?.suRef}
            vars={parameterValues}
            onValueChange={(suRef) => onChange({ suRef })}
            onExpressionChange={(expr) => onExpressionChange("suRef", expr)}
            min={0}
            fallbackValue={0}
            allowNegative={false}
            aria-label="Su ref (kPa)"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <Label>Y ref (m)</Label>
          <ExpressionNumericInput
            value={model.yRef}
            expression={modelExpressions?.yRef}
            vars={parameterValues}
            onValueChange={(yRef) => onChange({ yRef })}
            onExpressionChange={(expr) => onExpressionChange("yRef", expr)}
            fallbackValue={0}
            aria-label="Y ref (m)"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <Label>Rate (kPa/m)</Label>
          <ExpressionNumericInput
            value={model.rate}
            expression={modelExpressions?.rate}
            vars={parameterValues}
            onValueChange={(rate) => onChange({ rate })}
            onExpressionChange={(expr) => onExpressionChange("rate", expr)}
            fallbackValue={0}
            aria-label="Rate (kPa/m)"
          />
        </label>
      </div>
    </div>
  );
}
