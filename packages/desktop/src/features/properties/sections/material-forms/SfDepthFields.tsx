import { Label } from "../../../../components/ui/Label";
import { ExpressionNumericInput } from "../../../../components/ui/ExpressionNumericInput";
import type { DepthReference, StrengthFromDepthModel } from "@cslope/engine";
import type { MaterialExpressions } from "../../../../store/types";
import { CutoffField } from "./CutoffField";
import { AnisotropyField } from "./AnisotropyField";
import { UnitWeightSatField } from "./UnitWeightSatField";
import { SuctionFields } from "./SuctionFields";

interface Props {
  model: StrengthFromDepthModel;
  onChange: (patch: Partial<StrengthFromDepthModel>) => void;
  modelExpressions: MaterialExpressions | undefined;
  parameterValues: Record<string, number>;
  onExpressionChange: (field: string, expression: string | undefined) => void;
}

export function SfDepthFields({
  model,
  onChange,
  modelExpressions,
  parameterValues,
  onExpressionChange,
}: Props) {
  const combined = model.drainedCohesion !== undefined && model.drainedFrictionAngle !== undefined;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5">
          <Label>γ (kN/m³)</Label>
          <ExpressionNumericInput
            value={model.unitWeight}
            expression={modelExpressions?.unitWeight}
            vars={parameterValues}
            onValueChange={(unitWeight) => onChange({ unitWeight })}
            onExpressionChange={(expr) =>
              onExpressionChange("unitWeight", expr)
            }
            min={0.01}
            fallbackValue={0.1}
            allowNegative={false}
            aria-label="γ (kN/m³)"
          />
        </label>
        <UnitWeightSatField
          value={model.unitWeightSat}
          onChange={(unitWeightSat) => onChange({ unitWeightSat })}
        />
        <label className="flex flex-col gap-0.5">
          <Label>Su at reference depth (kPa)</Label>
          <ExpressionNumericInput
            value={model.suRef}
            expression={modelExpressions?.suRef}
            vars={parameterValues}
            onValueChange={(suRef) => onChange({ suRef })}
            onExpressionChange={(expr) => onExpressionChange("suRef", expr)}
            min={0}
            fallbackValue={0}
            allowNegative={false}
            aria-label="Su at reference depth (kPa)"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <Label title="Depth below the ground or the top of the layer (see Depth measured from) where Su has its reference value.">
            Reference depth (m)
          </Label>
          <ExpressionNumericInput
            value={model.depthRef}
            expression={modelExpressions?.depthRef}
            vars={parameterValues}
            onValueChange={(depthRef) => onChange({ depthRef })}
            onExpressionChange={(expr) => onExpressionChange("depthRef", expr)}
            fallbackValue={0}
            aria-label="Reference depth (m)"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <Label title="Change of Su per metre of depth: positive, Su increases downwards; negative, it decreases.">
            Su increase rate (kPa/m)
          </Label>
          <ExpressionNumericInput
            value={model.rate}
            expression={modelExpressions?.rate}
            vars={parameterValues}
            onValueChange={(rate) => onChange({ rate })}
            onExpressionChange={(expr) => onExpressionChange("rate", expr)}
            fallbackValue={0}
            aria-label="Su increase rate (kPa/m)"
          />
        </label>
        <label
          className="flex flex-col gap-0.5"
          title="Depth below the ground surface, or below the top of this material's layer above the slice base."
        >
          <Label>Depth measured from</Label>
          <select
            value={model.depthReference ?? "ground"}
            onChange={(e) =>
              onChange({ depthReference: e.target.value as DepthReference })
            }
            aria-label="Depth measured from"
          >
            <option value="ground">Ground surface</option>
            <option value="layer-top">Top of layer</option>
          </select>
        </label>
        <CutoffField
          value={model.suMax}
          rate={model.rate}
          onChange={(suMax) => onChange({ suMax })}
        />
        <AnisotropyField
          value={model.anisotropy}
          onChange={(anisotropy) => onChange({ anisotropy })}
        />
      </div>
      <label
        className="flex items-center gap-2 text-[11px]"
        title="Combined analysis: the strength is the lesser of Su and the drained c′ + σ′·tan φ′, c′ varying with the same depth as Su (e.g. c′ = 0.1·Su, φ′ = 30°)."
      >
        <input
          type="checkbox"
          checked={combined}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? {
                    drainedCohesion: Math.round(model.suRef * 10) / 100,
                    drainedCohesionRate: Math.round(model.rate * 100) / 1000,
                    drainedFrictionAngle: 30,
                  }
                : {
                    drainedCohesion: undefined,
                    drainedCohesionRate: undefined,
                    drainedFrictionAngle: undefined,
                    // suction strength belongs to the drained branch
                    phiB: undefined,
                    maxSuction: undefined,
                  },
            )
          }
          aria-label="Combined analysis (drained limit)"
        />
        Combined analysis (drained limit)
      </label>
      {combined && (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5">
            <Label>c′ at reference depth (kPa)</Label>
            <ExpressionNumericInput
              value={model.drainedCohesion ?? 0}
              expression={modelExpressions?.drainedCohesion}
              vars={parameterValues}
              onValueChange={(drainedCohesion) => onChange({ drainedCohesion })}
              onExpressionChange={(expr) => onExpressionChange("drainedCohesion", expr)}
              min={0}
              fallbackValue={0}
              allowNegative={false}
              aria-label="c′ at reference depth (kPa)"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <Label title="Change of c′ per metre of depth, with the same depth as Su.">c′ increase rate (kPa/m)</Label>
            <ExpressionNumericInput
              value={model.drainedCohesionRate ?? 0}
              expression={modelExpressions?.drainedCohesionRate}
              vars={parameterValues}
              onValueChange={(drainedCohesionRate) => onChange({ drainedCohesionRate })}
              onExpressionChange={(expr) => onExpressionChange("drainedCohesionRate", expr)}
              fallbackValue={0}
              aria-label="c′ increase rate (kPa/m)"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <Label>φ′ (°)</Label>
            <ExpressionNumericInput
              value={model.drainedFrictionAngle ?? 0}
              expression={modelExpressions?.drainedFrictionAngle}
              vars={parameterValues}
              onValueChange={(v) => onChange({ drainedFrictionAngle: Math.min(89, v) })}
              onExpressionChange={(expr) => onExpressionChange("drainedFrictionAngle", expr)}
              min={0}
              fallbackValue={0}
              allowNegative={false}
              aria-label="φ′ (°)"
            />
          </label>
          <SuctionFields
            phiB={model.phiB}
            maxSuction={model.maxSuction}
            onChange={onChange}
          />
        </div>
      )}
    </div>
  );
}
