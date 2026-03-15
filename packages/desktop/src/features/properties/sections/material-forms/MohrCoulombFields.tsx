import { Label } from "../../../../components/ui/Label";
import { NumericInput } from "../../../../components/ui/NumericInput";
import type { MohrCoulombModel } from "@cslope/engine";

interface Props {
  model: MohrCoulombModel;
  onChange: (patch: Partial<MohrCoulombModel>) => void;
}

export function MohrCoulombFields({ model, onChange }: Props) {
  return (
    <>
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
          <NumericInput
            value={model.frictionAngle}
            onValueChange={(frictionAngle) => onChange({ frictionAngle })}
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
          <NumericInput
            value={model.cohesion}
            onValueChange={(cohesion) => onChange({ cohesion })}
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
