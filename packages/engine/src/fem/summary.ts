/**
 * The finite element analysis as the app runs it: from a slope definition
 * and the analysis settings to a summary in model coordinates, as plain
 * arrays that pass through a worker message and a project file.
 */

import type { SlopeDefinition } from "../types/slope-definition";
import type { FemAnalysisSettings, FemResultSummary } from "../types/analysis";
import { buildSlope } from "../model/build-slope";
import { getDomainX, resolveOrientation, toCanonicalSlopeDefinition } from "../model/canonical";
import { analyzeFem } from "./analysis";
import type { SrmTrial } from "./srm";
import type { Slope } from "../model/slope";
import { lowerBound, type HighsModuleOptions } from "./lower-bound";
import { upperBound } from "./upper-bound";

/** Coordinates and displacements are rounded to this many significant digits for the summary. */
const DIGITS = 7;
const round = (v: number) => Number(v.toPrecision(DIGITS));

export function runFemSummary(
  definition: SlopeDefinition,
  settings: FemAnalysisSettings,
  onTrial?: (trial: SrmTrial) => void,
): FemResultSummary {
  return femAnalysis(definition, settings, onTrial).summary;
}

/**
 * The finite element analysis and, when the settings ask for them
 * (`limitAnalysis`), the lower and upper bounds of limit analysis on a mesh
 * graded as the strength reduction's final mesh, BOUND_COARSENING times
 * coarser (the linear programs grow fast with the elements); the upper
 * bound's search starts at the strength reduction factor. `highs` options
 * load the solver (e.g. its WebAssembly binary in an app).
 */
export async function runFemSummaryWithBounds(
  definition: SlopeDefinition,
  settings: FemAnalysisSettings,
  onTrial?: (trial: SrmTrial) => void,
  highs?: HighsModuleOptions,
): Promise<FemResultSummary> {
  const { summary, slope, sizeField } = femAnalysis(definition, settings, onTrial);
  if (!settings.limitAnalysis) return summary;
  const t0 = performance.now();
  const sf = Object.assign((x: number, y: number) => BOUND_COARSENING * sizeField(x, y), { min: (sizeField.min ?? 0) * BOUND_COARSENING });
  const common = {
    sizeField: sf,
    tensionCutoff: settings.tensionCutoff,
    porePressure: settings.porePressure ?? "water-table",
    fTolerance: 0.005,
    timeLimit: BOUND_TIME_LIMIT,
  } as const;
  const warnings: string[] = [];
  const upper = await upperBound(slope, { ...common, startF: summary.factorOfSafety > 0 ? summary.factorOfSafety : 1 }, undefined, highs);
  const lower = await lowerBound(slope, common, undefined, highs);
  for (const w of upper.warnings) warnings.push(`Upper bound: ${w}`);
  for (const w of lower.warnings) warnings.push(`Lower bound: ${w}`);
  return {
    ...summary,
    bounds: {
      lower: Number.isFinite(lower.factorOfSafety) ? lower.factorOfSafety : null,
      upper: Number.isFinite(upper.factorOfSafety) ? upper.factorOfSafety : null,
      elements: upper.elements,
      elapsedMs: performance.now() - t0,
      warnings,
    },
  };
}

/** Coarsening of the bounds' mesh against the strength reduction's final mesh (implementation choice: about 600 elements on V055, 30 s for the upper bound and 2 min for the lower). */
const BOUND_COARSENING = 2;
/** Time limit per linear program of the bounds in the app (s). */
const BOUND_TIME_LIMIT = 120;

function femAnalysis(
  definition: SlopeDefinition,
  settings: FemAnalysisSettings,
  onTrial?: (trial: SrmTrial) => void,
): { summary: FemResultSummary; slope: Slope; sizeField: ((x: number, y: number) => number) & { min?: number } } {
  const t0 = performance.now();
  const slope = buildSlope(toCanonicalSlopeDefinition(definition));
  const r = analyzeFem(slope, {
    flowRule: settings.flowRule,
    materialParameters: {
      "*": {
        youngsModulus: settings.youngsModulus,
        poissonsRatio: settings.poissonsRatio,
        dilationAngle: settings.dilationAngle,
      },
    },
    elementSize: settings.elementSize ?? undefined,
    tensionCutoff: settings.tensionCutoff,
    porePressure: settings.porePressure ?? "water-table",
    solver: settings.flowRule === "non-associated" && settings.nonAssociatedSolver === "newton" ? "newton" : undefined,
    convergence: settings.convergence === "equilibrium" ? "equilibrium" : undefined,
    adaptive: settings.refinementLevels > 0 ? { levels: Math.min(3, Math.round(settings.refinementLevels)), tolerance: 0.01 } : undefined,
    onTrial,
  });
  // The analysis runs on the slope as it slides to the right; mirror back.
  const rtl = resolveOrientation(definition.orientation, definition.coordinates) === "rtl";
  const [xMin, xMax] = getDomainX(definition.coordinates);
  const x = Array.from(r.mesh.x, (v) => round(rtl ? xMin + xMax - v : v));
  const y = Array.from(r.mesh.y, round);
  const displacement = Array.from(r.displacement, (v, i) => round(rtl && i % 2 === 0 ? -v : v));
  const triangles = Array.from(r.mesh.triangles);
  if (rtl) {
    // keep the elements counter-clockwise after mirroring
    for (let e = 0; e < triangles.length; e += 3) [triangles[e + 1], triangles[e + 2]] = [triangles[e + 2], triangles[e + 1]];
  }
  const summary: FemResultSummary = {
    factorOfSafety: r.factorOfSafety,
    failedF: r.failedF,
    flowRule: settings.flowRule,
    levels: r.levels.map((l) => ({ elements: l.elements, fos: l.factorOfSafety })),
    warnings: r.warnings,
    elapsedMs: performance.now() - t0,
    x,
    y,
    triangles,
    plasticShear: Array.from(r.plasticShearStrain, round),
    shearIncrement: Array.from(r.shearStrainIncrement, round),
    displacement,
    curve: forceDisplacementCurve(r.trials),
  };
  return { summary, slope, sizeField: r.sizeField };
}

/**
 * Largest displacement of the converged trials by increasing F, one point
 * per F (its first trial). Displacements depend on the load path, so only
 * trials that rose from a converged state are taken, as in the
 * displacement-jump test of srm.ts.
 */
function forceDisplacementCurve(trials: readonly SrmTrial[]): { F: number; displacement: number }[] {
  return trials
    .filter((t) => t.converged && t.startF > 0)
    .sort((a, b) => a.F - b.F)
    .filter((t, k, all) => k === 0 || t.F > all[k - 1].F)
    .map((t) => ({ F: round(t.F), displacement: round(t.maxDisplacement) }));
}
