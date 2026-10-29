/**
 * Verification of the strength reduction analysis by finite elements
 * (src/fem) against published finite element, finite difference,
 * limit analysis and plasticity theory values. The problems are those of
 * problems.ts that carry a `fem` entry; each is run with the settings of
 * the source (flow rule, elastic parameters) and compared with the
 * source's value by the two-level tolerance of the plan (docs: section 6.3):
 *
 *  - theory and limit analysis: an exact factor of safety 2 %; a pair of
 *    lower and upper bounds, the interval widened by 2 %;
 *  - published numerical values (finite elements, finite differences),
 *    which depend on the mesh, element, flow rule and failure criterion:
 *    5 %, or half a unit of the printed last digit plus 2 % if larger
 *    (Griffiths & Lane give F "to the nearest 0.05").
 */
import { buildSlope } from "../model/build-slope";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import type { SlopeDefinition } from "../types/slope-definition";
import { analyzeFem, type FemAnalysisOptions, type FemAnalysisResult } from "../fem/analysis";
import type { FlowRule } from "../fem/srm";
import type { FeMaterialParameters } from "../fem/model";

export interface FemReference {
  value: number;
  /** Upper bound when the source gives lower and upper bounds. */
  upper?: number;
  /** Who published it, e.g. "Griffiths & Lane (1999)". */
  source: string;
  /** The source's method, e.g. "finite-element strength reduction". */
  method: string;
  kind: "theory" | "bounds" | "numerical";
  /** The value was printed to this step (e.g. 0.05); default: its last printed digit. */
  precision?: number;
}

export interface FemSetup {
  /** Flow rule of the source; default Davis B. */
  flowRule?: FlowRule;
  /** E, ν, ψ per material name, as the source gives them. */
  materialParameters?: Record<string, FeMaterialParameters>;
  tensionCutoff?: boolean;
  /** Pore pressures: from the water lines (default) or from steady seepage with the water table as boundary (fem/seepage.ts). */
  porePressure?: "water-table" | "seepage";
  /** Axial stiffness of the reinforcement (kN/m), as the source gives it. */
  reinforcementStiffness?: number;
  /** Whether the source reduces the reinforcement's capacity with the soil's strength; default true. */
  reduceReinforcement?: boolean;
  /** Initial element size (m); default domain height / 20. */
  elementSize?: number;
  references: FemReference[];
  /** Why the setup or the comparison is as it is. */
  note?: string;
}

/** Adaptive refinement used for the published results (plan section 4.8). */
export const FEM_VERIFICATION_OPTIONS: FemAnalysisOptions = {
  adaptive: { levels: 2, tolerance: 0.01 },
  fTolerance: 0.005,
};

const THEORY = 0.02;
const NUMERICAL = 0.05;

function printedStep(x: number): number {
  const s = String(x);
  const dot = s.indexOf(".");
  return 10 ** -Math.max(2, dot < 0 ? 0 : s.length - dot - 1);
}

/** The accepted interval [lo, hi] for a finite element factor of safety. */
export function femInterval(r: FemReference): [number, number] {
  if (r.kind === "bounds") return [r.value * (1 - THEORY), (r.upper ?? r.value) * (1 + THEORY)];
  if (r.kind === "theory") return [r.value * (1 - THEORY), r.value * (1 + THEORY)];
  const t = Math.max(NUMERICAL, (0.5 * (r.precision ?? printedStep(r.value))) / r.value + THEORY);
  return [r.value * (1 - t), r.value * (1 + t)];
}

export function femAgrees(r: FemReference, fos: number): boolean {
  const [lo, hi] = femInterval(r);
  return fos >= lo - 1e-9 && fos <= hi + 1e-9;
}

/** Relative deviation from the reference (0 inside a pair of bounds). */
export function femDeviation(r: FemReference, fos: number): number {
  if (r.kind === "bounds") {
    if (fos < r.value) return (fos - r.value) / r.value;
    const up = r.upper ?? r.value;
    return fos > up ? (fos - up) / up : 0;
  }
  return (fos - r.value) / r.value;
}

/** Run the finite element analysis of a problem with its source's settings. */
export function runFemVerification(definition: SlopeDefinition, setup: FemSetup): FemAnalysisResult {
  const slope = buildSlope(toCanonicalSlopeDefinition(definition));
  return analyzeFem(slope, {
    ...FEM_VERIFICATION_OPTIONS,
    flowRule: setup.flowRule,
    materialParameters: setup.materialParameters,
    tensionCutoff: setup.tensionCutoff,
    porePressure: setup.porePressure,
    elementSize: setup.elementSize,
    reinforcementStiffness: setup.reinforcementStiffness,
    reduceReinforcement: setup.reduceReinforcement,
  });
}
