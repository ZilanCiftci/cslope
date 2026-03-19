import { Label } from "../../../../components/ui/Label";
import { ExpressionNumericInput } from "../../../../components/ui/ExpressionNumericInput";
import type { StrengthFromDepthModel } from "@cslope/engine";
import type { MaterialExpressions } from "../../../../store/types";

interface Props {
  model: StrengthFromDepthModel;
  onChange: (patch: Partial<StrengthFromDepthModel>) => void;
  modelExpressions: MaterialExpressions | undefined;
  parameterValues: Record<string, number>;
  onExpressionChange: (field: string, expression: string | undefined) => void;
}

export function SfDepthFields({
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
          <Label>Depth ref (m)</Label>
          <ExpressionNumericInput
            value={model.depthRef}
            expression={modelExpressions?.depthRef}
            vars={parameterValues}
            onValueChange={(depthRef) => onChange({ depthRef })}
            onExpressionChange={(expr) => onExpressionChange("depthRef", expr)}
            fallbackValue={0}
            aria-label="Depth ref (m)"
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
