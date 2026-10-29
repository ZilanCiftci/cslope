import type { ModelEntry } from "../../store/types";
import { resolveModelParameters } from "../../store/slices/parametersSlice";
import { resolveParameters } from "../../utils/expression";
import { toCsv } from "../export/sliceTable";

/** What a sensitivity analysis varies. */
export type SensitivityVariable =
  | { kind: "parameter"; name: string }
  | { kind: "material"; materialId: string; field: string };

export interface VariableOption {
  key: string;
  label: string;
  variable: SensitivityVariable;
  /** Current value in the model. */
  value: number;
}

export interface SensitivityPoint {
  value: number;
  fos: number | null;
  error?: string;
}

const FIELD_LABELS: Record<string, string> = {
  unitWeight: "γ (kN/m³)",
  cohesion: "c (kPa)",
  frictionAngle: "φ (°)",
  undrainedShearStrength: "Su (kPa)",
  suRateOfChange: "Su increase (kPa/m)",
  cohesionUndrained: "Su, combined (kPa)",
  cohesionRateOfChange: "c increase (kPa/m)",
  suRef: "Su ref (kPa)",
  rate: "Su increase (kPa/m)",
  depthRef: "Reference depth (m)",
  yRef: "Reference level (m)",
  ucs: "σci (kPa)",
  gsi: "GSI",
  mi: "mi",
  disturbance: "D",
};

/** Variables of a model: its parameters and the materials' numbers. */
export function listVariables(model: ModelEntry): VariableOption[] {
  const out: VariableOption[] = [];
  const { resolved } = resolveParameters(model.parameters ?? []);
  for (const [name, value] of Object.entries(resolved)) {
    out.push({
      key: `p:${name}`,
      label: `Parameter ${name}`,
      variable: { kind: "parameter", name },
      value,
    });
  }
  for (const m of model.materials) {
    const fields = m.model as unknown as Record<string, unknown>;
    for (const [field, label] of Object.entries(FIELD_LABELS)) {
      const value = fields[field];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      out.push({
        key: `m:${m.id}:${field}`,
        label: `${m.name}: ${label}`,
        variable: { kind: "material", materialId: m.id, field },
        value,
      });
    }
  }
  return out;
}

/** The model with the variable set to `value`. */
export function modelWithValue(
  model: ModelEntry,
  variable: SensitivityVariable,
  value: number,
): ModelEntry {
  if (variable.kind === "parameter") {
    const parameters = (model.parameters ?? []).map((p) =>
      p.name.trim() === variable.name ? { ...p, expression: String(value) } : p,
    );
    return {
      ...model,
      ...resolveModelParameters(
        { ...model, coordinateExpressions: model.coordinateExpressions ?? [] },
        parameters,
      ),
    };
  }
  return {
    ...model,
    materials: model.materials.map((m) => {
      if (m.id !== variable.materialId) return m;
      // The field's own expression would override the value.
      const modelExpressions = m.modelExpressions
        ? Object.fromEntries(
            Object.entries(m.modelExpressions).filter(([k]) => k !== variable.field),
          )
        : undefined;
      const next = { ...m.model, [variable.field]: value } as typeof m.model;
      return { ...m, model: next, modelExpressions };
    }),
  };
}

/** Evenly spaced values from `from` to `to` (inclusive). */
export function sensitivityValues(from: number, to: number, steps: number): number[] {
  const n = Math.max(2, Math.min(101, Math.round(steps)));
  // Rounded so 25.6 + 1.6 is 27.2, not 27.200000000000003.
  return Array.from({ length: n }, (_, i) =>
    Number((from + ((to - from) * i) / (n - 1)).toPrecision(12)),
  );
}

/** CSV of the points (Swedish Excel variant with `decimalComma`). */
export function sensitivityCsv(
  label: string,
  points: SensitivityPoint[],
  decimalComma = false,
): string {
  return toCsv(
    [
      [label, "FOS", "Note"],
      ...points.map((p) => [
        p.value,
        p.fos == null ? null : Math.round(p.fos * 10000) / 10000,
        p.error ?? null,
      ]),
    ],
    decimalComma,
  );
}
