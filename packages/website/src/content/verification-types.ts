/** The shape of generated/verification.json (see scripts/generate-data.ts). */

export interface VerificationCheck {
  /** Method as the source names it, e.g. "Spencer (M-P, constant f(x))". */
  method: string;
  published: number;
  /** Who published the value: literature, or "Commercial program A" etc. */
  source: string;
  /** The reference is a range ("0.45–0.50"); `published` is its middle. */
  range?: [number, number];
  computed: number | null;
  /** (computed − published) / published. */
  deviation: number | null;
}

export interface VerificationProblem {
  /** Neutral id, e.g. "P-3FA21C". */
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
