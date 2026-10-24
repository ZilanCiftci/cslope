import { Label } from "../../../../components/ui/Label";
import { ExpressionNumericInput } from "../../../../components/ui/ExpressionNumericInput";
import type { LimeCementColumnModel } from "@cslope/engine";
import type { MaterialExpressions } from "../../../../store/types";
import { CutoffField } from "./CutoffField";
import { UnitWeightSatField } from "./UnitWeightSatField";

interface Props {
  model: LimeCementColumnModel;
  onChange: (patch: Partial<LimeCementColumnModel>) => void;
  modelExpressions: MaterialExpressions | undefined;
  parameterValues: Record<string, number>;
  onExpressionChange: (field: string, expression: string | undefined) => void;
}

type NumberKey = "unitWeight" | "soilSu" | "suRefDepth" | "suRateOfChange" | "columnSu" | "areaRatio" | "columnCohesion" | "columnFrictionAngle";

/**
 * Lime-cement columns (KC-pelare): τ = a·τcol + (1 − a)·cu,soil; the column
 * strength optionally limited to c′ + σ′·tan φ′ (drained).
 */
export function LimeCementFields({ model, onChange, modelExpressions, parameterValues, onExpressionChange }: Props) {
  const field = (key: NumberKey, label: string, opts: { min?: number; max?: number; allowNegative?: boolean; fallback?: number } = {}) => (
    <label className="flex flex-col gap-0.5" key={key}>
      <Label>{label}</Label>
      <ExpressionNumericInput
        value={(model[key] as number | undefined) ?? 0}
        expression={modelExpressions?.[key]}
        vars={parameterValues}
        onValueChange={(v) => onChange({ [key]: opts.max !== undefined ? Math.min(opts.max, v) : v })}
        onExpressionChange={(expr) => onExpressionChange(key, expr)}
        min={opts.min}
        fallbackValue={opts.fallback ?? 0}
        allowNegative={opts.allowNegative ?? false}
        aria-label={label}
      />
    </label>
  );
  const drained = model.columnCohesion !== undefined && model.columnFrictionAngle !== undefined;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {field("unitWeight", "γ (kN/m³)", { min: 0.01, fallback: 0.1 })}
        <UnitWeightSatField value={model.unitWeightSat} onChange={(unitWeightSat) => onChange({ unitWeightSat })} />
        {field("areaRatio", "Area ratio a (–)", { min: 0, max: 1 })}
        {field("columnSu", "Su columns (kPa)", { min: 0 })}
        {field("soilSu", "Su soil at reference level (kPa)", { min: 0 })}
        {field("suRefDepth", "Reference level y (m)", { allowNegative: true })}
        {field("suRateOfChange", "Su soil increase rate (kPa/m)", { allowNegative: true })}
        <CutoffField value={model.suMax} rate={model.suRateOfChange ?? 0} onChange={(suMax) => onChange({ suMax })} />
      </div>
      <label className="flex items-center gap-2 text-[11px]" title="Limit the column strength to c′ + σ′·tan φ′ (≤ Su columns), e.g. c′ = 0.3·Su, φ′ = 30°.">
        <input
          type="checkbox"
          checked={drained}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? { columnCohesion: Math.round(0.3 * model.columnSu * 10) / 10, columnFrictionAngle: 30 }
                : { columnCohesion: undefined, columnFrictionAngle: undefined },
            )
          }
        />
        Drained limit of the column strength
      </label>
      {drained && (
        <div className="grid grid-cols-2 gap-2">
          {field("columnCohesion", "c′ columns (kPa)", { min: 0 })}
          {field("columnFrictionAngle", "φ′ columns (°)", { min: 0, max: 89 })}
        </div>
      )}
    </div>
  );
}
