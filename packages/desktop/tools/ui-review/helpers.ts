/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate() runs in the renderer without type imports */
import type { Page } from "playwright";
import { join } from "node:path";
import { OUT } from "./launch";

export function helpers(page: Page) {
  const ctx = page.context();
  const others = () => ctx.pages().filter((p) => p !== page);
  const S = (fn: (s: any) => unknown, arg?: unknown) =>
    page.evaluate(`(${fn.toString()})(window.__CSLOPE_STORE__.getState(), ${JSON.stringify(arg ?? null)})`);
  async function closeOthers() { for (const p of others()) await p.close().catch(() => {}); await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(200); }
  async function tab(name: string) {
    const c = page.getByRole("button", { name, exact: true });
    for (let i = 0; i < (await c.count()); i++) { const b = await c.nth(i).boundingBox(); if (b && b.y < 70) { await c.nth(i).click(); return; } }
    throw new Error("no tab " + name);
  }
  async function clickRibbon(text: string, nth = 0) {
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
  async function openDialog(tabName: string, text: string, nth = 0): Promise<Page> {
    await tab(tabName); const before = others().length; await clickRibbon(text, nth);
    const w = await waitNewWindow(before); if (!w) throw new Error("no window " + text);
    await w.waitForLoadState("domcontentloaded"); await w.waitForTimeout(1000); return w;
  }
  async function shotWindow(w: Page, name: string, grow = true) {
    await w.waitForTimeout(400);
    const size = await w.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    await w.screenshot({ path: join(OUT, `${name}.png`) });
    const need = await w.evaluate(() => {
      let extra = 0, hidden = 0;
      for (const e of document.querySelectorAll<HTMLElement>("*")) {
        const s = getComputedStyle(e);
        if ((s.overflowY === "auto" || s.overflowY === "scroll") && e.scrollHeight > e.clientHeight + 1) extra = Math.max(extra, e.scrollHeight - e.clientHeight);
        if ((s.overflowX === "auto" || s.overflowX === "scroll") && e.scrollWidth > e.clientWidth + 1) hidden = Math.max(hidden, e.scrollWidth - e.clientWidth);
      }
      return { extra, hidden };
    });
    console.log(`window ${name}: ${size.w}x${size.h}, hidden below ${need.extra}px, hidden right ${need.hidden}px`);
    if (grow && (need.extra > 0 || need.hidden > 0)) {
      const cdp = await ctx.newCDPSession(w);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: size.w + need.hidden + 20, height: size.h + need.extra + 20, deviceScaleFactor: 1, mobile: false });
      await w.waitForTimeout(500);
      await w.screenshot({ path: join(OUT, `${name}-full.png`) });
      await cdp.send("Emulation.clearDeviceMetricsOverride");
    }
    return need;
  }
  /** Inputs/selects/cells whose content is wider than the box (truncated). */
  async function truncation(w: Page, name: string) {
    const list = await w.evaluate(() => {
      const out: string[] = [];
      const ctxc = document.createElement("canvas").getContext("2d")!;
      for (const e of document.querySelectorAll<HTMLElement>("input, select, td, th, label, button, span, div")) {
        const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
        if (e instanceof HTMLInputElement || e instanceof HTMLSelectElement) {
          const s = getComputedStyle(e); ctxc.font = `${s.fontSize} ${s.fontFamily}`;
          const text = e instanceof HTMLSelectElement ? (e.selectedOptions[0]?.text ?? "") : (e.value || e.placeholder);
          const pad = parseFloat(s.paddingLeft) + parseFloat(s.paddingRight) + (e instanceof HTMLSelectElement ? 18 : 0);
          const need = ctxc.measureText(text).width + pad;
          if (need > r.width + 1) out.push(`${e.tagName.toLowerCase()} "${text}" needs ${Math.round(need)}px, has ${Math.round(r.width)}`);
        } else if (e.children.length === 0 && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== "visible") {
          out.push(`${e.tagName.toLowerCase()} "${(e.textContent || "").trim().slice(0, 50)}" clipped ${e.scrollWidth}>${e.clientWidth}`);
        }
      }
      return [...new Set(out)];
    });
    if (list.length) console.log(`TRUNC ${name}:\n  ` + list.join("\n  "));
    return list;
  }
  async function step(name: string, fn: () => Promise<void>) {
    try { await fn(); } catch (e) { console.error(`✗ ${name}: ${(e as Error).message.split("\n")[0]}`); }
    finally { await closeOthers(); }
  }
  async function shot(name: string, p: Page = page) { await p.waitForTimeout(300); await p.screenshot({ path: join(OUT, `${name}.png`) }); }
  return { S, ctx, others, closeOthers, tab, clickRibbon, waitNewWindow, openDialog, shotWindow, truncation, step, shot };
}
