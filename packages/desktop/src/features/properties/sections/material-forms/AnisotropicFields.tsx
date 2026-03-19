import { Label } from "../../../../components/ui/Label";
import { ExpressionNumericInput } from "../../../../components/ui/ExpressionNumericInput";
import { DataPointTable } from "../../../../components/ui/DataPointTable";
import type { AnisotropicFunctionModel } from "@cslope/engine";
import type { MaterialExpressions } from "../../../../store/types";

interface Props {
  model: AnisotropicFunctionModel;
  onChange: (patch: Partial<AnisotropicFunctionModel>) => void;
  modelExpressions: MaterialExpressions | undefined;
  parameterValues: Record<string, number>;
  onExpressionChange: (field: string, expression: string | undefined) => void;
}

export function AnisotropicFields({
  model,
  onChange,
  modelExpressions,
  parameterValues,
  onExpressionChange,
}: Props) {
  const rows = model.modifierFunction.map(([alpha, factor]) => [alpha, factor]);

  const handleRowsChange = (newRows: number[][]) => {
    onChange({
      modifierFunction: newRows.map((r) => [r[0], r[1]] as [number, number]),
    });
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
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
          <Label>φ (°)</Label>
          <ExpressionNumericInput
            value={model.frictionAngle}
            expression={modelExpressions?.frictionAngle}
            vars={parameterValues}
            onValueChange={(frictionAngle) => onChange({ frictionAngle })}
            onExpressionChange={(expr) =>
              onExpressionChange("frictionAngle", expr)
            }
            min={0}
            fallbackValue={0}
            allowNegative={false}
            aria-label="φ (°)"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <Label>c (kPa)</Label>
          <ExpressionNumericInput
            value={model.cohesion}
            expression={modelExpressions?.cohesion}
            vars={parameterValues}
            onValueChange={(cohesion) => onChange({ cohesion })}
            onExpressionChange={(expr) => onExpressionChange("cohesion", expr)}
            min={0}
            fallbackValue={0}
            allowNegative={false}
            aria-label="c (kPa)"
          />
        </label>
      </div>
      <Label>Modifier Function (α° → factor)</Label>
      <DataPointTable
        headers={["α (°)", "Factor"]}
        rows={rows}
        onChange={handleRowsChange}
        minRows={1}
      />
    </div>
  );
}
