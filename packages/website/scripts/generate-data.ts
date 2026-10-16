/**
 * Runs every published verification problem through the engine and writes
 * src/content/generated/verification.json for the site: the verification
 * table, the key figures on the home page and the examples there. The
 * problems carry cSlope's own ids and anonymous sources already; the result
 * is still checked for forbidden names before it is written.
 *
 *   bun scripts/generate-data.ts            (all problems, in parallel)
 *   bun scripts/generate-data.ts --cached   (reuse the last engine results)
 *
 * The raw engine results are cached in node_modules/.cache, so a change to
 * the output format does not need a new engine run.
 *
 * It also writes src/content/generated/home-plots.json: a small drawing of
 * the critical surface of each example on the home page, from a fresh run
 * of that check (also with --cached).
 *
 * The files are checked in, so the site builds without running the engine.
 * Regenerate it after changing the engine or the verification problems;
 * generate-data.test.ts fails when the problems no longer match the file.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import {
  RELIABILITY_CASES,
  VERIFICATION_CASES,
  agrees,
  runReliabilityCase,
  runVerification,
} from "@cslope/engine/verification";
import { findForbiddenNames } from "./forbidden-names";
import type {
  HomePlots,
  ReliabilityProblem,
  SlopePlot,
  VerificationData,
  VerificationProblem,
} from "../src/content/verification-types";
import { homeExamples } from "../src/content/verification";

// The table is published: it uses the full search, like the verification
// report (the test suite runs a shorter one on circular problems). The
// shards inherit the setting.
process.env.CSLOPE_VERIFICATION_FULL = "1";

const OUT = join(import.meta.dirname, "../src/content/generated/verification.json");
const PLOTS = join(import.meta.dirname, "../src/content/generated/home-plots.json");
const CACHE = join(import.meta.dirname, "../node_modules/.cache/cslope-verification-raw.json");

/** The computed FOS of every check of the problems in this shard. */
function runShard(shard: number, shards: number): Record<string, (number | null)[]> {
  const out: Record<string, (number | null)[]> = {};
  VERIFICATION_CASES.forEach((c, i) => {
    if (i % shards !== shard) return;
    out[c.id] = c.checks.map((k) => runVerification(c.definition, k.method, k.options).fos);
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
  const problems: VerificationProblem[] = VERIFICATION_CASES.map((c) => ({
    id: c.id,
    title: c.title,
    reference: c.reference,
    literature: !COMMERCIAL_ONLY.test(c.reference),
    commercial: COMMERCIAL.test(c.reference),
    surface: c.surface,
    units: c.units,
    // The reference and the computed value only: the site shows no
    // tolerances or pass marks (the engine's tests keep those).
    checks: c.checks.map((k, j) => {
      const raw = fos[c.id]?.[j] ?? null;
      const computed = raw == null ? null : round(raw);
      const deviation = computed == null ? null : (computed - k.published) / k.published;
      return {
        method: k.label,
        published: k.published,
        source: k.publishedBy,
        computed,
        deviation: deviation == null ? null : round(deviation, 5),
      };
    }),
  }));
  const reliability: ReliabilityProblem[] = RELIABILITY_CASES.map((c, i) => ({
    id: c.id,
    title: VERIFICATION_CASES.find((v) => v.id === c.id)?.title ?? `Probabilistic problem ${c.id}`,
    checks: c.checks.map(([quantity, published, publishedBy], j) => {
      const value = reliabilityResults[i]?.[j];
      const raw = value == null || !Number.isFinite(value) ? null : value;
      return { quantity, published, source: publishedBy, computed: raw == null ? null : round(raw) };
    }),
  }));
  const checks = problems.flatMap((p) => p.checks);
  return {
    summary: {
      problems: problems.length,
      checks: checks.length,
      literatureProblems: problems.filter((p) => p.literature).length,
      // β and Pf; a probabilistic problem's mean factor of safety is not counted.
      reliabilityChecks: reliability.reduce((n, r) => n + r.checks.filter((k) => k.quantity !== "fos").length, 0),
    },
    problems,
    reliability,
  };
}

/** The critical surface of one check, drawn as the home page shows it. */
export function slopePlot(caseIndex: number, checkIndex: number): SlopePlot | null {
  const c = VERIFICATION_CASES[caseIndex];
  const k = c.checks[checkIndex];
  const { slope } = runVerification(c.definition, k.method, k.options);
  const plane = slope.search.find((p) => p.fos != null && p.slices && p.slices.length > 0);
  if (!plane) return null;
  const r = (v: number) => round(v, 2);
  const pt = (x: number, y: number): [number, number] => [r(x), r(y)];
  const names = c.definition.materials.map((m) => m.name);
  const regions = slope.materialGeometries.map((g) => ({
    material: Math.max(0, names.indexOf(g.material.name)),
    points: g.px.map((x, i) => pt(x, g.py[i])),
  }));
  const xs = regions.flatMap((g) => g.points.map((p) => p[0]));
  const ys = regions.flatMap((g) => g.points.map((p) => p[1]));
  const bounds: SlopePlot["bounds"] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const w = slope.waterRLXY;
  const water = w
    ? w.x
        .map((x, i) => pt(Math.min(Math.max(x, bounds[0]), bounds[2]), w.y[i]))
        .filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0])
    : null;
  const s = plane.slices!;
  const surface = [pt(s[0].xLeft, s[0].y0Bottom), ...s.map((q) => pt(q.xRight, q.y1Bottom))];
  const top = [pt(s[0].xLeft, s[0].y0Top), ...s.map((q) => pt(q.xRight, q.y1Top))];
  return { bounds, regions, water: water && water.length > 1 ? water : null, surface, mass: [...surface, ...top.reverse()] };
}

/** A plot for each example on the home page, from the table just built. */
export function homePlots(data: VerificationData): HomePlots {
  const out: HomePlots = {};
  for (const { problem, check } of homeExamples(data)) {
    const i = VERIFICATION_CASES.findIndex((c) => c.id === problem.id);
    const plot = slopePlot(i, problem.checks.indexOf(check));
    if (plot) out[problem.id] = plot;
  }
  return out;
}

/** How many checks agree with their reference by the engine's rule (tolerance.ts). */
export function agreement(fos: Record<string, (number | null)[]>): { agree: number; total: number } {
  const checks = VERIFICATION_CASES.flatMap((c) => c.checks.map((k, j) => ({ k, value: fos[c.id]?.[j] ?? null })));
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
        VERIFICATION_CASES.filter((c) => raw.fos[c.id]?.length !== c.checks.length).length +
        RELIABILITY_CASES.filter((c, i) => raw.reliability[i]?.length !== c.checks.length).length;
      if (stale) throw new Error(`The cache misses ${stale} problem(s) or checks; run without --cached.`);
    } else {
      raw = await runAllShards();
      mkdirSync(join(CACHE, ".."), { recursive: true });
      writeFileSync(CACHE, JSON.stringify(raw));
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
    writeFileSync(PLOTS, JSON.stringify(homePlots(JSON.parse(json))) + "\n");
    const s = JSON.parse(json).summary;
    const a = agreement(fos);
    console.log(`${s.problems} problems, ${a.agree}/${a.total} checks agree, ${((Date.now() - started) / 1000).toFixed(0)} s → ${OUT}`);
  }
}
