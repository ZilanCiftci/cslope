import { Label } from "../../../../components/ui/Label";
import type { UndrainedModel } from "@cslope/engine";

interface Props {
  model: UndrainedModel;
  onChange: (patch: Partial<UndrainedModel>) => void;
}

export function UndrainedFields({ model, onChange }: Props) {
  const clamp = (v: string, min: number) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= min ? n : min;
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-0.5">
        <Label>γ (kN/m³)</Label>
        <input
          type="number"
          step="0.5"
          min="0.01"
          value={model.unitWeight}
          onChange={(e) =>
            onChange({ unitWeight: parseFloat(e.target.value) || 0 })
          }
          onBlur={(e) => onChange({ unitWeight: clamp(e.target.value, 0.1) })}
          aria-label="γ (kN/m³)"
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <Label>Su (kPa)</Label>
        <input
          type="number"
          step="1"
          min="0"
          value={model.undrainedShearStrength}
          onChange={(e) =>
            onChange({
              undrainedShearStrength: parseFloat(e.target.value) || 0,
            })
          }
          onBlur={(e) =>
            onChange({ undrainedShearStrength: clamp(e.target.value, 0) })
          }
          aria-label="Su (kPa)"
        />
      </label>
    </div>
  );
}
