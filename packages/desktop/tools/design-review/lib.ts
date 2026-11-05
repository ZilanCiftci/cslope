/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate() runs in the renderer without type imports */
/**
 * Helpers for the design review captures: start the built app (capture
 * mode) under a virtual display, size a window at a device pixel ratio,
 * drive the store, find dialog windows, and measure a page (text nodes,
 * controls, dialog layout, axe-core). Used by run.ts and scenes.ts.
 */

import { chromium, type Browser, type CDPSession, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { RENDER_SETTLE_MS, ANALYSIS_TIMEOUT_MS } from "../media-capture/capture-config";

export { RENDER_SETTLE_MS, ANALYSIS_TIMEOUT_MS };
export const ROOT = resolve(import.meta.dirname, "../../../..");
export const DESKTOP_DIR = join(ROOT, "packages/desktop");
export const OUT_DIR = join(ROOT, "design-review-out");

/** The main window's CSS size; at 150 % a 1920 × 1080 screen gives 1280 × 720. */
export const MAIN_SIZE = { width: 1440, height: 900 };
export const MAIN_SIZE_150 = { width: 1280, height: 720 };
export const DPR = 2;

// ── Launch ─────────────────────────────────────────────────────────────

/** Start the built app with remote debugging (as media-capture does) and return its main window. */
export async function launchApp(port: number): Promise<{ browser: Browser; page: Page; proc: ChildProcess }> {
  const electronPath = createRequire(join(DESKTOP_DIR, "package.json"))("electron") as unknown as string;
  const proc = spawn(
    electronPath,
    [
      DESKTOP_DIR,
      `--remote-debugging-port=${port}`,
      `--force-device-scale-factor=${DPR}`,
      // Chromium refuses to run as root with the sandbox on (a container).
      ...(process.env.CSLOPE_CAPTURE_NO_SANDBOX ? ["--no-sandbox"] : []),
    ],
    {
      cwd: DESKTOP_DIR,
      // CSLOPE_CAPTURE: no splash, no unsaved-changes prompt on quit.
      env: { ...process.env, NODE_OPTIONS: "", CSLOPE_CAPTURE: "1", VITE_DEV_SERVER_URL: "" },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  proc.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s) && !/dbus|gpu|GLES|viz|Fontconfig|libva|ALSA|Autofill/i.test(s)) process.stderr.write(`  [electron] ${s}`);
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
  if (!browser) throw new Error(`No remote debugging endpoint on port ${port}`);
  let page: Page | undefined;
  for (let i = 0; i < 300 && !page; i++) {
    page = browser.contexts()[0]?.pages().find((p) => !p.url().includes("#"));
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) throw new Error("The main window did not open");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => (window as any).__CSLOPE_CAPTURE_READY__ === true, { timeout: 30_000 });
  return { browser, page, proc };
}

export async function stopApp(browser: Browser, proc: ChildProcess) {
  await browser.close().catch(() => {});
  if (proc.exitCode !== null) return;
  proc.kill();
  const exited = await new Promise<boolean>((r) => {
    proc.once("exit", () => r(true));
    setTimeout(() => r(false), 3000);
  });
  if (!exited && proc.exitCode === null) proc.kill("SIGKILL");
}

// ── Pages and windows ──────────────────────────────────────────────────

const sessions = new WeakMap<Page, CDPSession>();

/** Set a page's CSS size and device pixel ratio (one CDP session per page, kept open). */
export async function setViewport(p: Page, dpr: number, width?: number, height?: number) {
  const size =
    width && height ? { width, height } : await p.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  let cdp = sessions.get(p);
  if (!cdp) {
    cdp = await p.context().newCDPSession(p);
    sessions.set(p, cdp);
  }
  await cdp.send("Emulation.setDeviceMetricsOverride", { ...size, deviceScaleFactor: dpr, mobile: false });
}

/** The window whose URL ends with #hash, once it has opened and received its state. */
export async function findWindow(page: Page, hash: string, timeoutMs = 12_000): Promise<Page> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const w = page.context().pages().find((p) => p.url().endsWith(`#${hash}`));
    if (w) {
      await w.waitForLoadState("domcontentloaded");
      await w.waitForTimeout(900);
      return w;
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`No window #${hash} (open: ${page.context().pages().map((p) => p.url().split("#")[1] ?? "main").join(", ")})`);
}

/** A ribbon tab (File, Model, Results, Help): the button in the menu bar at the top. */
export async function ribbonTab(page: Page, name: string) {
  const c = page.getByRole("button", { name, exact: true });
  for (let i = 0; i < (await c.count()); i++) {
    const b = await c.nth(i).boundingBox();
    if (b && b.y < 70) {
      await c.nth(i).click();
      await page.waitForTimeout(200);
      return;
    }
  }
  throw new Error(`No ribbon tab "${name}"`);
}

/** Click the first visible element with this accessible name (button or menu item), title or exact text. */
export async function clickNamed(p: Page, name: string | RegExp, opts: { button?: "left" | "right"; dbl?: boolean } = {}) {
  const exact = typeof name === "string";
  const candidates = [
    p.getByRole("button", { name, exact }),
    p.getByRole("menuitem", { name, exact }),
    p.getByRole("treeitem", { name, exact }),
    exact ? p.locator(`[title="${(name as string).replace(/"/g, '\\"')}"]`) : p.getByTitle(name),
    p.getByText(name, { exact }),
  ];
  for (const c of candidates) {
    const n = await c.count();
    for (let i = 0; i < n; i++) {
      const el = c.nth(i);
      if (await el.isVisible()) {
        if (opts.dbl) await el.dblclick();
        else await el.click({ button: opts.button ?? "left" });
        return;
      }
    }
  }
  throw new Error(`Nothing named "${name}" to click`);
}

/** Evaluate `fn(state, store)` on the main window's store. */
export function store<T = unknown>(page: Page, fn: string, arg?: unknown): Promise<T> {
  // A string expression: the renderer's CSP allows no eval of its own.
  return page.evaluate(
    `(() => { const st = window.__CSLOPE_STORE__; return (${fn})(st.getState(), st, ${JSON.stringify(arg ?? null)}); })()`,
  ) as Promise<T>;
}

/** Run the active model's analysis and wait for its end; returns the run state. */
export async function runAnalysis(page: Page): Promise<string> {
  await page.evaluate(() => (window as any).__CSLOPE_STORE__.getState().runAnalysis());
  await page.waitForFunction(
    () => {
      const s = (window as any).__CSLOPE_STORE__.getState();
      return s.runState === "done" || s.runState === "error";
    },
    undefined,
    { timeout: ANALYSIS_TIMEOUT_MS * 2 },
  );
  return store<string>(page, "(s) => s.runState");
}

/** The CSS position of a model point (world coordinates) on the canvas, in the page. */
export async function worldToPage(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ x, y }) => {
      const s = (window as any).__CSLOPE_STORE__.getState();
      const canvas = document.querySelector("[data-testid='slope-canvas']") as HTMLCanvasElement | null;
      if (!canvas) throw new Error("No canvas");
      const r = canvas.getBoundingClientRect();
      const result = s.mode === "result";
      const off = result ? s.resultViewOffset : s.editViewOffset;
      const scale = result ? s.resultViewScale : s.editViewScale;
      return { x: r.left + r.width / 2 + (x + off[0]) * scale, y: r.top + r.height / 2 - (y + off[1]) * scale };
    },
    { x, y },
  );
}

// ── Measurements ───────────────────────────────────────────────────────

const AXE_PATH = join(DESKTOP_DIR, "node_modules/axe-core/axe.min.js");
let axeSource: string | null = null;

/** Inject axe-core (a script tag; where the page's CSP refuses it, by evaluation). */
async function injectAxe(p: Page) {
  if (await p.evaluate(() => typeof (window as any).axe !== "undefined")) return;
  try {
    await p.addScriptTag({ path: AXE_PATH });
  } catch {
    /* refused by the CSP */
  }
  if (await p.evaluate(() => typeof (window as any).axe !== "undefined")) return;
  axeSource ??= readFileSync(AXE_PATH, "utf-8");
  await p.evaluate(axeSource);
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextMetric {
  text: string;
  tag: string;
  path: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  background: string;
  contrast: number | null;
  large: boolean;
  box: Box;
}

export interface ControlMetric {
  tag: string;
  role: string | null;
  type: string | null;
  classes: string;
  name: string;
  text: string;
  height: number;
  width: number;
  box: Box;
  primary: boolean;
  disabled: boolean;
  path: string;
}

export interface LayoutMetric {
  /** What the layout was measured on: a role="dialog" element, or the window. */
  root: "dialog" | "window";
  rootBox: Box;
  heading: (Box & { text: string; fontSize: number; fontWeight: number }) | null;
  subtitle: (Box & { text: string; fontSize: number }) | null;
  firstField: (Box & { tag: string }) | null;
  buttonRow: (Box & { buttons: string[]; className: string }) | null;
  primaryButtons: (Box & { text: string })[];
}

export interface PageMetrics {
  window: { width: number; height: number; dpr: number };
  focus: Box | null;
  texts: TextMetric[];
  controls: ControlMetric[];
  layout: LayoutMetric;
  overflow: { scrollers: { path: string; scrollHeight: number; clientHeight: number }[] };
  axe: { id: string; impact: string | null; help: string; nodes: { target: string; html: string; summary: string }[] }[];
  axeError?: string;
}

/** Measure a page: texts, controls, the dialog layout and an axe-core run, within `focus` when given. */
export async function measure(p: Page, focus: Box | null): Promise<PageMetrics> {
  const base = (await p.evaluate(collectInPage, focus)) as Omit<PageMetrics, "axe">;
  let axe: PageMetrics["axe"] = [];
  let axeError: string | undefined;
  try {
    await injectAxe(p);
    axe = (await p.evaluate(async (focus) => {
      const w = window as any;
      const res = await w.axe.run(document, { resultTypes: ["violations"] });
      const inFocus = (sel: string) => {
        if (!focus) return true;
        try {
          const el = document.querySelector(sel);
          if (!el) return true;
          const r = el.getBoundingClientRect();
          return r.right > focus.x && r.left < focus.x + focus.width && r.bottom > focus.y && r.top < focus.y + focus.height;
        } catch {
          return true;
        }
      };
      return res.violations
        .map((v: any) => ({
          id: v.id,
          impact: v.impact ?? null,
          help: v.help,
          nodes: v.nodes
            .filter((n: any) => inFocus(String(n.target?.[0] ?? "")))
            .slice(0, 25)
            .map((n: any) => ({
              target: (n.target ?? []).join(" "),
              html: String(n.html ?? "").slice(0, 240),
              summary: String(n.failureSummary ?? "").slice(0, 300),
            })),
        }))
        .filter((v: any) => v.nodes.length > 0);
    }, focus)) as PageMetrics["axe"];
  } catch (e) {
    axeError = e instanceof Error ? e.message.split("\n")[0] : String(e);
  }
  return { ...base, axe, ...(axeError ? { axeError } : {}) };
}

/**
 * Runs in the page (no closures over module scope): the visible text
 * nodes with their colors and contrast, the controls, and the layout of
 * the dialog or window.
 */
function collectInPage(focus: Box | null) {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const colorCache = new Map<string, [number, number, number, number]>();
  /** Any CSS color as RGBA (0–255, alpha 0–1), through a canvas. */
  const rgba = (css: string): [number, number, number, number] => {
    const hit = colorCache.get(css);
    if (hit) return hit;
    let out: [number, number, number, number] = [0, 0, 0, 0];
    if (css && css !== "transparent") {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      out = [d[0], d[1], d[2], d[3] / 255];
    }
    colorCache.set(css, out);
    return out;
  };
  const over = (top: [number, number, number, number], bottom: [number, number, number]): [number, number, number] => [
    top[0] * top[3] + bottom[0] * (1 - top[3]),
    top[1] * top[3] + bottom[1] * (1 - top[3]),
    top[2] * top[3] + bottom[2] * (1 - top[3]),
  ];
  const lum = (c: [number, number, number]) => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const hex = (c: [number, number, number]) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const pageBg = (() => {
    for (const el of [document.body, document.documentElement]) {
      const c = rgba(getComputedStyle(el).backgroundColor);
      if (c[3] > 0) return over(c, [255, 255, 255]);
    }
    return [255, 255, 255] as [number, number, number];
  })();
  /** The color behind an element: its and its ancestors' backgrounds composited. */
  const backgroundOf = (el: Element): [number, number, number] => {
    const layers: [number, number, number, number][] = [];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const c = rgba(getComputedStyle(e).backgroundColor);
      if (c[3] > 0) {
        layers.push(c);
        if (c[3] >= 1) break;
      }
    }
    let bg = pageBg;
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    return bg;
  };
  const opacityOf = (el: Element) => {
    let o = 1;
    for (let e: Element | null = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity) || 0;
    return o;
  };
  const pathOf = (el: Element) => {
    const parts: string[] = [];
    for (let e: Element | null = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      const label = e.getAttribute("aria-label");
      const role = e.getAttribute("role");
      if (e.id) s += `#${e.id}`;
      if (role) s += `[role=${role}]`;
      if (label) s += `[aria-label="${label.slice(0, 40)}"]`;
      parts.unshift(s);
    }
    return parts.join(" > ");
  };
  const boxOf = (r: DOMRect) => ({ x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 });
  const inView = (r: DOMRect) =>
    r.width > 0 &&
    r.height > 0 &&
    r.right > 0 &&
    r.bottom > 0 &&
    r.left < window.innerWidth &&
    r.top < window.innerHeight &&
    (!focus || (r.right > focus.x && r.left < focus.x + focus.width && r.bottom > focus.y && r.top < focus.y + focus.height));
  const visible = (el: Element) =>
    (el as any).checkVisibility ? (el as any).checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true;

  // Texts: one entry per element with its own (direct) text.
  const texts: any[] = [];
  const seen = new Set<Element>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el)) continue;
    if (!n.textContent || !n.textContent.trim()) continue;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "OPTION", "TITLE"].includes(el.tagName)) continue;
    seen.add(el);
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (!inView(r)) continue;
    const own = Array.from(el.childNodes)
      .filter((c) => c.nodeType === 3)
      .map((c) => c.textContent ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!own) continue;
    const cs = getComputedStyle(el);
    const fg = rgba(cs.color);
    const op = opacityOf(el);
    const bg = backgroundOf(el);
    const fgOnBg = over([fg[0], fg[1], fg[2], fg[3] * op], bg);
    const l1 = lum(fgOnBg), l2 = lum(bg);
    const contrast = Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    texts.push({
      text: own.slice(0, 160),
      tag: el.tagName.toLowerCase(),
      path: pathOf(el),
      fontSize: size,
      fontWeight: weight,
      color: hex(fgOnBg),
      background: hex(bg),
      contrast,
      large: size >= 18 || (size >= 14 && weight >= 700),
      box: boxOf(r),
    });
  }

  // Controls.
  const nameOf = (el: HTMLElement): string => {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
        .trim();
      if (t) return t;
    }
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l?.textContent?.trim()) return l.textContent.trim();
    }
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
      const wrap = el.closest("label");
      if (wrap) {
        const clone = wrap.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("select, input, textarea, option").forEach((x) => x.remove());
        const t = clone.textContent?.replace(/\s+/g, " ").trim();
        if (t) return t;
      }
      const input = el as HTMLInputElement;
      if (["button", "submit", "reset"].includes(input.type) && input.value) return input.value;
    } else {
      const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (t) return t;
      const img = el.querySelector("img[alt], svg[aria-label]");
      const alt = img?.getAttribute("alt") ?? img?.getAttribute("aria-label");
      if (alt) return alt;
    }
    const title = el.getAttribute("title");
    if (title && title.trim()) return title.trim();
    const ph = el.getAttribute("placeholder");
    if (ph && ph.trim()) return ph.trim();
    return "";
  };
  const controls: any[] = [];
  const controlSel =
    'button, input:not([type="hidden"]), select, textarea, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="option"], [role="treeitem"]';
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(controlSel))) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (!inView(r)) continue;
    const cls = typeof el.className === "string" ? el.className : "";
    controls.push({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      type: el.getAttribute("type"),
      classes: cls.slice(0, 300),
      name: nameOf(el).slice(0, 160),
      text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80),
      height: Math.round(r.height * 10) / 10,
      width: Math.round(r.width * 10) / 10,
      box: boxOf(r),
      primary: /\bbtn-primary\b/.test(cls),
      disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true",
      path: pathOf(el),
    });
  }

  // Layout of the dialog (a role="dialog" element) or of the window.
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')).filter(
    (d) => visible(d) && d.getBoundingClientRect().width > 0,
  );
  const rootEl = dialogs[dialogs.length - 1] ?? null;
  const rootBox = rootEl ? rootEl.getBoundingClientRect() : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  const scope: ParentNode = rootEl ?? document.body;
  const within = (el: Element) => {
    const r = el.getBoundingClientRect();
    return visible(el) && r.width > 0 && r.height > 0 && r.top >= rootBox.top - 1 && r.bottom <= rootBox.bottom + 1;
  };
  let heading: any = null;
  const hEl = Array.from(scope.querySelectorAll<HTMLElement>("h1, h2, h3, h4, [role='heading']")).find(within);
  const hCandidates = Array.from(scope.querySelectorAll<HTMLElement>("*")).filter((el) => {
    if (!within(el)) return false;
    const own = Array.from(el.childNodes).some((c) => c.nodeType === 3 && c.textContent?.trim());
    if (!own) return false;
    const cs = getComputedStyle(el);
    return (Number(cs.fontWeight) || 400) >= 600 && parseFloat(cs.fontSize) >= 11;
  });
  const topHeading = hCandidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
  const headEl =
    hEl && topHeading
      ? hEl.getBoundingClientRect().top <= topHeading.getBoundingClientRect().top + 2
        ? hEl
        : topHeading
      : (hEl ?? topHeading);
  if (headEl) {
    const cs = getComputedStyle(headEl);
    heading = { ...boxOf(headEl.getBoundingClientRect()), text: (headEl.textContent ?? "").trim().slice(0, 100), fontSize: parseFloat(cs.fontSize), fontWeight: Number(cs.fontWeight) || 400 };
  }
  let subtitle: any = null;
  if (headEl) {
    const hb = headEl.getBoundingClientRect();
    const next = Array.from(scope.querySelectorAll<HTMLElement>("p, div, span"))
      .filter((el) => {
        if (!within(el) || el.contains(headEl) || headEl.contains(el)) return false;
        const r = el.getBoundingClientRect();
        const own = Array.from(el.childNodes).some((c) => c.nodeType === 3 && c.textContent?.trim());
        return own && r.top >= hb.bottom - 1 && r.top - hb.bottom < 24;
      })
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    if (next) subtitle = { ...boxOf(next.getBoundingClientRect()), text: (next.textContent ?? "").trim().slice(0, 160), fontSize: parseFloat(getComputedStyle(next).fontSize) };
  }
  const field = Array.from(scope.querySelectorAll<HTMLElement>('input:not([type="hidden"]):not([type="file"]), select, textarea')).find(within);
  const firstField = field ? { ...boxOf(field.getBoundingClientRect()), tag: field.tagName.toLowerCase() } : null;
  const rows = Array.from(scope.querySelectorAll<HTMLElement>(".dialog-buttons")).filter(within);
  const rowEl = rows[rows.length - 1];
  const buttonRow = rowEl
    ? {
        ...boxOf(rowEl.getBoundingClientRect()),
        className: rowEl.className,
        buttons: Array.from(rowEl.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim()),
      }
    : null;
  const primaryButtons = Array.from(scope.querySelectorAll<HTMLElement>(".btn-primary"))
    .filter(within)
    .map((b) => ({ ...boxOf(b.getBoundingClientRect()), text: (b.textContent ?? "").trim() }));

  const scrollers: any[] = [];
  for (const e of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
    const o = getComputedStyle(e).overflowY;
    if ((o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight + 1 && visible(e)) {
      scrollers.push({ path: pathOf(e), scrollHeight: e.scrollHeight, clientHeight: e.clientHeight });
    }
  }

  return {
    window: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    focus,
    texts,
    controls,
    layout: { root: rootEl ? "dialog" : "window", rootBox: boxOf(rootBox), heading, subtitle, firstField, buttonRow, primaryButtons },
    overflow: { scrollers: scrollers.slice(0, 20) },
  };
}
