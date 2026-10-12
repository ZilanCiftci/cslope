/**
 * Store-injection capture: hydrate the Zustand store with a benchmark,
 * apply the scene's actions, optionally run the analysis and click through
 * the UI, then capture the canvas, the whole window or a dialog window.
 *
 * This module is evaluated by Bun and communicates with the Electron
 * renderer process via Playwright's page.evaluate().
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate() runs in renderer context without type imports */

import type { BrowserContext, CDPSession, Page } from "playwright";
import type { Scene } from "../../../website/src/content/media-scene-types";
import { RENDER_SETTLE_MS, ANALYSIS_TIMEOUT_MS, CAPTURE_DPR } from "./capture-config";

/** Apply store actions ([name, ...args]) in the renderer. */
async function applyActions(page: Page, actions: [string, ...unknown[]][] | undefined) {
  if (!actions?.length) return;
  await page.evaluate((list) => {
    const store = (window as any).__CSLOPE_STORE__;
    for (const [name, ...args] of list) {
      const state = store.getState();
      const fn = state[name];
      if (typeof fn !== "function") throw new Error(`Store has no action "${name}"`);
      // "$last:<key>": the id of the last item in that list of the state.
      const resolved = args.map((a) => {
        if (typeof a !== "string" || !a.startsWith("$last:")) return a;
        const list = state[a.slice(6)];
        if (!Array.isArray(list) || !list.length) throw new Error(`No items in "${a.slice(6)}"`);
        return list[list.length - 1].id;
      });
      fn(...resolved);
    }
  }, actions);
}

/** The ribbon tabs, which share names with other buttons ("Results"). */
const RIBBON_TABS = new Set(["File", "Model", "Results", "Help"]);

/**
 * Click a button in the main window by its exact text, accessible name or
 * tooltip. A ribbon tab name clicks the tab in the menu bar at the top.
 * "last:<name>" clicks the last of several matches (a panel's "Run" rather
 * than the toolbar's).
 */
async function clickByName(page: Page, spec: string) {
  const last = spec.startsWith("last:");
  const name = last ? spec.slice(5) : spec;
  if (RIBBON_TABS.has(name)) {
    const candidates = page.getByRole("button", { name, exact: true });
    for (let i = 0; i < (await candidates.count()); i++) {
      const box = await candidates.nth(i).boundingBox();
      if (box && box.y < 70) {
        await candidates.nth(i).click();
        return;
      }
    }
    throw new Error(`No ribbon tab "${name}"`);
  }
  for (const locator of [
    page.getByRole("button", { name, exact: true }),
    page.getByText(name, { exact: true }),
    page.locator(`[title="${name.replace(/"/g, '\\"')}"]`),
  ]) {
    if ((await locator.count()) > 0) {
      await (last ? locator.last() : locator.first()).click();
      return;
    }
  }
  throw new Error(`No button "${name}" to click`);
}

const sessions = new WeakMap<Page, CDPSession>();

/**
 * Set a page's CSS size, rendered at the capture pixel ratio (the same
 * ratio Electron is started with, see capture-runner.ts). One CDP session
 * per page, reused.
 */
export async function setPixelRatio(page: Page, width?: number, height?: number) {
  const size =
    width && height
      ? { width, height }
      : await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  let cdp = sessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    sessions.set(page, cdp);
  }
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    ...size,
    deviceScaleFactor: CAPTURE_DPR,
    mobile: false,
  });
}

/**
 * The URL hash each dialog window loads (electron/main.ts). The document
 * title of every window is "cSlope", so windows are told apart by URL.
 */
const WINDOW_HASH: Record<string, string> = {
  "Define Materials": "materials-dialog",
  "Assign Materials": "material-assignment-dialog",
  "Exterior Boundary": "geometry-dialog",
  "Interior Boundaries": "interior-boundaries-dialog",
  UDL: "udl-dialog",
  "Line Loads": "line-loads-dialog",
  Reinforcement: "reinforcement-dialog",
  "Piezometric Lines": "piezo-dialog",
  Parameters: "parameters-dialog",
  "Results Plot": "results-plot-dialog",
  "Search limits": "search-limits-dialog",
  "Custom search planes": "custom-search-planes-dialog",
  Options: "options-dialog",
  "View Settings": "view-settings-dialog",
};

/**
 * Shrink a dialog window to the height its content needs, so that the
 * image has no empty space at the bottom: the smallest height at which no
 * scrolling area overflows (dialogs fill their window and scroll inside).
 */
async function fitWindowHeight(win: Page) {
  const width = await win.evaluate(() => window.innerWidth);
  let high = await win.evaluate(() => window.innerHeight);
  let low = 200;
  const overflows = () =>
    win.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("*")].some((e) => {
        const o = getComputedStyle(e).overflowY;
        return (o === "auto" || o === "scroll" || e === document.documentElement) && e.scrollHeight > e.clientHeight + 1;
      }),
    );
  if (await overflows()) return;
  while (high - low > 8) {
    const mid = Math.round((high + low) / 2);
    await setPixelRatio(win, width, mid);
    await win.waitForTimeout(60);
    if (await overflows()) low = mid;
    else high = mid;
  }
  // A little room, so that no scroll bar appears at the limit.
  await setPixelRatio(win, width, high + 16);
  await win.waitForTimeout(RENDER_SETTLE_MS);
}

/** The dialog window with this title, once it has opened. */
async function findWindow(context: BrowserContext, title: string, timeoutMs = 15_000): Promise<Page> {
  const hash = WINDOW_HASH[title];
  if (!hash) throw new Error(`Unknown window "${title}"; add it to WINDOW_HASH`);
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const win = context.pages().find((p) => p.url().endsWith(`#${hash}`));
    if (win) return win;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No window "${title}" (open: ${context.pages().map((p) => p.url().split("#")[1] ?? "main").join(", ")})`);
}

/**
 * Capture a single scene.
 *
 * Steps:
 *  1. Load the benchmarks and switch to the scene's model.
 *  2. Apply the mode, result-view overrides and actions.
 *  3. If needed, run the analysis, switch to result mode and apply the
 *     after-analysis actions.
 *  4. Show the ribbon tab and click the buttons.
 *  5. Wait for rendering and capture.
 */
export async function captureScene(page: Page, scene: Scene): Promise<Buffer> {
  const { setup, output } = scene;

  await page.evaluate(
    ({ benchmarkName, setup }) => {
      const store = (window as any).__CSLOPE_STORE__;
      if (!store) throw new Error("Store bridge not available — is VITE_CAPTURE_MODE set?");
      // Nothing carries over from the previous scene: no selection, no focus.
      (document.activeElement as HTMLElement | null)?.blur?.();
      store.getState().setSelectedResultObject?.(null);
      store.getState().setSelectedAnnotations?.([]);
      store.getState().setActiveSection?.("Exterior Boundary");
      store.getState().loadBenchmarks();
      const state = store.getState();
      const target = state.models.find((m: any) => m.name === benchmarkName);
      if (!target) {
        const names = state.models.map((m: any) => m.name).join(", ");
        throw new Error(`Benchmark "${benchmarkName}" not found. Available: ${names}`);
      }
      store.getState().switchModel(target.id);
      if (setup.onlyModel) {
        for (const m of store.getState().models) if (m.id !== target.id) store.getState().deleteModel(m.id);
      }
      if (setup.mode) store.getState().setMode(setup.mode);
      if (setup.resultView) {
        const current = store.getState().resultViewSettings;
        store.getState().setResultViewSettings({ ...current, ...setup.resultView });
      }
    },
    { benchmarkName: scene.benchmark, setup },
  );
  await applyActions(page, setup.actions);

  if (setup.runAnalysis) {
    await page.evaluate(() => (window as any).__CSLOPE_STORE__.getState().runAnalysis());
    await page.waitForFunction(
      () => {
        const s = (window as any).__CSLOPE_STORE__.getState();
        return s.runState === "done" || s.runState === "error";
      },
      { timeout: ANALYSIS_TIMEOUT_MS },
    );
    const run = await page.evaluate(() => {
      const s = (window as any).__CSLOPE_STORE__.getState();
      return { runState: s.runState, error: s.errorMessage };
    });
    if (run.runState === "error") throw new Error(`Analysis failed for "${scene.id}": ${run.error}`);
    await page.evaluate(() => (window as any).__CSLOPE_STORE__.getState().setMode("result"));
    await applyActions(page, setup.afterAnalysis);
  }

  if (setup.ribbonTab) await clickByName(page, setup.ribbonTab);
  for (const name of setup.click ?? []) {
    await clickByName(page, name);
    await page.waitForTimeout(150);
  }
  if (setup.waitForText) {
    await page.getByText(setup.waitForText, { exact: false }).first().waitFor({ timeout: ANALYSIS_TIMEOUT_MS * 2 });
  }
  if (setup.waitMs) await page.waitForTimeout(setup.waitMs);

  await page.waitForTimeout(RENDER_SETTLE_MS);

  if (output.crop === "full") {
    return page.screenshot({ type: "png" });
  }

  if (output.crop === "window") {
    if (!output.window) throw new Error(`Scene "${scene.id}" needs output.window for crop "window"`);
    const win = await findWindow(page.context(), output.window);
    await win.waitForLoadState("domcontentloaded");
    await setPixelRatio(win);
    // Let the dialog receive the main window's state and lay out.
    await win.waitForTimeout(RENDER_SETTLE_MS * 2);
    for (const [label, option] of setup.windowSelect ?? []) {
      // The select inside the <label> whose own text is the label.
      const select = win
        .locator("label")
        .filter({ has: win.getByText(label, { exact: true }) })
        .locator("select")
        .first();
      await select.selectOption({ label: option });
      await win.waitForTimeout(RENDER_SETTLE_MS);
    }
    if (output.fitHeight !== false) await fitWindowHeight(win);
    return win.screenshot({ type: "png" });
  }

  const dataUrl = await page.evaluate(() => {
    const canvas = document.querySelector("[data-testid='slope-canvas']") as HTMLCanvasElement | null;
    if (!canvas) throw new Error("Canvas element not found");
    return canvas.toDataURL("image/png");
  });
  return Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
}
