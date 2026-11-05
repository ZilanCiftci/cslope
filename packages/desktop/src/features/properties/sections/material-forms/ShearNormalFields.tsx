import { Label } from "../../../../components/ui/Label";
import { ExpressionNumericInput } from "../../../../components/ui/ExpressionNumericInput";
import { DataPointTable } from "../../../../components/ui/DataPointTable";
import type { ShearNormalModel } from "@cslope/engine";
import type { MaterialExpressions } from "../../../../store/types";
import { UnitWeightSatField } from "./UnitWeightSatField";

interface Props {
  model: ShearNormalModel;
  onChange: (patch: Partial<ShearNormalModel>) => void;
  modelExpressions: MaterialExpressions | undefined;
  parameterValues: Record<string, number>;
  onExpressionChange: (field: string, expression: string | undefined) => void;
}

/**
 * Shear strength as a function of the effective normal stress on the slice
 * base, τ = f(σ′n), from a list of points sorted by increasing σ′n.
 */
export function ShearNormalFields({
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
      <UnitWeightSatField
        value={model.unitWeightSat}
        onChange={(unitWeightSat) => onChange({ unitWeightSat })}
      />
      <div className="col-span-2 space-y-1">
        <Label title="Shear strength against the effective normal stress on the slice base, interpolated between the points. At least two points, sorted by increasing σ′n; τ ≥ 0.">
          Shear strength against normal stress
        </Label>
        <DataPointTable
          headers={["σ′n (kPa)", "τ (kPa)"]}
          rows={model.points.map(([sn, tau]) => [sn, tau])}
          onChange={(rows) => onChange({ points: rows.map((r) => [r[0], r[1]] as [number, number]) })}
          minRows={2}
        />
      </div>
    </div>
  );
}
