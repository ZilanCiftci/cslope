import { Label } from "../../../../components/ui/Label";
import type { StrengthFromDepthModel } from "@cslope/engine";

interface Props {
  model: StrengthFromDepthModel;
  onChange: (patch: Partial<StrengthFromDepthModel>) => void;
}

export function SfDepthFields({ model, onChange }: Props) {
  const clamp = (v: string, min: number) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= min ? n : min;
  };

  return (
    <div className="space-y-2">
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
          <Label>Su ref (kPa)</Label>
          <input
            type="number"
            step="1"
            min="0"
            value={model.suRef}
            onChange={(e) =>
              onChange({ suRef: parseFloat(e.target.value) || 0 })
            }
            onBlur={(e) => onChange({ suRef: clamp(e.target.value, 0) })}
            aria-label="Su ref (kPa)"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <Label>Depth ref (m)</Label>
          <input
            type="number"
            step="0.5"
            value={model.depthRef}
            onChange={(e) =>
              onChange({ depthRef: parseFloat(e.target.value) || 0 })
            }
            aria-label="Depth ref (m)"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <Label>Rate (kPa/m)</Label>
          <input
            type="number"
            step="0.1"
            value={model.rate}
            onChange={(e) =>
              onChange({ rate: parseFloat(e.target.value) || 0 })
            }
            aria-label="Rate (kPa/m)"
          />
        </label>
      </div>
    </div>
  );
}
