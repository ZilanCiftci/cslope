/** The shape of generated/verification.json (see scripts/generate-data.ts). */

export interface VerificationCheck {
  /** Method as the source names it, e.g. "Spencer (M-P, constant f(x))". */
  method: string;
  published: number;
  /** Who published the value: literature, or "Commercial program A" etc. */
  source: string;
  /** Accepted relative deviation. */
  tolerance: number;
  computed: number | null;
  /** (computed − published) / published. */
  deviation: number | null;
  pass: boolean;
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
  tolerance: number;
  computed: number | null;
  pass: boolean;
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
    passed: number;
    literatureProblems: number;
    reliabilityChecks: number;
  };
  problems: VerificationProblem[];
  reliability: ReliabilityProblem[];
}
