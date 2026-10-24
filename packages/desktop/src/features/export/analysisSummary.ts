import {
  MATERIAL_MODEL_LABELS,
  WATER_UNIT_WEIGHT,
  type AnalysisOptions,
  type AnalysisResult,
  type MaterialModel,
  type PartialFactors,
} from "@cslope/engine";
import type {
  AnalysisLimitsState,
  MaterialRow,
  ModelOrientation,
  PiezometricLineState,
  PileRow,
  ReinforcementRow,
} from "../../store/types";
import { mainPiezoLine } from "../../utils/piezo";
import { equilibriumGapText, surfaceCountText } from "../../utils/result-summary";

/**
 * What an analysis was run with and what it found, as text for the summary
 * page of the PDF report: enough for a checker to repeat the calculation
 * (Eurocode 7, EN 1997-1 2.8: the report states the data, the assumptions
 * and the calculation method).
 */

export interface SummaryRow {
  label: string;
  value: string;
}

export interface SummarySection {
  title: string;
  rows?: SummaryRow[];
  table?: { header: string[]; rows: string[][] };
  note?: string;
}

export interface AnalysisSummaryInput {
  result: AnalysisResult;
  options: AnalysisOptions;
  analysisLimits: AnalysisLimitsState;
  orientation: ModelOrientation;
  piezometricLine: PiezometricLineState;
  materials: MaterialRow[];
  udls: { x1: number; x2: number; magnitude: number }[];
  lineLoads: { x: number; magnitude: number }[];
  reinforcements?: ReinforcementRow[];
  piles?: PileRow[];
  customPlanesOnly?: boolean;
  customSurfaceCount?: number;
}

/** A number as typed: up to four decimals, no trailing zeros. */
export function fmt(v: number | undefined | null): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "-";
  if (Math.abs(v) < 1e-12) return "0";
  return Number(v.toFixed(4)).toString();
}

const INTERSLICE_LABELS: Record<string, string> = {
  constant: "constant (Spencer)",
  "half-sine": "half-sine",
  "clipped-sine": "clipped sine",
  trapezoidal: "trapezoidal",
  "data-point-specified": "specified by data points",
};

/** The method as a reader would cite it. */
export function methodText(options: AnalysisOptions): string {
  switch (options.method) {
    case "Bishop":
      return "Bishop simplified (moment equilibrium)";
    case "Janbu":
      return options.janbuCorrection
        ? "Janbu simplified (force equilibrium), with correction factor f0"
        : "Janbu simplified (force equilibrium), without correction factor";
    case "Morgenstern-Price": {
      const fn = options.intersliceFunction ?? "half-sine";
      return `Morgenstern-Price (complete equilibrium), interslice function ${INTERSLICE_LABELS[fn] ?? fn}`;
    }
  }
}

/** The factor and what it means: on design values it is an over-design factor. */
export function fosLabel(partialFactors: PartialFactors | null | undefined): string {
  return partialFactors ? "Over-design factor (design values)" : "Minimum factor of safety";
}

/** Characteristic strength of a material model, in words. */
export function strengthText(model: MaterialModel): string {
  const cutoff = (m: { suMax?: number }, rate: number | undefined) =>
    m.suMax === undefined ? "" : `, ${(rate ?? 0) < 0 ? "minimum" : "maximum"} ${fmt(m.suMax)} kPa`;
  switch (model.kind) {
    case "mohr-coulomb": {
      const c = model.cFactor ? `${fmt(model.cohesion)} × ${fmt(model.cFactor)}` : fmt(model.cohesion);
      let s = `c' = ${c} kPa, φ' = ${fmt(model.frictionAngle)}°`;
      if (model.cohesionRateOfChange) {
        s += `, c' + ${fmt(model.cohesionRateOfChange)} kPa/m below y = ${fmt(model.cohesionRefDepth ?? 0)} m`;
      }
      if (model.cFactor) {
        s += `; combined, limited by Su = ${fmt(model.cohesionUndrained ?? model.cohesion)} kPa`;
      }
      return s;
    }
    case "undrained": {
      let s = `Su = ${fmt(model.undrainedShearStrength)} kPa`;
      if (model.suRateOfChange) {
        s += `, + ${fmt(model.suRateOfChange)} kPa/m below y = ${fmt(model.suRefDepth ?? 0)} m`;
      }
      return s + cutoff(model, model.suRateOfChange);
    }
    case "s-f-depth": {
      const from = model.depthReference === "layer-top" ? "the layer top" : "the ground";
      return (
        `Su = ${fmt(model.suRef)} kPa at ${fmt(model.depthRef)} m below ${from}, ` +
        `${fmt(model.rate)} kPa/m with depth` +
        cutoff(model, model.rate)
      );
    }
    case "s-f-datum":
      return (
        `Su = ${fmt(model.suRef)} kPa at y = ${fmt(model.yRef)} m, ` +
        `${fmt(model.rate)} kPa/m below` +
        cutoff(model, model.rate)
      );
    case "anisotropic-function":
      return (
        `c' = ${fmt(model.cohesion)} kPa, φ' = ${fmt(model.frictionAngle)}°, ` +
        `modified with base inclination (${model.modifierFunction.length} points)`
      );
    case "spatial-mohr-coulomb":
      return `c', φ' and γ interpolated (${model.interpolation ?? "idw"}) from ${model.dataPoints.length} points`;
    case "lime-cement-columns": {
      let s =
        `soil Su = ${fmt(model.soilSu)} kPa` +
        (model.suRateOfChange
          ? ` + ${fmt(model.suRateOfChange)} kPa/m below y = ${fmt(model.suRefDepth ?? 0)} m`
          : "") +
        cutoff(model, model.suRateOfChange) +
        `; columns Su = ${fmt(model.columnSu)} kPa, area ratio ${fmt(model.areaRatio)}`;
      if (model.columnCohesion !== undefined && model.columnFrictionAngle !== undefined) {
        s += `, drained c' = ${fmt(model.columnCohesion)} kPa, φ' = ${fmt(model.columnFrictionAngle)}°`;
      }
      return s;
    }
    case "high-strength":
      return "not sheared (surfaces through it are skipped)";
    case "impenetrable":
      return "impenetrable (surfaces do not enter)";
  }
}

function unitWeightText(model: MaterialModel): string {
  return model.unitWeightSat !== undefined && model.unitWeightSat !== model.unitWeight
    ? `${fmt(model.unitWeight)} / ${fmt(model.unitWeightSat)}`
    : fmt(model.unitWeight);
}

function directionText(d: ModelOrientation): string {
  return d === "ltr" ? "towards +x (right)" : "towards -x (left)";
}

function countByType(items: { type: string }[]): string {
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.type, (counts.get(it.type) ?? 0) + 1);
  return [...counts].map(([t, n]) => `${n} ${t}`).join(", ");
}

export function buildAnalysisSummary(input: AnalysisSummaryInput): SummarySection[] {
  const { result, options, piezometricLine: piezo } = input;
  const pf = options.partialFactors ?? null;
  const cs = result.criticalSurface;
  const sections: SummarySection[] = [];

  // ── Result ──
  const res: SummaryRow[] = [
    { label: fosLabel(pf), value: Number.isFinite(result.minFOS) ? result.minFOS.toFixed(3) : "-" },
    { label: "Method", value: methodText(options) },
  ];
  if (cs) {
    res.push({
      label: "Critical surface",
      value: cs.points
        ? `non-circular, ${cs.points.length} points`
        : `circle, centre (${fmt(cs.cx)}, ${fmt(cs.cy)}) m, radius ${fmt(cs.radius)} m`,
    });
    res.push({
      label: "Entry / exit",
      value: `(${fmt(cs.entryPoint[0])}, ${fmt(cs.entryPoint[1])}) / (${fmt(cs.exitPoint[0])}, ${fmt(cs.exitPoint[1])}) m`,
    });
  }
  const direction = result.slidingDirection ?? input.orientation;
  res.push({ label: "Sliding direction", value: directionText(direction) });
  if (result.slidingDirection) {
    res.push({
      label: "Other direction",
      value:
        result.otherDirectionMinFOS == null
          ? "no valid surface"
          : `${result.otherDirectionMinFOS.toFixed(3)} (automatic search limits)`,
    });
  }
  res.push({ label: "Surfaces analysed", value: surfaceCountText(result) });
  if (result.nonConvergedSurfaces) {
    res.push({ label: "Not converged", value: `${result.nonConvergedSurfaces} surfaces (no factor)` });
  }
  if (cs?.equilibriumGap !== undefined && cs.equilibriumGap !== null) {
    res.push({ label: "Warning", value: equilibriumGapText(cs.equilibriumGap) });
  }
  if (cs && cs.converged === false) {
    res.push({ label: "Warning", value: "The critical surface did not converge within the iteration limit" });
  }
  for (const w of result.warnings ?? []) res.push({ label: "Warning", value: w.message });
  sections.push({ title: "Result", rows: res });

  // ── Search ──
  const lim = input.analysisLimits;
  const search: SummaryRow[] = [];
  if (input.customPlanesOnly) {
    search.push({ label: "Surfaces", value: `custom surfaces only (${input.customSurfaceCount ?? 0})` });
  } else {
    search.push({
      label: "Surfaces",
      value:
        "circular search" +
        (options.nonCircularOptimization ? ", best circles optimised as non-circular surfaces" : "") +
        (input.customSurfaceCount ? `, and ${input.customSurfaceCount} custom surfaces` : ""),
    });
    search.push({
      label: "Search limits",
      value: lim.enabled
        ? `entry x ${fmt(Math.min(lim.entryLeftX, lim.entryRightX))} to ${fmt(Math.max(lim.entryLeftX, lim.entryRightX))} m, ` +
          `exit x ${fmt(Math.min(lim.exitLeftX, lim.exitRightX))} to ${fmt(Math.max(lim.exitLeftX, lim.exitRightX))} m`
        : "automatic",
    });
    search.push({
      label: "Trial surfaces",
      value:
        `${options.iterations}` +
        (options.refinedIterations ? ` + ${options.refinedIterations} refined` : ""),
    });
    search.push({ label: "Both directions", value: options.bothDirections ? "yes" : "no" });
  }
  search.push({ label: "Slices", value: `${options.slices}` });
  search.push({
    label: "Convergence",
    value: `tolerance ${fmt(options.tolerance)}, at most ${options.maxIterations} iterations`,
  });
  if (options.minFailureDist) {
    search.push({ label: "Minimum entry-exit distance", value: `${fmt(options.minFailureDist)} m` });
  }
  if (options.minSlipDepth) {
    search.push({ label: "Minimum slip depth", value: `${fmt(options.minSlipDepth)} m` });
  }
  search.push({
    label: "Minimum sliding area",
    value:
      options.minSlipArea == null
        ? "automatic (1 % of the squared ground relief)"
        : options.minSlipArea === 0
          ? "none"
          : `${fmt(options.minSlipArea)} m²`,
  });
  sections.push({ title: "Search", rows: search });

  // ── Water ──
  const water: SummaryRow[] = [];
  // The lines the analysis uses (see buildSlopeDTOFromModel): those with
  // two points or more; the main line among them.
  const lines = piezo.lines.filter((l) => l.coordinates.length >= 2);
  const main = mainPiezoLine({ lines, mainLineId: piezo.mainLineId });
  if (lines.length === 0) {
    water.push({ label: "Piezometric lines", value: "none (no pore pressure)" });
  } else {
    water.push({ label: "Piezometric lines", value: lines.map((l) => l.name).join(", ") });
    if (lines.length > 1 && main) {
      water.push({ label: "Main line", value: `${main.name} (free water, materials without a line)` });
    }
    water.push({
      label: "Pore pressure",
      value:
        options.porePressureHead === "phreatic-correction"
          ? "vertical head × cos²θ (phreatic correction)"
          : "vertical head below the line",
    });
    water.push({
      label: "Water above ground",
      value:
        piezo.freeWater !== false
          ? "free water: its weight acts on the ground"
          : "line clipped to the ground",
    });
  }
  water.push({ label: "Unit weight of water", value: `${WATER_UNIT_WEIGHT} kN/m³` });
  if (options.tensionCrackAuto || options.tensionCrackDepth) {
    water.push({
      label: "Tension crack",
      value: options.tensionCrackAuto
        ? "Rankine depth from the soil at each entry"
        : `${fmt(options.tensionCrackDepth)} m deep`,
    });
    water.push({
      label: "Water in crack",
      value: `${fmt((options.tensionCrackWater ?? 0) * 100)} % of the crack depth`,
    });
  } else {
    water.push({ label: "Tension crack", value: "none" });
  }
  sections.push({ title: "Water and tension crack", rows: water });

  // ── Partial factors ──
  if (pf) {
    sections.push({
      title: "Partial factors",
      rows: [
        { label: "γcu (undrained strength)", value: fmt(pf.cu) },
        { label: "γc' (effective cohesion)", value: fmt(pf.cohesion) },
        { label: "γφ' (on tan φ')", value: fmt(pf.tanPhi) },
        { label: "γQ (variable loads)", value: fmt(pf.variableLoad) },
      ],
      note:
        "Strengths are divided and variable loads multiplied by the factors. The factor is the " +
        "over-design factor on design values: 1.0 or more satisfies the design. The material " +
        "values in this summary are characteristic.",
    });
  } else {
    sections.push({
      title: "Partial factors",
      rows: [{ label: "Values", value: "characteristic (no partial factors)" }],
    });
  }

  // ── Materials ──
  const lineName = (m: MaterialRow): string => {
    if (lines.length === 0) return "-";
    const own = lines.find((l) => l.id === piezo.materialAssignment[m.id]);
    return (own ?? main)?.name ?? "-";
  };
  sections.push({
    title: "Materials (characteristic values)",
    table: {
      header: ["Name", "Model", "γ / γsat (kN/m³)", "Strength", "Water line"],
      rows: input.materials.map((m) => [
        m.name,
        MATERIAL_MODEL_LABELS[m.model.kind],
        unitWeightText(m.model),
        strengthText(m.model),
        lineName(m),
      ]),
    },
  });

  // ── Loads and structures ──
  const loads: string[][] = [
    ...input.udls.map((u) => [
      "Distributed load",
      `x ${fmt(Math.min(u.x1, u.x2))} to ${fmt(Math.max(u.x1, u.x2))} m`,
      `${fmt(u.magnitude)} kPa`,
    ]),
    ...input.lineLoads.map((l) => ["Line load", `x = ${fmt(l.x)} m`, `${fmt(l.magnitude)} kN/m`]),
  ];
  const reinf = input.reinforcements ?? [];
  const piles = input.piles ?? [];
  if (loads.length > 0 || reinf.length > 0 || piles.length > 0) {
    const rows: SummaryRow[] = [];
    if (reinf.length > 0) rows.push({ label: "Reinforcement", value: countByType(reinf) });
    if (piles.length > 0) rows.push({ label: "Piles", value: countByType(piles) });
    sections.push({
      title: "Loads and structures",
      ...(loads.length > 0 ? { table: { header: ["Load", "Position", "Magnitude"], rows: loads } } : {}),
      ...(rows.length > 0 ? { rows } : {}),
      ...(pf && loads.length > 0
        ? { note: `Loads are variable and multiplied by γQ = ${fmt(pf.variableLoad)} in the analysis.` }
        : {}),
    });
  }

  return sections;
}
