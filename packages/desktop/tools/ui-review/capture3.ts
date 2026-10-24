/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate() runs in the renderer without type imports */
import { launch, stop } from "./launch";
import { helpers } from "./helpers";
const { page, browser, proc } = await launch(9335);
const H = helpers(page);
const { S, step, openDialog, shotWindow, shot, tab } = H;
await page.evaluate(() => { localStorage.setItem("cslope-theme", "light"); document.documentElement.dataset.theme = "light"; });
await S((s) => s.loadExamples());
await S((s) => s.switchModel(s.models.find((m: any) => m.name === "T-ACADS Simple").id));
await page.waitForTimeout(600);
await shot("80-simple");
// T-ACADS Simple, explorer left: (20,0)->(704,358); ground edge (530,358); region (500,500); entry marker (645,358); outside (1100,250)
const pts: [string, number, number][] = [["vertex", 704, 358], ["edge", 530, 358], ["region", 500, 500], ["entry-marker", 645, 358], ["outside", 1100, 250], ["ruler", 315, 500]];
for (const [n, x, y] of pts) await step("ctx " + n, async () => { await page.mouse.move(x, y); await page.mouse.click(x, y, { button: "right" }); await page.waitForTimeout(300); await shot(`81-ctx-${n}`);
  const menu = await page.evaluate(() => [...document.querySelectorAll(".absolute.z-50")].map((e) => (e as HTMLElement).innerText.replace(/\n/g, " | ")));
  console.log("ctx", n, JSON.stringify(menu)); });
await step("click region", async () => { await page.mouse.click(500, 500); await page.waitForTimeout(400); await shot("82-click-region"); });
await step("hover vertex", async () => { await page.mouse.move(704, 358); await page.waitForTimeout(400); await shot("82-hover-vertex"); });
await step("drag vertex snap", async () => { await page.mouse.move(704, 358); await page.mouse.down(); await page.mouse.move(760, 330, { steps: 5 }); await page.waitForTimeout(200); await shot("82-drag-vertex"); await page.mouse.up(); await S((s) => s.undo?.()); });

// Project properties and rename
await step("project properties", async () => { await page.getByText("T-ACADS Simple", { exact: true }).click({ button: "right" }); await page.getByText("Properties", { exact: true }).click(); await page.waitForTimeout(600); await shot("83-project-properties"); });
await step("rename", async () => { await page.getByText("T-ACADS Simple", { exact: true }).click({ button: "right" }); await page.getByText("Rename", { exact: true }).click(); await page.waitForTimeout(300); await shot("83-rename"); });

// Empty project and an error run
await step("new project", async () => { await S((s) => s.newProject()); await page.waitForTimeout(500); await shot("84-new-project"); });
await step("new project dialogs", async () => { const w = await openDialog("Model", "Materials"); await shotWindow(w, "84-new-materials"); });
await step("run error", async () => {
  await S((s) => { s.setAnalysisLimits?.({ enabled: true, entryLeftX: 49, entryRightX: 50, exitLeftX: 0, exitRightX: 1 }); s.runAnalysis(); });
  await page.waitForTimeout(3000); await shot("85-run-error");
});
await step("running", async () => {
  await S((s) => s.loadExamples()); await S((s) => s.switchModel(s.models.find((m: any) => m.name === "Talbingo Dam").id));
  await S((s) => { s.setOptions({ iterations: 20000, nonCircularOptimization: true }); s.runAnalysis(); });
  await page.waitForTimeout(700); await shot("86-running");
  await page.waitForFunction(() => ["done", "error"].includes((window as any).__CSLOPE_STORE__.getState().runState), { timeout: 180000 });
  await S((s) => s.setMode("result")); await page.waitForTimeout(500); await shot("86-talbingo-result");
});

// Window sizes
async function size(w: number, h: number) { const cdp = await H.ctx.newCDPSession(page); await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await page.waitForTimeout(700); return cdp; }
for (const [w, h] of [[1024, 640], [1920, 1080]] as const) {
  await step(`size ${w}`, async () => {
    const cdp = await size(w, h);
    for (const t of ["Model", "Results"]) { await tab(t); await shot(`87-${w}-${t}`); }
    await S((s) => s.setMode("edit")); await tab("Model"); await shot(`87-${w}-edit`);
    await S((s) => s.setMode("result"));
    await cdp.send("Emulation.clearDeviceMetricsOverride");
  });
}
// Dark theme
await step("dark", async () => {
  await page.getByRole("button", { name: "Switch to dark mode" }).click(); await page.waitForTimeout(500);
  await tab("Model"); await shot("88-dark-result");
  await S((s) => s.setMode("edit")); await page.waitForTimeout(300); await shot("88-dark-edit");
  for (const [t, b, n] of [["Model", "Materials", "materials"], ["Model", "Options", "options"], ["Model", "Reinforcement", "reinforcement"]] as const) {
    const w = await openDialog(t, b); await shotWindow(w, `88-dark-dlg-${n}`, false); await H.closeOthers();
  }
  await tab("Results"); await page.mouse.click(642, 110).catch(() => {});
});
// Keyboard: tab through the ribbon and the first dialog
await step("focus", async () => {
  await page.getByRole("button", { name: "Switch to light mode" }).click().catch(() => {});
  await page.mouse.click(640, 18); for (let i = 0; i < 6; i++) await page.keyboard.press("Tab"); await shot("89-focus-6tabs");
  for (let i = 0; i < 10; i++) await page.keyboard.press("Tab"); await shot("89-focus-16tabs");
});
await stop(browser, proc);
