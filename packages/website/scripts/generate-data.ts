/**
 * Runs every published verification problem through the engine and writes
 * src/content/generated/verification.json for the site: the verification
 * table, the key figures on the home page and the examples there. Per
 * problem: the values its sources publish, and for each analysis cSlope
 * runs, cSlope's result and the range of other programs' results, without
 * naming any program and without marking results as passed. The result is
 * checked for forbidden names before it is written.
 *
 *   bun scripts/generate-data.ts            (all problems, in parallel)
 *   bun scripts/generate-data.ts --cached   (reuse the last engine results)
 *
 * The raw engine results are cached in node_modules/.cache, so a change to
 * the output format does not need a new engine run.
 *
 * The file is checked in, so the site builds without running the engine.
 * Regenerate it after changing the engine or the verification problems;
 * generate-data.test.ts fails when the problems no longer match the file.
 * Regenerate the PDF report the site serves at the same time: bun run report.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import {
  RELIABILITY_CASES,
  VERIFICATION_CASES,
  agrees,
  isProgramSource,
  paperValues,
  presentedAnalyses,
  runReliabilityCase,
  runVerification,
} from "@cslope/engine/verification";
import { findForbiddenNames } from "./forbidden-names";
import type { ReliabilityProblem, VerificationData, VerificationProblem } from "../src/content/verification-types";

// The table is published: it uses the full search, like the verification
// report (the test suite runs a shorter one on circular problems). The
// shards inherit the setting.
process.env.CSLOPE_VERIFICATION_FULL = "1";

const OUT = join(import.meta.dirname, "../src/content/generated/verification.json");
const CACHE = join(import.meta.dirname, "../node_modules/.cache/cslope-verification-raw.json");
/** Wall time of the last full engine run, read by scripts/verification-log.ts. */
export const RUN_TIME = join(import.meta.dirname, "../node_modules/.cache/cslope-verification-run.json");

/**
 * cSlope's FOS for every analysis of the problems in this shard, in the
 * order of presentedAnalyses (the checks' analyses, then those run only for
 * a published value).
 */
function runShard(shard: number, shards: number): Record<string, (number | null)[]> {
  const out: Record<string, (number | null)[]> = {};
  VERIFICATION_CASES.forEach((c, i) => {
    if (i % shards !== shard) return;
    out[c.id] = presentedAnalyses(c).map((a) => runVerification(c.definition, a.method, a.options).fos);
  });
  return out;
}

/** Keyed by index: a problem can have more than one probabilistic analysis. */
function runReliability(shard: number, shards: number): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  RELIABILITY_CASES.forEach((c, i) => {
    if (i % shards !== shard) return;
    out[i] = runReliabilityCase(c).map((r) => r.computed);
  });
  return out;
}

async function runAllShards(): Promise<{
  fos: Record<string, (number | null)[]>;
  reliability: Record<string, number[]>;
}> {
  const shards = Math.max(1, Math.min(8, availableParallelism()));
  const dir = mkdtempSync(join(tmpdir(), "cslope-data-"));
  await Promise.all(
    Array.from({ length: shards }, (_, k) => {
      const file = join(dir, `${k}.json`);
      return new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [import.meta.filename, "--shard", `${k}/${shards}`, file], {
          stdio: "inherit",
        });
        child.on("error", reject);
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`shard ${k} exited with ${code}`))));
      });
    }),
  );
  const fos: Record<string, (number | null)[]> = {};
  const reliability: Record<string, number[]> = {};
  for (let k = 0; k < shards; k++) {
    const part = JSON.parse(readFileSync(join(dir, `${k}.json`), "utf8"));
    Object.assign(fos, part.fos);
    Object.assign(reliability, part.reliability);
  }
  return { fos, reliability };
}

const round = (x: number, digits = 4) => Number(x.toFixed(digits));

/** A reference that is only a program's verification manual. */
const COMMERCIAL_ONLY = /^Verification manual of a commercial slope stability program\.$/;
const COMMERCIAL = /commercial slope stability program/i;

export function buildData(
  fos: Record<string, (number | null)[]>,
  reliabilityResults: Record<string, number[]>,
): VerificationData {
  const value = (raw: number | null | undefined) => (raw == null || !Number.isFinite(raw) ? null : round(raw));
  const problems: VerificationProblem[] = VERIFICATION_CASES.map((c) => ({
    id: c.id,
    title: c.title,
    reference: c.reference,
    literature: !COMMERCIAL_ONLY.test(c.reference),
    commercial: COMMERCIAL.test(c.reference),
    surface: c.surface,
    units: c.units,
    // Each published value with cSlope's result for the same method, when
    // cSlope has it; each analysis once, with cSlope's result and the
    // other programs' range. No pass marks: the engine's tests keep those.
    published: paperValues(c).map(({ analysis, ...v }) => {
      const j = presentedAnalyses(c).findIndex((a) => a.label === analysis);
      return j >= 0 ? { ...v, analysis, computed: value(fos[c.id]?.[j]) } : { ...v, computed: null };
    }),
    results: presentedAnalyses(c).map((a, j) => ({
      method: a.label,
      computed: value(fos[c.id]?.[j]),
      programs: a.programs && { min: a.programs.min, max: a.programs.max },
    })),
    ...(c.publicNote ? { note: c.publicNote } : {}),
  }));
  const reliability: ReliabilityProblem[] = RELIABILITY_CASES.map((c, i) => {
    const quantities = [...new Set(c.checks.map(([q]) => q))].filter((q) => q !== "fos");
    return {
      id: c.id,
      title: VERIFICATION_CASES.find((v) => v.id === c.id)?.title ?? `Probabilistic problem ${c.id}`,
      rows: quantities.map((quantity) => {
        const checks = c.checks.map((k, j) => ({ k, j })).filter(({ k }) => k[0] === quantity);
        const programs = checks.filter(({ k }) => isProgramSource(k[2])).map(({ k }) => k[1]);
        return {
          quantity,
          computed: value(reliabilityResults[i]?.[checks[0].j]),
          published: checks
            .filter(({ k }) => !isProgramSource(k[2]))
            .map(({ k }) => ({ value: k[1], source: k[2] })),
          programs: programs.length ? { min: Math.min(...programs), max: Math.max(...programs) } : null,
        };
      }),
    };
  });
  return {
    summary: {
      problems: problems.length,
      results: problems.reduce((n, p) => n + p.results.length, 0),
      publishedValues: problems.reduce((n, p) => n + p.published.length, 0),
      problemsWithPublished: problems.filter((p) => p.published.length > 0).length,
      literatureProblems: problems.filter((p) => p.literature).length,
      reliabilityQuantities: reliability.reduce((n, r) => n + r.rows.length, 0),
    },
    problems,
    reliability,
  };
}

/**
 * How many checks agree with their reference by the engine's rule
 * (tolerance.ts), from the results per analysis.
 */
export function agreement(fos: Record<string, (number | null)[]>): { agree: number; total: number } {
  const checks = VERIFICATION_CASES.flatMap((c) => {
    const analyses = presentedAnalyses(c);
    return c.checks.map((k, j) => ({ k, value: fos[c.id]?.[analyses.findIndex((a) => a.checks.includes(j))] ?? null }));
  });
  return { agree: checks.filter(({ k, value }) => value != null && agrees(k, value)).length, total: checks.length };
}

if (import.meta.main) {
  const i = process.argv.indexOf("--shard");
  if (i >= 0) {
    const [k, n] = process.argv[i + 1].split("/").map(Number);
    const file = process.argv[i + 2];
    writeFileSync(file, JSON.stringify({ fos: runShard(k, n), reliability: runReliability(k, n) }));
  } else {
    const started = Date.now();
    let raw: Awaited<ReturnType<typeof runAllShards>>;
    if (process.argv.includes("--cached") && existsSync(CACHE)) {
      raw = JSON.parse(readFileSync(CACHE, "utf8"));
      // A cache from an older set of problems would publish them as failed.
      const stale =
        VERIFICATION_CASES.filter((c) => raw.fos[c.id]?.length !== presentedAnalyses(c).length).length +
        RELIABILITY_CASES.filter((c, i) => raw.reliability[i]?.length !== c.checks.length).length;
      if (stale) throw new Error(`The cache misses ${stale} problem(s) or checks; run without --cached.`);
    } else {
      raw = await runAllShards();
      mkdirSync(join(CACHE, ".."), { recursive: true });
      writeFileSync(CACHE, JSON.stringify(raw));
      const seconds = (Date.now() - started) / 1000;
      writeFileSync(RUN_TIME, JSON.stringify({ seconds, workers: availableParallelism(), at: new Date().toISOString() }));
    }
    const { fos, reliability } = raw;
    const json = JSON.stringify(buildData(fos, reliability), null, 1) + "\n";
    const hits = findForbiddenNames("verification.json", json);
    if (hits.length) {
      for (const h of hits) console.error(`line ${h.line}: "${h.match}" in …${h.context}…`);
      throw new Error("A program name is left in the verification problems.");
    }
    mkdirSync(join(OUT, ".."), { recursive: true });
    writeFileSync(OUT, json);
    const s = JSON.parse(json).summary;
    const a = agreement(fos);
    console.log(`${s.problems} problems, ${a.agree}/${a.total} checks agree, ${((Date.now() - started) / 1000).toFixed(0)} s → ${OUT}`);
  }
}
