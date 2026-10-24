/**
 * Adds an entry to VERIFICATION-LOG.md at the repository root: how a change
 * moved cSlope's results on the verification problems.
 *
 *   bun scripts/verification-log.ts "Short description of the change"
 *   bun scripts/verification-log.ts "..." --base <git rev>   (default HEAD)
 *
 * Run it after `bun scripts/generate-data.ts`, before committing: it compares
 * the regenerated src/content/generated/verification.json with the one in
 * the base revision. The entry lists every result that moved and, below,
 * the error statistics over all results before and after, against the
 * other programs (the midpoint of their range per analysis) and against the
 * values the papers publish, and the wall time of the verification run
 * that produced the table (from generate-data.ts; it depends on the
 * machine's cores and load). A change that moves nothing still gets an
 * entry, so the log shows it was checked.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { VerificationData } from "../src/content/verification-types";

const ROOT = resolve(import.meta.dirname, "../../..");
const DATA = "packages/website/src/content/generated/verification.json";
const LOG = join(ROOT, "VERIFICATION-LOG.md");
const SUMMARY_END = "<!-- summary-end -->";
const ENTRIES = "<!-- entries -->";
const RUN_TIME = join(ROOT, "packages/website/node_modules/.cache/cslope-verification-run.json");

/** "87 s (4 workers, load 0.2 at start)" for the last full verification run, or "not recorded". */
function runTime(): string {
  if (!existsSync(RUN_TIME)) return "not recorded";
  const r = JSON.parse(readFileSync(RUN_TIME, "utf8")) as { seconds: number; workers: number; load?: number };
  const load = r.load === undefined ? "" : `, load ${r.load.toFixed(1)} at start`;
  return `${Math.round(r.seconds)} s (${r.workers} workers${load})`;
}

/** One compared value: cSlope's result and the reference it is compared with. */
interface Point {
  key: string;
  label: string;
  computed: number;
  reference: number;
}

/** Relative error in percent. */
const err = (p: Point) => ((p.computed - p.reference) / p.reference) * 100;

/** cSlope's results against the other programs and against the papers. */
export function points(data: VerificationData): { programs: Point[]; papers: Point[] } {
  const programs: Point[] = [];
  const papers: Point[] = [];
  for (const p of data.problems) {
    for (const r of p.results) {
      if (r.programs && r.computed != null) {
        programs.push({
          key: `${p.id}|${r.method}`,
          label: `${p.id} ${r.method}`,
          computed: r.computed,
          reference: (r.programs.min + r.programs.max) / 2,
        });
      }
    }
    (p.published ?? []).forEach((v) => {
      // A disputed value measures its source, not cSlope (see its reason).
      if (v.computed != null && !v.disputed) {
        papers.push({
          key: `${p.id}|${v.method}|${v.source}|${v.value}`,
          label: `${p.id} ${v.method} (${v.source})`,
          computed: v.computed,
          reference: v.value,
        });
      }
    });
  }
  return { programs, papers };
}

export interface Stats {
  n: number;
  mean: number;
  meanAbs: number;
  rms: number;
  maxAbs: number;
}

export function stats(ps: Point[]): Stats {
  const e = ps.map(err);
  const n = e.length;
  if (n === 0) return { n, mean: 0, meanAbs: 0, rms: 0, maxAbs: 0 };
  return {
    n,
    mean: e.reduce((s, x) => s + x, 0) / n,
    meanAbs: e.reduce((s, x) => s + Math.abs(x), 0) / n,
    rms: Math.sqrt(e.reduce((s, x) => s + x * x, 0) / n),
    maxAbs: Math.max(...e.map(Math.abs)),
  };
}

const pct = (x: number, sign = true) => `${sign && x > 0 ? "+" : ""}${x.toFixed(3)} %`;

/** Results present in both versions whose value changed. */
export function moved(before: Point[], after: Point[]) {
  const old = new Map(before.map((p) => [p.key, p]));
  return after
    .filter((p) => old.has(p.key) && old.get(p.key)!.computed !== p.computed)
    .map((p) => ({ before: old.get(p.key)!, after: p }));
}

function section(title: string, before: Point[], after: Point[]): string {
  const m = moved(before, after);
  const better = m.filter((x) => Math.abs(err(x.after)) < Math.abs(err(x.before))).length;
  const rows = m
    .sort((a, b) => Math.abs(err(b.after) - err(b.before)) - Math.abs(err(a.after) - err(a.before)))
    .map(
      ({ before: b, after: a }) =>
        `| ${a.label} | ${a.reference.toFixed(3)} | ${b.computed.toFixed(4)} | ${a.computed.toFixed(4)} | ${pct(err(b))} | ${pct(err(a))} |`,
    );
  const sb = stats(before);
  const sa = stats(after);
  const total = (name: string, f: (s: Stats) => string) => `| **${name}** | | | | ${f(sb)} | ${f(sa)} |`;
  return [
    `**${title}:** ${m.length} moved (${better} closer to the reference, ${m.length - better} further).`,
    "",
    "| Result | Reference | Before | After | Error before | Error after |",
    "|---|---|---|---|---|---|",
    ...rows,
    total(`Mean error (n = ${sa.n})`, (s) => pct(s.mean)),
    total("Mean absolute error", (s) => pct(s.meanAbs, false)),
    total("RMS error", (s) => pct(s.rms, false)),
    total("Largest error", (s) => pct(s.maxAbs, false)),
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const baseAt = args.indexOf("--base");
  const base = baseAt >= 0 ? args[baseAt + 1] : "HEAD";
  // A "|" would split the summary table's cells.
  const title = args
    .filter((_, i) => baseAt < 0 || (i !== baseAt && i !== baseAt + 1))
    .join(" ")
    .replace(/\|/g, "/")
    .trim();
  if (!title) throw new Error('Usage: bun scripts/verification-log.ts "Description of the change" [--base <rev>]');

  const after = JSON.parse(readFileSync(join(ROOT, DATA), "utf8")) as VerificationData;
  const before = JSON.parse(
    execFileSync("git", ["show", `${base}:${DATA}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 }),
  ) as VerificationData;
  const rev = execFileSync("git", ["rev-parse", "--short", base], { cwd: ROOT, encoding: "utf8" }).trim();
  const date = new Date().toISOString().slice(0, 10);
  const time = runTime();

  const b = points(before);
  const a = points(after);
  const entry = [
    `### ${date}: ${title}`,
    "",
    `Compared with ${rev}. Errors are relative to the reference, in percent. Verification run time: ${time}.`,
    "",
    section("Against other programs (midpoint of their range)", b.programs, a.programs),
    "",
    section("Against the papers", b.papers, a.papers),
    "",
  ].join("\n");

  const sp = [stats(b.programs), stats(a.programs)];
  const sl = [stats(b.papers), stats(a.papers)];
  const arrow = (x: Stats, y: Stats, f: (s: Stats) => number) => `${f(x).toFixed(3)} → ${f(y).toFixed(3)}`;
  const row =
    `| ${date} | ${title} | ${moved(b.programs, a.programs).length + moved(b.papers, a.papers).length} | ` +
    `${arrow(sp[0], sp[1], (s) => s.meanAbs)} | ${arrow(sp[0], sp[1], (s) => s.rms)} | ` +
    `${arrow(sl[0], sl[1], (s) => s.meanAbs)} | ${arrow(sl[0], sl[1], (s) => s.rms)} | ${time} |`;

  let log = readFileSync(LOG, "utf8");
  const nl = log.includes("\r\n") ? "\r\n" : "\n";
  const fix = (s: string) => s.replace(/\r?\n/g, nl);
  if (!log.includes(SUMMARY_END) || !log.includes(ENTRIES)) throw new Error(`${LOG} lacks its markers`);
  // Replacer functions: a "$" in the title must not be read as a pattern.
  log = log.replace(SUMMARY_END, () => fix(`${row}\n${SUMMARY_END}`));
  log = log.replace(ENTRIES, () => fix(`${ENTRIES}\n\n${entry}`));
  writeFileSync(LOG, log);
  console.log(`Added "${title}" to VERIFICATION-LOG.md`);
}

if (import.meta.main) main();
