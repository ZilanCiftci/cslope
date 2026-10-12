/**
 * Runs every published verification problem through the engine and writes
 * src/content/generated/verification.json for the site: the verification
 * table, the key figures on the home page and the examples there. Sources
 * are anonymised (see anonymise.ts) and the result is checked for
 * forbidden names before it is written.
 *
 *   bun scripts/generate-data.ts            (all problems, in parallel)
 *   bun scripts/generate-data.ts --cached   (reuse the last engine results)
 *
 * The raw engine results are cached in node_modules/.cache, so a change to
 * the anonymisation or the output format does not need a new engine run.
 *
 * The file is checked in, so the site builds without running the engine.
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
  runReliabilityCase,
  runVerification,
} from "@cslope/engine";
import { anonymiseReference, anonymiseSource, anonymiseTitle, publicId } from "./anonymise";
import { findForbiddenNames } from "./forbidden-names";
import type { VerificationData, VerificationProblem, ReliabilityProblem } from "../src/content/verification-types";

const OUT = join(import.meta.dirname, "../src/content/generated/verification.json");
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

function runReliability(shard: number, shards: number): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  RELIABILITY_CASES.forEach((c, i) => {
    if (i % shards !== shard) return;
    out[c.id] = runReliabilityCase(c).map((r) => r.computed);
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

export function buildData(
  fos: Record<string, (number | null)[]>,
  reliabilityResults: Record<string, number[]>,
): VerificationData {
  const problems: VerificationProblem[] = VERIFICATION_CASES.map((c) => {
    const ref = anonymiseReference(c.reference);
    return {
      id: publicId(c.id),
      title: anonymiseTitle(c.title),
      reference: ref.text,
      literature: ref.literature,
      commercial: ref.commercial,
      surface: c.surface,
      units: c.units,
      checks: c.checks.map((k, j) => {
        // The pass mark comes from the engine's own value, as in the engine's
        // verification tests; the shown values are rounded.
        const raw = fos[c.id]?.[j] ?? null;
        const computed = raw == null ? null : round(raw);
        const rawDeviation = raw == null ? null : (raw - k.published) / k.published;
        const deviation = computed == null ? null : (computed - k.published) / k.published;
        return {
          method: k.label,
          published: k.published,
          source: anonymiseSource(k.publishedBy),
          tolerance: k.tolerance,
          computed,
          deviation: deviation == null ? null : round(deviation, 5),
          pass: rawDeviation != null && Math.abs(rawDeviation) <= k.tolerance,
        };
      }),
    };
  });
  const reliability: ReliabilityProblem[] = RELIABILITY_CASES.map((c) => ({
    id: publicId(c.id),
    // The engine's id follows a vendor's numbering, so it is never shown.
    title: anonymiseTitle(VERIFICATION_CASES.find((v) => v.id === c.id)?.title ?? `Probabilistic problem ${publicId(c.id)}`),
    checks: c.checks.map(([quantity, published, publishedBy, tolerance], j) => {
      const value = reliabilityResults[c.id]?.[j];
      const raw = value == null || !Number.isFinite(value) ? null : value;
      const computed = raw == null ? null : round(raw);
      return {
        quantity,
        published,
        source: anonymiseSource(publishedBy),
        tolerance,
        computed,
        pass:
          raw != null &&
          (quantity === "fos"
            ? Math.abs(raw - published) / published <= tolerance
            : Math.abs(raw - published) <= tolerance + 1e-9),
      };
    }),
  }));
  const checks = problems.flatMap((p) => p.checks);
  return {
    summary: {
      problems: problems.length,
      checks: checks.length,
      passed: checks.filter((k) => k.pass).length,
      literatureProblems: problems.filter((p) => p.literature).length,
      reliabilityChecks: reliability.reduce((n, r) => n + r.checks.length, 0),
    },
    problems,
    reliability,
  };
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
      throw new Error("Anonymisation left a program name in the data; extend anonymise.ts.");
    }
    mkdirSync(join(OUT, ".."), { recursive: true });
    writeFileSync(OUT, json);
    const s = JSON.parse(json).summary;
    console.log(`${s.problems} problems, ${s.passed}/${s.checks} checks pass, ${((Date.now() - started) / 1000).toFixed(0)} s → ${OUT}`);
  }
}
