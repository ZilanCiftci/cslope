import { Label } from "../../../../components/ui/Label";
import { NumericInput } from "../../../../components/ui/NumericInput";
import { DataPointTable } from "../../../../components/ui/DataPointTable";
import type { AnisotropicFunctionModel } from "@cslope/engine";

interface Props {
  model: AnisotropicFunctionModel;
  onChange: (patch: Partial<AnisotropicFunctionModel>) => void;
}

export function AnisotropicFields({ model, onChange }: Props) {
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
          <Label>φ (°)</Label>
          <NumericInput
            value={model.frictionAngle}
            onValueChange={(frictionAngle) => onChange({ frictionAngle })}
            min={0}
            fallbackValue={0}
            allowNegative={false}
            aria-label="φ (°)"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <Label>c (kPa)</Label>
          <NumericInput
            value={model.cohesion}
            onValueChange={(cohesion) => onChange({ cohesion })}
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
