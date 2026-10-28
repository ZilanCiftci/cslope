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

/** Coordinates and displacements are rounded to this many significant digits for the summary. */
const DIGITS = 7;
const round = (v: number) => Number(v.toPrecision(DIGITS));

export function runFemSummary(
  definition: SlopeDefinition,
  settings: FemAnalysisSettings,
  onTrial?: (trial: SrmTrial) => void,
): FemResultSummary {
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
  return {
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
  };
}
