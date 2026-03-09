import { Label } from "../../../../components/ui/Label";
import { DataPointTable } from "../../../../components/ui/DataPointTable";
import type { StrengthFromDatumModel } from "@cslope/engine";

interface Props {
  model: StrengthFromDatumModel;
  onChange: (patch: Partial<StrengthFromDatumModel>) => void;
}

export function SfDatumFields({ model, onChange }: Props) {
  const clamp = (v: string, min: number) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= min ? n : min;
  };

  const rows = model.strengthFunction.map(([y, su]) => [y, su]);

  const handleRowsChange = (newRows: number[][]) => {
    onChange({
      strengthFunction: newRows.map((r) => [r[0], r[1]] as [number, number]),
    });
  };

  return (
    <div className="space-y-2">
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
      </div>
      <Label>Strength vs Elevation</Label>
      <DataPointTable
        headers={["Y (m)", "Su (kPa)"]}
        rows={rows}
        onChange={handleRowsChange}
        minRows={1}
      />
    </div>
  );
}
