import { Label } from "../../../../components/ui/Label";
import { DataPointTable } from "../../../../components/ui/DataPointTable";
import type { AnisotropicFunctionModel } from "@cslope/engine";

interface Props {
  model: AnisotropicFunctionModel;
  onChange: (patch: Partial<AnisotropicFunctionModel>) => void;
}

export function AnisotropicFields({ model, onChange }: Props) {
  const clamp = (v: string, min: number) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= min ? n : min;
  };

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
