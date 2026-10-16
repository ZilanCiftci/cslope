import data from "./generated/verification.json";
import type { VerificationData, VerificationProblem, VerificationCheck } from "./verification-types";
import { HOME_EXAMPLES } from "./home-examples";

export const VERIFICATION = data as VerificationData;

export interface Example {
  problem: VerificationProblem;
  check: VerificationCheck;
}

/** The home page's examples (home-examples.ts) with their data; missing ones are skipped. */
export function homeExamples(d: VerificationData = VERIFICATION): Example[] {
  return HOME_EXAMPLES.flatMap(({ id, check }) => {
    const problem = d.problems.find((p) => p.id === id);
    const k = problem?.checks[check];
    return problem && k && k.computed != null ? [{ problem, check: k }] : [];
  });
}

export type SourceKind = "literature" | "program";
export type SourceFilter = "all" | SourceKind;
export type MethodFilter = "all" | "Bishop" | "Janbu" | "Spencer" | "Morgenstern-Price";

export interface Filter {
  query: string;
  source: SourceFilter;
  method: MethodFilter;
}

/** The method family of a check, from the source's name for it. */
export function methodFamily(label: string): Exclude<MethodFilter, "all"> {
  if (/spencer/i.test(label)) return "Spencer";
  if (/janbu/i.test(label)) return "Janbu";
  if (/bishop/i.test(label)) return "Bishop";
  return "Morgenstern-Price";
}

/**
 * The reference values by kind: from the literature (analytical solutions
 * counted apart) and from other programs.
 */
export function checkCounts(d: VerificationData = VERIFICATION) {
  const checks = d.problems.flatMap((p) => p.checks);
  const theory = checks.filter((k) => /^theory\b/i.test(k.source)).length;
  const programs = checks.filter((k) => sourceKind(k) === "program").length;
  return { literature: checks.length - programs - theory, theory, programs };
}

/** Where a check's reference value comes from: the literature or another program. */
export function sourceKind(k: VerificationCheck): SourceKind {
  // "Commercial program A", and the other programs ("Program D").
  if (/\b[Pp]rogram [A-Z]\b/.test(k.source)) return "program";
  return "literature";
}

/** The problems and checks that match the filter; problems with no matching check are left out. */
export function filterProblems(problems: VerificationProblem[], f: Filter): VerificationProblem[] {
  const words = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  return problems
    .filter((p) => {
      const text = `${p.id} ${p.title} ${p.reference}`.toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .map((p) => ({
      ...p,
      checks: p.checks.filter(
        (k) =>
          (f.method === "all" || methodFamily(k.method) === f.method) &&
          (f.source === "all" || sourceKind(k) === f.source),
      ),
    }))
    .filter((p) => p.checks.length > 0);
}
