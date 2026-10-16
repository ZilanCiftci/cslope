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
  /**
   * The cSlope analysis with the same method (its label in
   * presentedAnalyses), when cSlope has that method; set by paperValues.
   */
  analysis?: string;
}

/** A problem as the presentation needs it. */
type Presentable = Pick<VerificationCase, "checks"> & { paper?: PaperValue[] };

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
  return Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  ) as Partial<AnalysisOptions>;
}

/** Options that choose the method rather than describe the problem. */
const METHOD_OPTIONS = ["intersliceFunction", "intersliceDataPoints", "janbuCorrection", "nonCircularOptimization"] as const;

/**
 * The cSlope analysis for a method as a source names it ("Bishop
 * simplified", "Spencer, non-circular", "Janbu corrected"), on the input of
 * the problem's first check; null for a method cSlope does not have
 * (finite elements, charts, trial wedges, Ordinary, ...).
 */
function analysisForMethod(
  text: string,
  base: Partial<AnalysisOptions>,
): { method: AnalysisMethod; options: Partial<AnalysisOptions> } | null {
  const t = text.toLowerCase();
  let method: AnalysisMethod;
  let own: Partial<AnalysisOptions> = {};
  if (t.startsWith("bishop")) method = "Bishop";
  else if (t.startsWith("spencer")) {
    method = "Morgenstern-Price";
    own = { intersliceFunction: "constant" };
  } else if (t.startsWith("morgenstern-price")) method = "Morgenstern-Price";
  else if (t.startsWith("janbu corrected")) {
    method = "Janbu";
    own = { janbuCorrection: true };
  } else if (t.startsWith("janbu simplified")) method = "Janbu";
  else return null;
  const options: Partial<AnalysisOptions> = { ...base, ...own };
  if (/non-circular/.test(t)) options.nonCircularOptimization = true;
  return { method, options };
}

interface Analyses {
  list: (PresentedAnalysis & { values: number[] })[];
  /** Index into `list` of each check. */
  ofCheck: number[];
  /** Index into `list` of each value of `paper`, or -1. */
  ofPaper: number[];
}

/**
 * The analyses of a problem: one per distinct method and options among its
 * checks, then one for each published value whose method cSlope has and
 * no check runs (they are run for the presentation, not tested).
 */
function analyses(c: Presentable): Analyses {
  const list: Analyses["list"] = [];
  const index = new Map<string, number>();
  const add = (method: AnalysisMethod, options: Partial<AnalysisOptions>): number => {
    const eff = effectiveOptions(options);
    const key = method + JSON.stringify(eff);
    let i = index.get(key);
    if (i == null) {
      i = list.length;
      index.set(key, i);
      list.push({ label: analysisLabel(method, eff), method, options, programs: null, checks: [], values: [] });
    }
    return i;
  };
  const ofCheck = c.checks.map((k, j) => {
    const i = add(k.method, k.options ?? {});
    list[i].checks.push(j);
    if (isProgramSource(k.publishedBy)) list[i].values.push(k.published);
    return i;
  });
  const base = Object.fromEntries(
    Object.entries(c.checks[0]?.options ?? {}).filter(([key]) => !(METHOD_OPTIONS as readonly string[]).includes(key)),
  ) as Partial<AnalysisOptions>;
  // A published value goes with the problem's own analysis of that method
  // when one exists (whatever its slices or crack), else with a new one.
  const sameMethod = (a: { method: AnalysisMethod; options: Partial<AnalysisOptions> }) =>
    list.findIndex(
      (x) =>
        x.checks.length > 0 &&
        x.method === a.method &&
        METHOD_OPTIONS.every((key) => (key === "intersliceDataPoints" ? true : !!x.options[key] === !!a.options[key])) &&
        (x.options.intersliceFunction ?? "half-sine") === (a.options.intersliceFunction ?? "half-sine"),
    );
  const ofPaper = (c.paper ?? []).map((v) => {
    const a = v.method ? analysisForMethod(v.method, base) : null;
    if (!a) return -1;
    const existing = sameMethod(a);
    return existing >= 0 ? existing : add(a.method, a.options);
  });
  // Two analyses with the same name: say what differs.
  const counts = new Map<string, number>();
  for (const a of list) counts.set(a.label, (counts.get(a.label) ?? 0) + 1);
  for (const a of list) {
    if ((counts.get(a.label) ?? 0) > 1) {
      const q = qualifier(effectiveOptions(a.options));
      if (q) a.label += ` (${q})`;
    }
  }
  return { list, ofCheck, ofPaper };
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
 * The analyses of a problem, in the order of its checks and then of its
 * published values: one per distinct method and options, with the range of
 * the other programs' values for it. Analyses without checks are run for
 * the presentation only.
 */
export function presentedAnalyses(c: Presentable): PresentedAnalysis[] {
  return analyses(c).list.map(({ values, ...a }) => ({
    ...a,
    programs: values.length ? { min: Math.min(...values), max: Math.max(...values), count: values.length } : null,
  }));
}

/**
 * The values the problem's sources publish: the checks against a paper, a
 * book or a theory, and the further values of `paper` (cases.ts) that are
 * not checked. Duplicates (same value and source) are listed once.
 */
export function paperValues(c: Presentable): PaperValue[] {
  const { list, ofCheck, ofPaper } = analyses(c);
  const fromChecks = c.checks.flatMap((k: VerificationCheck, j): PaperValue[] => {
    if (isProgramSource(k.publishedBy)) return [];
    const v: PaperValue = { value: k.published, ...sourceAndMethod(k.publishedBy, k.label) };
    // A check from a finite-element, chart or theory source is compared
    // with cSlope's analysis all the same: that is what the check runs.
    return [{ ...v, analysis: list[ofCheck[j]].label }];
  });
  const fromPaper = (c.paper ?? []).map((v, j): PaperValue => (ofPaper[j] >= 0 ? { ...v, analysis: list[ofPaper[j]].label } : { ...v }));
  const out: PaperValue[] = [];
  for (const v of [...fromChecks, ...fromPaper]) {
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
