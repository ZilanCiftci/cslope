import type { RandomVariable, ReliabilityResult } from "@cslope/engine";
import type { ModelEntry } from "../../store/types";
import { listVariables } from "../sensitivity/sensitivity";
import { toCsv } from "../export/sliceTable";

/** A material value the probabilistic analysis can treat as random. */
export interface RandomCandidate {
  key: string;
  label: string;
  materialId: string;
  field: string;
  /** Mean = the value in the model. */
  value: number;
}

/** One random variable as edited in the panel. */
export interface RandomRow {
  key: string;
  sd: number;
  distribution: "normal" | "lognormal";
}

// Reference levels and depths are geometry, not soil properties.
const NOT_RANDOM = new Set(["depthRef", "yRef"]);

/** Material values of a model that can be random variables. */
export function listRandomCandidates(model: ModelEntry): RandomCandidate[] {
  return listVariables(model).flatMap((v) =>
    v.variable.kind === "material" && !NOT_RANDOM.has(v.variable.field)
      ? [{ key: v.key, label: v.label, materialId: v.variable.materialId, field: v.variable.field, value: v.value }]
      : [],
  );
}

/** A default σ: a typical coefficient of variation for the property. */
export function defaultSd(candidate: RandomCandidate): number {
  const cov = candidate.field === "unitWeight" ? 0.05 : candidate.field === "frictionAngle" ? 0.1 : 0.25;
  return Number((Math.abs(candidate.value) * cov).toPrecision(2)) || 1;
}

/**
 * Engine variables for the rows (materials by their index in the model,
 * which is the order of the analysis request). Rows whose value no longer
 * exists, or with σ = 0, are left out.
 */
export function toRandomVariables(model: ModelEntry, rows: RandomRow[]): RandomVariable[] {
  const candidates = new Map(listRandomCandidates(model).map((c) => [c.key, c]));
  return rows.flatMap((row) => {
    const c = candidates.get(row.key);
    const material = c ? model.materials.findIndex((m) => m.id === c.materialId) : -1;
    if (!c || material < 0 || !(row.sd > 0)) return [];
    return [{ material, field: c.field, sd: row.sd, distribution: row.distribution }];
  });
}

/** Histogram of the Monte Carlo factors of safety: `bins` equal bins. */
export function histogram(samples: number[], bins = 30): { from: number; to: number; count: number }[] {
  if (samples.length === 0) return [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const f of samples) {
    if (f < lo) lo = f;
    if (f > hi) hi = f;
  }
  if (hi === lo) return [{ from: lo, to: hi, count: samples.length }];
  const width = (hi - lo) / bins;
  const out = Array.from({ length: bins }, (_, i) => ({ from: lo + i * width, to: lo + (i + 1) * width, count: 0 }));
  for (const f of samples) out[Math.min(bins - 1, Math.floor((f - lo) / width))].count++;
  return out;
}

/** CSV of a result: the summary and the Taylor terms or the samples. */
export function reliabilityCsv(
  result: ReliabilityResult,
  labels: string[],
  decimalComma = false,
): string {
  const r4 = (v: number) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);
  const rows: (string | number | null)[][] = [
    ["Method", result.method === "taylor" ? "Taylor series" : "Monte Carlo"],
    ["FOS (mean values)", r4(result.fos)],
    ["Mean FOS", r4(result.meanFOS)],
    ["σ FOS", r4(result.sdFOS)],
    ["COV", r4(result.cov)],
    ["β (lognormal)", r4(result.betaLognormal)],
    ["Pf (lognormal)", r4(result.pfLognormal)],
    ["β (normal)", r4(result.betaNormal)],
  ];
  if (result.pf != null) rows.push(["Pf (share of samples with FOS < 1)", r4(result.pf)]);
  rows.push([]);
  if (result.terms) {
    rows.push(["Variable", "Mean", "σ", "FOS (mean + σ)", "FOS (mean − σ)"]);
    for (const t of result.terms) rows.push([labels[t.variable] ?? "", t.mean, t.sd, r4(t.fPlus), r4(t.fMinus)]);
  } else if (result.samples) {
    rows.push(["Sample", "FOS"]);
    result.samples.forEach((f, i) => rows.push([i + 1, r4(f)]));
  }
  return toCsv(rows, decimalComma);
}
