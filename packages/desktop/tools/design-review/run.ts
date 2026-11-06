#!/usr/bin/env bun
/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate() runs in the renderer without type imports */
/**
 * Design review captures: builds the renderer in capture mode (as
 * media-capture does), starts the real Electron app under a virtual display,
 * and for each scene of scenes.ts, in the light and the dark theme, loads its
 * data, opens its part with real clicks and saves
 *
 *   design-review-out/shots/<scene>-<theme>.png      (DPR 2; 1.5 for the -150 scenes)
 *   design-review-out/metrics/<scene>-<theme>.json   (texts, contrast, controls, layout, axe)
 *   design-review-out/index.json                     (every scene, its files, the measured DPR and errors)
 *
 * The page is reloaded before each capture and the app restarted every
 * RESTART_EVERY scenes, so that nothing carries over.
 *
 *   CSLOPE_CAPTURE_NO_SANDBOX=1 xvfb-run -a -s "-screen 0 3000x2000x24" bun packages/desktop/tools/design-review/run.ts
 *
 * The 150 % captures (scenes with `also150`) need an app started at that
 * scale on a 1920 × 1080 screen (1280 × 720 DIP), as on a Windows laptop at
 * 150 %: the DevTools emulation can't change the scale a window is drawn
 * at. After the 100 % pass, run.ts therefore runs itself again for them,
 * in a second app instance under its own virtual screen:
 *
 *   DESIGN_REVIEW_SCALE=1.5 xvfb-run -a -s "-screen 0 1920x1080x24" bun packages/desktop/tools/design-review/run.ts
 *
 * which can also be run alone (it then reuses the last build). It
 * simulates a 48 DIP taskbar: the app sizes its windows to a work area that
 * much lower than the screen (CSLOPE_CAPTURE_TASKBAR).
 * DESIGN_REVIEW_NO_150=1 leaves the 150 % pass out. Every capture records
 * the device pixel ratio measured in the page and in the PNG; one that
 * differs from the pass's scale is an error.
 *
 * DESIGN_REVIEW_ONLY=<prefix>[,<prefix>…] runs the scenes whose id starts with
 * one of them (the index then keeps the other scenes' earlier entries);
 * DESIGN_REVIEW_SKIP_BUILD=1 reuses the last build in packages/desktop/dist;
 * DESIGN_REVIEW_PORT sets the debugging port (default 9341).
 *
 * Test data comes from the repository only: the built-in examples, the
 * verification problems, the design-capture review model, the project
 * fixture with PDF drawings and the DWG fixture (src/features/project/fixtures),
 * and a website image as the PNG drawing.
 */

import type { Browser, Page } from "playwright";
import type { ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initEngine } from "@cslope/engine";
import { VERIFICATION_CASES, presentedAnalyses } from "@cslope/engine/verification";
import { verificationModel } from "../../src/store/verification-models";
import { readZip } from "../../src/utils/zip";
import { designReviewModel } from "../design-capture/models";
import { SCENES, type Ctx, type DataSet, type Scene, type Target, type Theme, type Box } from "./scenes";
import {
  DESKTOP_DIR,
  DPR,
  MAIN_SIZE,
  MAIN_SIZE_150,
  OUT_DIR,
  RENDER_SETTLE_MS,
  ROOT,
  clickNamed,
  findWindow,
  launchApp,
  measure,
  ribbonTab,
  runAnalysis,
  setViewport,
  stopApp,
  store,
  worldToPage,
} from "./lib";

const PORT = Number(process.env.DESIGN_REVIEW_PORT ?? 9341);
const RESTART_EVERY = 10;
const SCENE_TIMEOUT_MS = 90_000;
const THEMES: Theme[] = ["light", "dark"];
const ONLY = process.env.DESIGN_REVIEW_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
/** The scale this pass runs the app at: 2 (the 100 % captures, drawn at 2 for detail) or 1.5 (the -150 captures). */
const SCALE = Number(process.env.DESIGN_REVIEW_SCALE ?? DPR);
const PASS_150 = SCALE === 1.5;
if (SCALE !== DPR && !PASS_150) throw new Error(`DESIGN_REVIEW_SCALE must be ${DPR} or 1.5, not ${process.env.DESIGN_REVIEW_SCALE}`);
/** The 150 % screen in DIPs: 1920 × 1080 at 150 % (no taskbar under the virtual display). */
const SCREEN_150 = { width: 1280, height: 720 };
/**
 * The taskbar the 150 % pass simulates (DIPs; Windows' is 48 at 150 %): the
 * app takes it off the work area it sizes windows to (CSLOPE_CAPTURE_TASKBAR,
 * #48), as the virtual screen has none.
 */
const TASKBAR_150 = 48;

export interface IndexEntry {
  id: string;
  sceneId: string;
  title: string;
  area: string;
  theme: Theme;
  /** The device pixel ratio measured in the page (the pass's scale when not measured). */
  dpr: number;
  /** The screenshot's pixels per CSS pixel, measured in the PNG. */
  pngScale?: number;
  shot: string | null;
  metrics: string | null;
  nativeDialogs: string[];
  errors: string[];
  ms: number;
}

// ── Test data ──────────────────────────────────────────────────────────

interface Data {
  models: Record<string, unknown>;
  drawingsProject: number[];
}

async function prepareData(): Promise<{ data: Data; files: Ctx["files"] }> {
  await initEngine();
  /** A verification problem as a model; `method`: run with the first analysis by that method. */
  const vm = (id: string, method?: string) => {
    const c = VERIFICATION_CASES.find((v) => v.id === id);
    if (!c) throw new Error(`No verification problem ${id}`);
    const label = method ? presentedAnalyses(c).find((a) => a.method === method)?.label : undefined;
    return verificationModel(c, label, `${c.id} ${c.title}`);
  };
  const models: Record<string, unknown> = {
    v017b: vm("V017b"),
    v085: vm("V085", "Morgenstern-Price"),
    v015: vm("V015"),
    review: designReviewModel(),
  };
  const fixtures = join(DESKTOP_DIR, "src/features/project/fixtures");
  const drawingsCslp = readFileSync(join(fixtures, "cslp-v1-drawings.cslp"));
  const dir = join(OUT_DIR, "fixtures");
  mkdirSync(dir, { recursive: true });
  const zip = await readZip(new Uint8Array(drawingsCslp), (n) => n.endsWith(".pdf"));
  const pdf = join(dir, "section.pdf");
  const [pdfBytes] = [...zip.values()];
  if (!pdfBytes) throw new Error("No PDF in cslp-v1-drawings.cslp");
  writeFileSync(pdf, pdfBytes);
  return {
    data: { models, drawingsProject: [...drawingsCslp] },
    files: {
      png: join(ROOT, "packages/website/public/media/generated/result-showcase.png"),
      pdf,
      dwg: join(fixtures, "slope-section.dwg"),
    },
  };
}

/** Load a data set into the app. */
async function loadData(page: Page, data: Data, set: DataSet) {
  if (set === "drawings") {
    await page.evaluate(async (bytes) => {
      await (window as any).__CSLOPE_PROJECT_FILE__.open(new Uint8Array(bytes));
    }, data.drawingsProject);
  } else {
    await page.evaluate(
      ({ set, model }) => {
        const s = (window as any).__CSLOPE_STORE__.getState();
        if (model) {
          s.loadProject({ models: [model], activeModelId: (model as any).id });
          return;
        }
        if (set === "empty") {
          s.newProject();
          return;
        }
        s.loadExamples();
        const all = (window as any).__CSLOPE_STORE__.getState().models;
        if (set === "example1") s.loadProject({ models: [all[0]], activeModelId: all[0].id });
        if (set === "nonhomog") {
          const m = all.find((x: any) => /Non-Homogeneous/.test(x.name)) ?? all[1];
          s.loadProject({ models: [m], activeModelId: m.id });
        }
        if (set === "many") {
          const names = [
            "Section 0+120, embankment on soft clay, long-term with the lowered groundwater",
            "Profile A–A′ excavation for the pumping station, stage 3 with the sheet pile wall",
            "Road embankment km 12/340, undrained",
          ];
          const models = Array.from({ length: 58 }, (_, i) => ({
            ...all[i % all.length],
            id: `many-${i}`,
            name: `${String(i + 1).padStart(2, "0")} ${names[i % names.length]}`,
            result: undefined,
          }));
          s.loadProject({ models, activeModelId: models[0].id });
        }
      },
      { set, model: (data.models[set] as object | undefined) ?? null },
    );
  }
  await page.evaluate(() => {
    const s = (window as any).__CSLOPE_STORE__.getState();
    s.setMode("edit");
    s.clearCanvasSelection?.();
  });
  await page.waitForTimeout(700);
}

// ── One capture ────────────────────────────────────────────────────────

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string) =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms))]);

class App {
  browser!: Browser;
  page!: Page;
  proc!: ChildProcess;
  nativeDialogs: string[] = [];
  confirmAnswer = false;

  async start() {
    const { browser, page, proc } = await launchApp(PORT, SCALE, PASS_150 ? { CSLOPE_CAPTURE_TASKBAR: String(TASKBAR_150) } : {});
    this.browser = browser;
    this.page = page;
    this.proc = proc;
    const watch = (p: Page) =>
      p.on("dialog", async (d) => {
        this.nativeDialogs.push(`${d.type()}: ${d.message()}`);
        if (d.type() === "confirm" && this.confirmAnswer) await d.accept().catch(() => {});
        else await d.dismiss().catch(() => {});
      });
    watch(page);
    page.context().on("page", watch);
    page.on("pageerror", (e) => console.error(`  [renderer error] ${e.message.split("\n")[0]}`));
  }

  async stop() {
    await stopApp(this.browser, this.proc);
  }

  /** A fresh page: other windows closed, reloaded, theme and size set. */
  async reset(theme: Theme, dpr: number, size: { width: number; height: number }) {
    const page = this.page;
    for (const p of page.context().pages()) if (p !== page) await p.close().catch(() => {});
    await page.evaluate((theme) => localStorage.setItem("cslope-theme", theme), theme);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForFunction(() => (window as any).__CSLOPE_CAPTURE_READY__ === true, undefined, { timeout: 30_000 });
    await page.evaluate((theme) => (window as any).__CSLOPE_STORE__.getState().setTheme(theme), theme);
    await setViewport(page, dpr, size.width, size.height);
    await page.mouse.move(2, 2);
    this.nativeDialogs = [];
    this.confirmAnswer = false;
  }
}

async function boxOf(focus: Target["focus"]): Promise<Box | null> {
  if (!focus) return null;
  if ("x" in focus && typeof (focus as Box).x === "number") return focus as Box;
  const loc = focus as import("playwright").Locator;
  await loc.first().waitFor({ state: "visible", timeout: 5000 });
  const b = await loc.first().boundingBox();
  if (!b) throw new Error("The focus element has no box");
  return b;
}

async function capture(app: App, data: Data, files: Ctx["files"], scene: Scene, theme: Theme, scale150: boolean): Promise<IndexEntry> {
  const dpr = SCALE;
  const id = scale150 ? `${scene.id}-150` : scene.id;
  const size = scale150 ? MAIN_SIZE_150 : (scene.size ?? MAIN_SIZE);
  const entry: IndexEntry = {
    id,
    sceneId: scene.id,
    title: scale150 ? `${scene.title} (150 %)` : scene.title,
    area: scene.area,
    theme,
    dpr,
    shot: null,
    metrics: null,
    nativeDialogs: [],
    errors: [],
    ms: 0,
  };
  const t0 = Date.now();
  const shotRel = `shots/${id}-${theme}.png`;
  const metricsRel = `metrics/${id}-${theme}.json`;
  if (scene.skip) {
    entry.errors.push(`not captured: ${scene.skip}`);
    return entry;
  }
  let grabbed = false;
  const page = app.page;
  let target: Page = page;
  try {
    await app.reset(theme, dpr, size);
    await loadData(page, data, scene.data ?? "example1");
    const ctx: Ctx = {
      page,
      theme,
      dpr,
      files,
      get nativeDialogs() {
        return app.nativeDialogs;
      },
      get confirmAnswer() {
        return app.confirmAnswer;
      },
      set confirmAnswer(v: boolean) {
        app.confirmAnswer = v;
      },
      load: (set) => loadData(page, data, set),
      result: async () => {
        const state = await runAnalysis(page);
        if (state !== "done") entry.errors.push(`the analysis ended with "${state}"`);
        await store(page, `(s) => s.setMode("result")`);
        await page.waitForTimeout(600);
      },
      tab: (name) => ribbonTab(page, name),
      click: (name, opts) => clickNamed(page, name, opts),
      store: (fn, arg) => store(page, fn, arg),
      window: async (hash, open) => {
        await open();
        // Kept at the size the app gives it (fitted to its content), at the instance's scale.
        const win = await findWindow(page, hash);
        await win.waitForTimeout(300);
        target = win;
        return win;
      },
      at: (x, y) => worldToPage(page, x, y),
      contextMenuAt: async (points, item, before) => {
        for (const p of points) {
          if (before) await before();
          await page.mouse.click(p.x, p.y, { button: "right" });
          await page.waitForTimeout(150);
          const menus = page.locator("[data-context-menu]");
          if ((await menus.count()) && (await menus.last().getByRole("menuitem", { name: item }).count())) return menus.last();
          await page.keyboard.press("Escape");
        }
        throw new Error(`No context menu with an item ${item} at ${points.length} points`);
      },
      canvasGrid: async (cols = 6, rows = 4) => {
        const r = await page.locator("[data-testid='slope-canvas']").boundingBox();
        if (!r) throw new Error("No canvas");
        const out: { x: number; y: number }[] = [];
        for (let j = 0; j < rows; j++)
          for (let i = 0; i < cols; i++) out.push({ x: r.x + ((i + 0.5) / cols) * r.width, y: r.y + ((j + 0.5) / rows) * r.height });
        return out;
      },
      wait: (ms) => page.waitForTimeout(ms),
      grabScreen: async () => {
        const display = process.env.DISPLAY;
        if (!display) return false;
        try {
          // The box opens at the screen's top left (no window manager): keep that corner.
          execSync(`import -display ${display} -window root -crop 1100x520+0+0 +repage "${join(OUT_DIR, shotRel)}"`, { stdio: "ignore" });
          grabbed = true;
          return true;
        } catch {
          return false;
        }
      },
    };
    if (scene.result) await ctx.result();
    const t = (await withTimeout(scene.open(ctx), SCENE_TIMEOUT_MS, `scene ${id}`)) ?? {};
    if (t.page) target = t.page;
    // A window the scene closed again (Place drawing after Place): capture the main window.
    if (target.isClosed()) target = page;
    await target.waitForTimeout(RENDER_SETTLE_MS);
    if (t.grow) {
      const extra = await target.evaluate(() => {
        let extra = 0;
        for (const e of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
          const o = getComputedStyle(e).overflowY;
          if ((o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight + 1) extra = Math.max(extra, e.scrollHeight - e.clientHeight);
          e.scrollTop = 0;
        }
        return extra;
      });
      const v = await target.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      if (extra > 0 && v) {
        await setViewport(target, dpr, v.width, Math.min(2000, v.height + extra + 16));
        await target.waitForTimeout(RENDER_SETTLE_MS);
      }
    }
    let focus: Box | null = null;
    let shotCss: { width: number; height: number } | null = null;
    try {
      focus = await boxOf(t.focus);
    } catch (e) {
      entry.errors.push(`focus: ${(e as Error).message.split("\n")[0]}`);
    }
    if (!grabbed) {
      const view = await target.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      const clip =
        t.clip && focus && view
          ? (() => {
              const x = Math.max(0, focus.x - 8), y = Math.max(0, focus.y - 8);
              return { x, y, width: Math.min(view.width - x, focus.width + 16), height: Math.min(view.height - y, focus.height + 16) };
            })()
          : undefined;
      await target.screenshot({ path: join(OUT_DIR, shotRel), clip, animations: "disabled", caret: "hide" });
      shotCss = clip ?? view;
    }
    entry.shot = shotRel;
    const metrics = await measure(target, focus);
    // The scale it was drawn at, measured: in the page and in the PNG (the page can report an
    // emulated scale that the screenshot isn't drawn at).
    entry.dpr = metrics.window.dpr;
    if (shotCss) {
      const png = readFileSync(join(OUT_DIR, shotRel));
      entry.pngScale = Math.round((png.readUInt32BE(16) / shotCss.width) * 100) / 100;
    }
    for (const [what, v] of [["page", entry.dpr], ["PNG", entry.pngScale]] as const) {
      if (v !== undefined && Math.abs(v - dpr) > 0.02) entry.errors.push(`device pixel ratio ${v} measured in the ${what}, expected ${dpr}`);
    }
    writeFileSync(
      join(OUT_DIR, metricsRel),
      JSON.stringify({ id, sceneId: scene.id, title: entry.title, area: scene.area, theme, url: target.url().split("#")[1] ?? "main", nativeDialogs: app.nativeDialogs, ...metrics }, null, 1),
    );
    entry.metrics = metricsRel;
  } catch (e) {
    entry.errors.push((e instanceof Error ? e.message : String(e)).split("\n")[0]);
    await target.screenshot({ path: join(OUT_DIR, "errors", `${id}-${theme}.png`) }).catch(() => {});
  }
  entry.nativeDialogs = [...app.nativeDialogs];
  entry.ms = Date.now() - t0;
  return entry;
}

// ── Main ───────────────────────────────────────────────────────────────

/** The 150 % pass in its own app instance and virtual screen (see the top of this file). */
function run150() {
  try {
    execSync("command -v xvfb-run", { stdio: "ignore", shell: "/bin/sh" });
  } catch {
    console.log(
      "\n  150 % pass skipped: it needs xvfb-run (a 1920 × 1080 virtual screen). Set DESIGN_REVIEW_NO_150=1 to skip it quietly,\n" +
        '  or run it alone where xvfb-run exists: DESIGN_REVIEW_SCALE=1.5 xvfb-run -a -s "-screen 0 1920x1080x24" bun packages/desktop/tools/design-review/run.ts\n',
    );
    return;
  }
  console.log("\n  150 % pass: a second app instance at scale 1.5 on a 1920 × 1080 screen\n");
  execSync(`xvfb-run -a -s "-screen 0 1920x1080x24" bun "${import.meta.filename}"`, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, DESIGN_REVIEW_SCALE: "1.5", DESIGN_REVIEW_SKIP_BUILD: "1" },
  });
}

/** The 150 % pass only runs on a 1280 × 720 DIP screen at scale 1.5: else its captures show nothing of 150 %. */
async function check150Screen(page: Page) {
  const m = await page.evaluate(() => ({ dpr: window.devicePixelRatio, width: screen.width, height: screen.height }));
  if (m.dpr !== 1.5 || m.width !== SCREEN_150.width || m.height !== SCREEN_150.height) {
    throw new Error(
      `The 150 % pass needs scale 1.5 on a ${SCREEN_150.width} × ${SCREEN_150.height} DIP screen (xvfb-run -s "-screen 0 1920x1080x24"); ` +
        `the page reports ${m.dpr} on ${m.width} × ${m.height}`,
    );
  }
}

async function main() {
  for (const d of ["shots", "metrics", "errors"]) mkdirSync(join(OUT_DIR, d), { recursive: true });
  const matching = ONLY ? SCENES.filter((s) => ONLY.some((p) => s.id.startsWith(p))) : SCENES;
  const selected = PASS_150 ? matching.filter((s) => s.also150) : matching;
  const pass = PASS_150 ? "150 % pass" : "Design review";
  console.log(`\n  ${pass}: ${selected.length} scenes × ${THEMES.length} themes\n  Output → ${OUT_DIR}\n`);

  // The 150 % pass uses the build the 100 % pass made.
  const skipBuild = PASS_150 || !!process.env.DESIGN_REVIEW_SKIP_BUILD;
  if (!skipBuild) {
    console.log("  Building app (VITE_CAPTURE_MODE=1)…");
    execSync("bunx vite build", { cwd: DESKTOP_DIR, stdio: "inherit", env: { ...process.env, VITE_CAPTURE_MODE: "1" } });
  } else if (!existsSync(join(DESKTOP_DIR, "dist", "index.html"))) {
    throw new Error("No build in packages/desktop/dist (DESIGN_REVIEW_SKIP_BUILD or the 150 % pass needs one)");
  }
  const { data, files } = await prepareData();

  const indexPath = join(OUT_DIR, "index.json");
  // The 150 % pass adds to the index the 100 % pass wrote.
  const previous: IndexEntry[] = (ONLY || PASS_150) && existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf-8")).scenes : [];
  const entries: IndexEntry[] = [];
  const t0 = Date.now();
  let app = new App();
  await app.start();
  if (PASS_150) await check150Screen(app.page).catch(async (e) => {
    await app.stop();
    throw e;
  });
  let sinceRestart = 0;
  try {
    for (const scene of selected) {
      if (sinceRestart >= RESTART_EVERY) {
        await app.stop();
        app = new App();
        await app.start();
        sinceRestart = 0;
      }
      for (const theme of THEMES) {
        let entry = await capture(app, data, files, scene, theme, PASS_150);
        // A crashed or stuck app: restart and try once more.
        if (entry.errors.length && !scene.skip && !entry.shot) {
          await app.stop();
          app = new App();
          await app.start();
          sinceRestart = 0;
          const retry = await capture(app, data, files, scene, theme, PASS_150);
          if (retry.shot || retry.errors.length <= entry.errors.length) entry = retry;
        }
        entries.push(entry);
        const mark = entry.errors.length ? (entry.shot ? "!" : "✗") : "✓";
        console.log(`  ${mark} ${entry.id}-${theme} (${(entry.ms / 1000).toFixed(1)} s)${entry.errors.length ? `  ${entry.errors.join("; ")}` : ""}`);
      }
      sinceRestart++;
      if (scene.restartAfter) sinceRestart = RESTART_EVERY;
    }
  } finally {
    await app.stop();
  }

  const ran = new Set(entries.map((e) => `${e.id}|${e.theme}`));
  const all = [...previous.filter((e) => !ran.has(`${e.id}|${e.theme}`)), ...entries];
  const order = new Map(SCENES.map((s, i) => [s.id, i]));
  all.sort((a, b) => (order.get(a.sceneId) ?? 0) - (order.get(b.sceneId) ?? 0) || a.id.localeCompare(b.id) || a.theme.localeCompare(b.theme));
  const seconds = Math.round((Date.now() - t0) / 1000);
  writeFileSync(
    indexPath,
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        runSeconds: seconds,
        scenes: all,
      },
      null,
      1,
    ),
  );
  const failed = entries.filter((e) => !e.shot);
  console.log(`\n  Done in ${seconds} s: ${entries.length - failed.length} shots, ${failed.length} not captured.\n`);
  if (!PASS_150 && !process.env.DESIGN_REVIEW_NO_150 && selected.some((s) => s.also150)) run150();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
