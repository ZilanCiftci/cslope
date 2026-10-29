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
 *   bun scripts/generate-data.ts --fem-fresh   (rerun the cached finite element results)
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
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { availableParallelism, loadavg, tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import {
  RELIABILITY_CASES,
  VERIFICATION_CASES,
  runFemVerification,
  agrees,
  femAgrees,
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

/** The analysis label of the finite element results in the table. */
export const FEM_LABEL = "Strength reduction (FE)";

/** Raw finite element result of a problem (cached with the other results). */
export interface FemRaw {
  fos: number;
  flowRule: string;
  levels: { elements: number; fos: number }[];
}

/**
 * Finite element results are cached by a hash of the problem's input and
 * of every engine source the finite element analysis imports, directly or
 * not (packages/engine/src/fem and what it uses): they take minutes, and a
 * change elsewhere in the limit equilibrium engine does not move them.
 */
const FEM_CACHE = join(import.meta.dirname, "../node_modules/.cache/cslope-fem");
const ENGINE_SRC = join(import.meta.dirname, "../../engine/src");

/** The engine sources reachable by relative imports from the finite element entry points. */
function femSources(): string[] {
  const seen = new Set<string>();
  const stack = ["fem/analysis.ts", "fem/lower-bound.ts", "fem/summary.ts", "verification/fem-cases.ts"].map((f) => join(ENGINE_SRC, f));
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, "utf8").matchAll(/(?:import|export)[^;]*?from\s+"(\.[^"]+)"/g)) {
      const base = normalize(join(dirname(file), m[1]));
      const next = [`${base}.ts`, join(base, "index.ts"), base].find((c) => c.endsWith(".ts") && existsSync(c));
      if (next) stack.push(next);
    }
  }
  return [...seen].sort();
}

let femSourceHash: string | undefined;
function femKey(c: (typeof VERIFICATION_CASES)[number]): string {
  if (femSourceHash === undefined) {
    const h = createHash("sha256");
    for (const f of femSources()) {
      h.update(f.slice(ENGINE_SRC.length));
      h.update(readFileSync(f));
    }
    femSourceHash = h.digest("hex");
  }
  const h = createHash("sha256");
  h.update(JSON.stringify([c.definition, c.fem]));
  h.update(femSourceHash);
  return h.digest("hex").slice(0, 32);
}

/** Finite element results for the problems with a `fem` setup in this shard. */
function runFemShard(shard: number, shards: number): Record<string, FemRaw> {
  const out: Record<string, FemRaw> = {};
  mkdirSync(FEM_CACHE, { recursive: true });
  VERIFICATION_CASES.filter((c) => c.fem).forEach((c, i) => {
    if (i % shards !== shard) return;
    const file = join(FEM_CACHE, `${c.id}-${femKey(c)}.json`);
    if (existsSync(file) && !process.argv.includes("--fem-fresh")) {
      out[c.id] = JSON.parse(readFileSync(file, "utf8"));
      return;
    }
    const r = runFemVerification(c.definition, c.fem!);
    out[c.id] = {
      fos: r.factorOfSafety,
      flowRule: c.fem!.flowRule ?? "davis-b",
      levels: r.levels.map((l) => ({ elements: l.elements, fos: l.factorOfSafety })),
    };
    writeFileSync(file, JSON.stringify(out[c.id]));
  });
  return out;
}

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
  fem: Record<string, FemRaw>;
}> {
  const shards = Math.max(1, Math.min(8, availableParallelism()));
  const dir = mkdtempSync(join(tmpdir(), "cslope-data-"));
  await Promise.all(
    Array.from({ length: shards }, (_, k) => {
      const file = join(dir, `${k}.json`);
      return new Promise<void>((resolve, reject) => {
        const fresh = process.argv.includes("--fem-fresh") ? ["--fem-fresh"] : [];
        const child = spawn(process.execPath, [import.meta.filename, "--shard", `${k}/${shards}`, file, ...fresh], {
          stdio: "inherit",
        });
        child.on("error", reject);
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`shard ${k} exited with ${code}`))));
      });
    }),
  );
  const fos: Record<string, (number | null)[]> = {};
  const reliability: Record<string, number[]> = {};
  const fem: Record<string, FemRaw> = {};
  for (let k = 0; k < shards; k++) {
    const part = JSON.parse(readFileSync(join(dir, `${k}.json`), "utf8"));
    Object.assign(fos, part.fos);
    Object.assign(reliability, part.reliability);
    Object.assign(fem, part.fem);
  }
  return { fos, reliability, fem };
}

const round = (x: number, digits = 4) => Number(x.toFixed(digits));

/** A reference that is only a program's verification manual. */
const COMMERCIAL_ONLY = /^Verification manual of a commercial slope stability program\.$/;
const COMMERCIAL = /commercial slope stability program/i;

export function buildData(
  fos: Record<string, (number | null)[]>,
  reliabilityResults: Record<string, number[]>,
  fem: Record<string, FemRaw> = {},
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
  })).map((p, i) => withFem(p, VERIFICATION_CASES[i], fem[p.id], value));
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
 * Adds the finite element analysis to a problem: a row in its results and
 * cSlope's value next to the published finite element, finite difference,
 * limit analysis and theory values it is compared with (fem.references).
 */
function withFem(
  p: VerificationProblem,
  c: (typeof VERIFICATION_CASES)[number],
  raw: FemRaw | undefined,
  value: (x: number | null | undefined) => number | null,
): VerificationProblem {
  if (!c.fem) return p;
  const computed = value(raw?.fos);
  const published = p.published.slice();
  for (const r of c.fem.references) {
    // The site names no other program, not even by letter.
    const source = isProgramSource(r.source) ? "another program's verification manual" : r.source;
    const j = published.findIndex((v) => v.value === r.value && v.source === source);
    if (j >= 0) published[j] = { ...published[j], analysis: FEM_LABEL, computed };
    else published.push({ value: r.value, ...(r.upper != null ? { upper: r.upper } : {}), method: r.method, source, analysis: FEM_LABEL, computed });
  }
  return {
    ...p,
    published,
    results: [...p.results, { method: FEM_LABEL, computed, programs: null }],
    fem: { flowRule: raw?.flowRule ?? c.fem.flowRule ?? "davis-b", levels: raw?.levels ?? [] },
  };
}

/** How many finite element results lie within their references' tolerance (fem-cases.ts). */
export function femAgreement(fem: Record<string, FemRaw>): { agree: number; total: number } {
  const refs = VERIFICATION_CASES.flatMap((c) => (c.fem ? c.fem.references.map((r) => ({ r, fos: fem[c.id]?.fos })) : []));
  return { agree: refs.filter(({ r, fos }) => fos != null && femAgrees(r, fos)).length, total: refs.length };
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
    writeFileSync(file, JSON.stringify({ fos: runShard(k, n), reliability: runReliability(k, n), fem: runFemShard(k, n) }));
  } else {
    const started = Date.now();
    // Other work on the machine at the start, so run times stay comparable.
    const loadAtStart = loadavg()[0];
    let raw: Awaited<ReturnType<typeof runAllShards>>;
    if (process.argv.includes("--cached") && existsSync(CACHE)) {
      raw = JSON.parse(readFileSync(CACHE, "utf8"));
      // A cache from an older set of problems would publish them as failed.
      const stale =
        VERIFICATION_CASES.filter((c) => raw.fos[c.id]?.length !== presentedAnalyses(c).length).length +
        RELIABILITY_CASES.filter((c, i) => raw.reliability[i]?.length !== c.checks.length).length +
        VERIFICATION_CASES.filter((c) => c.fem && !raw.fem?.[c.id]).length;
      if (stale) throw new Error(`The cache misses ${stale} problem(s) or checks; run without --cached.`);
    } else {
      raw = await runAllShards();
      mkdirSync(join(CACHE, ".."), { recursive: true });
      writeFileSync(CACHE, JSON.stringify(raw));
      const seconds = (Date.now() - started) / 1000;
      writeFileSync(RUN_TIME, JSON.stringify({ seconds, workers: Math.max(1, Math.min(8, availableParallelism())), load: loadAtStart, at: new Date().toISOString() }));
    }
    const { fos, reliability, fem = {} } = raw;
    const json = JSON.stringify(buildData(fos, reliability, fem), null, 1) + "\n";
    const hits = findForbiddenNames("verification.json", json);
    if (hits.length) {
      for (const h of hits) console.error(`line ${h.line}: "${h.match}" in …${h.context}…`);
      throw new Error("A program name is left in the verification problems.");
    }
    mkdirSync(join(OUT, ".."), { recursive: true });
    writeFileSync(OUT, json);
    const s = JSON.parse(json).summary;
    const a = agreement(fos);
    const fa = femAgreement(fem);
    console.log(`${s.problems} problems, ${a.agree}/${a.total} checks agree, ${fa.agree}/${fa.total} finite element references agree, ${((Date.now() - started) / 1000).toFixed(0)} s → ${OUT}`);
  }
}
