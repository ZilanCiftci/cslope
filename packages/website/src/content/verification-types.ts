/**
 * The shape of generated/verification.json (see scripts/generate-data.ts).
 * Results are presented, not judged: the values the sources publish, the
 * range of other programs' results and cSlope's result. No program is
 * named.
 */

/** A value a paper, book, design manual or theory publishes. */
export interface PublishedValue {
  value: number;
  /** Upper end when the source gives a range. */
  upper?: number;
  /** Method as the source names it; absent when the source does not say. */
  method?: string;
  /** e.g. "Arai & Tagyo (1985)". */
  source: string;
  /** Why the value is shown but not counted in the error statistics. */
  disputed?: string;
  /** cSlope's analysis for this value (a `results` method), when cSlope has the method. */
  analysis?: string;
  /** cSlope's result of that analysis; null when cSlope does not have the method. */
  computed: number | null;
}

/** One analysis cSlope runs for a problem. */
export interface VerificationResult {
  /** cSlope's name for the analysis, e.g. "Spencer, non-circular". */
  method: string;
  computed: number | null;
  /** Range of other programs' published values for the same analysis. */
  programs: { min: number; max: number } | null;
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
  published: PublishedValue[];
  results: VerificationResult[];
  /** Why the published values and the programs differ, where they do. */
  note?: string;
}

/** One quantity of a probabilistic problem (β or Pf, by Taylor series or Monte Carlo). */
export interface ReliabilityRow {
  quantity: string;
  computed: number | null;
  published: { value: number; source: string }[];
  programs: { min: number; max: number } | null;
}

export interface ReliabilityProblem {
  id: string;
  title: string;
  rows: ReliabilityRow[];
}

export interface VerificationData {
  summary: {
    problems: number;
    /** cSlope analyses over all problems. */
    results: number;
    /** Values published by papers, books and theory. */
    publishedValues: number;
    /** Problems with at least one published value. */
    problemsWithPublished: number;
    literatureProblems: number;
    /** β and Pf quantities of the probabilistic problems. */
    reliabilityQuantities: number;
  };
  problems: VerificationProblem[];
  reliability: ReliabilityProblem[];
}
