import { Label } from "../../../../components/ui/Label";
import type { MohrCoulombModel } from "@cslope/engine";

interface Props {
  model: MohrCoulombModel;
  onChange: (patch: Partial<MohrCoulombModel>) => void;
}

export function MohrCoulombFields({ model, onChange }: Props) {
  const clamp = (v: string, min: number) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= min ? n : min;
  };

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
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
          <input
            type="number"
            step="1"
            min="0"
            value={model.frictionAngle}
            onChange={(e) =>
              onChange({ frictionAngle: parseFloat(e.target.value) || 0 })
            }
            onBlur={(e) =>
              onChange({ frictionAngle: clamp(e.target.value, 0) })
            }
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
          <input
            type="number"
            step="0.5"
            min="0"
            value={model.cohesion}
            onChange={(e) =>
              onChange({ cohesion: parseFloat(e.target.value) || 0 })
            }
            onBlur={(e) => onChange({ cohesion: clamp(e.target.value, 0) })}
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
