import { Label } from "../../../../components/ui/Label";
import { ExpressionNumericInput } from "../../../../components/ui/ExpressionNumericInput";
import type { MohrCoulombModel } from "@cslope/engine";
import type { MaterialExpressions } from "../../../../store/types";

interface Props {
  model: MohrCoulombModel;
  onChange: (patch: Partial<MohrCoulombModel>) => void;
  modelExpressions: MaterialExpressions | undefined;
  parameterValues: Record<string, number>;
  onExpressionChange: (field: string, expression: string | undefined) => void;
}

export function MohrCoulombFields({
  model,
  onChange,
  modelExpressions,
  parameterValues,
  onExpressionChange,
}: Props) {
  return (
    <>
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
            aria-invalid={model.unitWeight < 0.01}
            style={
              model.unitWeight < 0.01
                ? { borderColor: "var(--color-vsc-error)" }
                : undefined
            }
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
            aria-invalid={model.frictionAngle < 0}
            style={
              model.frictionAngle < 0
                ? { borderColor: "var(--color-vsc-error)" }
                : undefined
            }
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
            aria-invalid={model.cohesion < 0}
            style={
              model.cohesion < 0
                ? { borderColor: "var(--color-vsc-error)" }
                : undefined
            }
          />
        </label>
      </div>
    </>
  );
}
