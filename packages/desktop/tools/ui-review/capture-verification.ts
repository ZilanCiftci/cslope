/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate() runs in the renderer without type imports */
// Captures every verification problem in the app: the edit view, the
// result view and the paper export, one set of images per problem.
//
//   xvfb-run -a -s "-screen 0 1920x1200x24" bun tools/ui-review/capture-verification.ts [from] [to] [port]
//   ... capture-verification.ts benchmarks _ [port]   (the examples instead)
//
// Images go to $UI_OUT/verification/<id>-{edit,result,paper}.png and a
// summary (FOS per problem, run errors) to $UI_OUT/verification/summary.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VERIFICATION_CASES } from "@cslope/engine/verification";
import { verificationModel } from "../../src/store/verification-models";
import { launch, stop, OUT } from "./launch";

const from = Number(process.argv[2] === "benchmarks" ? 0 : (process.argv[2] ?? 0));
const to = Number(process.argv[3] ?? VERIFICATION_CASES.length);
const port = Number(process.argv[4] ?? 9333);
const only = process.env.UI_ONLY?.split(",");
const dir = join(OUT, "verification");
mkdirSync(dir, { recursive: true });

const { page, browser, proc } = await launch(port);
const summary: Record<string, unknown> = {};
const benchmarks = process.argv[2] === "benchmarks";
const cases = benchmarks
  ? ((await page.evaluate(() => {
      const s = (window as any).__CSLOPE_STORE__;
      s.getState().loadExamples();
      return s.getState().models.map((m: any) => ({ id: m.name.replace(/[^\w.-]+/g, "_"), title: m.name, model: m }));
    })) as { id: string; title: string; model: any }[])
  : VERIFICATION_CASES.slice(from, to).filter((c) => !only || only.includes(c.id)).map((c) => ({ id: c.id, title: c.title, model: verificationModel(c) as any }));
for (const c of cases) {
  const model = c.model;
  const t0 = Date.now();
  try {
    await page.evaluate((model) => {
      const s = (window as any).__CSLOPE_STORE__;
      (document.activeElement as HTMLElement | null)?.blur?.();
      s.getState().loadProject({ models: [model], activeModelId: model.id });
      s.getState().switchModel(model.id);
      s.getState().setMode("edit");
    }, model as any);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(dir, `${c.id}-edit.png`) });
    await page.evaluate(() => (window as any).__CSLOPE_STORE__.getState().runAnalysis());
    await page.waitForFunction(() => {
      const s = (window as any).__CSLOPE_STORE__.getState();
      return s.runState === "done" || s.runState === "error";
    }, undefined, { timeout: 240_000 });
    const run = await page.evaluate(() => {
      const s = (window as any).__CSLOPE_STORE__.getState();
      return { state: s.runState, error: s.errorMessage, fos: s.result?.minFOS ?? null };
    });
    await page.evaluate(() => (window as any).__CSLOPE_STORE__.getState().setMode("result"));
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(dir, `${c.id}-result.png`) });
    const png = await page.evaluate(() => (window as any).__CSLOPE_EXPORT_PNG__() as string | null);
    if (png) writeFileSync(join(dir, `${c.id}-paper.png`), Buffer.from(png.replace(/^data:image\/png;base64,/, ""), "base64"));
    summary[c.id] = { title: c.title, ...run, ms: Date.now() - t0 };
    console.log(c.id, run.state, run.fos ?? run.error, `${Date.now() - t0} ms`);
  } catch (e) {
    summary[c.id] = { title: c.title, failed: (e as Error).message.split("\n")[0] };
    console.error("✗", c.id, (e as Error).message.split("\n")[0]);
  }
}
writeFileSync(join(dir, benchmarks ? "summary-benchmarks.json" : `summary-${from}-${to}.json`), JSON.stringify(summary, null, 2));
await stop(browser, proc);
