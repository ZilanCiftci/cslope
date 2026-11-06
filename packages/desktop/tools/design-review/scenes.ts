/**
 * The scene inventory of the design review: every part of the app that can
 * be opened, taken from the code (the ribbon tabs and their menus, the
 * context menus of the models panel and the canvas, the side panels, the
 * banners, the status bar, every *DialogApp.tsx and *Window.tsx window and
 * the in-window dialogs). Each scene loads a data set, opens its part with
 * real clicks where the app has a control for it (by role and name), and
 * returns what to capture. run.ts runs each scene in the light and the dark
 * theme.
 *
 * Data sets (no client data, see run.ts): the built-in examples, the
 * verification problems V017b (water, distributed load, reinforcement),
 * V085 (S = f(datum)) and V015 (piles), the design-capture review model
 * (every material kind, waternet, rapid drawdown, seismic, loads), the
 * project fixture with PDF drawings, and many models with long names.
 */

import type { Locator, Page } from "playwright";

export type Area = "main-edit" | "main-result" | "sidebar" | "menus" | "windows" | "dialogs" | "canvas";
export type Theme = "light" | "dark";
export type DataSet = "example" | "example1" | "nonhomog" | "v017b" | "v085" | "v015" | "review" | "drawings" | "many" | "empty";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a scene captures: a page (default: the main window), the region the metrics cover, and whether the image is cut to it. */
export interface Target {
  page?: Page;
  focus?: Locator | Box;
  /** Cut the image to the focus region (with a margin). */
  clip?: boolean;
  /** Make the window tall enough that nothing scrolls (at most 2000 px), so that one image shows all of it. */
  grow?: boolean;
}

/** What scenes can do (implemented in run.ts). */
export interface Ctx {
  page: Page;
  theme: Theme;
  /** The device pixel ratio of this capture (2, or 1.5 for the 150 % scenes). */
  dpr: number;
  /** Repository fixtures: a PNG, a PDF and a DWG drawing. */
  files: { png: string; pdf: string; dwg: string };
  /** Texts of window.confirm/alert boxes (accepted or dismissed, see `confirmAnswer`). */
  nativeDialogs: string[];
  /** The answer to the next window.confirm: false dismisses (the default). */
  confirmAnswer: boolean;
  load(data: DataSet): Promise<void>;
  /** Run the active model and show the result view. */
  result(): Promise<void>;
  tab(name: "File" | "Model" | "Results" | "Help"): Promise<void>;
  click(name: string | RegExp, opts?: { button?: "left" | "right"; dbl?: boolean }): Promise<void>;
  /** Evaluate `(s, store, arg) => …` on the main window's store. */
  store<T = unknown>(fn: string, arg?: unknown): Promise<T>;
  /** Open a dialog window with `open` (real clicks) and return it, sized at this capture's pixel ratio. */
  window(hash: string, open: () => Promise<void>): Promise<Page>;
  /** The page position of a model point on the canvas. */
  at(x: number, y: number): Promise<{ x: number; y: number }>;
  /** Right-click at each point until a context menu shows an item matching `item`; returns the menu. */
  contextMenuAt(points: { x: number; y: number }[], item: RegExp, before?: () => Promise<void>): Promise<Locator>;
  /** Points on a grid over the canvas (page coordinates). */
  canvasGrid(cols?: number, rows?: number): Promise<{ x: number; y: number }[]>;
  wait(ms: number): Promise<void>;
  /** Grab the X screen (native message boxes) to the scene's image; false when it cannot. */
  grabScreen(): Promise<boolean>;
}

export interface Scene {
  id: string;
  title: string;
  area: Area;
  /** The data set loaded first (default "example1"). */
  data?: DataSet;
  /** Run the analysis and show the result view before `open`. */
  result?: boolean;
  /** Also capture at 150 % (device pixel ratio 1.5). */
  also150?: boolean;
  /** Main window CSS size (default 1440 × 900). */
  size?: { width: number; height: number };
  /** Restart the app after this scene (it leaves the app broken). */
  restartAfter?: boolean;
  /** Why the scene cannot be captured; it is listed with this error and not run. */
  skip?: string;
  open(ctx: Ctx): Promise<Target | void>;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** The status bar: the bottom 26 px of the main window. */
const statusBar = async (ctx: Ctx): Promise<Box> => {
  const v = await ctx.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  return { x: 0, y: v.height - 26, width: v.width, height: 26 };
};
const toolbar = (ctx: Ctx) => ({ focus: ctx.page.getByRole("toolbar", { name: "Floating toolbar" }) });
const menu = (ctx: Ctx, name?: string) =>
  name ? ctx.page.getByRole("menu", { name, exact: true }).last() : ctx.page.getByRole("menu").last();
const sidebar = (ctx: Ctx) => ctx.page.locator("div.h-full.flex.flex-col").filter({ hasText: "Summary" }).first();
const explorer = (ctx: Ctx) => ctx.page.locator("div.flex.flex-col.h-full").filter({ hasText: "MODELS" }).first();

async function modelWindow(ctx: Ctx, label: string, hash: string): Promise<Page> {
  return ctx.window(hash, async () => {
    await ctx.tab("Model");
    await ctx.click(label);
  });
}

async function resultsWindow(ctx: Ctx, label: string, hash: string): Promise<Page> {
  return ctx.window(hash, async () => {
    await ctx.tab("Results");
    await ctx.click(label);
  });
}

/** The page points along the exterior boundary's segments (midpoints) and its vertices. */
async function exteriorPoints(ctx: Ctx, which: "vertices" | "edges"): Promise<{ x: number; y: number }[]> {
  const pts = await ctx.store<[number, number][]>("(s) => s.coordinates");
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    if (which === "vertices") out.push(await ctx.at(x, y));
    else {
      const [x2, y2] = pts[(i + 1) % pts.length];
      out.push(await ctx.at((x + x2) / 2, (y + y2) / 2));
    }
  }
  return out;
}

/** Page points on the active model's first drawing (a grid over an A4 page in its source units), on the canvas. */
async function drawingPoints(ctx: Ctx): Promise<{ x: number; y: number }[]> {
  const t = await ctx.store<{ a: number; b: number; c: number; d: number; e: number; f: number }>("(s) => s.backgrounds[0].transform");
  const canvas = await ctx.page.locator("[data-testid='slope-canvas']").boundingBox();
  const out: { x: number; y: number }[] = [];
  for (let v = 40; v < 840; v += 60)
    for (let u = 40; u < 600; u += 60) {
      const p = await ctx.at(t.a * u + t.c * v + t.e, t.b * u + t.d * v + t.f);
      if (canvas && p.x > canvas.x + 10 && p.x < canvas.x + canvas.width - 10 && p.y > canvas.y + 10 && p.y < canvas.y + canvas.height - 40) out.push(p);
    }
  return out;
}

/** Select the last annotation of a type on the result sheet. */
async function selectAnnotation(ctx: Ctx, type: string) {
  await ctx.store(
    `(s, store, type) => { const a = s.resultViewSettings.annotations.filter((a) => a.type === type).pop(); if (!a) throw new Error("No " + type + " annotation"); s.setSelectedAnnotations([a.id]); }`,
    type,
  );
}

/** Check every unchecked checkbox and open every <details> in a window, until nothing new appears. */
async function expandAll(win: Page) {
  for (let round = 0; round < 6; round++) {
    let changed = false;
    for (const d of await win.locator("details:not([open]) > summary").all()) {
      await d.click().catch(() => {});
      changed = true;
    }
    const boxes = win.locator('input[type="checkbox"]:not(:checked):not(:disabled)');
    const n = await boxes.count();
    for (let i = 0; i < n; i++) {
      const b = boxes.nth(0);
      if (!(await b.count())) break;
      // "Custom planes only" turns the search off; keep the search shown.
      const label = (await b.getAttribute("aria-label")) ?? "";
      if (/only/i.test(label)) break;
      await b.check({ force: true }).catch(() => {});
      changed = true;
      await win.waitForTimeout(80);
    }
    if (!changed) break;
  }
}

/** Open the Place drawing window and add a drawing file. */
async function placeDrawingWith(ctx: Ctx, file: string): Promise<Page> {
  const win = await ctx.window("place-drawing-dialog", async () => {
    await ctx.tab("Model");
    await ctx.click("Drawing");
  });
  await win.locator('input[type="file"][aria-label="Drawing file"]').setInputFiles(file);
  await win.waitForTimeout(2500);
  return win;
}

const MATERIAL_KINDS: [string, string][] = [
  ["mohr-coulomb", "Mohr-Coulomb"],
  ["undrained", "Undrained"],
  ["high-strength", "High strength"],
  ["impenetrable", "Impenetrable"],
  ["spatial-mohr-coulomb", "Spatial Mohr-Coulomb"],
  ["anisotropic-function", "Anisotropic function"],
  ["s-f-depth", "S = f(depth)"],
  ["s-f-datum", "S = f(datum)"],
  ["lime-cement-columns", "Lime-cement columns"],
  ["hoek-brown", "Hoek-Brown"],
  ["shansep", "SHANSEP"],
  ["shear-normal", "Shear-normal function"],
];

const REINFORCEMENT_TYPES = ["anchor", "tieback", "nail", "geosynthetic"];
const PILE_TYPES = ["pile", "sheet-pile"];

// ── The scenes ─────────────────────────────────────────────────────────

const mainEdit: Scene[] = [
  { id: "main-edit", title: "Main window, edit view (example model)", area: "main-edit", also150: true, open: async () => {} },
  { id: "main-edit-examples", title: "Main window, edit view, all examples loaded", area: "main-edit", data: "example", open: async () => {} },
  { id: "main-edit-review", title: "Main window, edit view of a model with water, loads and every material kind", area: "main-edit", data: "review", open: async () => {} },
  { id: "main-edit-v017b", title: "Main window, edit view of V017b (water, distributed load, reinforcement)", area: "main-edit", data: "v017b", open: async () => {} },
  { id: "main-edit-empty", title: "Main window after File › New (empty model)", area: "main-edit", data: "empty", open: async () => {} },
  { id: "ribbon-file", title: "Ribbon, File tab", area: "main-edit", open: async (ctx) => { await ctx.tab("File"); } },
  { id: "ribbon-model", title: "Ribbon, Model tab", area: "main-edit", open: async (ctx) => { await ctx.tab("Model"); } },
  { id: "ribbon-results-edit", title: "Ribbon, Results tab before a run (display commands enabled, a hint in their tooltips)", area: "main-edit", open: async (ctx) => { await ctx.tab("Results"); } },
  { id: "ribbon-help", title: "Ribbon, Help tab", area: "main-edit", open: async (ctx) => { await ctx.tab("Help"); } },
  { id: "ribbon-model-narrow", title: "Ribbon, Model tab at 1100 px", area: "main-edit", size: { width: 1100, height: 800 }, open: async (ctx) => { await ctx.tab("Model"); } },
  { id: "ribbon-file-narrow", title: "Ribbon, File tab at 1100 px", area: "main-edit", size: { width: 1100, height: 800 }, open: async (ctx) => { await ctx.tab("File"); } },
  { id: "status-edit", title: "Status bar in the edit view", area: "main-edit", open: async (ctx) => ({ focus: await statusBar(ctx), clip: true }) },
  {
    id: "status-edit-selection",
    title: "Status bar with a selected, locked object (selection text, Unlock)",
    area: "main-edit",
    open: async (ctx) => {
      await ctx.store(`(s) => { s.lockAllOfGroup("exterior"); s.lockAllOfGroup("boundaries"); s.selectCanvasObject({ type: "exterior" }, 1); }`);
      return { focus: await statusBar(ctx), clip: true };
    },
  },
  { id: "floating-toolbar-edit", title: "Floating toolbar, edit view", area: "main-edit", open: async (ctx) => toolbar(ctx) },
  {
    id: "banner-error-buttons",
    title: "Analysis error banner with buttons (no surface, limits drawn for the other direction)",
    area: "main-edit",
    open: async (ctx) => {
      await ctx.store(`(s, store) => {
        s.setOrientation(s.orientation === "ltr" ? "rtl" : "ltr");
        store.setState({ runState: "error", errorMessage: "No valid slip surface was found. Check the search limits, the geometry and the material strengths." });
      }`);
      return { focus: ctx.page.getByTestId("analysis-error-banner") };
    },
  },
  {
    id: "banner-error-plain",
    title: "Analysis error banner without buttons",
    area: "main-edit",
    open: async (ctx) => {
      await ctx.store(`(s, store) => store.setState({ runState: "error", errorMessage: "The expression of parameter H could not be evaluated: unknown name \\"h0\\"." })`);
      return { focus: ctx.page.getByTestId("analysis-error-banner") };
    },
  },
  {
    id: "banner-error-result",
    title: "Analysis error banner in the result view (the summary says only \"Analysis failed.\")",
    area: "main-edit",
    open: async (ctx) => {
      await ctx.store(`(s, store) => { s.setMode("result"); store.setState({ runState: "error", errorMessage: "No valid slip surface was found. Check the search limits, the geometry and the material strengths." }); }`);
    },
  },
  {
    id: "assign-hint",
    title: "\"Click a region to assign\" hint over the canvas",
    area: "main-edit",
    data: "nonhomog",
    open: async (ctx) => {
      await ctx.store(`(s) => s.setAssigningMaterial(s.materials[1].id)`);
    },
  },
  {
    id: "assign-hint-with-banner",
    title: "Assign hint together with an error banner",
    area: "main-edit",
    data: "nonhomog",
    open: async (ctx) => {
      await ctx.store(`(s, store) => { s.setAssigningMaterial(s.materials[1].id); store.setState({ runState: "error", errorMessage: "No valid slip surface was found. Check the search limits, the geometry and the material strengths." }); }`);
    },
  },
];

const mainResult: Scene[] = [
  { id: "main-result", title: "Main window, result view (example model)", area: "main-result", result: true, also150: true, open: async () => {} },
  { id: "main-result-review", title: "Result view of the review model (water, loads, seismic)", area: "main-result", data: "review", result: true, open: async () => {} },
  {
    id: "main-result-v085-table",
    title: "Result view of V085 with the material table (S = f(datum) columns) and color bar",
    area: "main-result",
    data: "v085",
    result: true,
    open: async (ctx) => {
      await ctx.store(`(s) => { if (!s.resultViewSettings.annotations.some((a) => a.type === "material-table")) s.addAnnotation("material-table"); s.addAnnotation("color-bar"); s.setSelectedAnnotations([]); }`);
    },
  },
  {
    id: "main-result-all-surfaces",
    title: "Result view with all surfaces and slices",
    area: "main-result",
    result: true,
    open: async (ctx) => {
      await ctx.store(`(s) => s.setResultViewSettings({ surfaceDisplay: "all", showSlices: true })`);
    },
  },
  { id: "ribbon-results", title: "Ribbon, Results tab after a run", area: "main-result", result: true, open: async (ctx) => { await ctx.tab("Results"); } },
  { id: "ribbon-results-narrow", title: "Ribbon, Results tab at 1100 px", area: "main-result", result: true, size: { width: 1100, height: 800 }, open: async (ctx) => { await ctx.tab("Results"); } },
  { id: "status-result", title: "Status bar in the result view (FOS)", area: "main-result", result: true, open: async (ctx) => ({ focus: await statusBar(ctx), clip: true }) },
  {
    id: "status-run-all-running",
    title: "Status bar while Run all runs",
    area: "main-result",
    data: "example",
    open: async (ctx) => {
      await ctx.store(`(s, store) => store.setState({ runAll: { total: 6, finished: 2, failed: 0, progress: 0.4, running: true }, runState: "running", runStartedAt: Date.now() - 4200 })`);
      return { focus: await statusBar(ctx), clip: true };
    },
  },
  {
    id: "status-run-all-failed",
    title: "Status bar after Run all with failures",
    area: "main-result",
    data: "example",
    open: async (ctx) => {
      await ctx.store(`(s, store) => store.setState({ runAll: { total: 6, finished: 6, failed: 2, progress: 1, running: false } })`);
      return { focus: await statusBar(ctx), clip: true };
    },
  },
  {
    id: "status-analysis-failed",
    title: "Status bar after a failed analysis",
    area: "main-result",
    open: async (ctx) => {
      await ctx.store(`(s, store) => store.setState({ runState: "error", errorMessage: "No valid slip surface was found. Check the search limits, the geometry and the material strengths." })`);
      return { focus: await statusBar(ctx), clip: true };
    },
  },
  { id: "floating-toolbar-result", title: "Floating toolbar, result view", area: "main-result", result: true, open: async (ctx) => toolbar(ctx) },
];

const sidebarScenes: Scene[] = [
  { id: "models-one", title: "Models panel with one model", area: "sidebar", open: async (ctx) => ({ focus: explorer(ctx) }) },
  { id: "models-examples", title: "Models panel with the examples", area: "sidebar", data: "example", open: async (ctx) => ({ focus: explorer(ctx) }) },
  { id: "models-many-long", title: "Models panel with 58 models with long names (scrolls)", area: "sidebar", data: "many", open: async (ctx) => ({ focus: explorer(ctx) }) },
  {
    id: "models-status-dots",
    title: "Models panel: status dots (not run, running, done, failed)",
    area: "sidebar",
    data: "example",
    open: async (ctx) => {
      await ctx.store(`(s, store) => {
        const ms = s.models.slice();
        ms[1] = { ...ms[1], runState: "running" };
        ms[2] = { ...ms[2], runState: "error", errorMessage: "No valid slip surface was found." };
        if (ms[3]) ms[3] = { ...ms[3], runState: "done", result: s.models[0].result ?? { minFOS: 1.234 } };
        store.setState({ models: ms });
      }`);
      await ctx.result();
      await ctx.store(`(s) => s.setMode("edit")`);
      return { focus: explorer(ctx) };
    },
  },
  {
    id: "models-multi-selected",
    title: "Models panel with three models selected (Ctrl+click)",
    area: "sidebar",
    data: "example",
    open: async (ctx) => {
      const rows = ctx.page.getByRole("treeitem");
      await rows.nth(1).click({ modifiers: ["Control"] });
      await rows.nth(2).click({ modifiers: ["Control"] });
      return { focus: explorer(ctx) };
    },
  },
  {
    id: "models-hover",
    title: "Models panel, a row under the pointer",
    area: "sidebar",
    data: "example",
    open: async (ctx) => {
      await ctx.page.getByRole("treeitem").nth(2).hover();
      return { focus: explorer(ctx) };
    },
  },
  {
    id: "models-rename",
    title: "Models panel, renaming a model (double-click)",
    area: "sidebar",
    data: "example",
    open: async (ctx) => {
      await ctx.page.getByRole("treeitem").nth(0).dblclick();
      return { focus: explorer(ctx) };
    },
  },
  { id: "models-drawings-expanded", title: "Models panel, models with drawings, expanded", area: "sidebar", data: "drawings", open: async (ctx) => ({ focus: explorer(ctx) }) },
  {
    id: "models-drawings-collapsed",
    title: "Models panel, models with drawings, collapsed",
    area: "sidebar",
    data: "drawings",
    open: async (ctx) => {
      const hide = ctx.page.getByRole("button", { name: /^Hide the drawings of/ });
      for (let i = 0; i < 10 && (await hide.count()); i++) await hide.first().click();
      return { focus: explorer(ctx) };
    },
  },
  {
    id: "models-drawing-selected",
    title: "Models panel, a drawing row selected (its settings below it)",
    area: "sidebar",
    data: "drawings",
    open: async (ctx) => {
      const row = ctx.page.getByRole("group", { name: "Drawings of the model" }).first().getByRole("treeitem").first();
      await row.locator("xpath=descendant-or-self::*[contains(@title, 'click for its settings')]").first().click();
      return { focus: explorer(ctx) };
    },
  },
  {
    id: "models-drawing-hover",
    title: "Models panel, a drawing row under the pointer (grip and ×)",
    area: "sidebar",
    data: "drawings",
    open: async (ctx) => {
      await ctx.page.getByRole("group", { name: "Drawings of the model" }).first().getByRole("treeitem").first().hover();
      return { focus: explorer(ctx) };
    },
  },
  {
    id: "models-drawing-hidden-unlocked",
    title: "Models panel, a drawing hidden and unlocked",
    area: "sidebar",
    data: "drawings",
    open: async (ctx) => {
      await ctx.page.getByRole("button", { name: /^Hide (?!the drawings)/ }).first().click({ force: true });
      await ctx.page.getByRole("button", { name: /^Unlock / }).first().click({ force: true });
      return { focus: explorer(ctx) };
    },
  },
  {
    id: "models-drawing-dwg-layers",
    title: "Models panel, a placed DWG drawing with its layers list open",
    area: "sidebar",
    open: async (ctx) => {
      const win = await placeDrawingWith(ctx, ctx.files.dwg);
      await win.getByRole("button", { name: "Place", exact: true }).click();
      await ctx.wait(1200);
      const row = ctx.page.getByRole("group", { name: "Drawings of the model" }).first().getByRole("treeitem").first();
      await row.locator("xpath=descendant-or-self::*[contains(@title, 'click for its settings')]").first().click();
      await ctx.page.getByRole("button", { name: /^Layers of / }).first().click();
      return { focus: explorer(ctx) };
    },
  },
  {
    id: "attachments",
    title: "Attachments panel (files of the project)",
    area: "sidebar",
    data: "drawings",
    open: async (ctx) => ({ focus: ctx.page.getByRole("list", { name: "Attached files" }).locator("xpath=../..") }),
  },
  {
    id: "attachments-empty",
    title: "Attachments panel without files",
    area: "sidebar",
    open: async (ctx) => ({ focus: explorer(ctx) }),
  },
  { id: "result-summary", title: "Result sidebar, Summary of a successful run", area: "sidebar", result: true, open: async (ctx) => ({ focus: sidebar(ctx) }) },
  {
    id: "result-summary-notes",
    title: "Result sidebar, Summary with notes expanded (review model)",
    area: "sidebar",
    data: "review",
    result: true,
    open: async (ctx) => {
      const notes = ctx.page.locator('button[aria-expanded="false"]').filter({ hasText: /\bnotes?\b/ });
      if (await notes.count()) await notes.first().click();
      const explain = ctx.page.getByRole("button", { name: "Explain" });
      if (await explain.count()) await explain.first().click();
      return { focus: sidebar(ctx) };
    },
  },
  {
    id: "result-summary-error",
    title: "Result sidebar, Summary of a failed run",
    area: "sidebar",
    open: async (ctx) => {
      await ctx.store(`(s, store) => { s.setMode("result"); store.setState({ runState: "error", errorMessage: "No valid slip surface was found. Check the search limits, the geometry and the material strengths." }); }`);
      return { focus: sidebar(ctx) };
    },
  },
  {
    id: "result-summary-custom-surfaces",
    title: "Result sidebar, Summary with custom surfaces",
    area: "sidebar",
    open: async (ctx) => {
      await ctx.store(`(s) => {
        const xs = s.coordinates.map((p) => p[0]), ys = s.coordinates.map((p) => p[1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, top = Math.max(...ys);
        s.addCustomSearchPlane({ kind: "circle", cx, cy: top + 10, radius: 18 });
        s.addCustomSearchPlane({ kind: "circle", cx: cx + 400, cy: top + 10, radius: 2 });
      }`).catch(() => {});
      await ctx.result();
      await ctx.store(`(s) => s.setResultViewSettings({ showCustomSurfaces: true })`);
      return { focus: sidebar(ctx) };
    },
  },
  {
    id: "result-layers",
    title: "Result sidebar, Layers list with annotations",
    area: "sidebar",
    result: true,
    open: async (ctx) => {
      await ctx.store(`(s) => { s.addAnnotation("text"); s.addAnnotation("color-bar"); s.addAnnotation("plot"); s.setSelectedAnnotations([]); }`);
      return { focus: sidebar(ctx) };
    },
  },
  {
    id: "result-layers-selected",
    title: "Result sidebar, Layers list with a selected row",
    area: "sidebar",
    result: true,
    open: async (ctx) => {
      await ctx.store(`(s) => { s.addAnnotation("text"); s.addAnnotation("plot"); }`);
      await selectAnnotation(ctx, "text");
      return { focus: sidebar(ctx) };
    },
  },
  {
    id: "result-layers-hover",
    title: "Result sidebar, Layers list with a row under the pointer (grip shown)",
    area: "sidebar",
    result: true,
    open: async (ctx) => {
      await ctx.store(`(s) => { s.addAnnotation("text"); s.addAnnotation("plot"); s.setSelectedAnnotations([]); }`);
      const items = ctx.page.getByRole("list").filter({ has: ctx.page.getByRole("listitem") }).last().getByRole("listitem");
      await items.nth(1).hover();
      return { focus: sidebar(ctx) };
    },
  },
  {
    id: "result-sheet",
    title: "Result sidebar, Sheet section (Results › Sheet settings)",
    area: "sidebar",
    result: true,
    open: async (ctx) => {
      await ctx.tab("Results");
      await ctx.click("Sheet settings");
      return { focus: sidebar(ctx) };
    },
  },
  {
    id: "anno-text",
    title: "Result sidebar, text annotation properties",
    area: "sidebar",
    result: true,
    open: async (ctx) => {
      await ctx.tab("Results");
      await ctx.click("Text");
      await selectAnnotation(ctx, "text");
      return { focus: sidebar(ctx) };
    },
  },
  {
    id: "anno-material-table",
    title: "Result sidebar, material table properties (V085, S = f(datum))",
    area: "sidebar",
    data: "v085",
    result: true,
    open: async (ctx) => {
      await ctx.store(`(s) => { if (!s.resultViewSettings.annotations.some((a) => a.type === "material-table")) s.addAnnotation("material-table"); }`);
      await selectAnnotation(ctx, "material-table");
      return { focus: sidebar(ctx) };
    },
  },
  {
    id: "anno-color-bar",
    title: "Result sidebar, color bar properties",
    area: "sidebar",
    result: true,
    open: async (ctx) => {
      await ctx.store(`(s) => s.setResultViewSettings({ surfaceDisplay: "all" })`);
      await ctx.store(`(s) => { if (!s.resultViewSettings.annotations.some((a) => a.type === "color-bar")) s.addAnnotation("color-bar"); }`);
      await selectAnnotation(ctx, "color-bar");
      return { focus: sidebar(ctx) };
    },
  },
  {
    id: "anno-plot",
    title: "Result sidebar, plot properties",
    area: "sidebar",
    result: true,
    open: async (ctx) => {
      await ctx.tab("Results");
      await ctx.click("Plot");
      await selectAnnotation(ctx, "plot");
      return { focus: sidebar(ctx) };
    },
  },
  {
    id: "anno-reference",
    title: "Result sidebar, reference line properties",
    area: "sidebar",
    result: true,
    open: async (ctx) => {
      await ctx.tab("Results");
      await ctx.click("Reference line");
      await menu(ctx, "Reference line").getByRole("menuitem", { name: "Polyline" }).click();
      return { focus: sidebar(ctx) };
    },
  },
  {
    id: "anno-reference-circle",
    title: "Result sidebar, reference circle properties",
    area: "sidebar",
    result: true,
    open: async (ctx) => {
      await ctx.tab("Results");
      await ctx.click("Reference line");
      await menu(ctx, "Reference line").getByRole("menuitem", { name: "Circle" }).click();
      return { focus: sidebar(ctx) };
    },
  },
  {
    id: "panels-collapsed",
    title: "Both side panels collapsed to strips (result view)",
    area: "sidebar",
    result: true,
    open: async (ctx) => {
      await ctx.store(`(s) => { s.toggleExplorer(); s.toggleSidebar(); }`);
    },
  },
];

const menus: Scene[] = [
  { id: "menu-file-import", title: "File › Import menu", area: "menus", open: async (ctx) => { await ctx.tab("File"); await ctx.click("Import"); return { focus: menu(ctx, "Import") }; } },
  { id: "menu-file-export", title: "File › Export menu", area: "menus", open: async (ctx) => { await ctx.tab("File"); await ctx.click("Export"); return { focus: menu(ctx, "Export") }; } },
  {
    id: "menu-model-drawing",
    title: "Model › Drawing ▾ menu",
    area: "menus",
    open: async (ctx) => {
      await ctx.tab("Model");
      await ctx.click("More drawing commands");
      return { focus: menu(ctx, "More drawing commands") };
    },
  },
  {
    id: "menu-model-drawing-pick",
    title: "Model › Drawing ▾ menu with Pick lines enabled (a PDF drawing shown)",
    area: "menus",
    data: "drawings",
    open: async (ctx) => {
      await ctx.tab("Model");
      await ctx.click("More drawing commands");
      return { focus: menu(ctx, "More drawing commands") };
    },
  },
  { id: "menu-results-surfaces", title: "Results › Surfaces ▾ menu", area: "menus", result: true, open: async (ctx) => { await ctx.tab("Results"); await ctx.click("Surfaces"); return { focus: ctx.page.getByRole("group", { name: "Surfaces", exact: true }) }; } },
  {
    id: "menu-results-surfaces-filter",
    title: "Results › Surfaces ▾ menu, Filter by FOS (with the FOS field)",
    area: "menus",
    result: true,
    open: async (ctx) => {
      await ctx.store(`(s) => s.setResultViewSettings({ surfaceDisplay: "filter" })`);
      await ctx.tab("Results");
      await ctx.click("Surfaces");
      return { focus: ctx.page.getByRole("group", { name: "Surfaces", exact: true }) };
    },
  },
  { id: "menu-results-reference-line", title: "Results › Reference line ▾ menu", area: "menus", result: true, open: async (ctx) => { await ctx.tab("Results"); await ctx.click("Reference line"); return { focus: menu(ctx, "Reference line") }; } },
  { id: "menu-results-export", title: "Results › Export ▾ menu", area: "menus", result: true, open: async (ctx) => { await ctx.tab("Results"); await ctx.click("More export options"); return { focus: ctx.page.getByRole("group", { name: "Export options", exact: true }) }; } },
  {
    id: "menu-help-shortcuts",
    title: "Help › Shortcuts (keyboard shortcuts panel)",
    area: "menus",
    open: async (ctx) => {
      await ctx.tab("Help");
      await ctx.click("Shortcuts");
      return { focus: ctx.page.getByRole("table", { name: "Keyboard shortcuts" }).locator("xpath=../..") };
    },
  },
  {
    id: "menu-run",
    title: "Floating toolbar, Run ▾ menu",
    area: "menus",
    result: true,
    open: async (ctx) => {
      await ctx.click("More run options");
      return toolbar(ctx);
    },
  },
  {
    id: "ctx-model-single",
    title: "Context menu of a model (Models panel)",
    area: "menus",
    data: "example",
    open: async (ctx) => {
      await ctx.page.getByRole("treeitem").nth(1).click({ button: "right" });
      return { focus: menu(ctx) };
    },
  },
  {
    id: "ctx-model-multi",
    title: "Context menu of three selected models",
    area: "menus",
    data: "example",
    open: async (ctx) => {
      const rows = ctx.page.getByRole("treeitem");
      await rows.nth(1).click({ modifiers: ["Control"] });
      await rows.nth(2).click({ modifiers: ["Control"] });
      await rows.nth(2).click({ button: "right" });
      return { focus: menu(ctx) };
    },
  },
  {
    id: "ctx-canvas-empty",
    title: "Canvas context menu on an empty spot",
    area: "menus",
    open: async (ctx) => ({ focus: await ctx.contextMenuAt(await ctx.canvasGrid(), /^Lock all$/) }),
  },
  {
    id: "ctx-canvas-point",
    title: "Canvas context menu on a point of the exterior boundary",
    area: "menus",
    open: async (ctx) => {
      await ctx.store(`(s) => s.selectCanvasObject({ type: "exterior" })`);
      return { focus: await ctx.contextMenuAt(await exteriorPoints(ctx, "vertices"), /^Delete point$/) };
    },
  },
  {
    id: "ctx-canvas-edge",
    title: "Canvas context menu on an edge of the exterior boundary (Add point)",
    area: "menus",
    open: async (ctx) => {
      await ctx.store(`(s) => s.selectCanvasObject({ type: "exterior" })`);
      return { focus: await ctx.contextMenuAt(await exteriorPoints(ctx, "edges"), /^Add point$/) };
    },
  },
  {
    id: "ctx-canvas-boundary",
    title: "Canvas context menu on a material boundary",
    area: "menus",
    data: "nonhomog",
    open: async (ctx) => {
      const pts = await ctx.store<[number, number][]>(`(s) => { const b = s.materialBoundaries[0]; s.selectCanvasObject({ type: "boundary", id: b.id }); const c = b.coordinates; const out = []; for (let i = 0; i + 1 < c.length; i++) out.push([(c[i][0] + c[i + 1][0]) / 2, (c[i][1] + c[i + 1][1]) / 2]); return out.concat(c); }`);
      const at = [];
      for (const [x, y] of pts) at.push(await ctx.at(x, y));
      return { focus: await ctx.contextMenuAt(at, /material boundary/i) };
    },
  },
  {
    id: "ctx-canvas-load",
    title: "Canvas context menu on a distributed load",
    area: "menus",
    data: "review",
    open: async (ctx) => {
      const u = await ctx.store<{ x1: number; x2: number }>(`(s) => { const u = s.udls[0]; s.selectCanvasObject({ type: "udl", id: u.id }); return u; }`);
      const at = [];
      for (const dy of [0.3, 0.8, 1.5, 2.5, 0]) for (const f of [0.5, 0.3, 0.7]) at.push(await ctx.at(u.x1 + (u.x2 - u.x1) * f, 10 + dy));
      return { focus: await ctx.contextMenuAt(at, /load/i) };
    },
  },
  {
    id: "ctx-canvas-drawing-locked",
    title: "Canvas context menu on a locked drawing",
    area: "menus",
    data: "drawings",
    open: async (ctx) => {
      await ctx.store(`(s) => { for (const b of s.backgrounds) s.setObjectLocked({ type: "background", id: b.id }, true); }`);
      return { focus: await ctx.contextMenuAt([...(await ctx.canvasGrid(8, 6)), ...(await drawingPoints(ctx))], /^Unlock drawing$/) };
    },
  },
  {
    id: "ctx-canvas-drawing-unlocked",
    title: "Canvas context menu on an unlocked drawing",
    area: "menus",
    data: "drawings",
    open: async (ctx) => {
      await ctx.store(`(s) => { for (const b of s.backgrounds) s.setObjectLocked({ type: "background", id: b.id }, false); }`);
      return { focus: await ctx.contextMenuAt([...(await ctx.canvasGrid(8, 6)), ...(await drawingPoints(ctx))], /^Lock drawing$/) };
    },
  },
  {
    id: "ctx-canvas-lock-all",
    title: "Canvas context menu, Lock all submenu",
    area: "menus",
    data: "review",
    open: async (ctx) => {
      const m = await ctx.contextMenuAt(await ctx.canvasGrid(), /^Lock all$/);
      await m.getByRole("menuitem", { name: "Lock all", exact: true }).hover();
      await m.getByRole("menuitem", { name: "Lock all", exact: true }).click();
      return { focus: ctx.page.getByRole("menu", { name: "Lock all" }) };
    },
  },
  {
    id: "ctx-annotation",
    title: "Context menu on annotations in the result view (two selected: align)",
    area: "menus",
    result: true,
    open: async (ctx) => {
      await ctx.store(`(s) => { s.addAnnotation("text"); s.addAnnotation("plot"); }`);
      const select = () => ctx.store(`(s) => s.setSelectedAnnotations(s.resultViewSettings.annotations.filter((a) => a.type === "text" || a.type === "plot").map((a) => a.id))`).then(() => {});
      const grid = (await ctx.canvasGrid(20, 14)).filter((_, i) => { const c = i % 20, r = Math.floor(i / 20); return c >= 5 && c <= 15 && r >= 3 && r <= 11; });
      return { focus: await ctx.contextMenuAt(grid, /^Align left$/, select) };
    },
  },
  {
    id: "ctx-reference-line",
    title: "Context menu on a reference line in the result view",
    area: "menus",
    result: true,
    open: async (ctx) => {
      await ctx.tab("Results");
      await ctx.click("Reference line");
      await menu(ctx, "Reference line").getByRole("menuitem", { name: "Polyline" }).click();
      return { focus: await ctx.contextMenuAt(await ctx.canvasGrid(24, 16), /reference line/i) };
    },
  },
  {
    id: "menu-insert-variable",
    title: "Insert variable menu (text annotation)",
    area: "menus",
    result: true,
    open: async (ctx) => {
      await ctx.store(`(s) => s.addAnnotation("text")`);
      await selectAnnotation(ctx, "text");
      await ctx.click(/^Insert variable/);
      return { focus: ctx.page.getByRole("menu", { name: "Insert variable" }) };
    },
  },
  {
    id: "menu-material-picker",
    title: "Material picker (double-click in a region)",
    area: "menus",
    data: "nonhomog",
    open: async (ctx) => {
      const pts = await ctx.canvasGrid(10, 8);
      for (const p of pts) {
        await ctx.page.mouse.dblclick(p.x, p.y);
        await ctx.wait(250);
        const m = ctx.page.getByText("Assign material", { exact: true });
        if (await m.count()) return { focus: m.first().locator("..") };
        await ctx.page.keyboard.press("Escape");
      }
      throw new Error("No material picker opened at any point of the grid");
    },
  },
  {
    id: "point-editor",
    title: "Point editor (double-click a point of the selected exterior)",
    area: "menus",
    open: async (ctx) => {
      await ctx.store(`(s) => s.selectCanvasObject({ type: "exterior" })`);
      for (const p of await exteriorPoints(ctx, "vertices")) {
        await ctx.page.mouse.dblclick(p.x, p.y);
        await ctx.wait(300);
        const ed = ctx.page.getByRole("dialog");
        if (await ed.count()) return { focus: ed.last() };
        const inputs = ctx.page.locator("input:visible");
        if (await inputs.count()) return { focus: inputs.first().locator("xpath=../..") };
      }
      throw new Error("No point editor opened");
    },
  },
  {
    id: "annotation-style-menu",
    title: "Annotation style menu",
    area: "menus",
    skip: "AnnotationStyleMenu (features/canvas/AnnotationStyleMenu.tsx) is not rendered anywhere in the app: no component imports it.",
    open: async () => {},
  },
];

const canvasScenes: Scene[] = [
  {
    id: "canvas-selected-point",
    title: "Canvas: a selected point of the exterior boundary",
    area: "canvas",
    open: async (ctx) => {
      await ctx.store(`(s) => s.selectCanvasObject({ type: "exterior" }, 2)`);
    },
  },
  {
    id: "canvas-boundary-handles",
    title: "Canvas: a selected material boundary with its handles",
    area: "canvas",
    data: "nonhomog",
    open: async (ctx) => {
      await ctx.store(`(s) => s.selectCanvasObject({ type: "boundary", id: s.materialBoundaries[0].id })`);
    },
  },
  {
    id: "canvas-search-limits",
    title: "Canvas: the search limits selected",
    area: "canvas",
    open: async (ctx) => {
      await ctx.store(`(s) => { if (!s.analysisLimits.enabled) s.setAnalysisLimits({ ...s.analysisLimits, enabled: true }); s.selectCanvasObject({ type: "searchLimits" }); }`);
    },
  },
  {
    id: "canvas-water-line",
    title: "Canvas: a selected water line (review model)",
    area: "canvas",
    data: "review",
    open: async (ctx) => {
      await ctx.store(`(s) => { const l = s.piezometricLine.lines[0]; if (l) s.selectCanvasObject({ type: "waterLine", id: l.id }); }`);
    },
  },
  {
    id: "canvas-reinforcement",
    title: "Canvas: a selected reinforcement (V017b)",
    area: "canvas",
    data: "v017b",
    open: async (ctx) => {
      await ctx.store(`(s) => { const r = s.reinforcements[0]; if (r) s.selectCanvasObject({ type: "reinforcement", id: r.id }); }`);
    },
  },
  {
    id: "canvas-drawing-frame",
    title: "Canvas: a selected drawing (frame)",
    area: "canvas",
    data: "drawings",
    open: async (ctx) => {
      await ctx.store(`(s) => { const b = s.backgrounds[0]; s.setObjectLocked({ type: "background", id: b.id }, false); s.selectCanvasObject({ type: "background", id: b.id }); }`);
    },
  },
  {
    id: "canvas-locked-padlock",
    title: "Canvas: a locked object under the pointer (padlock)",
    area: "canvas",
    open: async (ctx) => {
      await ctx.store(`(s) => s.lockAllOfGroup("exterior")`);
      const pts = await exteriorPoints(ctx, "edges");
      const p = pts[Math.min(2, pts.length - 1)];
      await ctx.page.mouse.move(p.x - 20, p.y - 20);
      await ctx.page.mouse.move(p.x, p.y, { steps: 4 });
    },
  },
  {
    id: "pick-lines-bar",
    title: "Pick lines bar (Model › Drawing ▾ › Pick lines…)",
    area: "canvas",
    data: "drawings",
    open: async (ctx) => {
      await ctx.tab("Model");
      await ctx.click("More drawing commands");
      await menu(ctx, "More drawing commands").getByRole("menuitem", { name: "Pick lines…" }).click();
      await ctx.wait(1500);
    },
  },
];

const windows: Scene[] = [
  { id: "win-materials", title: "Define materials window (example)", area: "windows", also150: true, open: async (ctx) => ({ page: await modelWindow(ctx, "Materials", "materials-dialog") }) },
  { id: "win-materials-review", title: "Define materials window (review model: SHANSEP, notices)", area: "windows", data: "review", open: async (ctx) => ({ page: await modelWindow(ctx, "Materials", "materials-dialog") }) },
  { id: "win-materials-v085", title: "Define materials window (V085, S = f(datum) layers)", area: "windows", data: "v085", open: async (ctx) => ({ page: await modelWindow(ctx, "Materials", "materials-dialog") }) },
  ...MATERIAL_KINDS.map(
    ([kind, label]): Scene => ({
      id: `win-materials-${kind}`,
      title: `Define materials window, ${label} form`,
      area: "windows",
      open: async (ctx) => {
        const win = await modelWindow(ctx, "Materials", "materials-dialog");
        await win.locator('select:has(option[value="mohr-coulomb"])').first().selectOption(kind);
        await win.waitForTimeout(400);
        return { page: win };
      },
    }),
  ),
  { id: "win-assign", title: "Assign materials window", area: "windows", data: "nonhomog", open: async (ctx) => ({ page: await modelWindow(ctx, "Assign", "material-assignment-dialog") }) },
  {
    id: "win-assign-picking",
    title: "Assign materials window with a region picked on the canvas",
    area: "windows",
    data: "nonhomog",
    open: async (ctx) => {
      const win = await modelWindow(ctx, "Assign", "material-assignment-dialog");
      // Region keys are "region-<index>" (utils/regions.ts), not the indices of regionMaterials.
      await ctx.store(`(s) => s.setSelectedRegionKey("region-0")`).catch(() => {});
      await win.waitForTimeout(500);
      return { page: win };
    },
  },
  { id: "win-geometry", title: "Exterior boundary window (points table)", area: "windows", open: async (ctx) => ({ page: await modelWindow(ctx, "Exterior", "geometry-dialog") }) },
  { id: "win-interior", title: "Interior boundaries window", area: "windows", data: "nonhomog", open: async (ctx) => ({ page: await modelWindow(ctx, "Interior", "interior-boundaries-dialog") }) },
  { id: "win-interior-empty", title: "Interior boundaries window, no boundaries", area: "windows", open: async (ctx) => ({ page: await modelWindow(ctx, "Interior", "interior-boundaries-dialog") }) },
  { id: "win-udl-empty", title: "Distributed loads window, empty", area: "windows", open: async (ctx) => ({ page: await modelWindow(ctx, "Distributed loads", "udl-dialog") }) },
  { id: "win-udl", title: "Distributed loads window (review: excess pore pressure)", area: "windows", data: "review", open: async (ctx) => ({ page: await modelWindow(ctx, "Distributed loads", "udl-dialog") }) },
  { id: "win-udl-v017b", title: "Distributed loads window (V017b)", area: "windows", data: "v017b", open: async (ctx) => ({ page: await modelWindow(ctx, "Distributed loads", "udl-dialog") }) },
  { id: "win-lineloads-empty", title: "Line loads window, empty", area: "windows", open: async (ctx) => ({ page: await modelWindow(ctx, "Line loads", "line-loads-dialog") }) },
  { id: "win-lineloads", title: "Line loads window (review: two loads, one inclined)", area: "windows", data: "review", open: async (ctx) => ({ page: await modelWindow(ctx, "Line loads", "line-loads-dialog") }) },
  { id: "win-reinforcement-empty", title: "Reinforcement window, empty", area: "windows", open: async (ctx) => ({ page: await modelWindow(ctx, "Reinforcement", "reinforcement-dialog") }) },
  { id: "win-reinforcement-v017b", title: "Reinforcement window (V017b geosynthetic supports)", area: "windows", data: "v017b", open: async (ctx) => ({ page: await modelWindow(ctx, "Reinforcement", "reinforcement-dialog") }) },
  { id: "win-reinforcement-v015", title: "Reinforcement window (V015 tiebacks and soldier piles)", area: "windows", data: "v015", open: async (ctx) => ({ page: await modelWindow(ctx, "Reinforcement", "reinforcement-dialog") }) },
  ...REINFORCEMENT_TYPES.map(
    (type): Scene => ({
      id: `win-reinforcement-${type}`,
      title: `Reinforcement window, a new ${type}`,
      area: "windows",
      open: async (ctx) => {
        const win = await modelWindow(ctx, "Reinforcement", "reinforcement-dialog");
        await win.getByRole("combobox", { name: "Type of the new reinforcement" }).selectOption(type);
        await win.getByRole("region", { name: "Reinforcement elements" }).getByRole("button", { name: "Add", exact: true }).click();
        await win.waitForTimeout(400);
        return { page: win };
      },
    }),
  ),
  ...PILE_TYPES.map(
    (type): Scene => ({
      id: `win-reinforcement-${type}`,
      title: `Reinforcement window, a new ${type.replace("-", " ")}`,
      area: "windows",
      open: async (ctx) => {
        const win = await modelWindow(ctx, "Reinforcement", "reinforcement-dialog");
        await win.getByRole("combobox", { name: "Type of the new pile" }).selectOption(type);
        await win.getByRole("region", { name: "Piles and sheet piles" }).getByRole("button", { name: "Add", exact: true }).click();
        await win.waitForTimeout(400);
        return { page: win };
      },
    }),
  ),
  { id: "win-piezo-empty", title: "Piezometric lines window, no water", area: "windows", open: async (ctx) => ({ page: await modelWindow(ctx, "Piezometric lines", "piezo-dialog") }) },
  { id: "win-piezo", title: "Piezometric lines window (review: head lines notice, rapid drawdown)", area: "windows", data: "review", open: async (ctx) => ({ page: await modelWindow(ctx, "Piezometric lines", "piezo-dialog") }) },
  { id: "win-piezo-v017b", title: "Piezometric lines window (V017b)", area: "windows", data: "v017b", open: async (ctx) => ({ page: await modelWindow(ctx, "Piezometric lines", "piezo-dialog") }) },
  { id: "win-parameters-empty", title: "Parameters window, empty", area: "windows", open: async (ctx) => ({ page: await modelWindow(ctx, "Parameters", "parameters-dialog") }) },
  {
    id: "win-parameters",
    title: "Parameters window with parameters",
    area: "windows",
    open: async (ctx) => {
      await ctx.store(`(s) => { s.addParameter(); s.addParameter(); const p = s.parameters; s.updateParameter(p[0].id, { name: "H", expression: "10" }); s.updateParameter(p[1].id, { name: "c_clay", expression: "H * 2.5" }); }`).catch(() => {});
      return { page: await modelWindow(ctx, "Parameters", "parameters-dialog") };
    },
  },
  { id: "win-search-limits", title: "Search limits window", area: "windows", open: async (ctx) => ({ page: await modelWindow(ctx, "Search limits", "search-limits-dialog") }) },
  {
    id: "win-search-limits-mismatch",
    title: "Search limits window with the limits-direction warning",
    area: "windows",
    open: async (ctx) => {
      await ctx.store(`(s) => s.setOrientation(s.orientation === "ltr" ? "rtl" : "ltr")`);
      return { page: await modelWindow(ctx, "Search limits", "search-limits-dialog") };
    },
  },
  { id: "win-custom-surfaces-empty", title: "Custom surfaces window, empty", area: "windows", open: async (ctx) => ({ page: await modelWindow(ctx, "Custom surfaces", "custom-search-planes-dialog") }) },
  {
    id: "win-custom-surfaces-circle",
    title: "Custom surfaces window with a circle",
    area: "windows",
    open: async (ctx) => {
      const win = await modelWindow(ctx, "Custom surfaces", "custom-search-planes-dialog");
      await win.getByText("+ Add circle").click();
      await win.waitForTimeout(300);
      return { page: win };
    },
  },
  {
    id: "win-custom-surfaces-polyline",
    title: "Custom surfaces window with a non-circular surface",
    area: "windows",
    open: async (ctx) => {
      const win = await modelWindow(ctx, "Custom surfaces", "custom-search-planes-dialog");
      await win.getByText("+ Add non-circular surface").click();
      await win.waitForTimeout(300);
      return { page: win };
    },
  },
  { id: "win-options", title: "Options window", area: "windows", also150: true, open: async (ctx) => ({ page: await modelWindow(ctx, "Options", "options-dialog") }) },
  {
    id: "win-options-expanded",
    title: "Options window with every optional group turned on (tension crack, FE, 3D, rapid drawdown, …)",
    area: "windows",
    data: "review",
    open: async (ctx) => {
      const win = await modelWindow(ctx, "Options", "options-dialog");
      await expandAll(win);
      await win.waitForTimeout(400);
      return { page: win, grow: true };
    },
  },
  {
    id: "win-options-mismatch",
    title: "Options window with the limits-direction warning",
    area: "windows",
    open: async (ctx) => {
      await ctx.store(`(s) => s.setOrientation(s.orientation === "ltr" ? "rtl" : "ltr")`);
      return { page: await modelWindow(ctx, "Options", "options-dialog") };
    },
  },
  { id: "win-results-plot", title: "Results plot window (slip surface variables)", area: "windows", result: true, open: async (ctx) => ({ page: await resultsWindow(ctx, "Results plot", "results-plot-dialog") }) },
  {
    id: "win-results-plot-lambda",
    title: "Results plot window, λ – Fm/Ff plot",
    area: "windows",
    data: "v085",
    result: true,
    open: async (ctx) => {
      const win = await resultsWindow(ctx, "Results plot", "results-plot-dialog");
      await win.locator('select:has(option[value="lambdaFmFf"])').selectOption("lambdaFmFf");
      await win.waitForTimeout(800);
      return { page: win };
    },
  },
  { id: "win-sensitivity", title: "Sensitivity analysis window", area: "windows", result: true, open: async (ctx) => ({ page: await resultsWindow(ctx, "Sensitivity", "sensitivity-dialog") }) },
  { id: "win-probabilistic", title: "Probabilistic analysis window", area: "windows", result: true, open: async (ctx) => ({ page: await resultsWindow(ctx, "Probabilistic", "reliability-dialog") }) },
  {
    id: "win-place-drawing-empty",
    title: "Place drawing window, no drawing",
    area: "windows",
    also150: true,
    open: async (ctx) => ({
      page: await ctx.window("place-drawing-dialog", async () => {
        await ctx.tab("Model");
        await ctx.click("Drawing");
      }),
    }),
  },
  { id: "win-place-drawing-image", title: "Place drawing window, an image (axes calibration)", area: "windows", open: async (ctx) => ({ page: await placeDrawingWith(ctx, ctx.files.png) }) },
  {
    id: "win-place-drawing-image-points",
    title: "Place drawing window, an image, points calibration",
    area: "windows",
    open: async (ctx) => {
      const win = await placeDrawingWith(ctx, ctx.files.png);
      await win.getByRole("radio", { name: "Points" }).click();
      return { page: win };
    },
  },
  {
    id: "win-place-drawing-image-scale",
    title: "Place drawing window, an image, scale calibration",
    area: "windows",
    open: async (ctx) => {
      const win = await placeDrawingWith(ctx, ctx.files.png);
      await win.getByRole("radio", { name: "Scale" }).click();
      return { page: win };
    },
  },
  {
    id: "win-place-drawing-image-crop",
    title: "Place drawing window, an image, crop tool on",
    area: "windows",
    open: async (ctx) => {
      const win = await placeDrawingWith(ctx, ctx.files.png);
      await win.getByRole("button", { name: "Crop", exact: true }).click();
      return { page: win };
    },
  },
  { id: "win-place-drawing-pdf", title: "Place drawing window, a PDF", area: "windows", open: async (ctx) => ({ page: await placeDrawingWith(ctx, ctx.files.pdf) }) },
  { id: "win-place-drawing-dwg", title: "Place drawing window, a DWG (drawing coordinates)", area: "windows", open: async (ctx) => ({ page: await placeDrawingWith(ctx, ctx.files.dwg) }) },
  {
    id: "win-place-drawing-dwg-axes",
    title: "Place drawing window, a DWG, axes calibration",
    area: "windows",
    open: async (ctx) => {
      const win = await placeDrawingWith(ctx, ctx.files.dwg);
      await win.getByRole("radio", { name: "Axes" }).click();
      return { page: win };
    },
  },
  {
    id: "win-place-drawing-project",
    title: "Place drawing window with the project's drawings (asset strip)",
    area: "windows",
    data: "drawings",
    open: async (ctx) => ({
      page: await ctx.window("place-drawing-dialog", async () => {
        await ctx.tab("Model");
        await ctx.click("Drawing");
      }),
    }),
  },
  {
    id: "win-new-models",
    title: "New models from drawing window",
    area: "windows",
    data: "drawings",
    open: async (ctx) => ({
      page: await ctx.window("place-drawing-dialog", async () => {
        await ctx.tab("Model");
        await ctx.click("More drawing commands");
        await menu(ctx, "More drawing commands").getByRole("menuitem", { name: "New models from drawing…" }).click();
      }),
    }),
  },
  {
    id: "win-new-models-empty",
    title: "New models from drawing window, no drawing",
    area: "windows",
    open: async (ctx) => ({
      page: await ctx.window("place-drawing-dialog", async () => {
        await ctx.tab("File");
        await ctx.click("Import");
        await menu(ctx, "Import").getByRole("menuitem", { name: "New models from drawing…" }).click();
      }),
    }),
  },
];

const dialogs: Scene[] = [
  {
    id: "dlg-model-properties",
    title: "Model properties dialog (one model)",
    area: "dialogs",
    data: "example",
    open: async (ctx) => {
      await ctx.page.getByRole("treeitem").nth(0).click({ button: "right" });
      await ctx.page.getByRole("menuitem", { name: "Model properties…" }).click();
      return { focus: ctx.page.getByRole("dialog") };
    },
  },
  {
    id: "dlg-model-properties-multi",
    title: "Model properties dialog (three models)",
    area: "dialogs",
    data: "example",
    open: async (ctx) => {
      const rows = ctx.page.getByRole("treeitem");
      await rows.nth(1).click({ modifiers: ["Control"] });
      await rows.nth(2).click({ modifiers: ["Control"] });
      await rows.nth(2).click({ button: "right" });
      await ctx.page.getByRole("menuitem", { name: "Model properties…" }).click();
      return { focus: ctx.page.getByRole("dialog") };
    },
  },
  {
    id: "dlg-anonymize",
    title: "Save as anonymized dialog",
    area: "dialogs",
    data: "drawings",
    open: async (ctx) => {
      await ctx.tab("File");
      await ctx.click("Save as anonymized…");
      return { focus: ctx.page.getByRole("dialog") };
    },
  },
  {
    id: "dlg-import-summary",
    title: "Import summary dialog (File › Import › DWG file…)",
    area: "dialogs",
    open: async (ctx) => {
      await ctx.tab("File");
      await ctx.click("Import");
      const chooser = ctx.page.waitForEvent("filechooser", { timeout: 8000 });
      await menu(ctx, "Import").getByRole("menuitem", { name: "DWG file…" }).click();
      await (await chooser).setFiles(ctx.files.dwg);
      await ctx.page.getByRole("dialog").waitFor({ timeout: 20_000 });
      return { focus: ctx.page.getByRole("dialog") };
    },
  },
  {
    id: "dlg-export-summary",
    title: "Export summary dialog (File › Export › .gsz file…)",
    area: "dialogs",
    data: "review",
    open: async (ctx) => {
      await ctx.page.evaluate(() => {
        // Keep the export in memory instead of saving it.
        HTMLAnchorElement.prototype.click = function () {};
      });
      await ctx.tab("File");
      await ctx.click("Export");
      await menu(ctx, "Export").getByRole("menuitem", { name: ".gsz file…" }).click();
      await ctx.page.getByRole("dialog").waitFor({ timeout: 20_000 });
      return { focus: ctx.page.getByRole("dialog") };
    },
    restartAfter: true,
  },
  {
    id: "dlg-about",
    title: "About cSlope (Help › About)",
    area: "dialogs",
    open: async (ctx) => {
      await ctx.tab("Help");
      await ctx.click("About");
      const dialog = ctx.page.getByRole("dialog", { name: "About cSlope" });
      await dialog.waitFor({ timeout: 10_000 });
      return { focus: dialog };
    },
  },
  {
    id: "dlg-confirm-delete-model",
    title: "Delete model confirmation (window.confirm, recorded as text)",
    area: "dialogs",
    data: "example",
    open: async (ctx) => {
      await ctx.page.getByRole("treeitem").nth(1).click({ button: "right" });
      await ctx.page.getByRole("menuitem", { name: /^Delete/ }).click();
      await ctx.wait(500);
      if (!ctx.nativeDialogs.length) throw new Error("No confirm box appeared");
    },
  },
  {
    id: "dlg-confirm-remove-drawing",
    title: "Remove a drawing (confirm or undo step, recorded as text)",
    area: "dialogs",
    data: "drawings",
    open: async (ctx) => {
      await ctx.page.getByRole("button", { name: /^Remove .* from the model$/ }).first().click().catch(async () => {
        const row = ctx.page.getByRole("group", { name: "Drawings of the model" }).first().getByRole("treeitem").first();
        await row.locator("xpath=descendant-or-self::*[contains(@title, 'click for its settings')]").first().click();
        await ctx.page.getByRole("button", { name: /^Remove .* from the model$/ }).first().click();
      });
      await ctx.wait(500);
      return { focus: explorer(ctx) };
    },
  },
  {
    id: "error-boundary",
    title: "ErrorBoundary page (a render error)",
    area: "dialogs",
    open: async (ctx) => {
      await ctx.store(`(s, store) => store.setState({ models: null })`).catch(() => {});
      await ctx.wait(800);
      await ctx.page.getByText("cSlope ran into an error").waitFor({ timeout: 5000 });
    },
    restartAfter: true,
  },
];

export const SCENES: Scene[] = [...mainEdit, ...mainResult, ...sidebarScenes, ...menus, ...canvasScenes, ...windows, ...dialogs];
