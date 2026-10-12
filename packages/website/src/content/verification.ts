import data from "./generated/verification.json";
import type { VerificationData, VerificationProblem, VerificationCheck } from "./verification-types";

export const VERIFICATION = data as VerificationData;

export interface Example {
  problem: VerificationProblem;
  check: VerificationCheck;
}

/**
 * Well-known literature problems for the home page, found by reference so
 * that regenerating the data cannot change which ones are shown. Only
 * values the literature itself gives (not a program's) are used.
 */
const EXAMPLES: { reference: RegExp; method: RegExp }[] = [
  { reference: /^Fredlund, D\.G\. & Krahn/, method: /Bishop/ },
  { reference: /^Duncan & Wright.*fig\. 14\.3\./, method: /Spencer/ },
  { reference: /^Griffiths & Lane/, method: /.*/ },
];


export function homeExamples(d: VerificationData = VERIFICATION): Example[] {
  const out: Example[] = [];
  for (const e of EXAMPLES) {
    for (const problem of d.problems) {
      if (!problem.literature || !e.reference.test(problem.reference)) continue;
      const check = problem.checks.find(
        (k) => e.method.test(k.method) && sourceKind(k) === "literature" && k.computed != null,
      );
      if (check) {
        out.push({ problem, check });
        break;
      }
    }
  }
  return out;
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
