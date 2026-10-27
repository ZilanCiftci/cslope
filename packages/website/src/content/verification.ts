import data from "./generated/verification.json";
import type { PublishedValue, VerificationData, VerificationProblem, VerificationResult } from "./verification-types";
import { HOME_EXAMPLES } from "./home-examples";

export const VERIFICATION = data as VerificationData;

export interface Example {
  problem: VerificationProblem;
  /** The analysis shown (cSlope's result and the other programs' range). */
  result: VerificationResult;
  /** The source's value shown next to it, if the problem has one. */
  published: PublishedValue | null;
}

/** The home page's examples (home-examples.ts) with their data; missing ones are skipped. */
export function homeExamples(d: VerificationData = VERIFICATION): Example[] {
  return HOME_EXAMPLES.flatMap(({ id, method }) => {
    const problem = d.problems.find((p) => p.id === id);
    const result = problem?.results.find((r) => r.method === method);
    return problem && result && result.computed != null
      ? [{ problem, result, published: problem.published[0] ?? null }]
      : [];
  });
}

export type PublishedFilter = "all" | "with" | "without";
export type MethodFilter = "all" | "Bishop" | "Janbu" | "Spencer" | "Morgenstern-Price" | "Finite elements";

export interface Filter {
  query: string;
  published: PublishedFilter;
  method: MethodFilter;
}

/** The method family of an analysis, from cSlope's name for it. */
export function methodFamily(label: string): Exclude<MethodFilter, "all"> {
  if (/\(FE\)|finite element/i.test(label)) return "Finite elements";
  if (/spencer/i.test(label)) return "Spencer";
  if (/janbu/i.test(label)) return "Janbu";
  if (/bishop/i.test(label)) return "Bishop";
  return "Morgenstern-Price";
}

/** A value as the source prints it: "1.24–1.27" or "1.451". */
export function formatPublished(v: Pick<PublishedValue, "value" | "upper">): string {
  const f = (x: number) => {
    const s = String(x);
    const dot = s.indexOf(".");
    return x.toFixed(Math.min(4, Math.max(2, dot < 0 ? 0 : s.length - dot - 1)));
  };
  return v.upper != null ? `${f(v.value)}–${f(v.upper)}` : f(v.value);
}

/** A range of other programs' values: "1.409–1.417", or one value. */
export function formatRange(r: { min: number; max: number } | null, digits = 3): string {
  if (!r) return "–";
  return r.min === r.max ? r.min.toFixed(digits) : `${r.min.toFixed(digits)}–${r.max.toFixed(digits)}`;
}

/**
 * The problems that match the filter, with only the analyses of the chosen
 * method family; problems left without an analysis are dropped.
 */
export function filterProblems(problems: VerificationProblem[], f: Filter): VerificationProblem[] {
  const words = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  return problems
    .filter((p) => {
      const text = `${p.id} ${p.title} ${p.reference} ${p.published.map((v) => v.source).join(" ")}`.toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .filter((p) => f.published === "all" || (f.published === "with") === p.published.length > 0)
    .map((p) => ({ ...p, results: p.results.filter((r) => f.method === "all" || methodFamily(r.method) === f.method) }))
    .filter((p) => p.results.length > 0);
}
