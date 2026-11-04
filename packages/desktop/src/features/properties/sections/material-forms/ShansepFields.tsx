import { Label } from "../../../../components/ui/Label";
import { ExpressionNumericInput } from "../../../../components/ui/ExpressionNumericInput";
import { DraftNumberInput } from "../../../../components/ui/DraftNumberInput";
import { DataPointTable } from "../../../../components/ui/DataPointTable";
import type { ShansepModel } from "@cslope/engine";
import type { MaterialExpressions } from "../../../../store/types";
import { AnisotropyField } from "./AnisotropyField";
import { UnitWeightSatField } from "./UnitWeightSatField";
import { NO_SPINNER } from "./styles";
import { ocrOverrideText } from "./ocr-override";

interface Props {
  model: ShansepModel;
  onChange: (patch: Partial<ShansepModel>) => void;
  modelExpressions: MaterialExpressions | undefined;
  parameterValues: Record<string, number>;
  onExpressionChange: (field: string, expression: string | undefined) => void;
}

/** Rows of a point table as the model stores them; no rows: not set. */
function toPoints(rows: number[][]): [number, number][] | undefined {
  return rows.length ? rows.map((r) => [r[0], r[1]] as [number, number]) : undefined;
}

/**
 * A point table switched on by a checkbox, like the anisotropy field: off,
 * the model has no table (and its constant parameters apply).
 */
function PointTableField({
  label,
  title,
  headers,
  value,
  initial,
  onChange,
  disabled,
}: {
  label: string;
  title: string;
  headers: [string, string];
  value: [number, number][] | undefined;
  initial: () => [number, number][];
  onChange: (points: [number, number][] | undefined) => void;
  disabled?: boolean;
}) {
  const on = value !== undefined;
  return (
    <fieldset disabled={disabled} className="col-span-2 space-y-1" style={disabled ? { opacity: 0.6 } : undefined}>
      <label className="flex items-center gap-1.5" title={title}>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => onChange(e.target.checked ? initial() : undefined)}
          aria-label={label}
        />
        <Label>{label}</Label>
      </label>
      {on && (
        <DataPointTable
          headers={headers}
          rows={value.map(([x, y]) => [x, y])}
          onChange={(rows) => onChange(toPoints(rows))}
          minRows={1}
        />
      )}
    </fieldset>
  );
}

/** The note that the OCR fields do not apply, with a button that clears the stress history. */
function OcrOverride({ text, onUseOcr }: { text: string; onUseOcr: () => void }) {
  return (
    <div
      role="note"
      data-testid="ocr-override"
      className="col-span-2 flex items-center gap-2 text-[11px]"
      style={{ color: "var(--color-vsc-text)" }}
    >
      <span className="flex-1">{text}.</span>
      <button
        type="button"
        onClick={onUseOcr}
        className="btn flex-shrink-0"
        title="Remove the imported stress history and use the OCR fields"
      >
        Use OCR instead
      </button>
    </div>
  );
}

/**
 * The imported stress history that replaces OCR, editable: POP (on its own
 * or added to the earlier stage's stress) or the yield stress σ′y. Emptied,
 * POP on top of the earlier stage is none; POP or σ′y on its own is kept
 * (the "Use OCR instead" button removes it).
 */
function StressHistoryField({ model, onChange }: { model: ShansepModel; onChange: (patch: Partial<ShansepModel>) => void }) {
  if (model.yieldFromEarlierStage || model.pop !== undefined) {
    const onStage = model.yieldFromEarlierStage === true;
    return (
      <label
        className="flex flex-col gap-0.5"
        title={
          onStage
            ? "Pre-overburden pressure added to the yield stress from the earlier stage (kPa). Empty: none."
            : "Pre-overburden pressure (kPa): OCR = (σ′v + POP)/σ′v at the slice base."
        }
      >
        <Label>POP (kPa)</Label>
        <DraftNumberInput
          value={model.pop}
          min={0}
          placeholder={onStage ? "None" : undefined}
          className={NO_SPINNER}
          onValueChange={(pop) => {
            if (pop >= 0) onChange({ pop });
          }}
          onClear={() => {
            if (onStage) onChange({ pop: undefined });
          }}
          aria-label="POP (kPa)"
        />
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-0.5" title="Yield (preconsolidation) stress (kPa): OCR = σ′y/σ′v at the slice base, at least 1.">
      <Label>σ′y (yield stress) (kPa)</Label>
      <DraftNumberInput
        value={model.yieldStress}
        min={0}
        className={NO_SPINNER}
        onValueChange={(yieldStress) => {
          if (yieldStress >= 0) onChange({ yieldStress });
        }}
        aria-label="σ′y (yield stress) (kPa)"
      />
    </label>
  );
}

/** Optional lower limit of Su; an empty field means none (0). */
function SuMinField({ value, onChange }: { value: number | undefined; onChange: (suMin: number | undefined) => void }) {
  return (
    <label className="flex flex-col gap-0.5" title="Lower limit of Su, e.g. near the ground surface where σ′v is small. Leave empty for none.">
      <Label>Min Su (kPa)</Label>
      <DraftNumberInput
        value={value}
        min={0}
        placeholder="None"
        className={NO_SPINNER}
        onValueChange={(v) => {
          if (v >= 0) onChange(v > 0 ? v : undefined);
        }}
        onClear={() => onChange(undefined)}
        aria-label="Min Su (kPa)"
      />
    </label>
  );
}

/**
 * SHANSEP: Su = σ′v · S · OCR^m from the effective vertical stress at the
 * slice base, with OCR constant or against elevation; or Su given directly
 * against σ′v, which replaces S, m and OCR.
 */
export function ShansepFields({
  model,
  onChange,
  modelExpressions,
  parameterValues,
  onExpressionChange,
}: Props) {
  const byStress = model.suByStress !== undefined;
  const byElevation = model.ocrByElevation !== undefined;
  // An imported stress history (POP, yield stress, earlier stage) replaces OCR.
  const override = ocrOverrideText(model);
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-0.5">
        <Label>γ (kN/m³)</Label>
        <ExpressionNumericInput
          value={model.unitWeight}
          expression={modelExpressions?.unitWeight}
          vars={parameterValues}
          onValueChange={(unitWeight) => onChange({ unitWeight })}
          onExpressionChange={(expr) => onExpressionChange("unitWeight", expr)}
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
      {!byStress && (
        <>
          <label className="flex flex-col gap-0.5">
            <Label title="Su/σ′v of the normally consolidated soil (OCR = 1).">S (Su/σ′v)</Label>
            <ExpressionNumericInput
              value={model.ratio}
              expression={modelExpressions?.ratio}
              vars={parameterValues}
              onValueChange={(ratio) => onChange({ ratio })}
              onExpressionChange={(expr) => onExpressionChange("ratio", expr)}
              min={0}
              fallbackValue={0}
              allowNegative={false}
              aria-label="S (Su/σ′v)"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <Label title="Exponent m of OCR, Su = σ′v · S · OCR^m. Default 0.8.">m (exponent)</Label>
            <ExpressionNumericInput
              value={model.exponent ?? 0.8}
              expression={modelExpressions?.exponent}
              vars={parameterValues}
              onValueChange={(exponent) => onChange({ exponent })}
              onExpressionChange={(expr) => onExpressionChange("exponent", expr)}
              fallbackValue={0.8}
              aria-label="m (exponent)"
            />
          </label>
          {override && (
            <OcrOverride
              text={override}
              onUseOcr={() => onChange({ pop: undefined, yieldStress: undefined, yieldFromEarlierStage: undefined })}
            />
          )}
          {override && <StressHistoryField model={model} onChange={onChange} />}
          {!byElevation && !override && (
            <label className="flex flex-col gap-0.5">
              <Label title="Overconsolidation ratio, constant through the material. Default 1.">OCR</Label>
              <ExpressionNumericInput
                value={model.ocr ?? 1}
                expression={modelExpressions?.ocr}
                vars={parameterValues}
                onValueChange={(ocr) => onChange({ ocr })}
                onExpressionChange={(expr) => onExpressionChange("ocr", expr)}
                min={0.01}
                fallbackValue={1}
                allowNegative={false}
                aria-label="OCR"
              />
            </label>
          )}
          <SuMinField value={model.suMin} onChange={(suMin) => onChange({ suMin })} />
          <PointTableField
            label="OCR against elevation"
            title="OCR as a function of the elevation of the slice base, interpolated linearly, constant beyond the ends; replaces the constant OCR. Points sorted by increasing elevation."
            headers={["y (m)", "OCR"]}
            value={model.ocrByElevation}
            initial={() => [
              [0, model.ocr ?? 1],
              [10, model.ocr ?? 1],
            ]}
            onChange={(ocrByElevation) => onChange({ ocrByElevation })}
            disabled={override !== null}
          />
        </>
      )}
      {byStress && <SuMinField value={model.suMin} onChange={(suMin) => onChange({ suMin })} />}
      <PointTableField
        label="Su against σ′v"
        title="Su as a function of the effective vertical stress at the slice base, interpolated linearly, constant beyond the ends; replaces S, m and OCR. Points sorted by increasing σ′v."
        headers={["σ′v (kPa)", "Su (kPa)"]}
        value={model.suByStress}
        initial={() => [
          [0, 0],
          [100, Math.round(100 * model.ratio * 100) / 100],
        ]}
        onChange={(suByStress) => onChange({ suByStress })}
      />
      <AnisotropyField
        value={model.anisotropy}
        onChange={(anisotropy) => onChange({ anisotropy })}
      />
    </div>
  );
}
