/**
 * Measuring stick for the non-circular optimisation: every verification
 * check with non-circular optimisation, run with several search sizes and
 * convergence tolerances. Reports, per check, how far the result is from
 * the published value and how much it moves with the settings (the spread):
 * a robust optimisation finds the same surface whatever the search size.
 *
 *   bun scripts/noncircular-bench.ts [out.json]     (from packages/engine)
 *   bun scripts/noncircular-bench.ts --compare a.json b.json
 *
 * The search is a deterministic grid, so a run is reproducible; a different
 * search size gives the optimisation different starting circles.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { VERIFICATION_CASES, agrees, runVerification } from "../src/verification";
import type { AnalysisOptions } from "../src/types/analysis";

export const VARIANTS: Record<string, Partial<AnalysisOptions>> = {
  "1000/1000": { iterations: 1000, refinedIterations: 1000 },
  "2000/1000": { iterations: 2000, refinedIterations: 1000 },
  "3000/1500": { iterations: 3000, refinedIterations: 1500 },
  "4000/2000": { iterations: 4000, refinedIterations: 2000 },
  "6000/3000": { iterations: 6000, refinedIterations: 3000 },
};
export const TOLERANCES = [0.005, 0.001];

interface Row {
  id: string;
  check: number;
  label: string;
  published: number;
  /** FOS per variant, keyed "<variant>@<tolerance>". */
  fos: Record<string, number | null>;
  agrees: Record<string, boolean>;
  seconds: number;
}

const checks = () =>
  VERIFICATION_CASES.flatMap((c) =>
    c.checks.map((k, j) => ({ c, k, j })).filter(({ k }) => k.options?.nonCircularOptimization),
  );

function runShard(shard: number, shards: number): Row[] {
  return checks()
    .filter((_, i) => i % shards === shard)
    .map(({ c, k, j }) => {
      const t = performance.now();
      const fos: Row["fos"] = {};
      const ok: Row["agrees"] = {};
      for (const tol of TOLERANCES)
        for (const [name, v] of Object.entries(VARIANTS)) {
          const key = `${name}@${tol}`;
          fos[key] = runVerification(c.definition, k.method, { ...k.options, ...v, tolerance: tol }).fos;
          ok[key] = fos[key] != null && agrees(k, fos[key]!);
        }
      return { id: c.id, check: j, label: k.label, published: k.published, fos, agrees: ok, seconds: (performance.now() - t) / 1000 };
    });
}

async function runAll(): Promise<Row[]> {
  const shards = Math.max(1, Math.min(8, availableParallelism()));
  const dir = mkdtempSync(join(tmpdir(), "cslope-nc-"));
  await Promise.all(
    Array.from({ length: shards }, (_, k) => {
      const file = join(dir, `${k}.json`);
      return new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [import.meta.filename, "--shard", `${k}/${shards}`, file], { stdio: "inherit" });
        child.on("error", reject);
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`shard ${k} exited with ${code}`))));
      });
    }),
  );
  const rows = Array.from({ length: shards }, (_, k) => JSON.parse(readFileSync(join(dir, `${k}.json`), "utf8")) as Row[]).flat();
  return rows.sort((a, b) => a.id.localeCompare(b.id) || a.check - b.check);
}

/** Per tolerance: the spread (max - min over search sizes) and the worst deviation from the published value. */
function summarise(rows: Row[]) {
  return TOLERANCES.map((tol) => {
    const keys = Object.keys(VARIANTS).map((v) => `${v}@${tol}`);
    const per = rows.map((r) => {
      const v = keys.map((k) => r.fos[k]).filter((x): x is number => x != null);
      const spread = v.length ? (Math.max(...v) - Math.min(...v)) / r.published : NaN;
      const worst = v.length ? Math.max(...v.map((x) => Math.abs(x / r.published - 1))) : NaN;
      return { r, spread, worst, fails: keys.filter((k) => !r.agrees[k]).length };
    });
    return {
      tol,
      per,
      meanSpread: per.reduce((s, p) => s + p.spread, 0) / per.length,
      maxSpread: Math.max(...per.map((p) => p.spread)),
      fails: per.reduce((s, p) => s + p.fails, 0),
      runs: per.length * keys.length,
    };
  });
}

function report(rows: Row[], label = "") {
  for (const s of summarise(rows)) {
    console.log(
      `\n${label}tolerance ${s.tol}: mean spread ${(s.meanSpread * 100).toFixed(2)} %, max spread ${(s.maxSpread * 100).toFixed(2)} %, ${s.fails}/${s.runs} runs outside the reference tolerance`,
    );
    for (const p of s.per)
      console.log(
        `  ${p.r.id}#${p.r.check} ${p.r.label.padEnd(30)} ref ${p.r.published.toFixed(3)}  ` +
          Object.keys(VARIANTS).map((v) => p.r.fos[`${v}@${s.tol}`]?.toFixed(3) ?? "null").join(" ") +
          `  spread ${(p.spread * 100).toFixed(1)} %${p.fails ? `  ${p.fails} outside` : ""}`,
      );
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--shard");
  if (i >= 0) {
    const [k, n] = args[i + 1].split("/").map(Number);
    writeFileSync(args[i + 2], JSON.stringify(runShard(k, n)));
  } else if (args[0] === "--compare") {
    const [a, b] = args.slice(1).map((f) => JSON.parse(readFileSync(f, "utf8")) as Row[]);
    report(a, "before, ");
    report(b, "after, ");
  } else {
    const started = Date.now();
    const rows = await runAll();
    report(rows);
    console.log(`\n${rows.length} checks in ${((Date.now() - started) / 1000).toFixed(0)} s`);
    if (args[0]) writeFileSync(args[0], JSON.stringify(rows));
  }
}
