/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate() runs in the renderer without type imports */
import type { Page } from "playwright";
import { launch, stop, shot, OUT } from "./launch";
import { join } from "node:path";

const { page, browser, proc } = await launch();
const S = (fn: (s: any) => unknown) => page.evaluate(`(${fn.toString()})(window.__CSLOPE_STORE__.getState())`);
const ctx = page.context();
const others = () => ctx.pages().filter((p) => p !== page);

async function closeOthers() { for (const p of others()) await p.close().catch(() => {}); await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(200); }
async function tab(name: string) {
  const c = page.getByRole("button", { name, exact: true });
  for (let i = 0; i < (await c.count()); i++) { const b = await c.nth(i).boundingBox(); if (b && b.y < 70) { await c.nth(i).click(); return; } }
  throw new Error("no tab " + name);
}
async function clickRibbon(text: string, nth = 0) {
  // buttons inside the ribbon panel (y between 66 and 136)
  const c = page.locator("button").filter({ hasText: new RegExp(`^${text.replace(/[()]/g, "\\$&")}$`) });
  const hits: number[] = [];
  for (let i = 0; i < (await c.count()); i++) { const b = await c.nth(i).boundingBox(); if (b && b.y > 60 && b.y < 140) hits.push(i); }
  if (!hits.length) { const t = page.locator(`[title="${text}"]`); if (await t.count()) { await t.first().click(); return; } throw new Error("no ribbon button " + text); }
  await c.nth(hits[nth] ?? hits[0]).click();
}
async function waitNewWindow(before: number, ms = 8000): Promise<Page | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const o = others(); if (o.length > before) return o[o.length - 1]; await page.waitForTimeout(150); }
  return null;
}
async function shotWindow(w: Page, name: string) {
  await w.waitForLoadState("domcontentloaded"); await w.waitForTimeout(1200);
  const size = await w.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await w.screenshot({ path: join(OUT, `${name}.png`) });
  // Same window grown to show all content (the tallest scrolling element).
  const need = await w.evaluate(() => {
    let extra = 0;
    for (const e of document.querySelectorAll<HTMLElement>("*")) {
      const o = getComputedStyle(e).overflowY;
      if ((o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight + 1) extra = Math.max(extra, e.scrollHeight - e.clientHeight);
    }
    return extra;
  });
  console.log(`window ${name}: ${size.w}x${size.h}, hidden content ${need}px`);
  if (need > 0) {
    const cdp = await ctx.newCDPSession(w);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: size.w, height: size.h + need + 20, deviceScaleFactor: 1, mobile: false });
    await w.waitForTimeout(500);
    await w.screenshot({ path: join(OUT, `${name}-full.png`) });
    await cdp.send("Emulation.clearDeviceMetricsOverride");
  }
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn(); } catch (e) { console.error(`✗ ${name}: ${(e as Error).message.split("\n")[0]}`); }
  finally { await closeOthers(); }
}

await page.evaluate(() => { localStorage.setItem("cslope-theme", "light"); document.documentElement.dataset.theme = "light"; });
await S((s) => s.loadExamples());
// The richest example: switch to T-ACADS Non-Homogeneous (layers, water).
await S((s) => s.switchModel(s.models.find((m: any) => m.name === "T-ACADS Non-Homogeneous").id));
await page.waitForTimeout(500);

for (const t of ["File", "Model", "Results", "Help"]) await step("tab " + t, async () => { await tab(t); await shot(page, `01-tab-${t}`); });

const modelButtons: [string, number, string][] = [
  ["Exterior", 0, "geometry"], ["Interior", 0, "interior"], ["Materials", 0, "materials"], ["Assign", 0, "assign"],
  ["UDL", 0, "udl"], ["Line loads", 0, "lineloads"], ["Reinforcement", 0, "reinforcement"], ["Piezometric lines", 0, "piezo"],
  ["Parameters", 0, "parameters"], ["Search limits", 0, "searchlimits"], ["Custom planes", 0, "customplanes"], ["Options", 0, "options"],
];
for (const [text, nth, name] of modelButtons) {
  await step("dialog " + name, async () => {
    await tab("Model");
    const before = others().length;
    await clickRibbon(text, nth);
    const w = await waitNewWindow(before);
    if (!w) { await shot(page, `10-${name}-main`); throw new Error("no window for " + text); }
    await shotWindow(w, `10-dlg-${name}`);
  });
}

// Run the analysis, results mode.
await S((s) => s.runAnalysis());
await page.waitForFunction(() => ["done", "error"].includes((window as any).__CSLOPE_STORE__.getState().runState), { timeout: 120000 });
await S((s) => s.setMode("result"));
await page.waitForTimeout(800);
await step("results main", async () => { await tab("Results"); await shot(page, "20-results-tab"); });
for (const [text, name] of [["Results Plot", "resultsplot"], ["Settings", "viewsettings"]] as const) {
  await step("dialog " + name, async () => {
    await tab("Results"); const before = others().length; await clickRibbon(text);
    const w = await waitNewWindow(before);
    if (!w) { await shot(page, `21-${name}-main`); throw new Error("no window"); }
    await shotWindow(w, `21-dlg-${name}`);
  });
}
for (const [text, name] of [["Sensitivity", "sensitivity"], ["Probabilistic", "probabilistic"], ["Display", "display"], ["More export options", "export-menu"]] as const) {
  await step("popup " + name, async () => { await tab("Results"); await clickRibbon(text); await page.waitForTimeout(500); await shot(page, `22-popup-${name}`); });
}
await step("help about", async () => { await tab("Help"); await clickRibbon("About"); await page.waitForTimeout(500); await shot(page, "30-about"); });
await step("help help", async () => { await tab("Help"); const before = others().length; await clickRibbon("Help"); await page.waitForTimeout(800); const w = await waitNewWindow(before, 2000); await shot(page, "31-help"); if (w) await shotWindow(w, "31-help-window"); });

// Run dropdown, explorer and activity-bar context menus.
await step("run menu", async () => { await S((s) => s.setMode("edit")); await page.getByRole("button", { name: "▾", exact: true }).click(); await shot(page, "40-run-menu"); });
await step("explorer ctx", async () => { await page.getByText("T-ACADS Simple", { exact: true }).click({ button: "right" }); await shot(page, "41-explorer-ctx"); });
await step("activitybar ctx", async () => { await page.mouse.click(24, 162, { button: "right" }); await shot(page, "42-activitybar-ctx"); });
await stop(browser, proc);
