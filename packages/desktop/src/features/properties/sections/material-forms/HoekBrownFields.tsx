import { Label } from "../../../../components/ui/Label";
import { ExpressionNumericInput } from "../../../../components/ui/ExpressionNumericInput";
import { hoekBrownParameters, type HoekBrownModel } from "@cslope/engine";
import type { MaterialExpressions } from "../../../../store/types";
import { UnitWeightSatField } from "./UnitWeightSatField";

interface Props {
  model: HoekBrownModel;
  onChange: (patch: Partial<HoekBrownModel>) => void;
  modelExpressions: MaterialExpressions | undefined;
  parameterValues: Record<string, number>;
  onExpressionChange: (field: string, expression: string | undefined) => void;
}

/** Generalised Hoek–Brown rock mass: σci, GSI, mi and D, with the derived mb, s and a. */
export function HoekBrownFields({ model, onChange, modelExpressions, parameterValues, onExpressionChange }: Props) {
  const field = (
    key: "unitWeight" | "ucs" | "gsi" | "mi" | "disturbance",
    label: string,
    value: number,
    min: number,
    fallback: number,
    title?: string,
  ) => (
    <label className="flex flex-col gap-0.5" title={title}>
      <Label>{label}</Label>
      <ExpressionNumericInput
        value={value}
        expression={modelExpressions?.[key]}
        vars={parameterValues}
        onValueChange={(v) => onChange({ [key]: v } as Partial<HoekBrownModel>)}
        onExpressionChange={(expr) => onExpressionChange(key, expr)}
        min={min}
        fallbackValue={fallback}
        allowNegative={false}
        aria-label={label}
      />
    </label>
  );
  const p = hoekBrownParameters(model.ucs, model.gsi, model.mi, model.disturbance ?? 0);
  return (
    <div className="grid grid-cols-2 gap-2">
      {field("unitWeight", "γ (kN/m³)", model.unitWeight, 0.01, 0.1)}
      <UnitWeightSatField value={model.unitWeightSat} onChange={(unitWeightSat) => onChange({ unitWeightSat })} />
      {field("ucs", "σci (kPa)", model.ucs, 0, 10000, "Uniaxial compressive strength of the intact rock")}
      {field("gsi", "GSI", model.gsi, 0, 50, "Geological Strength Index of the rock mass, 0–100")}
      {field("mi", "mi", model.mi, 0, 10, "Intact rock constant (e.g. 4–10 for mudstones and shales, 17–25 for sandstones, 25–33 for granites)")}
      {field("disturbance", "D", model.disturbance ?? 0, 0, 0, "Disturbance factor, 0 (undisturbed) to 1 (heavy blasting or stress relief)")}
      <p className="col-span-2 text-[11px] tabular-nums" style={{ color: "var(--color-vsc-text-muted)" }}>
        mb = {p.mb.toPrecision(3)}, s = {p.s.toPrecision(3)}, a = {p.a.toFixed(3)}. The analyses use the instantaneous c′ and φ′ at the normal stress they find on the slip surface (in FE, at the stress state).
      </p>
    </div>
  );
}
