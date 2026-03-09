import { Label } from "../../../../components/ui/Label";
import type { ImpenetrableModel } from "@cslope/engine";

interface Props {
  model: ImpenetrableModel;
  onChange: (patch: Partial<ImpenetrableModel>) => void;
}

export function ImpenetrableFields({ model, onChange }: Props) {
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
        Bedrock — slip surfaces cannot enter this material.
      </p>
    </div>
  );
}
