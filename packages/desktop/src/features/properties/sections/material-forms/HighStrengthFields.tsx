import { Label } from "../../../../components/ui/Label";
import type { HighStrengthModel } from "@cslope/engine";

interface Props {
  model: HighStrengthModel;
  onChange: (patch: Partial<HighStrengthModel>) => void;
}

export function HighStrengthFields({ model, onChange }: Props) {
  const clamp = (v: string, min: number) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= min ? n : min;
  };

  return (
    <div className="grid grid-cols-1 gap-2">
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
