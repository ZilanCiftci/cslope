/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate() runs in the renderer without type imports */
import { launch, stop } from "./launch";
import { helpers } from "./helpers";
const { page, browser, proc } = await launch(9336);
const H = helpers(page);
const { S, step, openDialog, shotWindow, shot, tab } = H;
await page.evaluate(() => { localStorage.setItem("cslope-theme", "light"); document.documentElement.dataset.theme = "light"; });
await S((s) => s.loadExamples());
await S((s) => s.switchModel(s.models.find((m: any) => m.name === "T-ACADS Non-Homogeneous").id));
await page.waitForTimeout(500);
await step("escape modal", async () => {
  await page.getByText("T-ACADS Simple", { exact: true }).click({ button: "right" }); await page.getByText("Properties", { exact: true }).click(); await page.waitForTimeout(400);
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  console.log("modal open after Escape:", await page.getByText("Model Properties").count());
  const c = page.getByRole("button", { name: "Cancel" }); if (await c.count()) await c.click();
});
await step("rename", async () => { await page.getByText("T-ACADS Simple", { exact: true }).click({ button: "right" }); await page.getByText("Rename", { exact: true }).click(); await page.waitForTimeout(300); await shot("90-rename"); await page.keyboard.press("Escape"); });
await step("error edit mode", async () => {
  await S((s) => { s.setAnalysisLimits({ enabled: true, entryLeftX: 49, entryRightX: 50, exitLeftX: 0, exitRightX: 1 }); });
  await S((s) => s.runAnalysis());
  await page.waitForFunction(() => ["done", "error"].includes((window as any).__CSLOPE_STORE__.getState().runState), { timeout: 60000 });
  console.log("run:", await S((s) => ({ st: s.runState, err: s.errorMessage, mode: s.mode })));
  await page.waitForTimeout(500); await shot("91-error-edit");
  await S((s) => s.setMode("result")); await page.waitForTimeout(400); await shot("91-error-result");
  await S((s) => s.undo()); await S((s) => s.setMode("edit"));
});
await S((s) => s.switchModel(s.models.find((m: any) => m.name === "T-ACADS Non-Homogeneous").id));
await S((s) => s.runAnalysis());
await page.waitForFunction(() => ["done", "error"].includes((window as any).__CSLOPE_STORE__.getState().runState), { timeout: 60000 });
await S((s) => s.setMode("result")); await page.waitForTimeout(500);
await step("tab after result", async () => { await shot("92-result-which-tab"); });
async function size(w: number, h: number) { const cdp = await H.ctx.newCDPSession(page); await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await page.waitForTimeout(700); return cdp; }
for (const [w, h] of [[1024, 640], [1920, 1080]] as const) {
  await step(`size ${w}`, async () => {
    const cdp = await size(w, h);
    for (const t of ["Model", "Results"]) { await tab(t); await shot(`93-${w}-${t}`); }
    await S((s) => s.setMode("edit")); await page.waitForTimeout(400); await shot(`93-${w}-edit`);
    await S((s) => s.setMode("result")); await page.waitForTimeout(300);
    await cdp.send("Emulation.clearDeviceMetricsOverride"); await cdp.detach();
  });
}
await step("dark", async () => {
  await page.getByRole("button", { name: "Switch to dark mode" }).click(); await page.waitForTimeout(500);
  await tab("Results"); await shot("94-dark-result");
  await S((s) => s.setMode("edit")); await page.waitForTimeout(300); await tab("Model"); await shot("94-dark-edit");
  for (const [b, n] of [["Materials", "materials"], ["Options", "options"], ["Piezometric lines", "piezo"]] as const) {
    const w = await openDialog("Model", b); await shotWindow(w, `94-dark-dlg-${n}`, false); await H.closeOthers();
  }
  await S((s) => s.setMode("result")); await page.waitForTimeout(300);
  const w = await openDialog("Results", "Results Plot"); await shotWindow(w, "94-dark-dlg-resultsplot", false); await H.closeOthers();
  await tab("Results"); await H.clickRibbon("Sensitivity"); await page.waitForTimeout(400); await shot("94-dark-sensitivity");
  await page.getByRole("button", { name: "Switch to light mode" }).click().catch(() => {});
});
await step("focus", async () => {
  await S((s) => s.setMode("edit")); await page.mouse.click(640, 18);
  for (let i = 0; i < 8; i++) await page.keyboard.press("Tab"); await shot("95-focus-8");
  for (let i = 0; i < 10; i++) await page.keyboard.press("Tab"); await shot("95-focus-18");
  const f = await page.evaluate(() => { const a = document.activeElement as HTMLElement; return a?.outerHTML.slice(0, 160); }); console.log("focus after 18 tabs:", f);
});
await step("tooltips", async () => {
  await tab("Results"); await page.mouse.move(243, 82); await page.waitForTimeout(1500); await shot("96-tooltip-display");
  const titles = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => { const r = b.getBoundingClientRect(); return r.y > 60 && r.y < 140; }).map((b) => `${(b.textContent || "").trim() || "∅"} [${b.title || "no title"}]`));
  console.log("results ribbon:", titles.join(" ; "));
  const tb = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => { const r = b.getBoundingClientRect(); return r.y > 740 && r.y < 820; }).map((b) => `${(b.textContent || "").trim() || "∅"} [${b.title || b.getAttribute("aria-label") || "no title"}]`));
  console.log("canvas toolbar:", tb.join(" ; "));
});
await stop(browser, proc);
