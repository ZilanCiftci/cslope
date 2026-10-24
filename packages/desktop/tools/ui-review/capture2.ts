/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate() runs in the renderer without type imports */
import { launch, stop } from "./launch";
import { helpers } from "./helpers";

const { page, browser, proc } = await launch(9334);
const H = helpers(page);
const { S, step, openDialog, shotWindow, truncation, shot, tab } = H;
await page.evaluate(() => { localStorage.setItem("cslope-theme", "light"); document.documentElement.dataset.theme = "light"; });
await S((s) => s.loadExamples());
await S((s) => s.switchModel(s.models.find((m: any) => m.name === "T-ACADS Non-Homogeneous").id));
// Long names to probe truncation.
await S((s) => { const m = s.materials; s.updateMaterial(m[0].id, { name: "Lera, sulfidhaltig, mycket lös (Su från CPT)" }); s.updateMaterial(m[1].id, { name: "Friktionsjord / grusig sand, packad" }); });
await S((s) => s.renameModel(s.activeModelId, "Sektion 12/400 – Exempelväg, långtidsstabilitet med kalkcementpelare"));
await page.waitForTimeout(400);
await H.shot("50-long-names-main");

// Fill dialogs through their own add buttons.
async function clickAll(w: any, name: string, times = 1) { for (let i = 0; i < times; i++) { const b = w.getByRole("button", { name, exact: true }); if (await b.count()) { await b.first().click(); await w.waitForTimeout(150); } } }

await step("reinforcement filled", async () => {
  const w = await openDialog("Model", "Reinforcement");
  const adds = w.getByRole("button", { name: "+ Add", exact: true });
  for (let k = 0; k < (await adds.count()); k++) {
    const sel = adds.nth(k).locator("xpath=preceding-sibling::select[1]");
    const opts = await sel.evaluate((s: HTMLSelectElement) => [...s.options].map((o) => o.value));
    for (const o of opts) { await sel.selectOption(o); await adds.nth(k).click(); await w.waitForTimeout(150); }
  }
  await shotWindow(w, "51-dlg-reinforcement-filled"); await truncation(w, "reinforcement");
});
await step("udl/lineloads filled", async () => {
  let w = await openDialog("Model", "UDL"); await clickAll(w, "+ Add UDL", 2); await shotWindow(w, "52-dlg-udl-filled"); await truncation(w, "udl");
  await H.closeOthers();
  w = await openDialog("Model", "Line loads"); await clickAll(w, "+ Add Line Load", 2); await shotWindow(w, "52-dlg-lineloads-filled"); await truncation(w, "lineloads");
});
await step("piezo filled", async () => {
  const w = await openDialog("Model", "Piezometric Lines"); await clickAll(w, "Add", 2); await w.waitForTimeout(300);
  await clickAll(w, "+ Add Point", 3);
  await shotWindow(w, "53-dlg-piezo-filled"); await truncation(w, "piezo");
});
await step("parameters filled", async () => {
  const w = await openDialog("Model", "Define", 1); await clickAll(w, "+ Add Parameter", 3); await shotWindow(w, "54-dlg-parameters-filled"); await truncation(w, "parameters");
});
await step("custom planes filled", async () => {
  const w = await openDialog("Model", "Custom planes"); await clickAll(w, "+ Add Search Plane", 2); await clickAll(w, "+ Add Non-circular Surface", 1);
  await shotWindow(w, "55-dlg-customplanes-filled"); await truncation(w, "customplanes");
});
await step("assign long names", async () => { const w = await openDialog("Model", "Assign"); await shotWindow(w, "56-dlg-assign-long"); await truncation(w, "assign"); });
await step("options all on", async () => {
  await S((s) => s.setOptions({ partialFactors: { cu: 1.5, cohesion: 1.3, tanPhi: 1.3, variableLoad: 1.3 }, tensionCrackAuto: true, nonCircularOptimization: true, bothDirections: true }));
  const w = await openDialog("Model", "Options"); await shotWindow(w, "57-dlg-options-all"); await truncation(w, "options");
});
await step("materials every model", async () => {
  const w = await openDialog("Model", "Define");
  await shotWindow(w, "58-dlg-materials-long"); await truncation(w, "materials-list");
  const sel = w.locator("label").filter({ has: w.getByText("Material Model", { exact: true }) }).locator("select").first();
  const fallback = w.locator("select").first();
  const s = (await sel.count()) ? sel : fallback;
  const opts = await s.evaluate((el: HTMLSelectElement) => [...el.options].map((o) => o.text));
  console.log("material models:", opts.join(" | "));
  for (const [i, o] of opts.entries()) { await s.selectOption({ label: o }); await w.waitForTimeout(400); await shotWindow(w, `59-mat-${i}-${o.replace(/[^a-z0-9]+/gi, "_")}`); await truncation(w, "mat " + o); }
});
await step("geometry interior", async () => { const w = await openDialog("Model", "Interior"); await truncation(w, "interior"); });
await step("search limits", async () => { const w = await openDialog("Model", "Search limits"); await truncation(w, "searchlimits"); });

// Edit-mode canvas: left/right clicks at known places (explorer on the left).
await S((s) => s.setMode("edit")); await page.waitForTimeout(400);
const pts: [string, number, number][] = [["vertex", 699, 351], ["inner-vertex", 628, 423], ["region", 500, 590], ["edge", 520, 351], ["limit-marker", 621, 351], ["outside", 1100, 250]];
for (const [n, x, y] of pts) await step("ctx edit " + n, async () => { await page.mouse.click(x, y, { button: "right" }); await shot(`60-ctx-edit-${n}`); });
await step("click region", async () => { await page.mouse.click(500, 590); await page.waitForTimeout(300); await shot("61-click-region"); });
await step("dblclick region", async () => { await page.mouse.dblclick(500, 590); await page.waitForTimeout(300); await shot("61-dblclick-region"); });
await step("zoom select", async () => { await page.locator("select").filter({ hasText: "100%" }).first().click(); await shot("62-zoom-select"); });

// Results mode
await S((s) => s.runAnalysis());
await page.waitForFunction(() => ["done", "error"].includes((window as any).__CSLOPE_STORE__.getState().runState), { timeout: 120000 });
await S((s) => s.setMode("result")); await page.waitForTimeout(800);
await shot("70-results-long-names");
for (const [n, x, y] of [["surface", 700, 600], ["annotation", 450, 300], ["table", 860, 305], ["paper-bg", 600, 450], ["outside-paper", 1150, 760]] as [string, number, number][])
  await step("ctx result " + n, async () => { await page.mouse.click(x, y, { button: "right" }); await shot(`71-ctx-result-${n}`); });
await step("select annotation", async () => { await page.mouse.click(450, 300); await page.waitForTimeout(400); await shot("72-select-annotation"); });
await step("select table", async () => { await page.mouse.click(860, 305); await page.waitForTimeout(400); await shot("72-select-table"); });
await step("display dropdown", async () => { await tab("Results"); await page.mouse.click(218, 82); await shot("73-display-dropdown"); });
await step("pdf arrow", async () => { await tab("Results"); await page.mouse.click(642, 110); await shot("73-pdf-arrow"); });
await step("results sidebar scroll", async () => { await shot("74-results-sidebar"); });
await step("explorer properties", async () => { await page.getByText(/^Sektion 12/).first().click({ button: "right" }); await page.getByText("Properties", { exact: true }).click(); await page.waitForTimeout(500); await shot("75-project-properties"); });
await stop(browser, proc);
