#!/usr/bin/env bun
/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate() and app.evaluate() run in other processes without type imports */
/**
 * The manual beta checklist, run in the real desktop app: opens, saves and
 * reopens projects (also after a restart), imports and exports every format
 * through the File menu, edits materials, water, options and loads in their
 * dialog windows, undoes with Ctrl+Z, runs, and exports the PDF. Each step
 * is checked against the factor of safety the checklist expects (to three
 * decimals, as the status bar shows it) or the behaviour it describes, and
 * the meaningful states are captured as images.
 *
 *   bun packages/desktop/tools/design-capture/beta-checklist.ts <output folder> <beta-test folder>
 *
 * The beta-test folder holds files/ (the projects and their .stix, .slim
 * and .gsz exports), expected.json and variants.json (the factors of safety
 * after the checklist's edits). Run under a virtual display as capture.ts
 * (README.md). The app is started through Playwright's Electron launcher,
 * so the main process can answer its native dialogs: the open and save
 * dialogs return prepared paths, message boxes return a prepared button,
 * and downloads (exports, the PDF) are saved to the output folder or
 * cancelled. Every dialog the app asked is recorded.
 *
 * Writes results.md (step, expected, got, pass or fail, image) and
 * index.html (the contact sheet) to the output folder.
 */

import { _electron, type ElectronApplication, type Page } from "playwright";
import { readZip } from "../../src/utils/zip";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { DESKTOP_DIR, Rig, buildApp, setSize, growToContent, closeOthers, ribbonTab, clickNamed, findWindow, store } from "./lib";
import { writeContactSheet } from "./contact-sheet";

const OUT = resolve(process.argv[2] ?? "beta-checklist-run");
const BETA = resolve(process.argv[3] ?? ".");
const FILES = join(BETA, "files");
const MAIN_W = 1600, MAIN_H = 1000;

interface Expected {
  key: string;
  title: string;
  fCircle?: number;
  fSearch: number;
  fWithoutFeature?: number;
  imports?: Record<"stix" | "slim" | "gsz", { exportNotes: string[]; importNotes: string[]; method: string; fAsImported: number; planes: number }>;
}
const EXPECTED: Expected[] = JSON.parse(readFileSync(join(BETA, "expected.json"), "utf-8"));
const VARIANTS: Record<string, number> = JSON.parse(readFileSync(join(BETA, "variants.json"), "utf-8"));
const exp = (key: string) => EXPECTED.find((e) => e.key === key)!;
const file = (name: string) => join(FILES, name);

// ── Results ────────────────────────────────────────────────────────────

interface Result {
  id: string;
  step: string;
  expected: string;
  got: string;
  /** true pass, false fail, null: information or not possible here. */
  pass: boolean | null;
  shots: string[];
}
const results: Result[] = [];
let rig: Rig;

/** The images taken since `from` (index into rig.shots). */
const shotsSince = (from: number) => rig.shots.slice(from).map((s) => s.file).filter((f): f is string => !!f);

function record(id: string, step: string, expected: string, got: string, pass: boolean | null, from?: number) {
  const r: Result = { id, step, expected, got, pass, shots: from === undefined ? [] : shotsSince(from) };
  results.push(r);
  const mark = pass === true ? "PASS" : pass === false ? "FAIL" : "INFO";
  rig.say(`  [${mark}] ${id} ${step}: expected ${expected}; got ${got}`);
  if (pass === false) rig.shots.push({ file: null, title: `${id} FAIL: ${step}`, section: rig.section, error: `expected ${expected}; got ${got}` });
  else rig.note(`${id} ${mark}`, `${step}\nexpected: ${expected}\ngot: ${got}`);
}

/** Check a factor of safety as displayed (three decimals). */
function checkF(id: string, step: string, expected: number, got: string | null, from?: number, tol = 0.0005) {
  const ok = got !== null && Math.abs(Number(got) - expected) <= tol + 1e-9;
  record(id, step, `F = ${expected.toFixed(3)}${tol > 0.001 ? ` (±${tol})` : ""}`, got === null ? "no F" : `F = ${got}`, ok, from);
  return ok;
}

/** Run one checklist step; an exception is recorded as a failure. */
let skipping = !!process.env.BETA_START_AT;
async function step(id: string, title: string, fn: () => Promise<void>) {
  // BETA_START_AT=<step id>: skip the steps before it (to rerun a part).
  if (skipping && id === process.env.BETA_START_AT) skipping = false;
  if (skipping) return;
  const from = rig.shots.length;
  try {
    await fn();
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).split("\n")[0];
    try {
      await rig.shot(page(), `${id}-error`, `${id}: state at the error`);
    } catch {
      /* the window may be gone */
    }
    record(id, title, "step completes", `error: ${msg}`, false, from);
  }
}

// ── App and its native dialogs ─────────────────────────────────────────

let app: ElectronApplication;
let main: Page;
const page = () => main;

interface DialogCall {
  kind: "open" | "save" | "message" | "error";
  title?: string;
  message?: string;
  detail?: string;
  buttons?: string[];
  defaultPath?: string;
  answer?: unknown;
}

/**
 * Replace the main process's native dialogs with answers from queues, and
 * save downloads to a folder (or cancel them), recording each.
 */
async function installStubs(a: ElectronApplication, downloadDir: string) {
  await a.evaluate(({ dialog, session }, downloadDir) => {
    const g = globalThis as any;
    const pathMod = (process as any).getBuiltinModule("node:path");
    g.__beta = { open: [], save: [], msg: [], calls: [], downloads: [], downloadPlan: [], downloadDir };
    const opts = (a: any[]) => (a.length > 1 && a[1] && typeof a[1] === "object" ? a[1] : a[0]) ?? {};
    (dialog as any).showOpenDialog = async (...a: any[]) => {
      const o = opts(a);
      const p = g.__beta.open.shift();
      g.__beta.calls.push({ kind: "open", title: o.title, answer: p ?? "cancel" });
      return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] };
    };
    (dialog as any).showSaveDialog = async (...a: any[]) => {
      const o = opts(a);
      const p = g.__beta.save.shift();
      g.__beta.calls.push({ kind: "save", title: o.title, defaultPath: o.defaultPath, answer: p ?? "cancel" });
      return p ? { canceled: false, filePath: p } : { canceled: true, filePath: "" };
    };
    (dialog as any).showMessageBox = async (...a: any[]) => {
      const o = opts(a);
      // Unsaved changes: "Don't save" unless a test queued another answer.
      const r = g.__beta.msg.length ? g.__beta.msg.shift() : o.title === "Unsaved changes" ? 1 : (o.cancelId ?? 0);
      g.__beta.calls.push({ kind: "message", title: o.title, message: o.message, detail: o.detail, buttons: o.buttons, answer: o.buttons?.[r] ?? r });
      return { response: r, checkboxChecked: false };
    };
    (dialog as any).showErrorBox = (title: string, message: string) => {
      g.__beta.calls.push({ kind: "error", title, message });
    };
    session.defaultSession.on("will-download", (_e: any, item: any) => {
      const plan = g.__beta.downloadPlan.shift() ?? g.__beta.downloadDir;
      const name = item.getFilename();
      if (plan === "cancel") {
        g.__beta.downloads.push({ name, path: null, state: "cancelled (save dialog cancelled)" });
        item.cancel();
        return;
      }
      const p = pathMod.join(plan, name);
      item.setSavePath(p);
      item.once("done", (_ev: any, state: string) => g.__beta.downloads.push({ name, path: p, state }));
    });
  }, downloadDir);
}

async function queue(kind: "open" | "save" | "msg" | "downloadPlan", value: unknown) {
  await app.evaluate((_e, { kind, value }) => (globalThis as any).__beta[kind].push(value), { kind, value });
}
/** The native dialogs asked since the last call. */
async function takeCalls(): Promise<DialogCall[]> {
  return app.evaluate(() => {
    const g = (globalThis as any).__beta;
    return g.calls.splice(0);
  });
}
async function takeDownloads(waitMs = 8000): Promise<{ name: string; path: string | null; state: string }[]> {
  const end = Date.now() + waitMs;
  let list: any[] = [];
  while (Date.now() < end) {
    list = await app.evaluate(() => (globalThis as any).__beta.downloads.slice());
    if (list.length) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await app.evaluate(() => (globalThis as any).__beta.downloads.splice(0));
  return list;
}
async function windowTitle(): Promise<string> {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes("#") && w.webContents.getURL().includes("index.html"));
    return w?.getTitle() ?? "";
  });
}

const electronPath = createRequire(join(DESKTOP_DIR, "package.json"))("electron") as unknown as string;

/**
 * Start the app. `capture` false: as a user starts it (splash, the
 * unsaved-changes prompt on close).
 */
async function start(opts: { capture?: boolean; extraArgs?: string[]; scale?: number } = {}) {
  const capture = opts.capture ?? true;
  const env: Record<string, string> = { ...(process.env as Record<string, string>), VITE_DEV_SERVER_URL: "" };
  if (capture) env.CSLOPE_CAPTURE = "1";
  else delete env.CSLOPE_CAPTURE;
  app = await _electron.launch({
    executablePath: electronPath,
    args: [
      DESKTOP_DIR,
      `--force-device-scale-factor=${opts.scale ?? 1}`,
      ...(process.env.CSLOPE_CAPTURE_NO_SANDBOX ? ["--no-sandbox"] : []),
      ...(opts.extraArgs ?? []),
    ],
    cwd: DESKTOP_DIR,
    env,
  });
  mkdirSync(join(OUT, "exports"), { recursive: true });
  await installStubs(app, join(OUT, "exports"));
  let found: Page | undefined;
  for (let i = 0; i < 300 && !found; i++) {
    found = app.windows().find((w) => w.url().includes("index.html") && !w.url().includes("#"));
    if (!found) await new Promise((r) => setTimeout(r, 100));
  }
  if (!found) throw new Error("The main window did not open");
  main = found;
  await main.waitForLoadState("domcontentloaded");
  await main.waitForFunction(() => (window as any).__CSLOPE_CAPTURE_READY__ === true, undefined, { timeout: 30_000 });
  if (rig) (rig as any).page = main;
  main.on("pageerror", (e) => rig?.say(`  [renderer error] ${e.message}`));
  main.on("dialog", async (d) => {
    // A confirm is answered by the main process stub (its queue); an alert is a message.
    if (d.type() === "alert") lastAlert = d.message();
    rig?.say(`  [renderer ${d.type()}] ${d.message().slice(0, 200)}`);
    await d.accept().catch(() => {});
  });
  await main.evaluate(() => {
    localStorage.setItem("cslope-theme", localStorage.getItem("cslope-theme") ?? "light");
  });
  if ((opts.scale ?? 1) === 1) await setSize(main, MAIN_W, MAIN_H);
  await main.waitForTimeout(800);
  return main;
}
let lastAlert: string | null = null;

async function quit() {
  await app.close().catch(() => {});
}

// ── Main window actions ────────────────────────────────────────────────

async function focusMain() {
  await main.bringToFront();
  await main.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
}

/** File › Open (or Ctrl+O) with the open dialog answering `path`. */
async function openProject(path: string, via: "menu" | "key" = "key") {
  await closeOthers(main);
  await queue("open", path);
  await focusMain();
  if (via === "menu") {
    await ribbonTab(main, "File");
    await clickNamed(main, "Open");
  } else {
    await main.keyboard.press("Control+o");
  }
  const name = basename(path);
  await main.waitForFunction(() => true);
  await main.waitForTimeout(1200);
  const calls = await takeCalls();
  if (!calls.some((c) => c.kind === "open")) throw new Error(`No open dialog was asked for ${name}`);
  return calls;
}

/** The status bar's factor of safety, as shown (three decimals), or null. */
async function shownF(): Promise<string | null> {
  const t = await main.evaluate(() => document.body.innerText);
  return t.match(/FOS:\s*([0-9]+\.[0-9]{3})/)?.[1] ?? null;
}

/** Press Run and wait for the result; returns the F the status bar shows. */
async function run(): Promise<string | null> {
  await closeOthersKeepNone();
  await focusMain();
  try {
    await clickNamed(main, /run analysis and view results/i);
  } catch {
    rig.say("  - Run button not found; running through the store");
    await main.evaluate(() => (window as any).__CSLOPE_STORE__.getState().runAnalysis());
  }
  await main.waitForFunction(
    () => {
      const s = (window as any).__CSLOPE_STORE__.getState();
      return s.runState === "done" || s.runState === "error";
    },
    undefined,
    { timeout: 300_000 },
  );
  const state = await store<{ runState: string; error?: string }>(main, "(s) => ({ runState: s.runState, error: s.errorMessage })");
  await main.waitForTimeout(900);
  if (state.runState === "error") return `error: ${state.error}`;
  return shownF();
}
/** Dialog windows stay open across a run (they are separate windows). */
async function closeOthersKeepNone() {
  await main.waitForTimeout(100);
}

async function undo(times = 1) {
  await focusMain();
  for (let i = 0; i < times; i++) {
    await main.keyboard.press("Control+z");
    await main.waitForTimeout(350);
  }
  await main.waitForTimeout(400);
}

/** A ribbon dialog window from the Model tab (the preload API if the button is not found). */
async function openDialog(label: string, hash: string, api: string): Promise<Page> {
  await closeOthers(main);
  try {
    await ribbonTab(main, "Model");
    await clickNamed(main, label);
  } catch (e) {
    rig.say(`  - ribbon button "${label}" not found (${(e as Error).message}); opening #${hash} through window.cslope.${api}()`);
    await main.evaluate((api) => (window as any).cslope[api](), api);
  }
  const w = await findWindow(main, hash);
  await setSize(w, Math.max(560, await w.evaluate(() => window.innerWidth)), Math.max(640, await w.evaluate(() => window.innerHeight)));
  return w;
}
const materialsDialog = () => openDialog("Materials", "materials-dialog", "openMaterialsDialog");
const piezoDialog = () => openDialog("Piezometric lines", "piezo-dialog", "openPiezoDialog");
const optionsDialog = () => openDialog("Options", "options-dialog", "openOptionsDialog");
const udlDialog = () => openDialog("UDL", "udl-dialog", "openUdlDialog");
const lineLoadsDialog = () => openDialog("Line loads", "line-loads-dialog", "openLineLoadsDialog");
const customPlanesDialog = () => openDialog("Custom planes", "custom-search-planes-dialog", "openCustomSearchPlanesDialog");

async function selectMaterial(d: Page, name: string) {
  const input = d.locator(`input[aria-label="Material name"][value="${name}"]`).first();
  if (!(await input.count())) throw new Error(`No material "${name}" in the table`);
  const row = input.locator("xpath=ancestor::tr[1]");
  const cells = row.locator("td");
  if ((await cells.count()) > 1) await cells.nth(1).click();
  else await row.click();
  await d.waitForTimeout(400);
}

/** Type into a field as a user does: select all, type, Tab. */
async function typeInto(d: Page, label: string, text: string) {
  const f = d.getByLabel(label, { exact: true }).first();
  await f.click();
  await d.keyboard.press("Control+a");
  if (text === "") await d.keyboard.press("Delete");
  else await d.keyboard.type(text);
  await d.keyboard.press("Tab");
  await d.waitForTimeout(600);
}

async function notes(d: Page): Promise<string[]> {
  return d.getByRole("note").allInnerTexts().catch(() => []);
}
async function alerts(d: Page): Promise<string[]> {
  return d.getByRole("alert").allInnerTexts().catch(() => []);
}

const activeModel = (fn: string) => store<any>(main, `(s) => { const m = s.models.find((m) => m.id === s.activeModelId); return (${fn})(m, s); }`);

// ── Import and export through the File menu ────────────────────────────

/** Wait for the summary dialog, record its text and image, close it. */
async function summary(name: string, title: string): Promise<string> {
  const dialog = main.getByRole("dialog");
  const end = Date.now() + 20_000;
  while (Date.now() < end && !(await dialog.count()) && lastAlert === null) await main.waitForTimeout(200);
  if (lastAlert !== null) {
    const t = lastAlert;
    lastAlert = null;
    rig.writeFile(`text/${name}.txt`, t);
    await rig.shot(main, `${name}-alert`, `${title}: message box`, t.slice(0, 300));
    return t;
  }
  if (!(await dialog.count())) {
    await rig.shot(main, `${name}-no-summary`, `${title}: no summary appeared`);
    return "";
  }
  const text = await dialog.first().innerText().catch(() => "");
  rig.writeFile(`text/${name}.txt`, text);
  await rig.shot(main, name, title);
  // The summary's own Close (the title bar has a "Close" button too).
  await dialog.first().getByRole("button", { name: "Close", exact: true }).last().click().catch(() => main.keyboard.press("Escape"));
  await main.waitForTimeout(400);
  return text;
}

async function importVia(menu: RegExp, path: string, name: string, title: string) {
  await closeOthers(main);
  lastAlert = null;
  await ribbonTab(main, "File");
  await clickNamed(main, "Import");
  const chooser = main.waitForEvent("filechooser", { timeout: 8000 });
  await clickNamed(main, menu);
  await (await chooser).setFiles(path);
  return summary(name, title);
}

const MENU = { stix: /^\.stix file/i, slim: /^\.sli\/\.slim/i, gsz: /^\.gsz file/i, dxf: /^DXF file/i } as const;
const EXPORT_MENU = { stix: /^\.stix file/i, slim: /^\.slim file/i, gsz: /^\.gsz file/i } as const;

async function exportVia(fmt: "stix" | "slim" | "gsz", name: string, title: string, plan?: string) {
  await closeOthers(main);
  lastAlert = null;
  if (plan) await queue("downloadPlan", plan);
  await ribbonTab(main, "File");
  await clickNamed(main, "Export");
  await clickNamed(main, EXPORT_MENU[fmt]);
  const text = await summary(name, title);
  const downloads = await takeDownloads(plan === "cancel" ? 3000 : 8000);
  return { text, downloads };
}

const modelCount = () => store<number>(main, "(s) => s.models.length");

// ── The checklist ──────────────────────────────────────────────────────

const FEATURES = EXPECTED.filter((e) => e.fCircle !== undefined);

async function partA() {
  // A1: start, version, close prompt (as a user starts it: no capture mode)
  rig.section = "A1 Start and close";
  await step("A1.2", "start: splash, main window, version", async () => {
    const from = rig.shots.length;
    await start({ capture: false });
    const splash = app.windows().find((w) => !w.url().includes("index.html"));
    const version = await app.evaluate(({ app }) => app.getVersion());
    await main.waitForTimeout(1500);
    const shown = (await main.evaluate(() => document.body.innerText)).match(/cSlope v([^\s]+)/)?.[1] ?? "none";
    await rig.shot(main, "a1-main-window", "Main window after start (no capture mode)");
    record("A1.2", "version in the status bar = installed version", `v${version}`, `v${shown}${splash ? ", splash window seen" : ", splash already closed when checked"}`, shown === version, from);
  });
  await step("A1.3a", "close without changes: no question", async () => {
    await takeCalls();
    const closed = app.waitForEvent("close", { timeout: 10_000 }).then(() => true).catch(() => false);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("index.html") && !w.webContents.getURL().includes("#"))?.close());
    const didClose = await closed;
    const calls = didClose ? [] : await takeCalls();
    record("A1.3a", "close (×) without changes", "app closes, no question", `${didClose ? "app closed" : "app still open"}; ${calls.length ? `asked: ${calls.map((c) => c.message).join("; ")}` : "no question"}`, didClose && !calls.length);
    if (!didClose) await quit();
  });
  await step("A1.3b", "close with a change: Save / Don't Save / Cancel; Cancel keeps the app open", async () => {
    const from = rig.shots.length;
    await start({ capture: false });
    // a change: move a point of the ground (the first model's second point up 0.5 m)
    await main.evaluate(() => {
      const s = (window as any).__CSLOPE_STORE__.getState();
      const c = s.coordinates.map((p: number[]) => [...p]);
      c[1][1] += 0.5;
      s.setCoordinates(c);
    });
    await main.waitForTimeout(500);
    await rig.shot(main, "a1-changed", "After moving a point (unsaved)");
    await queue("msg", 2); // Cancel
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("index.html") && !w.webContents.getURL().includes("#"))?.close());
    await main.waitForTimeout(1500);
    const calls = await takeCalls();
    const box = calls.find((c) => c.kind === "message");
    const open = !main.isClosed();
    record(
      "A1.3b",
      "close with a change, answer Cancel",
      'question "Save / Don\'t Save / Cancel"; app stays open',
      `${box ? `"${box.message}" [${box.buttons?.join(" / ")}]` : "no question"}; app ${open ? "still open" : "closed"}`,
      !!box && JSON.stringify(box.buttons) === JSON.stringify(["Save", "Don't save", "Cancel"]) && open,
      from,
    );
    await queue("msg", 1); // Don't Save
    const closed = app.waitForEvent("close", { timeout: 10_000 }).then(() => true).catch(() => false);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("index.html") && !w.webContents.getURL().includes("#"))?.close());
    const didClose = await closed;
    record("A1.3c", "close again, answer Don't Save", "app closes", didClose ? "app closed" : "app still open", didClose);
    if (!didClose) await quit();
  });

  // The rest in capture mode (no splash; native dialogs answered by the stubs).
  await start();

  rig.section = "A2 Open and run";
  for (const [i, f] of FEATURES.entries()) {
    await step(`A2.${f.key.slice(0, 2)}`, `open ${f.key}.json and run`, async () => {
      const from = rig.shots.length;
      await openProject(file(`${f.key}.json`), i === 0 ? "menu" : "key");
      const title = await windowTitle();
      const name = await activeModel("(m) => m?.name");
      await rig.shot(main, `a2-${f.key}-open`, `${f.key}.json opened`, `window title "${title}", model "${name}"`);
      const got = await run();
      await rig.shot(main, `a2-${f.key}-result`, `${f.key}: result`);
      checkF(`A2.${f.key.slice(0, 2)}`, `${f.key}.json run (title "${title}")`, f.fCircle!, got, from);
      if (title !== `${f.key} — cSlope`) record(`A2.${f.key.slice(0, 2)}t`, `${f.key}: window title`, `"${f.key} — cSlope"`, `"${title}"`, false);
    });
  }

  rig.section = "A3 Save and open again";
  const saved = join(OUT, "saved", "ny mapp");
  mkdirSync(saved, { recursive: true });
  const pop20 = join(saved, "test-pop20.cslp");
  await step("A3.1", "04: POP 10 → 20, run", async () => {
    const from = rig.shots.length;
    await openProject(file("04-shansep-excavation.json"));
    const d = await materialsDialog();
    await selectMaterial(d, "Soft clay");
    await growToContent(d);
    const pop = d.getByLabel("POP (kPa)", { exact: true });
    const popValue = (await pop.count()) ? await pop.inputValue() : null;
    await rig.shot(d, "a3-soft-clay", "Soft clay before the change", popValue !== null ? `POP field: ${popValue}` : "no POP field");
    record("A3.1a", "Material › Soft clay: the POP field shows 10", "an editable POP field, 10", popValue !== null ? `POP field: ${popValue}` : "no POP field", popValue === "10", from);
    await typeInto(d, "POP (kPa)", "20");
    const stored = await store<number>(main, '(s) => s.materials.find((m) => m.name === "Soft clay").model.pop');
    await growToContent(d);
    await rig.shot(d, "a3-pop20", "Soft clay: POP 20 typed", `stored POP ${stored}; ${(await notes(d)).join(" | ")}`);
    await closeOthers(main);
    const got = await run();
    await rig.shot(main, "a3-pop20-result", "POP 20: result");
    checkF("A3.1", `04 with POP 20 typed in the field (stored ${stored})`, VARIANTS["04 POP 20"], got, from);
  });
  await step("A3.2", "Save As (Ctrl+Shift+S): title shows the file name", async () => {
    await queue("save", pop20);
    await focusMain();
    await main.keyboard.press("Control+Shift+s");
    await main.waitForTimeout(1500);
    const calls = await takeCalls();
    const title = await windowTitle();
    const sv = calls.find((c) => c.kind === "save");
    record("A3.2", "Save As → test-pop20.cslp in a new folder", 'save dialog; file written; title "test-pop20 — cSlope"', `${sv ? `save dialog (default name "${sv.defaultPath}")` : "NO save dialog"}; file ${existsSync(pop20) ? "written" : "MISSING"}; title "${title}"`, !!sv && existsSync(pop20) && title === "test-pop20 — cSlope");
  });
  await step("A3.3", "restart, open test-pop20.cslp, run; stage tag and note kept", async () => {
    const from = rig.shots.length;
    await quit();
    await start();
    await openProject(pop20);
    const title = await windowTitle();
    const got = await run();
    await rig.shot(main, "a3-reopened-result", "test-pop20.cslp after a restart: result", `title "${title}"`);
    checkF("A3.3", "test-pop20.cslp after a restart", VARIANTS["04 POP 20"], got, from);
    const from2 = rig.shots.length;
    const d = await materialsDialog();
    await selectMaterial(d, "Soft clay");
    await growToContent(d);
    const n = await notes(d);
    const tag = await d.getByTestId("stage-tag").count();
    await rig.shot(d, "a3-reopened-materials", "Materials after reopening", n.join(" | "));
    record("A3.3b", "materials after reopening", '"stage" tag and earlier-stage note, POP 20', `${tag ? "stage tag shown" : "NO stage tag"}; notes: ${n.join(" | ") || "none"}`, tag > 0 && n.some((t) => /earlier stage was imported/i.test(t)) && n.some((t) => /POP 20/.test(t)), from2);
  });
  await step("A3.4", "change, Ctrl+S saves to the same file without a dialog", async () => {
    await closeOthers(main);
    const before = statSync(pop20).mtimeMs;
    await main.evaluate(() => {
      const s = (window as any).__CSLOPE_STORE__.getState();
      const m = s.models.find((m: any) => m.id === s.activeModelId);
      s.renameModel?.(m.id, "SHANSEP excavation (edited)");
    });
    await main.waitForTimeout(600);
    // The title marks the unsaved change, in the window's title bar and the system's.
    const barTitle = () => main.getByText(/— cSlope$/).first().innerText().catch(() => "?");
    const dirtyTitles = [await windowTitle(), await barTitle()];
    await rig.shot(main, "a3-unsaved-title", "An unsaved change: the title bar", dirtyTitles.join(" | "));
    await focusMain();
    await main.keyboard.press("Control+s");
    await main.waitForTimeout(1500);
    const cleanTitles = [await windowTitle(), await barTitle()];
    record("A3.4t", "title with an unsaved change, then after Ctrl+S", '"*test-pop20 — cSlope", then "test-pop20 — cSlope" (system title and title bar)', `${dirtyTitles.join(" | ")} → ${cleanTitles.join(" | ")}`, dirtyTitles.every((t) => t === "*test-pop20 — cSlope") && cleanTitles.every((t) => t === "test-pop20 — cSlope"));
    const calls = await takeCalls();
    const after = statSync(pop20).mtimeMs;
    // A .cslp file is a ZIP archive: the model names are in models/<id>/model.json.
    const entries = await readZip(new Uint8Array(readFileSync(pop20)), (n) => /^models\/[^/]+\/model\.json$/.test(n));
    const content = [...entries.values()].map((e) => new TextDecoder().decode(e)).join("\n");
    record("A3.4", "Ctrl+S after a change", "saved to test-pop20.cslp, no dialog", `${calls.length ? `dialogs: ${calls.map((c) => c.kind).join(", ")}` : "no dialog"}; file ${after > before ? "rewritten" : "NOT rewritten"}${content.includes("(edited)") ? " with the change" : " (change not in the file)"}`, !calls.length && after > before && content.includes("(edited)"));
  });
  await step("A3.5", "alla-funktioner.json: eight models, switch and run", async () => {
    const from = rig.shots.length;
    await openProject(file("alla-funktioner.json"));
    const names = await main.getByRole("treeitem").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    await rig.shot(main, "a3-all-models", "alla-funktioner.json: the tree", names.join(", "));
    record("A3.5a", "alla-funktioner.json: models in the tree", "8 models", `${names.length}: ${names.join(", ")}`, names.length === 8, from);
    for (const f of FEATURES) {
      const from2 = rig.shots.length;
      await main.getByRole("treeitem", { name: f.title, exact: true }).first().click();
      await main.waitForTimeout(500);
      const got = await run();
      if (f.key.startsWith("04") || f.key.startsWith("08")) await rig.shot(main, `a3-all-${f.key}`, `alla-funktioner: ${f.title} run`);
      checkF(`A3.5-${f.key.slice(0, 2)}`, `alla-funktioner: switch to "${f.title}" and run`, f.fCircle!, got, from2);
    }
  });

  rig.section = "A4 Import";
  const imports: [string, "stix" | "slim" | "gsz", number, RegExp[]][] = [
    ["04-shansep-excavation", "stix", exp("04-shansep-excavation").imports!.stix.fAsImported, [/earlier stage/i, /POP/]],
    ["06-rapid-drawdown", "slim", exp("06-rapid-drawdown").imports!.slim.fAsImported, [/drawdown/i]],
    ["02-bbar-fill", "gsz", exp("02-bbar-fill").imports!.gsz.fAsImported, [/surcharge|distributed|UDL/i, /slip surface|custom/i]],
    ["03-waternet", "stix", exp("03-waternet").imports!.stix.fAsImported, []],
  ];
  for (const [key, fmt, f, phrases] of imports) {
    const id = `A4-${key.slice(0, 2)}.${fmt}`;
    await step(id, `import ${key}.${fmt}`, async () => {
      const from = rig.shots.length;
      const before = await modelCount();
      const text = await importVia(MENU[fmt], file(`${key}.${fmt}`), `a4-import-${key}-${fmt}`, `Import ${key}.${fmt}: summary`);
      const after = await modelCount();
      const method = await activeModel("(m, s) => s.options?.method ?? m?.options?.method");
      // The summary names the method the model got (e.g. Bishop from a .stix file).
      const methodPhrase = new RegExp(`method ${exp(key).imports![fmt].method.replace(/[-]/g, "\\-")}`);
      const missing = [...phrases, methodPhrase].filter((p) => !p.test(text)).map((p) => p.source);
      record(`${id}a`, `import ${key}.${fmt}: summary`, `summary mentions ${[...phrases, methodPhrase].map((p) => p.source).join(", ")}; model added`, `${missing.length ? `MISSING ${missing.join(", ")}` : "all mentioned"}; models ${before} → ${after}; method ${method}`, !missing.length && after === before + 1, from);
      const from2 = rig.shots.length;
      if (key.startsWith("03")) {
        const d = await piezoDialog();
        await growToContent(d);
        const n = await notes(d);
        await rig.shot(d, `a4-${key}-piezo`, `${key}.${fmt} imported: Piezometric lines`, n.join(" | "));
        record(`${id}p`, `${key}.${fmt}: Piezometric lines shows the head-line notice`, '"Pore pressure comes from … head lines …"', n.join(" | ") || "no notice", n.some((t) => /head lines/.test(t)));
        await closeOthers(main);
      }
      const got = await run();
      await rig.shot(main, `a4-${key}-${fmt}-result`, `${key}.${fmt} imported: result`);
      checkF(id, `${key}.${fmt} imported (${method}), run`, f, got, from2);
      if (key.startsWith("04") && method !== "Bishop") record(`${id}m`, "method after the .stix import", "Bishop", method, false);
    });
  }
  await step("A4.props", "imported model: Properties shows the import notes", async () => {
    const from = rig.shots.length;
    await closeOthers(main);
    const target = "Calculation 1 (04-shansep-excavation)";
    await main.getByRole("treeitem", { name: target, exact: true }).first().click({ button: "right" });
    await main.waitForTimeout(400);
    await rig.shot(main, "a4-context-menu", `Right click on the imported model "${target}"`);
    await main.getByRole("menuitem", { name: /Properties/ }).first().click();
    await main.waitForTimeout(600);
    const n = await main.getByTestId("import-notes").innerText().catch(() => "");
    await rig.shot(main, "a4-properties", "Model properties of the imported model");
    record("A4.props", "right click › Properties: import notes", "import notes listed", n ? n.replace(/\s+/g, " ").slice(0, 200) : "no import notes", !!n, from);
    await main.keyboard.press("Escape");
    await main.waitForTimeout(300);
  });
  await step("A4.undo", "Ctrl+Z does not remove an import; delete in the tree", async () => {
    const from = rig.shots.length;
    const before = await modelCount();
    await undo(1);
    const afterUndo = await modelCount();
    const active = await activeModel("(m) => m.name");
    await main.getByRole("treeitem", { name: active, exact: true }).first().click({ button: "right" });
    await main.waitForTimeout(300);
    await queue("msg", 0); // OK in the confirm box
    await main.getByRole("menuitem", { name: /^Delete/ }).first().click();
    await main.waitForTimeout(800);
    const calls = await takeCalls();
    const afterDelete = await modelCount();
    await rig.shot(main, "a4-after-delete", "After deleting the imported model in the tree");
    record("A4.undo", "Ctrl+Z after the import, then Delete in the tree", "Ctrl+Z keeps the imported model; Delete removes it", `models ${before} → ${afterUndo} after Ctrl+Z → ${afterDelete} after Delete${calls.length ? ` (asked: ${calls.map((c) => c.message).join("; ")})` : ""}`, afterUndo === before && afterDelete === before - 1, from);
  });

  rig.section = "A5 Export";
  const exportDir = join(OUT, "exports", "a5");
  mkdirSync(exportDir, { recursive: true });
  const exported: Record<string, string> = {};
  for (const fmt of ["stix", "slim", "gsz"] as const) {
    await step(`A5.${fmt}`, `03-waternet: export .${fmt}`, async () => {
      const from = rig.shots.length;
      await openProject(file("03-waternet.json"));
      const { text, downloads } = await exportVia(fmt, `a5-export-${fmt}`, `Export .${fmt} of 03-waternet: summary`, exportDir);
      const dl = downloads[0];
      if (dl?.path) exported[fmt] = dl.path;
      const wantName = `Clay over aquifer.${fmt}`;
      const headNote = fmt === "stix" || /head (and reference )?lines?/i.test(text);
      record(`A5.${fmt}`, `export .${fmt}`, `file "${wantName}" saved; summary${fmt !== "stix" ? " says the head lines are not written" : ""}`, `${dl ? `"${dl.name}" ${dl.state}` : "NO download"}; ${headNote ? "summary ok" : "summary does NOT mention the head lines"}`, !!dl && dl.name === wantName && dl.state === "completed" && headNote, from);
    });
  }
  for (const fmt of ["stix", "slim", "gsz"] as const) {
    await step(`A5.3-${fmt}`, `import the exported .${fmt}`, async () => {
      if (!exported[fmt]) throw new Error("the export was not saved");
      const from = rig.shots.length;
      await importVia(MENU[fmt], exported[fmt], `a5-reimport-${fmt}`, `Import the exported .${fmt}: summary`);
      const got = await run();
      await rig.shot(main, `a5-reimport-${fmt}-result`, `Exported .${fmt} imported again: result`);
      checkF(`A5.3-${fmt}`, `exported .${fmt} imported again`, { stix: 1.091, slim: 1.473, gsz: 1.473 }[fmt], got, from);
    });
  }
  await step("A5.4", "cancel the save dialog of an export", async () => {
    const from = rig.shots.length;
    const { text, downloads } = await exportVia("stix", "a5-export-cancelled", "Export .stix, save dialog cancelled: summary", "cancel");
    const claims = /saved|written to/i.test(text);
    record("A5.4", "export, cancel the save dialog", "no file; no message saying it was saved", `${downloads.map((d) => `${d.name}: ${d.state}`).join(", ") || "no download"}; summary: "${text.split("\n").find((l) => /Prepared|saved/i.test(l)) ?? text.slice(0, 80)}"`, downloads.every((d) => !d.path) && !claims, from);
  });

  rig.section = "A6 Materials";
  await step("A6.1", "04: Soft clay notice, stage tag, override note", async () => {
    const from = rig.shots.length;
    await openProject(file("04-shansep-excavation.json"));
    const d = await materialsDialog();
    await selectMaterial(d, "Soft clay");
    await growToContent(d);
    const n = await notes(d);
    const tag = await d.getByTestId("stage-tag").count();
    await rig.shot(d, "a6-soft-clay", "04 Soft clay: earlier stage notice and override", n.join(" | "));
    const ok = n.some((t) => /An earlier stage was imported/i.test(t)) && n.some((t) => /Overridden by the yield stress from the earlier stage \+ POP 10 kPa/.test(t)) && tag > 0;
    record("A6.1", "Soft clay: notice, stage tag, override note", '"An earlier stage was imported…" + Remove earlier stage; "stage"; "Overridden … + POP 10 kPa" + Use OCR instead', `${tag ? "stage tag" : "no stage tag"}; ${n.join(" | ")}`, ok, from);
  });
  await step("A6.2", "Remove earlier stage, run; Ctrl+Z, run", async () => {
    const from = rig.shots.length;
    const d = await materialsDialog();
    await selectMaterial(d, "Soft clay");
    await clickNamed(d, /remove.*earlier stage/i);
    await d.waitForTimeout(800);
    await growToContent(d);
    const n = await notes(d);
    const tag = await d.getByTestId("stage-tag").count();
    await rig.shot(d, "a6-stage-removed", "After Remove earlier stage", n.join(" | ") || "no notes");
    record("A6.2a", "Remove earlier stage: notice and tag gone", "no earlier-stage notice, no stage tag", `${tag ? "stage tag still shown" : "tag gone"}; notes: ${n.join(" | ") || "none"}`, !tag && !n.some((t) => /earlier stage was imported/i.test(t)), from);
    checkF("A6.2b", "run after Remove earlier stage", VARIANTS["04 Remove earlier stage"], await run());
    const from2 = rig.shots.length;
    await undo(1);
    const d2 = await materialsDialog();
    await selectMaterial(d2, "Soft clay");
    await growToContent(d2);
    const n2 = await notes(d2);
    await rig.shot(d2, "a6-stage-undo", "After Ctrl+Z in the main window", n2.join(" | "));
    record("A6.2c", "Ctrl+Z brings the notice back", "earlier-stage notice back", n2.some((t) => /earlier stage was imported/i.test(t)) ? "notice back" : "notice NOT back", n2.some((t) => /earlier stage was imported/i.test(t)), from2);
    checkF("A6.2d", "run after Ctrl+Z", exp("04-shansep-excavation").fCircle!, await run());
  });
  await step("A6.3", "Use OCR instead, run; Ctrl+Z, run", async () => {
    const from = rig.shots.length;
    const d = await materialsDialog();
    await selectMaterial(d, "Soft clay");
    await clickNamed(d, "Use OCR instead");
    await d.waitForTimeout(700);
    await growToContent(d);
    const ocrEnabled = await d.getByLabel("OCR", { exact: true }).first().isEnabled().catch(() => false);
    const n = await notes(d);
    await rig.shot(d, "a6-use-ocr", "After Use OCR instead", n.join(" | ") || "no notes");
    record("A6.3a", "Use OCR instead: OCR editable, POP gone", "OCR field enabled; no POP", `OCR ${ocrEnabled ? "enabled" : "DISABLED"}; notes: ${n.join(" | ") || "none"}`, ocrEnabled && !n.some((t) => /POP/.test(t)), from);
    checkF("A6.3b", "run after Use OCR instead", VARIANTS["04 Use OCR instead"], await run());
    await undo(1);
    checkF("A6.3c", "Ctrl+Z, run", exp("04-shansep-excavation").fCircle!, await run());
  });
  await step("A6.4", "01: rᵤ edits, empty, out of range, undo", async () => {
    await openProject(file("01-ru.json"));
    const ru = "rᵤ (pore pressure ratio)";
    let d = await materialsDialog();
    await selectMaterial(d, "Clay ru");
    await typeInto(d, ru, "0.5");
    await growToContent(d);
    await rig.shot(d, "a6-ru-05", "Clay ru: rᵤ = 0.5");
    checkF("A6.4a", "rᵤ 0.3 → 0.5, Tab, run", VARIANTS["01 ru 0.5"], await run());
    d = await materialsDialog();
    await selectMaterial(d, "Clay ru");
    await typeInto(d, ru, "");
    const placeholder = await d.getByLabel(ru, { exact: true }).getAttribute("placeholder");
    await rig.shot(d, "a6-ru-empty", "Clay ru: rᵤ emptied", `placeholder "${placeholder}"`);
    checkF("A6.4b", `rᵤ emptied (shows "${placeholder}"), run`, VARIANTS["01 ru tom"], await run());
    for (const [val, id] of [["1.2", "A6.4c"], ["-0.3", "A6.4d"]] as const) {
      const from = rig.shots.length;
      d = await materialsDialog();
      await selectMaterial(d, "Clay ru");
      const f = d.getByLabel(ru, { exact: true });
      await f.click();
      await d.keyboard.press("Control+a");
      await d.keyboard.type(val);
      await d.waitForTimeout(500);
      const errs = await alerts(d);
      await rig.shot(d, `a6-ru-${val.replace(/[^0-9]/g, "")}`, `Clay ru: rᵤ = ${val} typed`, errs.join(" | ") || "no error shown");
      await d.keyboard.press("Tab");
      await d.waitForTimeout(400);
      const stored = await main.evaluate(() => (window as any).__CSLOPE_STORE__.getState().materials[0].model.ru);
      const got = await run();
      await rig.shot(main, `a6-ru-${val.replace(/[^0-9]/g, "")}-run`, `Run with rᵤ = ${val} in the field`);
      const used = got !== null && !got.startsWith("error") && Number(got) !== VARIANTS["01 ru tom"];
      record(id, `rᵤ = ${val}`, "validation error under the field; value not used in the analysis", `error: ${errs.join(" | ") || "none"}; stored rᵤ = ${stored}; run: ${got ?? "no F"}${used ? " (value USED)" : ""}`, errs.length > 0 && !used, from);
    }
    const from = rig.shots.length;
    let presses = 0;
    for (; presses < 12; presses++) {
      const v = await main.evaluate(() => (window as any).__CSLOPE_STORE__.getState().materials[0].model.ru);
      if (v === 0.3) break;
      await undo(1);
    }
    const v = await main.evaluate(() => (window as any).__CSLOPE_STORE__.getState().materials[0].model.ru);
    record("A6.4e", "Ctrl+Z back to rᵤ 0.3", "rᵤ 0.3 restored", `rᵤ = ${v} after ${presses} × Ctrl+Z`, v === 0.3, from);
  });
  await step("A6.5", "02: B̄ edits and the fill checkbox", async () => {
    await openProject(file("02-bbar-fill.json"));
    const bb = "B̄ (excess pore pressure from fill above)";
    let d = await materialsDialog();
    await selectMaterial(d, "Clay");
    await typeInto(d, bb, "1.0");
    await growToContent(d);
    await rig.shot(d, "a6-bbar-1", "Clay: B̄ = 1.0");
    checkF("A6.5a", "B̄ 0.6 → 1.0, run", VARIANTS["02 B̄ 1.0"], await run());
    d = await materialsDialog();
    await selectMaterial(d, "Clay");
    await typeInto(d, bb, "");
    checkF("A6.5b", "B̄ emptied, run", VARIANTS["02 B̄ tom"], await run());
    const from = rig.shots.length;
    d = await materialsDialog();
    await selectMaterial(d, "Clay");
    const f = d.getByLabel(bb, { exact: true });
    await f.click();
    await d.keyboard.press("Control+a");
    await d.keyboard.type("2");
    await d.waitForTimeout(400);
    const errs = await alerts(d);
    await rig.shot(d, "a6-bbar-2", "Clay: B̄ = 2", errs.join(" | ") || "no error");
    record("A6.5c", "B̄ = 2", "error (0 to 1.5)", errs.join(" | ") || "no error", errs.some((e) => /0 and 1\.5/.test(e)), from);
    await openProject(file("02-bbar-fill.json"));
    const from2 = rig.shots.length;
    d = await materialsDialog();
    await selectMaterial(d, "Fill");
    await d.getByLabel("This material is a fill that loads the B̄ materials below", { exact: true }).uncheck();
    await d.waitForTimeout(500);
    await growToContent(d);
    await rig.shot(d, "a6-fill-unchecked", "Fill: not a B̄ load");
    checkF("A6.5d", "Fill not a load, run", VARIANTS["02 fyllning ej last"], await run(), from2);
  });
  await step("A6.6", "switch material model and back", async () => {
    const from = rig.shots.length;
    await openProject(file("04-shansep-excavation.json"));
    const d = await materialsDialog();
    await selectMaterial(d, "Soft clay");
    const sel = d.locator("select").filter({ has: d.locator("option", { hasText: /SHANSEP/i }) }).first();
    const before = await sel.inputValue();
    const beforeModel = JSON.stringify(await main.evaluate(() => (window as any).__CSLOPE_STORE__.getState().materials.find((m: any) => m.name === "Soft clay").model));
    const options = await sel.locator("option").evaluateAll((os) => os.map((o) => ({ v: (o as HTMLOptionElement).value, l: o.textContent })));
    const problems: string[] = [];
    for (const o of options) {
      if (o.v === before) continue;
      await sel.selectOption(o.v);
      await d.waitForTimeout(300);
      const errs = [...(await alerts(d)), ...(await d.getByLabel("Validation errors").allInnerTexts().catch(() => []))].filter((t) => t.trim());
      if (errs.length) problems.push(`${o.l}: ${errs.join(" | ")}`);
    }
    await sel.selectOption(before);
    await d.waitForTimeout(500);
    await growToContent(d);
    const afterModel = JSON.stringify(await main.evaluate(() => (window as any).__CSLOPE_STORE__.getState().materials.find((m: any) => m.name === "Soft clay").model));
    await rig.shot(d, "a6-model-roundtrip", "Soft clay after switching through every model and back to SHANSEP", (await notes(d)).join(" | "));
    const lost = beforeModel !== afterModel;
    record("A6.6", "switch Soft clay through every material model and back", "no errors; values kept", `${problems.length ? problems.join("; ") : "no errors"}; ${lost ? `model changed: ${diffKeys(JSON.parse(beforeModel), JSON.parse(afterModel))}` : "SHANSEP values unchanged"}`, !problems.length && !lost, from);
    checkF("A6.6b", "run after switching back", exp("04-shansep-excavation").fCircle!, await run());
  });

  rig.section = "A7 Head lines";
  await step("A7.1", "03: head-line notice", async () => {
    const from = rig.shots.length;
    await openProject(file("03-waternet.json"));
    const d = await piezoDialog();
    await growToContent(d);
    const n = await notes(d);
    await rig.shot(d, "a7-piezo", "03 Piezometric lines: head-line notice", n.join(" | "));
    record("A7.1", "Piezometric lines notice", '"Pore pressure comes from 2 imported head lines and 1 reference line…" + Remove head lines', n.join(" | ") || "none", n.some((t) => /Pore pressure comes from 2 imported head lines and 1 reference line/.test(t)), from);
  });
  await step("A7.2", "Remove head lines, run; Ctrl+Z, run", async () => {
    const d = await piezoDialog();
    await clickNamed(d, /remove.*head/i);
    await d.waitForTimeout(700);
    await growToContent(d);
    await rig.shot(d, "a7-removed", "After Remove head lines");
    checkF("A7.2a", "run without head lines", VARIANTS["03 utan stighöjdslinjer"], await run());
    const from = rig.shots.length;
    await undo(1);
    const back = await store<boolean>(main, "(s) => !!s.waternet");
    await main.evaluate(() => (window as any).__CSLOPE_STORE__.getState().setMode("edit"));
    await main.waitForTimeout(500);
    await rig.shot(main, "a7-undo-canvas", "Edit canvas after Ctrl+Z: head lines back?");
    record("A7.2b", "Ctrl+Z restores the head lines", "head lines back", back ? "head lines back in the model" : "NOT back", back, from);
    checkF("A7.2c", "run after Ctrl+Z", exp("03-waternet").fCircle!, await run());
  });
  await step("A7.3", "06: rapid drawdown note", async () => {
    const from = rig.shots.length;
    await openProject(file("06-rapid-drawdown.json"));
    const d = await piezoDialog();
    await growToContent(d);
    const n = await notes(d);
    await rig.shot(d, "a7-drawdown-note", "06 Piezometric lines: rapid drawdown note", n.join(" | "));
    record("A7.3", "rapid drawdown note", '"Rapid drawdown: water before drawdown at level y = 8 m…"', n.join(" | ") || "none", n.some((t) => /Rapid drawdown: water before drawdown at level y = 8 m/.test(t)), from);
  });

  rig.section = "A8 Options and loads";
  await step("A8.1", "07: seismic kh", async () => {
    const from = rig.shots.length;
    await openProject(file("07-seismic.json"));
    let d = await optionsDialog();
    await growToContent(d);
    const kh = await d.getByLabel("Horizontal seismic coefficient", { exact: true }).inputValue();
    await rig.shot(d, "a8-options-seismic", "07 Options: seismic", `kh = ${kh}`);
    record("A8.1a", "Options › kh", "kh = 0.15", `kh = ${kh}`, Number(kh) === 0.15, from);
    await typeInto(d, "Horizontal seismic coefficient", "0.10");
    checkF("A8.1b", "kh 0.10, run", VARIANTS["07 kh 0.10"], await run());
    d = await optionsDialog();
    await typeInto(d, "Horizontal seismic coefficient", "0");
    checkF("A8.1c", "kh 0, run", VARIANTS["07 kh 0"], await run());
  });
  await step("A8.2", "06: rapid drawdown off, Ctrl+Z, on again", async () => {
    const from = rig.shots.length;
    await openProject(file("06-rapid-drawdown.json"));
    let d = await optionsDialog();
    const cb = () => d.getByLabel("Rapid drawdown", { exact: true });
    const on = await cb().isChecked();
    await growToContent(d);
    await rig.shot(d, "a8-options-drawdown", "06 Options: rapid drawdown");
    record("A8.2a", "Options › Rapid drawdown on", "checked", on ? "checked" : "NOT checked", on, from);
    await cb().uncheck();
    await d.waitForTimeout(500);
    checkF("A8.2b", "rapid drawdown off, run", VARIANTS["06 utan snabb avsänkning"], await run());
    await undo(1);
    d = await optionsDialog();
    const back = await cb().isChecked();
    record("A8.2c", "Ctrl+Z: rapid drawdown on again", "checked", back ? "checked" : "NOT checked", back);
    checkF("A8.2d", "after Ctrl+Z, run", exp("06-rapid-drawdown").fCircle!, await run());
    const from2 = rig.shots.length;
    d = await optionsDialog();
    await cb().uncheck();
    await d.waitForTimeout(300);
    await cb().check();
    await d.waitForTimeout(500);
    await growToContent(d);
    const text = "suggested water before drawdown";
    const level = await d.getByLabel("Water level before drawdown").inputValue().catch(() => "?");
    await rig.shot(d, "a8-drawdown-on-again", "Rapid drawdown switched off and on again: suggested water before", `level ${level}`);
    const got = await run();
    record("A8.2e", "off and on again with the checkbox: suggested water before", "note what is suggested (original: level y = 8 m)", `${text}; level field ${level}; run F = ${got}`, null, from2);
  });
  await step("A8.3", "05: UDL excess pore pressure", async () => {
    const from = rig.shots.length;
    await openProject(file("05-excess-pore-pressure.json"));
    const d = await udlDialog();
    await growToContent(d);
    const n = await notes(d);
    const label = 'Excess pore pressure ratio of UDL 1 in material "Clay"';
    const field = d.getByLabel(label, { exact: true });
    const ratio = (await field.count()) ? await field.inputValue() : null;
    await rig.shot(d, "a8-udl", "05 Distributed loads: excess pore pressure", `${n.join(" | ")}; ratio ${ratio ?? "no field"}`);
    record("A8.3a", "UDL: excess pore pressure Clay 0.6, editable to 1.0", "an editable ratio, Clay 0.6", `${n.join(" | ") || "no note"}; ${ratio !== null ? `ratio field ${ratio}` : "NO ratio field"}`, ratio !== null && Number(ratio) === 0.6, from);
    await typeInto(d, label, "1.0");
    const stored = await store<number>(main, "(s) => s.udls[0].excessPorePressure[0].ratio");
    await growToContent(d);
    await rig.shot(d, "a8-udl-ratio-1", "Clay ratio 1.0 typed", `stored ${stored}`);
    checkF("A8.3b", `ratio 1.0 typed in the field (stored ${stored}), run`, VARIANTS["05 kvot 1.0"], await run());
    await undo(1);
    const d2 = await udlDialog();
    await clickNamed(d2, /^Remove the excess pore pressure of UDL 1/);
    await d2.waitForTimeout(500);
    await growToContent(d2);
    await rig.shot(d2, "a8-udl-removed", "After Remove");
    checkF("A8.3c", "excess pore pressure removed, run", VARIANTS["05 utan portryck under last"], await run());
  });
  await step("A8.4", "08: line load angle", async () => {
    const from = rig.shots.length;
    await openProject(file("08-inclined-line-load.json"));
    await rig.shot(main, "a8-line-load-canvas", "08 edit canvas: inclined line load arrow (30°, + towards +x)");
    let d = await lineLoadsDialog();
    await growToContent(d);
    const ang = await d.getByLabel("Line load angle").first().inputValue();
    await rig.shot(d, "a8-line-loads", "08 Line loads", `angle ${ang}`);
    record("A8.4a", "Line loads angle", "30", ang, Number(ang) === 30, from);
    for (const [v, key] of [["0", "08 vinkel 0"], ["-30", "08 vinkel -30"]] as const) {
      d = await lineLoadsDialog();
      const f = d.getByLabel("Line load angle").first();
      await f.click();
      await d.keyboard.press("Control+a");
      await d.keyboard.type(v);
      await d.keyboard.press("Tab");
      await d.waitForTimeout(500);
      if (v === "-30") {
        await closeOthers(main);
        await main.evaluate(() => (window as any).__CSLOPE_STORE__.getState().setMode("edit"));
        await rig.shot(main, "a8-line-load-minus30", "Edit canvas with angle −30 (should lean towards −x)");
      }
      checkF(`A8.4-${v}`, `angle ${v}, run`, VARIANTS[key], await run());
    }
    d = await lineLoadsDialog();
    await clickNamed(d, "Remove line load 1");
    await d.waitForTimeout(500);
    checkF("A8.4-del", "line load removed, run", VARIANTS["08 utan linjelast"], await run());
  });

  rig.section = "A9 Results and PDF";
  for (const key of ["04-shansep-excavation", "06-rapid-drawdown", "00-design-review"]) {
    await step(`A9-${key.slice(0, 2)}`, `${key}: result view and PDF`, async () => {
      const from = rig.shots.length;
      await openProject(file(`${key}.json`));
      const got = await run();
      await rig.shot(main, `a9-${key}-result`, `${key}: result view`);
      await ribbonTab(main, "Results");
      await rig.shot(main, `a9-${key}-results-tab`, `${key}: Results tab`);
      const pdfDir = join(OUT, "exports", "pdf");
      mkdirSync(pdfDir, { recursive: true });
      await queue("downloadPlan", pdfDir);
      await clickNamed(main, "Export PDF", ["menuitem", "button"]);
      const dl = (await takeDownloads(20_000))[0];
      if (!dl?.path || !existsSync(dl.path)) throw new Error(`No PDF saved (${JSON.stringify(dl)})`);
      const target = join(pdfDir, `${key}.pdf`);
      execSync(`mv "${dl.path}" "${target}"`);
      const txt = execSync(`pdftotext -layout "${target}" -`).toString();
      rig.writeFile(`text/a9-${key}-pdf.txt`, txt);
      const prefix = join(OUT, "img", `a9-${key}-pdf`);
      execSync(`pdftoppm -r 70 -png "${target}" "${prefix}"`);
      for (const n of readdirSync(join(OUT, "img")).filter((n) => n.startsWith(`a9-${key}-pdf`)).sort()) {
        rig.shots.push({ file: `img/${n}`, title: `${key} PDF ${n.match(/-(\d+)\.png$/)?.[1]}`, section: rig.section });
      }
      const fInPdf = got && txt.includes(got);
      const want: [string, RegExp][] = [
        ["Analysis summary", /Analysis summary/i],
        ["method", /Morgenstern|Bishop|Spencer/i],
        ["materials", /Material/i],
        ...(key.startsWith("04") ? ([["earlier stage / POP", /earlier stage|POP/i]] as [string, RegExp][]) : []),
        ...(key.startsWith("06") ? ([["rapid drawdown", /drawdown/i]] as [string, RegExp][]) : []),
        ...(key.startsWith("00") ? ([["rᵤ (not ru)", /rᵤ/], ["B̄ (not B-bar)", /B\u0304/], ["drawdown strength", /drawdown/i], ["φ", /φ/], ["σ′", /σ′|σ'/]] as [string, RegExp][]) : []),
      ];

      const missing = want.filter(([, re]) => !re.test(txt)).map(([n]) => n);
      // Page 1 (the drawing) states F above it.
      if (!got || !txt.split("\f")[0].includes(got)) missing.push("F on page 1");
      record(`A9-${key.slice(0, 2)}`, `${key}: PDF`, `PDF saved as "${dl.name}"; F ${got} in the PDF and on page 1; summary has ${want.map(([n]) => n).join(", ")}`, `${dl.name}; F ${fInPdf ? "found" : "NOT found"}; ${missing.length ? `missing: ${missing.join(", ")}` : "all found"}`, !!fInPdf && !missing.length, from);
      await closeOthers(main);
    });
  }
}

async function partB() {
  rig.section = "B1 Search instead of the fixed circle";
  for (const f of FEATURES) {
    await step(`B1-${f.key.slice(0, 2)}`, `${f.key}: search`, async () => {
      const from = rig.shots.length;
      await openProject(file(`${f.key}.json`));
      const d = await customPlanesDialog();
      const cb = d.getByLabel(/Only analyze these surfaces/i).first();
      if (f.key.startsWith("01")) {
        await growToContent(d);
        await rig.shot(d, "b1-custom-planes", "Custom planes dialog");
      }
      await cb.uncheck();
      await d.waitForTimeout(400);
      const got = await run();
      if (f.key.startsWith("08")) await rig.shot(main, `b1-${f.key}-result`, `${f.key}: search result`);
      checkF(`B1-${f.key.slice(0, 2)}`, `${f.key}: search (custom planes off)`, f.fSearch, got, from, 0.01);
    });
  }

  rig.section = "B2 Every export and import";
  const dir = join(OUT, "exports", "b2");
  mkdirSync(dir, { recursive: true });
  for (const f of FEATURES) {
    for (const fmt of ["stix", "slim", "gsz"] as const) {
      const id = `B2-${f.key.slice(0, 2)}.${fmt}`;
      const e = f.imports![fmt];
      await step(id, `${f.key}: export and import .${fmt}`, async () => {
        const from = rig.shots.length;
        await openProject(file(`${f.key}.json`));
        const { text, downloads } = await exportVia(fmt, `b2-export-${f.key}-${fmt}`, `Export ${f.key} .${fmt}`, dir);
        const missing = e.exportNotes.filter((n) => !text.replace(/\s+/g, " ").includes(n.replace(/\s+/g, " ")));
        record(`${id}x`, `${f.key}: export .${fmt} summary`, e.exportNotes.length ? `mentions ${e.exportNotes.length} note(s)` : "no notes needed", `${downloads[0]?.state ?? "no download"}; ${missing.length ? `MISSING: ${missing.join(" / ")}` : "all notes shown"}`, !missing.length && downloads[0]?.state === "completed", from);
        const from2 = rig.shots.length;
        await importVia(MENU[fmt], file(`${f.key}.${fmt}`), `b2-import-${f.key}-${fmt}`, `Import ${f.key}.${fmt}`);
        const method = await activeModel("(m, s) => s.options?.method");
        const got = await run();
        checkF(id, `${f.key}.${fmt} imported (${method}), run`, e.fAsImported, got, from2);
      });
    }
  }

  rig.section = "B3 Drag and drop";
  await step("B3", "drop a .json on the window (with unsaved changes)", async () => {
    const from = rig.shots.length;
    await openProject(file("01-ru.json"));
    await main.evaluate(() => {
      const s = (window as any).__CSLOPE_STORE__.getState();
      const c = s.coordinates.map((p: number[]) => [...p]);
      c[1][1] += 0.5;
      s.setCoordinates(c);
    });
    await takeCalls();
    // A real File with a native path: through a file input, then dropped.
    await main.evaluate(() => {
      const i = document.createElement("input");
      i.type = "file";
      i.id = "__beta_drop";
      i.style.display = "none";
      document.body.appendChild(i);
    });
    await main.setInputFiles("#__beta_drop", file("07-seismic.json"));
    await queue("msg", 1); // Don't Save
    await main.evaluate(() => {
      const i = document.getElementById("__beta_drop") as HTMLInputElement;
      const dt = new DataTransfer();
      dt.items.add(i.files![0]);
      const target = document.elementFromPoint(800, 500) ?? document.body;
      target.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
      target.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      i.remove();
    });
    await main.waitForTimeout(1500);
    const calls = await takeCalls();
    const name = await activeModel("(m) => m.name");
    const title = await windowTitle();
    await rig.shot(main, "b3-dropped", "After dropping 07-seismic.json", `title "${title}"`);
    const asked = calls.find((c) => c.kind === "message");
    record("B3", "drop 07-seismic.json with unsaved changes", "opens like Open; asks about unsaved changes first", `model "${name}", title "${title}"; ${asked ? `asked "${asked.message}"` : "NOT asked"}`, name === "Seismic kh 0.15" && !!asked && title === "07-seismic — cSlope", from);
  });

  rig.section = "B5 DXF import";
  await step("B5", "import a DXF", async () => {
    const from = rig.shots.length;
    const poly = (closed: boolean) =>
      `0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\nGROUND\n90\n6\n70\n${closed ? 1 : 0}\n10\n0\n20\n-10\n10\n0\n20\n10\n10\n15\n20\n10\n10\n35\n20\n0\n10\n60\n20\n0\n10\n60\n20\n-10\n0\nENDSEC\n0\nEOF\n`;
    const open = rig.writeFile("files/open-polyline.dxf", poly(false));
    const textOpen = await importVia(MENU.dxf, open, "b5-import-dxf-open", "Import DXF with an open polyline: summary");
    record("B5a", "DXF with only an open polyline", "a clear message", textOpen.replace(/\s+/g, " ").slice(0, 200) || "none", null, from);
    const from2 = rig.shots.length;
    const closed = rig.writeFile("files/closed-polyline.dxf", poly(true));
    const before = await modelCount();
    const text = await importVia(MENU.dxf, closed, "b5-import-dxf", "Import DXF with a closed polyline: summary");
    await closeOthers(main);
    await rig.shot(main, "b5-after", "After the DXF import");
    const after = await modelCount();
    const pts = await store<number>(main, "(s) => s.coordinates.length");
    record("B5", "DXF with a closed polyline (the slope outline)", "a model with the outline", `summary: ${text.replace(/\s+/g, " ").slice(0, 160) || "none"}; models ${before} → ${after}; ${pts} points`, after === before + 1 && pts >= 6, from2);
  });

  rig.section = "B6 Design review model";
  await step("B6", "00-design-review: dialogs and run", async () => {
    const from = rig.shots.length;
    await openProject(file("00-design-review.json"));
    for (const [open, name] of [[materialsDialog, "materials"], [piezoDialog, "piezo"], [optionsDialog, "options"], [udlDialog, "udl"], [lineLoadsDialog, "line-loads"]] as const) {
      const d = await open();
      await growToContent(d);
      await rig.shot(d, `b6-${name}`, `00-design-review: ${name}`, (await notes(d)).join(" | "));
    }
    const got = await run();
    await rig.shot(main, "b6-result", "00-design-review: result (search)");
    checkF("B6", "00-design-review: run (search)", exp("00-design-review").fSearch, got, from, 0.005);
  });
}

async function partC() {
  rig.section = "C4 Dark theme";
  await step("C4", "dark theme: main window, dialogs, notices, summary", async () => {
    await openProject(file("04-shansep-excavation.json"));
    await focusMain();
    await clickNamed(main, /dark|theme/i);
    await main.waitForTimeout(600);
    const theme = await main.evaluate(() => document.documentElement.dataset.theme);
    await rig.shot(main, "c4-dark-main", "Dark theme: main window", `theme ${theme}`);
    let d = await materialsDialog();
    await selectMaterial(d, "Soft clay");
    await growToContent(d);
    await rig.shot(d, "c4-dark-materials", "Dark theme: Materials with notices");
    await openProject(file("03-waternet.json"));
    d = await piezoDialog();
    await growToContent(d);
    await rig.shot(d, "c4-dark-piezo", "Dark theme: Piezometric lines notice");
    d = await optionsDialog();
    await growToContent(d);
    await rig.shot(d, "c4-dark-options", "Dark theme: Options");
    await exportVia("slim", "c4-dark-export-summary", "Dark theme: export summary", join(OUT, "exports"));
    await run();
    await rig.shot(main, "c4-dark-result", "Dark theme: result");
    record("C4", "dark theme", "dialogs and notices readable", `theme ${theme}; see images`, null);
    await clickNamed(main, /light|theme/i).catch(() => {});
  });
}

/** C3 (part): the dialog windows at 125 % and 150 % display scaling. */
async function partC3() {
  rig.section = "C3 Display scaling (Linux, forced device scale)";
  for (const scale of [1.25, 1.5]) {
    await step(`C3-${scale}`, `scale ${scale}: dialogs fit`, async () => {
      const from = rig.shots.length;
      await start({ scale });
      await openProject(file("00-design-review.json"));
      const fits: string[] = [];
      for (const [open, hash, name] of [[materialsDialog, "materials-dialog", "Materials"], [optionsDialog, "options-dialog", "Options"]] as const) {
        await open();
        await main.waitForTimeout(800);
        const b = await app.evaluate(({ BrowserWindow, screen }, hash) => {
          const w = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith(`#${hash}`));
          const area = screen.getPrimaryDisplay().workArea;
          return { win: w?.getBounds(), area, sf: screen.getPrimaryDisplay().scaleFactor };
        }, hash);
        const inside = b.win && b.win.x >= b.area.x && b.win.y >= b.area.y && b.win.x + b.win.width <= b.area.x + b.area.width && b.win.y + b.win.height <= b.area.y + b.area.height;
        fits.push(`${name} ${b.win?.width}×${b.win?.height} at ${b.win?.x},${b.win?.y} in ${b.area.width}×${b.area.height} (scale ${b.sf}): ${inside ? "fits" : "DOES NOT FIT"}`);
        rig.grabScreen(`c3-${scale}-${name.toLowerCase()}`, `Scale ${scale}: ${name} on the screen`);
      }
      record(`C3-${scale}`, `display scale ${scale}: Materials and Options fit on the screen`, "inside the work area", fits.join("; "), fits.every((f) => f.endsWith("fits")), from);
      await quit();
    });
  }
}

/** A6.7: a comma as the decimal separator, in a Swedish and an English locale. */
async function commaDecimal() {
  rig.section = "A6.7 Decimal comma (locale)";
  for (const lang of ["sv-SE", "en-US"]) {
    await step(`A6.7-${lang}`, `type decimal commas (${lang})`, async () => {
      await start({ extraArgs: [`--lang=${lang}`] });
      const navLang = await main.evaluate(() => navigator.language);
      await openProject(file("01-ru.json"));
      const fields: [string, () => Promise<Page>, string, string, string, number][] = [
        ["rᵤ", materialsDialog, "rᵤ (pore pressure ratio)", "0,5", "(s) => s.materials[0].model.ru", 0.5],
        ["c′", materialsDialog, "c′ (kPa)", "8,5", "(s) => s.materials[0].model.cohesion", 8.5],
        ["kh", optionsDialog, "Horizontal seismic coefficient", "0,1", "(s) => s.options.seismicHorizontal", 0.1],
      ];
      for (const [name, open, label, text, read, want] of fields) {
        const from = rig.shots.length;
        const d = await open();
        if (open === materialsDialog) await selectMaterial(d, "Clay ru");
        const f = d.getByLabel(label, { exact: true });
        await f.click();
        await d.keyboard.press("Control+a");
        await d.keyboard.type(text);
        await d.waitForTimeout(400);
        const shown = await f.inputValue();
        const errs = await alerts(d);
        await rig.shot(d, `a67-${lang}-${slug(name)}`, `${name} typed as "${text}" (${navLang})`, `field "${shown}"; ${errs.join(" | ") || "no error"}`);
        await d.keyboard.press("Tab");
        await d.waitForTimeout(400);
        const stored = await store<number>(main, read);
        record(`A6.7-${lang}-${name}`, `"${text}" typed in ${name} (locale ${navLang})`, `${want}`, `field showed "${shown}", stored ${stored}${errs.length ? `; ${errs.join(" | ")}` : ""}`, stored === want, from);
      }
      await quit();
    });
  }
}

const slug = (s: string) => s.normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";

function diffKeys(a: Record<string, unknown>, b: Record<string, unknown>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => `${k}: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`).join(", ");
}

// ── Output ─────────────────────────────────────────────────────────────

const MANUAL = [
  "A1.1 Installer (Setup.exe): wizard, folder choice, per-user install without an administrator prompt; SmartScreen and the publisher name.",
  "A1.2 Start from the Start menu and the desktop shortcut (the splash and the version are checked here on Linux).",
  "A2–A5 The Windows open and save dialogs themselves (here the main process's dialogs are answered by the test), file names with Swedish characters and paths on Windows.",
  "A5.1 The Windows save dialog of an export (the suggested name is checked here from the download).",
  "A6.7 A comma as the decimal separator with Windows' Swedish regional settings (here: Chromium's --lang=sv-SE only).",
  "A9 The PDF opening in the Windows PDF reader.",
  "B3 A real drag from Explorer (here a File with its native path is dropped by script).",
  "B4 Double click on a .cslp project in Explorer: opens it in cSlope (in the running cSlope, if one is open); the file icon and type name \"cSlope project\".",
  "C1 Uninstall (Settings › Apps): shortcuts and program folder removed, %APPDATA% kept; reinstall keeps the theme.",
  "C2 Upgrade over an older version.",
  "C3 Real Windows 125 %/150 % scaling and a second monitor, moving dialog windows between them (here: Chromium's forced device scale on one virtual screen).",
  "A1.3 The native message box itself (its look; the question, buttons and Cancel behaviour are checked here).",
];

function writeResults() {
  const pass = results.filter((r) => r.pass === true).length;
  const fail = results.filter((r) => r.pass === false).length;
  const info = results.filter((r) => r.pass === null).length;
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const md = [
    "# cSlope beta checklist, automated run",
    "",
    `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC. **${pass} pass, ${fail} fail, ${info} info / not checkable.** Images in \`img/\`, summaries in \`text/\`, exported files in \`exports/\`. Contact sheet: \`index.html\`.`,
    "",
    "| Step | What | Expected | Got | Result | Images |",
    "|---|---|---|---|---|---|",
    ...results.map((r) => `| ${r.id} | ${cell(r.step)} | ${cell(r.expected)} | ${cell(r.got)} | ${r.pass === true ? "pass" : r.pass === false ? "**FAIL**" : "info"} | ${r.shots.map((s) => `[${basename(s)}](${s})`).join("<br>")} |`),
    "",
    "## Left for the manual test on Windows",
    "",
    ...MANUAL.map((m) => `- ${m}`),
    "",
  ].join("\n");
  writeFileSync(join(OUT, "results.md"), md);
}

async function main_() {
  mkdirSync(OUT, { recursive: true });
  console.log(`\n  Beta checklist → ${OUT}\n`);
  if (!process.env.DESIGN_CAPTURE_SKIP_BUILD) buildApp();
  rig = new Rig(null as unknown as Page, OUT);
  const t0 = Date.now();
  const parts = (process.env.BETA_PARTS ?? "A,B,C").split(",");
  try {
    if (parts.includes("A")) await partA();
    if (parts.includes("B")) {
      if (!app || main.isClosed()) await start();
      await partB();
    }
    if (parts.includes("C")) {
      if (!app || main.isClosed()) await start();
      await partC();
      await quit();
      await commaDecimal();
      await partC3();
    }
  } finally {
    rig.say(`\n  ${results.filter((r) => r.pass === true).length} pass, ${results.filter((r) => r.pass === false).length} fail, ${Math.round((Date.now() - t0) / 1000)} s`);
    writeResults();
    writeContactSheet(rig, "cSlope beta checklist (automated)");
    await quit();
  }
}

main_().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
