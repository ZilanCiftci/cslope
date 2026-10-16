/**
 * How a verification problem is presented in the public report and on the
 * website: the values its sources publish, the analyses cSlope runs, and
 * the range of the other programs' results for each analysis. Nothing here
 * passes or fails a result; the tests compare with the checks themselves
 * (cases.ts, tolerance.ts).
 *
 * Programs are never named: the data labels them "Commercial program A",
 * "Program D" and so on, and here they only make up a range.
 */
import type { AnalysisMethod, AnalysisOptions } from "../types/analysis";
import type { VerificationCase, VerificationCheck } from "./cases";
import { VERIFICATION_OPTIONS } from "./cases";

/** A value published by a paper, a book, a design manual or a theory. */
export interface PaperValue {
  value: number;
  /** Upper end when the source gives a range ("1.24–1.27"). */
  upper?: number;
  /** Method as the source names it; absent when the source does not say. */
  method?: string;
  /** Who published it, e.g. "Arai & Tagyo (1985)". */
  source: string;
}

/** One analysis cSlope runs for a problem, with the other programs' results for it. */
export interface PresentedAnalysis {
  /** cSlope's name for the analysis, e.g. "Spencer, non-circular". */
  label: string;
  method: AnalysisMethod;
  options: Partial<AnalysisOptions>;
  /** Range of the other programs' published values for this analysis, if any. */
  programs: { min: number; max: number; count: number } | null;
  /** Indices of the problem's checks that run this analysis. */
  checks: number[];
}

/** A value from another program's manual (the data names them "Commercial program A", "Program D"). */
export function isProgramSource(publishedBy: string): boolean {
  return /\b[Pp]rogram [A-Z]\b/.test(publishedBy);
}

/** cSlope's name for an analysis. */
export function analysisLabel(method: AnalysisMethod, options: Partial<AnalysisOptions> = {}): string {
  let s: string;
  if (method === "Bishop") s = "Bishop simplified";
  else if (method === "Janbu") s = options.janbuCorrection ? "Janbu corrected" : "Janbu simplified";
  else if (method === "Morgenstern-Price") {
    const f = options.intersliceFunction ?? "half-sine";
    s = f === "constant" ? "Spencer" : `Morgenstern-Price (${f === "data-point-specified" ? "specified f(x)" : f})`;
  } else s = method;
  if (options.nonCircularOptimization) s += ", non-circular";
  return s;
}

/** Options as the analysis runs them, so that a default and its explicit value are one analysis. */
function effectiveOptions(options: Partial<AnalysisOptions> = {}): Partial<AnalysisOptions> {
  const o: Partial<AnalysisOptions> = { slices: VERIFICATION_OPTIONS.slices, ...options };
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))) as Partial<AnalysisOptions>;
}

/** What tells two analyses with the same name apart. */
function qualifier(options: Partial<AnalysisOptions>): string {
  const q: string[] = [];
  if (options.slices !== VERIFICATION_OPTIONS.slices) q.push(`${options.slices} slices`);
  if (options.tensionCrackAuto) q.push("tension crack of automatic depth");
  else if (options.tensionCrackDepth) q.push(`${options.tensionCrackDepth} m tension crack`);
  if (options.porePressureHead) q.push(`${options.porePressureHead} pore-pressure head`);
  return q.join(", ");
}

/**
 * The analyses of a problem, in the order of its checks: one per distinct
 * method and options, with the range of the other programs' values for it.
 */
export function presentedAnalyses(c: Pick<VerificationCase, "checks">): PresentedAnalysis[] {
  const byKey = new Map<string, PresentedAnalysis & { values: number[] }>();
  c.checks.forEach((k, i) => {
    const options = effectiveOptions(k.options);
    const key = k.method + JSON.stringify(options);
    let a = byKey.get(key);
    if (!a) {
      a = { label: analysisLabel(k.method, options), method: k.method, options: k.options ?? {}, programs: null, checks: [], values: [] };
      byKey.set(key, a);
    }
    a.checks.push(i);
    if (isProgramSource(k.publishedBy)) a.values.push(k.published);
  });
  const list = [...byKey.values()];
  // Two analyses with the same name: say what differs.
  const counts = new Map<string, number>();
  for (const a of list) counts.set(a.label, (counts.get(a.label) ?? 0) + 1);
  for (const a of list) {
    if ((counts.get(a.label) ?? 0) > 1) {
      const q = qualifier(effectiveOptions(a.options));
      if (q) a.label += ` (${q})`;
    }
  }
  return list.map(({ values, ...a }) => ({
    ...a,
    programs: values.length ? { min: Math.min(...values), max: Math.max(...values), count: values.length } : null,
  }));
}

/**
 * The values the problem's sources publish: the checks against a paper, a
 * book or a theory, and the further values of `paper` (cases.ts) that are
 * not checked. Duplicates (same value and source) are listed once.
 */
export function paperValues(c: Pick<VerificationCase, "checks"> & { paper?: PaperValue[] }): PaperValue[] {
  const fromChecks = c.checks
    .filter((k: VerificationCheck) => !isProgramSource(k.publishedBy))
    .map((k): PaperValue => ({ value: k.published, ...sourceAndMethod(k.publishedBy, k.label) }));
  const out: PaperValue[] = [];
  for (const v of [...fromChecks, ...(c.paper ?? [])]) {
    if (!out.some((o) => o.value === v.value && o.upper === v.upper && o.source === v.source)) out.push(v);
  }
  return out;
}

/** How a check's source qualifies its value, as the published method. */
const SOURCE_METHODS: [RegExp, string][] = [
  [/^FE strength reduction$/i, "finite-element strength reduction"],
  [/^FE$/i, "finite elements"],
  [/^LE curve$/i, "limit-equilibrium chart"],
  [/chart/i, "stability chart"],
  [/^infinite slope$/i, "infinite slope"],
  [/^Janbu wedge/i, "Janbu wedge"],
];

/**
 * The source and the published method of a literature check. The data
 * writes the source's own method in parentheses ("Griffiths & Lane (FE)",
 * "Theory (infinite slope)"); otherwise the check's method stands, without
 * cSlope's analysis details ("Spencer (M-P, constant f(x))" → "Spencer").
 */
function sourceAndMethod(publishedBy: string, label: string): { source: string; method?: string } {
  const plainLabel = label.replace(/\s*\((?:M-P, constant f\(x\)|f0|vertical head)\)/g, "").trim();
  const m = /^(.*?)\s*\(([^)]*)\)(.*)$/.exec(publishedBy);
  if (/^Morgenstern chart$/i.test(publishedBy)) return { source: "Morgenstern", method: "stability chart" };
  if (!m) return { source: publishedBy, method: plainLabel };
  const [, name, qualifier, rest] = m;
  const own = SOURCE_METHODS.find(([re]) => re.test(qualifier.trim()));
  const suffix = rest.replace(/^,\s*/, "").trim();
  const method = own ? own[1] : `${plainLabel}${suffix ? `, ${suffix}` : ""}`;
  return { source: name.trim(), method };
}

/** A paper value as the source prints it: "1.24–1.27" or "1.451". */
export function formatPaperValue(v: PaperValue): string {
  const f = (x: number) => x.toFixed(decimals(x));
  return v.upper != null ? `${f(v.value)}–${f(v.upper)}` : f(v.value);
}

/** Decimals as printed in the source (at least two, at most four). */
function decimals(x: number): number {
  const s = String(x);
  const dot = s.indexOf(".");
  return Math.min(4, Math.max(2, dot < 0 ? 0 : s.length - dot - 1));
}

/** A range of program values as text: "1.409–1.417", or one value. */
export function formatRange(r: { min: number; max: number }, digits = 3): string {
  return r.min === r.max ? r.min.toFixed(digits) : `${r.min.toFixed(digits)}–${r.max.toFixed(digits)}`;
}
