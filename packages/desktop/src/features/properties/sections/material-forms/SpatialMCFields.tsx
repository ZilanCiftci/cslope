import { Label } from "../../../../components/ui/Label";
import { NumericInput } from "../../../../components/ui/NumericInput";
import { DataPointTable } from "../../../../components/ui/DataPointTable";
import type { SpatialMohrCoulombModel } from "@cslope/engine";

interface Props {
  model: SpatialMohrCoulombModel;
  onChange: (patch: Partial<SpatialMohrCoulombModel>) => void;
}

export function SpatialMCFields({ model, onChange }: Props) {
  // Convert tuple data points to rows for DataPointTable
  const rows = model.dataPoints.map(([x, y, c, phi, gamma]) => [
    x,
    y,
    c,
    phi,
    gamma,
  ]);

  const handleRowsChange = (newRows: number[][]) => {
    onChange({
      dataPoints: newRows.map(
        (r) =>
          [r[0], r[1], r[2], r[3], r[4]] as [
            number,
            number,
            number,
            number,
            number,
          ],
      ),
    });
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
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
          <Label>Interpolation</Label>
          <select
            value={model.interpolation ?? "idw"}
            onChange={(e) =>
              onChange({
                interpolation: e.target.value as "idw" | "nearest" | "linear",
              })
            }
            aria-label="Interpolation method"
          >
            <option value="idw">IDW</option>
            <option value="nearest">Nearest</option>
            <option value="linear">Linear</option>
          </select>
        </label>
      </div>
      <Label>Data Points</Label>
      <DataPointTable
        headers={["X", "Y", "c (kPa)", "φ (°)", "γ (kN/m³)"]}
        rows={rows}
        onChange={handleRowsChange}
        minRows={1}
      />
    </div>
  );
}
