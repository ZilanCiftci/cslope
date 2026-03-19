import { Label } from "../../../../components/ui/Label";
import { ExpressionNumericInput } from "../../../../components/ui/ExpressionNumericInput";
import type { HighStrengthModel } from "@cslope/engine";
import type { MaterialExpressions } from "../../../../store/types";

interface Props {
  model: HighStrengthModel;
  onChange: (patch: Partial<HighStrengthModel>) => void;
  modelExpressions: MaterialExpressions | undefined;
  parameterValues: Record<string, number>;
  onExpressionChange: (field: string, expression: string | undefined) => void;
}

export function HighStrengthFields({
  model,
  onChange,
  modelExpressions,
  parameterValues,
  onExpressionChange,
}: Props) {
  return (
    <div className="grid grid-cols-1 gap-2">
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
