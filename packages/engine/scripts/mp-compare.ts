/**
 * Compares the iterative Morgenstern-Price solver with the march solver
 * (`mp-march.ts`) on every M-P check in the verification set:
 *
 *   1. same surface: the critical surface of the iterative search, solved
 *      again by the march solver (all roots, Newton vs scan, time);
 *   2. full search: the whole search run with each solver, critical FOS
 *      against the published value, and the time.
 *
 *   bun scripts/mp-compare.ts out.json          (from packages/engine)
 *   bun scripts/mp-compare.ts --report out.json
 *
 * Solver options for the run: --lambda-min <λ> (e.g. 0), --scan-only
 * (no Newton fast path in the search), --rule nearest-zero|largest|smallest.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { VERIFICATION_CASES, agrees, runVerification } from "../src/verification";
import {
  analyseMorgensternPrice,
  analyseOrdinary,
  getSlicePropertyArrays,
  setMorgensternPriceSolver,
} from "../src/model/solvers";
import { setMarchSearchOptions, solveMorgensternPriceMarch, type MpMarchOptions, type MpRoot } from "../src/model/mp-march";

function marchOptions(args: string[]): MpMarchOptions {
  const o: MpMarchOptions = {};
  const i = args.indexOf("--lambda-min");
  if (i >= 0) o.lambdaMin = Number(args[i + 1]);
  if (args.includes("--scan-only")) o.scanOnly = true;
  const r = args.indexOf("--rule");
  if (r >= 0) o.rule = args[r + 1] as MpMarchOptions["rule"];
  return o;
}
const OPTIONS = marchOptions(process.argv.slice(2));
setMarchSearchOptions(OPTIONS);

interface Row {
  id: string;
  label: string;
  published: number;
  tolerance: number;
  nonCircular: boolean;
  /** Same surface. */
  same: {
    old: number | null;
    oldGap: number | null;
    oldMs: number;
    roots: MpRoot[];
    newton: MpRoot | null;
    chosen: number | null;
    holes: number;
    multiFf: number;
    evaluations: number;
    newMs: number;
  };
  /** Full search with each solver. */
  search: { old: number | null; oldS: number; new: number | null; newS: number };
}

const analyses = () => {
  const seen = new Set<string>();
  return VERIFICATION_CASES.flatMap((c) =>
    c.checks
      .filter((k) => k.method === "Morgenstern-Price")
      .map((k) => ({ c, k }))
      .filter(({ c, k }) => {
        const key = c.id + JSON.stringify(k.options ?? {});
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
  );
};

function runShard(shard: number, shards: number): Row[] {
  return analyses()
    .filter((_, i) => i % shards === shard)
    .map(({ c, k }) => {
      setMorgensternPriceSolver("iterative");
      let t = performance.now();
      const { fos: oldFos, slope } = runVerification(c.definition, "Morgenstern-Price", k.options);
      const oldS = (performance.now() - t) / 1000;
      const plane = slope.search.find((p) => p.fos != null && p.slices) ?? null;
      let same: Row["same"] = { old: null, oldGap: null, oldMs: 0, roots: [], newton: null, chosen: null, holes: 0, multiFf: 0, evaluations: 0, newMs: 0 };
      if (plane) {
        const s = plane.slices!;
        t = performance.now();
        const [f, lff] = analyseMorgensternPrice(slope, s);
        const oldMs = performance.now() - t;
        const gap = lff ? Math.min(...lff.map((x) => x[3])) : null;
        const p = getSlicePropertyArrays(s, s[0].xLeft, s[s.length - 1].xRight, slope.intersliceFunction, slope.intersliceDataPoints);
        t = performance.now();
        const r = solveMorgensternPriceMarch(p, analyseOrdinary(slope, s) ?? 1, { ...OPTIONS, scanOnly: false });
        const newMs = performance.now() - t;
        same = { old: f, oldGap: gap, oldMs, roots: r.roots, newton: r.newton, chosen: r.chosen?.F ?? null, holes: r.holes, multiFf: r.multiFf, evaluations: r.evaluations, newMs };
      }
      setMorgensternPriceSolver("march");
      t = performance.now();
      const { fos: newFos } = runVerification(c.definition, "Morgenstern-Price", k.options);
      const newS = (performance.now() - t) / 1000;
      setMorgensternPriceSolver("iterative");
      return {
        id: c.id, label: k.label, published: k.published, tolerance: k.tolerance,
        nonCircular: !!k.options?.nonCircularOptimization,
        same, search: { old: oldFos, oldS, new: newFos, newS },
      };
    });
}

async function runAll(): Promise<Row[]> {
  const shards = Math.max(1, Math.min(8, availableParallelism()));
  const dir = mkdtempSync(join(tmpdir(), "cslope-mp-"));
  await Promise.all(
    Array.from({ length: shards }, (_, k) => {
      const file = join(dir, `${k}.json`);
      return new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [import.meta.filename, "--shard", `${k}/${shards}`, file, ...process.argv.slice(3)], { stdio: "inherit" });
        child.on("error", reject);
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`shard ${k} exited with ${code}`))));
      });
    }),
  );
  return Array.from({ length: shards }, (_, k) => JSON.parse(readFileSync(join(dir, `${k}.json`), "utf8")) as Row[])
    .flat()
    .sort((a, b) => a.id.localeCompare(b.id));
}

const f3 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(3));
const dev = (v: number | null, pub: number) => (v == null ? "—" : `${((v / pub - 1) * 100).toFixed(1)} %`);

function report(rows: Row[]): string {
  const out: string[] = [];
  const within = (v: number | null, r: Row) => v != null && agrees({ published: r.published, tolerance: r.tolerance } as never, v);
  const n = rows.length;
  const sameBoth = rows.filter((r) => r.same.old != null && r.same.chosen != null);
  const sameAgree = sameBoth.filter((r) => Math.abs(r.same.old! - r.same.chosen!) < 0.002).length;
  const newtonOk = rows.filter((r) => r.same.newton && r.same.roots.some((x) => Math.abs(x.F - r.same.newton!.F) < 1e-4)).length;
  const newtonNull = rows.filter((r) => r.same.chosen != null && !r.same.newton).length;
  out.push(`## Summary (${n} analyses, options ${JSON.stringify(OPTIONS)})`, "");
  out.push(`| | iterative | march |`, `|---|---|---|`);
  out.push(`| same surface: solved | ${rows.filter((r) => r.same.old != null).length} | ${rows.filter((r) => r.same.chosen != null).length} |`);
  out.push(`| same surface: both solved and |ΔF| < 0.002 | ${sameAgree} of ${sameBoth.length} | |`);
  out.push(`| same surface: accepted with gap ≥ 0.001 (fallback) | ${rows.filter((r) => r.same.oldGap != null && r.same.oldGap >= 0.001).length} | — |`);
  out.push(`| same surface: several roots in the band | — | ${rows.filter((r) => r.same.roots.length > 1).length} |`);
  out.push(`| same surface: Newton agrees with a scan root | — | ${newtonOk} (Newton failed on ${newtonNull} solved) |`);
  out.push(`| same surface: median ms per solve | ${f3(median(rows.map((r) => r.same.oldMs)))} | ${f3(median(rows.map((r) => r.same.newMs)))} |`);
  out.push(`| full search: within the reference tolerance | ${rows.filter((r) => within(r.search.old, r)).length} | ${rows.filter((r) => within(r.search.new, r)).length} |`);
  out.push(`| full search: no result | ${rows.filter((r) => r.search.old == null).length} | ${rows.filter((r) => r.search.new == null).length} |`);
  out.push(`| full search: total s | ${rows.reduce((s, r) => s + r.search.oldS, 0).toFixed(0)} | ${rows.reduce((s, r) => s + r.search.newS, 0).toFixed(0)} |`);
  // Deviation from the published value over the analyses both solvers answer.
  const both = rows.filter((r) => r.search.old != null && r.search.new != null);
  const devs = (pick: (r: Row) => number | null) => both.map((r) => (pick(r)! / r.published - 1) * 100);
  const stats = (d: number[]) => {
    const abs = d.map(Math.abs);
    return `mean ${(d.reduce((a, b) => a + b, 0) / d.length).toFixed(2)} %, mean |dev| ${(abs.reduce((a, b) => a + b, 0) / abs.length).toFixed(2)} %, median |dev| ${median(abs).toFixed(2)} %, max |dev| ${Math.max(...abs).toFixed(2)} %`;
  };
  const groups: [string, (r: Row) => boolean][] = [["all", () => true], ["circular", (r) => !r.nonCircular], ["non-circular", (r) => r.nonCircular]];
  for (const [name, f] of groups) {
    const sub = both.filter(f);
    if (!sub.length) continue;
    out.push(`| deviation from published, ${name} (${sub.length}): iterative | ${stats(devs((r) => r.search.old).filter((_, i) => f(both[i])))} | |`);
    out.push(`| deviation from published, ${name} (${sub.length}): march | | ${stats(devs((r) => r.search.new).filter((_, i) => f(both[i])))} |`);
  }
  out.push("", `## Per analysis`, "");
  out.push(`| Problem | Published | Same surface: iterative (gap) | march (λ) | roots | holes | Search: iterative | march | s old / new |`);
  out.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const r of rows) {
    const roots = r.same.roots.map((x) => `${x.F.toFixed(3)}@${x.lambda.toFixed(2)}${x.negativeN ? ` N<0:${x.negativeN}` : ""}`).join(", ");
    const chosenRoot = r.same.roots.find((x) => x.F === r.same.chosen);
    const flag = (v: number | null) => (v == null ? "—" : `${v.toFixed(3)} (${dev(v, r.published)})${within(v, r) ? "" : " ✗"}`);
    out.push(
      `| ${r.id} ${r.nonCircular ? "NC" : ""} | ${r.published} | ${f3(r.same.old)} (${r.same.oldGap == null ? "—" : r.same.oldGap.toFixed(4)}) | ${f3(r.same.chosen)}${chosenRoot ? ` (${chosenRoot.lambda.toFixed(2)})` : ""} | ${roots || "none"} | ${r.same.holes} | ${flag(r.search.old)} | ${flag(r.search.new)} | ${r.search.oldS.toFixed(1)} / ${r.search.newS.toFixed(1)} |`,
    );
  }
  return out.join("\n");
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--shard");
  if (i >= 0) {
    const [k, n] = args[i + 1].split("/").map(Number);
    writeFileSync(args[i + 2], JSON.stringify(runShard(k, n)));
  } else if (args[0] === "--report") {
    console.log(report(JSON.parse(readFileSync(args[1], "utf8")) as Row[]));
  } else {
    const started = Date.now();
    if (args[0].startsWith("--")) throw new Error("the output file comes first");
    const rows = await runAll();
    console.log(report(rows));
    console.log(`\n${rows.length} analyses in ${((Date.now() - started) / 1000).toFixed(0)} s`);
    if (args[0]) writeFileSync(args[0], JSON.stringify(rows));
  }
}
