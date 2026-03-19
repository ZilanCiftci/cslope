import { Label } from "../../../../components/ui/Label";
import { ExpressionNumericInput } from "../../../../components/ui/ExpressionNumericInput";
import type { UndrainedModel } from "@cslope/engine";
import type { MaterialExpressions } from "../../../../store/types";

interface Props {
  model: UndrainedModel;
  onChange: (patch: Partial<UndrainedModel>) => void;
  modelExpressions: MaterialExpressions | undefined;
  parameterValues: Record<string, number>;
  onExpressionChange: (field: string, expression: string | undefined) => void;
}

export function UndrainedFields({
  model,
  onChange,
  modelExpressions,
  parameterValues,
  onExpressionChange,
}: Props) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-0.5">
        <Label>γ (kN/m³)</Label>
        <ExpressionNumericInput
          value={model.unitWeight}
          expression={modelExpressions?.unitWeight}
          vars={parameterValues}
          onValueChange={(unitWeight) => onChange({ unitWeight })}
          onExpressionChange={(expr) => onExpressionChange("unitWeight", expr)}
          min={0.01}
          fallbackValue={0.1}
          allowNegative={false}
          aria-label="γ (kN/m³)"
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <Label>Su (kPa)</Label>
        <ExpressionNumericInput
          value={model.undrainedShearStrength}
          expression={modelExpressions?.undrainedShearStrength}
          vars={parameterValues}
          onValueChange={(undrainedShearStrength) =>
            onChange({ undrainedShearStrength })
          }
          onExpressionChange={(expr) =>
            onExpressionChange("undrainedShearStrength", expr)
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
