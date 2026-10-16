/** The shape of generated/verification.json (see scripts/generate-data.ts). */

export interface VerificationCheck {
  /** Method as the source names it, e.g. "Spencer (M-P, constant f(x))". */
  method: string;
  published: number;
  /** Who published the value: literature, or "Commercial program A" etc. */
  source: string;
  computed: number | null;
  /** (computed − published) / published. */
  deviation: number | null;
}

export interface VerificationProblem {
  /** cSlope's own id, e.g. "V021a": the number is the slope, the letter the variant. */
  id: string;
  title: string;
  reference: string;
  /** The reference cites literature. */
  literature: boolean;
  /** Some values come from a commercial program's verification manual. */
  commercial: boolean;
  surface: "fixed" | "search";
  units: "SI" | "imperial";
  checks: VerificationCheck[];
}

export interface ReliabilityCheck {
  quantity: string;
  published: number;
  source: string;
  computed: number | null;
}

export interface ReliabilityProblem {
  id: string;
  title: string;
  checks: ReliabilityCheck[];
}

export interface VerificationData {
  summary: {
    problems: number;
    checks: number;
    literatureProblems: number;
    reliabilityChecks: number;
  };
  problems: VerificationProblem[];
  reliability: ReliabilityProblem[];
}

/**
 * A small drawing of a problem's result for the home page (see
 * scripts/generate-data.ts): model coordinates, y up.
 */
export interface SlopePlot {
  /** [xMin, yMin, xMax, yMax] of the model. */
  bounds: [number, number, number, number];
  /** Material regions; `material` indexes the problem's materials in order of definition. */
  regions: { material: number; points: [number, number][] }[];
  /** Piezometric line, when there is one. */
  water: [number, number][] | null;
  /** Critical slip surface, entry to exit. */
  surface: [number, number][];
  /** The sliding mass: the slip surface and the ground above it, closed. */
  mass: [number, number][];
}

/** generated/home-plots.json: a plot per home-page example, keyed by problem id. */
export type HomePlots = Record<string, SlopePlot>;
