/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate() runs in the renderer without type imports */
/**
 * Helpers for the design screenshots: start the built app under a virtual
 * display, find buttons and dialog windows by their accessible names, take
 * screenshots, catch downloads and native message boxes. A missing element
 * is logged and the step skipped (the UI changes while it is reviewed).
 */

import { chromium, type Browser, type CDPSession, type Page } from "playwright";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

export const ROOT = resolve(import.meta.dirname, "../../../..");
export const DESKTOP_DIR = join(ROOT, "packages/desktop");

/** One captured image (or a failed step) for the contact sheet. */
export interface Shot {
  file: string | null;
  title: string;
  section: string;
  note?: string;
  error?: string;
}

export class Rig {
  shots: Shot[] = [];
  log: string[] = [];
  section = "";
  /** The text of the last native message box (alert/confirm). */
  lastNative: string | null = null;
  private seq = 0;

  constructor(
    readonly page: Page,
    readonly out: string,
  ) {
    mkdirSync(join(out, "img"), { recursive: true });
  }

  say(line: string) {
    console.log(line);
    this.log.push(line);
  }

  /** Run one step; an error is logged and recorded, never thrown. */
  async step(title: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).split("\n")[0];
      this.say(`  ✗ ${title}: ${msg}`);
      this.shots.push({ file: null, title, section: this.section, error: msg });
    }
  }

  /** Save a screenshot of a page (the main window or a dialog window). */
  async shot(p: Page, name: string, title: string, note?: string) {
    await p.waitForTimeout(350);
    const file = `img/${String(++this.seq).padStart(3, "0")}-${name}.png`;
    await p.screenshot({ path: join(this.out, file) });
    this.shots.push({ file, title, section: this.section, note });
    this.say(`  ✓ ${file}  ${title}${note ? ` — ${note}` : ""}`);
  }

  /** Save the whole X screen (native message boxes are not in the page). */
  grabScreen(name: string, title: string, note?: string) {
    const display = process.env.DISPLAY;
    if (!display) {
      this.say(`  - ${title}: no DISPLAY, screen not grabbed`);
      return;
    }
    const file = `img/${String(++this.seq).padStart(3, "0")}-${name}.png`;
    try {
      execSync(`import -display ${display} -window root "${join(this.out, file)}"`, { stdio: "ignore" });
      this.shots.push({ file, title, section: this.section, note });
      this.say(`  ✓ ${file}  ${title}`);
    } catch {
      this.say(`  - ${title}: screen grab failed (ImageMagick "import" missing?)`);
    }
  }

  /** Record a note (no image) on the contact sheet. */
  note(title: string, note: string) {
    this.shots.push({ file: null, title, section: this.section, note });
    this.say(`  • ${title}: ${note}`);
  }

  writeFile(rel: string, data: string | Uint8Array) {
    const path = join(this.out, rel);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, data);
    return path;
  }
}

// ── Launch ─────────────────────────────────────────────────────────────

/** Build the renderer with the capture bridge (VITE_CAPTURE_MODE is compiled in). */
export function buildApp() {
  execSync("bunx vite build", { cwd: DESKTOP_DIR, stdio: "inherit", env: { ...process.env, VITE_CAPTURE_MODE: "1" } });
}

/** Start the built app with remote debugging and return its main window. */
export async function launch(port: number): Promise<{ browser: Browser; page: Page; proc: ChildProcess }> {
  const electronPath = createRequire(join(DESKTOP_DIR, "package.json"))("electron") as unknown as string;
  const proc = spawn(
    electronPath,
    [
      DESKTOP_DIR,
      `--remote-debugging-port=${port}`,
      "--force-device-scale-factor=1",
      // Chromium refuses to run as root with the sandbox (a container).
      ...(process.env.CSLOPE_CAPTURE_NO_SANDBOX ? ["--no-sandbox"] : []),
    ],
    {
      cwd: DESKTOP_DIR,
      // CSLOPE_CAPTURE: no splash, no unsaved-changes prompt on quit.
      env: { ...process.env, CSLOPE_CAPTURE: "1", VITE_DEV_SERVER_URL: "" },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  proc.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s) && !/dbus|gpu|GLES|viz|Fontconfig|libva/i.test(s)) process.stderr.write(`  [electron] ${s}`);
  });
  let browser: Browser | null = null;
  for (let i = 0; i < 240 && !browser; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      const d = (await r.json()) as { webSocketDebuggerUrl: string };
      browser = await chromium.connectOverCDP(d.webSocketDebuggerUrl);
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!browser) throw new Error(`No remote debugging endpoint on port ${port} (is another app using it?)`);
  let page: Page | undefined;
  for (let i = 0; i < 200 && !page; i++) {
    page = browser.contexts()[0]?.pages().find((p) => !p.url().includes("#"));
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) throw new Error("The main window did not open");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => (window as any).__CSLOPE_CAPTURE_READY__ === true, { timeout: 30_000 });
  return { browser, page, proc };
}

export async function stop(browser: Browser, proc: ChildProcess) {
  await browser.close().catch(() => {});
  if (proc.exitCode !== null) return;
  proc.kill();
  await new Promise((r) => setTimeout(r, 1000));
  if (proc.exitCode === null) proc.kill("SIGKILL");
}

// ── Pages and windows ──────────────────────────────────────────────────

const sessions = new WeakMap<Page, CDPSession>();

/**
 * Set a page's CSS size (1 device pixel per CSS pixel). One CDP session per
 * page, kept open: the size override ends with its session.
 */
export async function setSize(p: Page, width: number, height: number) {
  let cdp = sessions.get(p);
  if (!cdp) {
    cdp = await p.context().newCDPSession(p);
    sessions.set(p, cdp);
  }
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
}

/**
 * Make a dialog window tall (and wide) enough that nothing scrolls, so one
 * image shows all of it; at most `maxHeight`.
 */
export async function growToContent(p: Page, maxHeight = 2400) {
  const size = await p.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const need = await p.evaluate(() => {
    let extra = 0, wide = 0;
    for (const e of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
      const s = getComputedStyle(e);
      if ((s.overflowY === "auto" || s.overflowY === "scroll") && e.scrollHeight > e.clientHeight + 1) extra = Math.max(extra, e.scrollHeight - e.clientHeight);
      if ((s.overflowX === "auto" || s.overflowX === "scroll") && e.scrollWidth > e.clientWidth + 1) wide = Math.max(wide, e.scrollWidth - e.clientWidth);
    }
    return { extra, wide };
  });
  if (need.extra > 0 || need.wide > 0) {
    await setSize(p, size.w + need.wide + (need.wide ? 16 : 0), Math.min(maxHeight, size.h + need.extra + 16));
    await p.waitForTimeout(400);
  }
}

/** Close every dialog window and any menu or modal in the main window. */
export async function closeOthers(page: Page) {
  for (const p of page.context().pages()) if (p !== page) await p.close().catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(200);
}

/** A ribbon tab (File, Model, Results, Help): the button in the menu bar. */
export async function ribbonTab(page: Page, name: string) {
  const c = page.getByRole("button", { name, exact: true });
  for (let i = 0; i < (await c.count()); i++) {
    const b = await c.nth(i).boundingBox();
    if (b && b.y < 60) {
      await c.nth(i).click();
      await page.waitForTimeout(250);
      return;
    }
  }
  throw new Error(`No ribbon tab "${name}"`);
}

/**
 * Click the first visible element that has this accessible name, title or
 * exact text (in that order of preference).
 */
export async function clickNamed(p: Page, name: string | RegExp, roles: ("button" | "menuitem")[] = ["button", "menuitem"]) {
  const candidates = [
    ...roles.map((role) => p.getByRole(role, { name, exact: typeof name === "string" })),
    typeof name === "string" ? p.locator(`[title="${name.replace(/"/g, '\\"')}"]`) : p.getByTitle(name),
    p.getByText(name, { exact: typeof name === "string" }),
  ];
  for (const c of candidates) {
    const n = await c.count();
    for (let i = 0; i < n; i++) {
      if (await c.nth(i).isVisible()) {
        await c.nth(i).click();
        return;
      }
    }
  }
  throw new Error(`Nothing named "${name}" to click`);
}

/** The window whose URL ends with #hash, once it has opened. */
export async function findWindow(page: Page, hash: string, timeoutMs = 10_000): Promise<Page> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const w = page.context().pages().find((p) => p.url().endsWith(`#${hash}`));
    if (w) {
      await w.waitForLoadState("domcontentloaded");
      // the dialog asks the main window for its state over IPC
      await w.waitForTimeout(900);
      return w;
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`No window #${hash} (open: ${page.context().pages().map((p) => p.url().split("#")[1] ?? "main").join(", ")})`);
}

/**
 * Open a dialog window from the Model tab by its ribbon label; when the
 * button cannot be found, through the preload API (`window.cslope[api]`).
 */
export async function openDialog(rig: Rig, label: string, hash: string, api: string): Promise<Page> {
  const page = rig.page;
  await closeOthers(page);
  try {
    await ribbonTab(page, "Model");
    await clickNamed(page, label);
  } catch (e) {
    rig.say(`  - ribbon button "${label}" not found (${(e as Error).message}); opening #${hash} through window.cslope.${api}()`);
    await page.evaluate((api) => (window as any).cslope[api](), api);
  }
  const w = await findWindow(page, hash);
  await setSize(w, Math.max(560, await w.evaluate(() => window.innerWidth)), Math.max(640, await w.evaluate(() => window.innerHeight)));
  return w;
}

// ── Store and downloads ────────────────────────────────────────────────

/** Evaluate `fn(state)` on the main window's store. */
export function store<T = unknown>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(() => { const s = window.__CSLOPE_STORE__.getState(); return (${fn})(s); })()`) as Promise<T>;
}

/** Load models into the app as an opened project would. */
export async function loadModels(page: Page, models: unknown[], activeModelId?: string) {
  await page.evaluate(
    ({ models, activeModelId }) => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      const s = (window as any).__CSLOPE_STORE__.getState();
      s.setMode?.("edit");
      s.loadProject({ models, activeModelId: activeModelId ?? (models as any[])[0].id });
    },
    { models, activeModelId },
  );
  await page.waitForTimeout(900);
}

/**
 * Catch file downloads in the renderer (exports and the PDF go through an
 * <a download> click): the file is kept in memory instead of opening a save
 * dialog. Install once per page load.
 */
export async function catchDownloads(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    if (w.__designCapture) return;
    w.__designCapture = { files: [] as { name: string; blob: Blob }[] };
    const blobs = new Map<string, Blob>();
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b: Blob | MediaSource) => {
      const url = create(b);
      if (b instanceof Blob) blobs.set(url, b);
      return url;
    };
    const keep = (a: HTMLAnchorElement) => {
      if (!a.download) return false;
      const blob = blobs.get(a.href);
      if (blob) w.__designCapture.files.push({ name: a.download, blob });
      else if (a.href.startsWith("data:")) w.__designCapture.files.push({ name: a.download, blob: null, dataUrl: a.href });
      return true;
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (keep(this)) return;
      return click.call(this);
    };
    const dispatch = HTMLAnchorElement.prototype.dispatchEvent;
    HTMLAnchorElement.prototype.dispatchEvent = function (this: HTMLAnchorElement, ev: Event) {
      if (ev.type === "click" && keep(this)) return true;
      return dispatch.call(this, ev);
    };
  });
}

/** The downloads caught since the last call: name and bytes. */
export async function takeDownloads(page: Page, waitMs = 6000): Promise<{ name: string; bytes: Uint8Array }[]> {
  const end = Date.now() + waitMs;
  while (Date.now() < end) {
    const n = await page.evaluate(() => (window as any).__designCapture?.files.length ?? 0);
    if (n > 0) break;
    await page.waitForTimeout(200);
  }
  const files = await page.evaluate(async () => {
    const w = window as any;
    const list = w.__designCapture?.files ?? [];
    w.__designCapture.files = [];
    const out: { name: string; b64: string }[] = [];
    for (const f of list) {
      let bytes: Uint8Array;
      if (f.blob) bytes = new Uint8Array(await f.blob.arrayBuffer());
      else {
        const res = await fetch(f.dataUrl);
        bytes = new Uint8Array(await res.arrayBuffer());
      }
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      out.push({ name: f.name, b64: btoa(s) });
    }
    return out;
  });
  return files.map((f) => ({ name: f.name, bytes: new Uint8Array(Buffer.from(f.b64, "base64")) }));
}
