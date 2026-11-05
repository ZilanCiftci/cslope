/**
 * The verification problems as app models, for the Benchmarks button and
 * the website's result images: each runs one of its analyses (by cSlope's
 * name for it, the first by default) with the full search, as the
 * published verification table runs it.
 *
 * Opened from Help › Benchmarks a problem carries a title block on its
 * paper (its id and title, the source, the calculated FOS and the values it
 * is compared with) and the FOS label at the critical surface; the
 * website's images keep the plain plot.
 */

import {
  FULL_VERIFICATION_OPTIONS,
  NON_CIRCULAR_VERIFICATION_OPTIONS,
  VERIFICATION_CASES,
  VERIFICATION_OPTIONS,
  formatPaperValue,
  formatRange,
  isProgramSource,
  paperValues,
  presentedAnalyses,
  type FemReference,
  type VerificationCase,
} from "@cslope/engine/verification";
import { createExampleResultViewSettings, exampleMaterialTable } from "./benchmarks";
import { createDefaultProjectInfo } from "./defaults";
import { modelFromDefinition } from "./definition-model";
import type { Annotation, ModelEntry } from "./types";
import { paperContentOf } from "../features/view/extents";

type PresentedAnalysis = ReturnType<typeof presentedAnalyses>[number];

/** How a verification model is opened. */
export interface VerificationModelOptions {
  /**
   * The title block of Help › Benchmarks: title, source, calculated FOS,
   * the reference values and the material table, with the FOS label at
   * the critical surface. Without it the paper shows the plot alone (the
   * website's result images).
   */
  titleBlock?: boolean;
}

/** One verification problem as an app model, run as the analysis named `method`. */
export function verificationModel(
  c: VerificationCase,
  method?: string,
  name = c.title,
  opts: VerificationModelOptions = {},
): ModelEntry {
  const analyses = presentedAnalyses(c);
  const a = method ? analyses.find((x) => x.label === method) : analyses[0];
  if (!a && method) throw new Error(`No verification problem ${c.id} with the analysis "${method}"`);
  const model = modelFromDefinition(c.definition, {
    id: `verification-${c.id}`,
    name,
    options: a
      ? {
          method: a.method,
          ...VERIFICATION_OPTIONS,
          ...FULL_VERIFICATION_OPTIONS,
          ...(a.options.nonCircularOptimization ? NON_CIRCULAR_VERIFICATION_OPTIONS : {}),
          ...a.options,
        }
      : // A problem checked by finite elements only: the app's default analysis.
        { ...VERIFICATION_OPTIONS, ...FULL_VERIFICATION_OPTIONS },
  });
  if (opts.titleBlock) return withTitleBlock(model, c, a);
  // The website's plots are plain: the table gives the FOS.
  return { ...model, resultViewSettings: { ...model.resultViewSettings!, showFosLabel: false } };
}

/** Every verification problem, named by its id and title ("V001 Arai & Tagyo (1985) example 1"), with its title block. */
export function verificationModels(): ModelEntry[] {
  return VERIFICATION_CASES.map((c) => verificationModel(c, undefined, `${c.id} ${c.title}`, { titleBlock: true }));
}

// ── Title block ─────────────────────────────────────────────────

/**
 * Width of the text beside the material table, as font size × characters
 * (a character about 0.48 em in the sheet's sans-serif): on an A4
 * landscape sheet the block runs from 11 % of the width to the table at
 * about 68 %, some 74 characters at 13 pt, with a little to spare.
 */
const BLOCK_WIDTH = 960;
/** The same for the title, a little narrower: its larger letters run wider. */
const TITLE_WIDTH = 860;
const TITLE_SIZE = 24;
/** Smallest title size on one line; a longer title goes on two lines. */
const TITLE_MIN_SIZE = 16;
const SUBTITLE_SIZE = 13;
const FOS_SIZE = 14;
const REFERENCE_SIZE = 11;
/** Longest subtitle (the source) before it is shortened. */
const SUBTITLE_MAX = Math.floor(BLOCK_WIDTH / SUBTITLE_SIZE) - 1;
/** Longest line of reference values. */
const REFERENCE_LINE_MAX = Math.floor(BLOCK_WIDTH / REFERENCE_SIZE) - 1;
/** Indent of a reference line that goes on from the one above. */
const INDENT = "    ";
/** Space between the lines of the block, as a share of the paper height. */
const LINE_GAP = 0.007;

/** Height of `lines` lines of text at `size`, as a share of the paper height (ANNOTATION_SCALE_DIVISOR, ANNOTATION_LINE_HEIGHT). */
const textHeight = (size: number, lines = 1) => (lines * size * 1.2) / 600;

/**
 * The title block of a benchmark, as the examples' (title, subtitle, FOS
 * and material table at the top of the paper) with the reference values
 * below the calculated FOS in a smaller size. The title is #Title at a
 * size that fits beside the material table; one too long for that at
 * 16 pt goes on two lines as fixed text.
 */
function titleBlockAnnotations(title: string, reference: string[]): Annotation[] {
  const x = 0.11;
  let y = 0.08;
  const out: Annotation[] = [];
  const add = (id: string, text: string, fontSize: number, lines = 1) => {
    out.push({ id: `anno-benchmark-${id}`, type: "text", x, y, text, fontSize });
    y += textHeight(fontSize, lines) + LINE_GAP;
  };
  if (title.length * TITLE_MIN_SIZE <= TITLE_WIDTH) add("title", "#Title", Math.min(TITLE_SIZE, Math.floor(TITLE_WIDTH / title.length)));
  else {
    const lines = splitInTwo(title);
    add("title", lines.join("\n"), Math.min(18, Math.floor(TITLE_WIDTH / Math.max(...lines.map((l) => l.length)))), 2);
  }
  add("subtitle", "#Subtitle", SUBTITLE_SIZE);
  add("fos", "Calculated FOS: #FOS", FOS_SIZE);
  // Fixed text, so the PDF prints it as the sheet shows it.
  add("reference", reference.join("\n"), REFERENCE_SIZE, reference.length);
  return [...out, exampleMaterialTable()];
}

/** A title on two lines, split at the space nearest its middle. */
function splitInTwo(s: string): string[] {
  let best = -1;
  for (let i = s.indexOf(" "); i >= 0; i = s.indexOf(" ", i + 1)) {
    if (best < 0 || Math.abs(i - s.length / 2) < Math.abs(best - s.length / 2)) best = i;
  }
  return best < 0 ? [s] : [s.slice(0, best), s.slice(best + 1)];
}

function withTitleBlock(model: ModelEntry, c: VerificationCase, a: PresentedAnalysis | undefined): ModelEntry {
  const title = `${c.id} ${c.title}`;
  const annotations = titleBlockAnnotations(title, referenceLines(c, a));
  return {
    ...model,
    projectInfo: { ...createDefaultProjectInfo(), ...model.projectInfo, title, subtitle: shortReference(c.reference) },
    resultViewSettings: createExampleResultViewSettings(paperContentOf(model), { annotations, showFosLabel: true }),
  };
}

/**
 * The values a benchmark's analysis is compared with, as lines of text:
 * the values its sources publish for that analysis (with the source's own
 * method where it says more, and "(disputed)" for one left out of the
 * error statistics) and the range of the other programs' results, which
 * are not named. A problem checked by finite elements only gives its
 * finite element, limit analysis or theory references.
 *
 *   Reference for Bishop simplified: 1.451 Arai & Tagyo (1985)
 *       other programs 1.409–1.417 (2)
 */
function referenceLines(c: VerificationCase, a: PresentedAnalysis | undefined): string[] {
  if (!a) {
    const refs = c.fem?.references ?? [];
    if (refs.length === 0) return ["Reference: none published"];
    return wrap(refs.map((r) => `Reference, ${femKind(r)}: ${femValue(r)}`));
  }
  const head = `Reference for ${a.label}${c.surface === "fixed" ? ", given surface" : ""}: `;
  const values = paperValues(c)
    .filter((v) => v.analysis === a.label)
    .map((v) => `${formatPaperValue(v)} ${v.source}${methodNote(v.method, a.label)}${v.disputed ? " (disputed)" : ""}`);
  const p = a.programs;
  const programs = p ? (p.count === 1 ? `another program ${formatRange(p)}` : `other programs ${formatRange(p)} (${p.count})`) : null;
  if (values.length === 0) return wrap([head + (programs ?? "none published")]);
  const one = head + [...values, ...(programs ? [programs] : [])].join("; ");
  if (one.length <= REFERENCE_LINE_MAX) return [one];
  return wrap([head + values[0], ...[...values.slice(1), ...(programs ? [programs] : [])].map((s) => `${INDENT}${s}`)]);
}

/** Lines longer than REFERENCE_LINE_MAX cut after the heading, between values or at a word, the rest indented on the next line. */
function wrap(lines: string[]): string[] {
  return lines.flatMap((line) => {
    const out: string[] = [];
    let rest = line;
    while (rest.length > REFERENCE_LINE_MAX) {
      // After the heading or between values when it can, else at a word.
      const sep = Math.max(rest.lastIndexOf(": ", REFERENCE_LINE_MAX - 1), rest.lastIndexOf("; ", REFERENCE_LINE_MAX - 1));
      const at = sep > REFERENCE_LINE_MAX / 3 ? sep + 1 : rest.lastIndexOf(" ", REFERENCE_LINE_MAX);
      if (at <= 0) break;
      out.push(rest.slice(0, at).trimEnd());
      rest = `${INDENT}${rest.slice(at + 1)}`;
    }
    return [...out, rest];
  });
}

/** A source's own method where it says more than cSlope's name for the analysis: ", finite-element pore pressures". */
function methodNote(method: string | undefined, label: string): string {
  if (!method || label.startsWith(method)) return "";
  const rest = method.startsWith(label) ? method.slice(label.length).replace(/^,\s*/, "").trim() : method;
  if (!rest) return "";
  return rest.startsWith("(") ? ` ${rest}` : `, ${rest}`;
}

/** The kind of a finite element problem's reference. */
function femKind(r: FemReference): string {
  if (r.kind === "theory") return "theory";
  if (r.kind === "bounds") return "limit analysis";
  return /finite.difference/i.test(r.method) ? "finite differences" : "finite elements";
}

/** A finite element reference with its source; another program's is not named (as on the website). */
function femValue(r: FemReference): string {
  const value = formatPaperValue({ value: r.value, upper: r.upper, source: r.source });
  const source = isProgramSource(r.source) ? "another program's verification manual" : r.source;
  return `${value} ${source}${r.disputed ? " (disputed)" : ""}`;
}

/**
 * A source for the subtitle: as written when it is short, otherwise the
 * authors (the first with "et al." for three or more), the year and the
 * title, cut at a word with an ellipsis if still too long.
 *
 *   "Cheng, Y.M., Lansivaara, T. & Wei, W.B. (2007). Two-dimensional slope stability analysis by ..."
 *   → "Cheng et al. (2007). Two-dimensional slope stability analysis by limit equilibrium and…"
 */
export function shortReference(reference: string, max = SUBTITLE_MAX): string {
  const s = reference.trim().replace(/\.$/, "");
  if (s.length <= max) return s;
  const m = /^(.+?)\s*\((\d{4}[a-z]?)\)[.,]?\s*(.*)$/.exec(s);
  if (!m) return cut(s, max);
  const [, authors, year, rest] = m;
  const surnames = [...authors.matchAll(/([A-Z][^,&]*?),\s*(?:[A-Z][a-z]?\.\s*-?\s*)+/g)].map((x) => x[1].trim());
  const who =
    surnames.length === 0
      ? authors.trim()
      : surnames.length === 1
        ? surnames[0]
        : surnames.length === 2
          ? `${surnames[0]} & ${surnames[1]}`
          : `${surnames[0]} et al.`;
  const title = rest.split(/\.\s/)[0].replace(/\.$/, "");
  return cut(title ? `${who} (${year}). ${title}` : `${who} (${year})`, max);
}

/** Text cut at a word to at most `max` characters, with an ellipsis. */
function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > max / 2 ? head.slice(0, space) : head).replace(/[\s,.;:]+$/, "")}…`;
}
