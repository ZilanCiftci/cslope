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

/** A check whose value comes from the literature rather than a program. */
const fromLiterature = (k: VerificationCheck) => !/program/i.test(k.source);

export function homeExamples(d: VerificationData = VERIFICATION): Example[] {
  const out: Example[] = [];
  for (const e of EXAMPLES) {
    for (const problem of d.problems) {
      if (!problem.literature || !e.reference.test(problem.reference)) continue;
      const check = problem.checks.find((k) => e.method.test(k.method) && fromLiterature(k) && k.computed != null);
      if (check) {
        out.push({ problem, check });
        break;
      }
    }
  }
  return out;
}
