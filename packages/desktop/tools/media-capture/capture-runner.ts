#!/usr/bin/env bun
/**
 * Media Capture Runner
 *
 * Builds the Electron app with VITE_CAPTURE_MODE=1 baked into the renderer,
 * then launches it via Playwright to iterate scene definitions and produce
 * deterministic PNG screenshots.
 *
 * Usage:  bun run packages/desktop/tools/media-capture/capture-runner.ts
 *
 * CSLOPE_CAPTURE_ONLY=<prefix> captures only the scenes whose id starts with
 * the prefix (e.g. "tut-first"); several prefixes are separated by commas.
 *
 * Every scene is captured in the light and the dark theme: <name>.png and
 * <name>-dark.png (the website shows the one of its own theme).
 * CSLOPE_CAPTURE_THEME=light or =dark captures one of them only.
 */

import { chromium, type Browser, type Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { scenes } from "../../../website/src/content/media-scenes";
import { themedFilename, type CaptureTheme } from "../../../website/src/content/media-scene-types";
import { initEngine } from "@cslope/engine";
import { captureScene, setPixelRatio } from "./store-capture";
import { VIEWPORT_WIDTH, VIEWPORT_HEIGHT, OUTPUT_DIR, MEDIA_DIR, CAPTURE_DPR } from "./capture-config";

const ROOT = resolve(import.meta.dirname, "../../../..");
const DESKTOP_DIR = join(ROOT, "packages/desktop");

// Resolve the Electron binary — Bun hoists it under .bun/, so Playwright's
// default require('electron') lookup may fail. Resolve from the desktop
// package where electron is an actual dependency.
const desktopRequire = createRequire(join(DESKTOP_DIR, "package.json"));
const electronPath: string = desktopRequire("electron") as unknown as string;
const REMOTE_DEBUGGING_PORT = 9222;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

const ONLY = process.env.CSLOPE_CAPTURE_ONLY?.split(",").map((p) => p.trim()).filter(Boolean);
const selected = ONLY?.length ? scenes.filter((s) => ONLY.some((p) => s.id.startsWith(p))) : scenes;

const THEME_ENV = process.env.CSLOPE_CAPTURE_THEME;
if (THEME_ENV && THEME_ENV !== "light" && THEME_ENV !== "dark") {
  throw new Error(`CSLOPE_CAPTURE_THEME must be "light" or "dark", not "${THEME_ENV}"`);
}
const THEMES: CaptureTheme[] = THEME_ENV ? [THEME_ENV as CaptureTheme] : ["light", "dark"];

/**
 * The app's theme, in the main window and (through localStorage, which
 * they read when they open) in the dialog windows opened after this.
 */
async function setTheme(page: Page, theme: CaptureTheme) {
  await page.evaluate((t) => {
    localStorage.setItem("cslope-theme", t);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (window as any).__CSLOPE_STORE__;
    if (store) store.getState().setTheme(t);
    else document.documentElement.dataset.theme = t;
  }, theme);
}

async function main() {
  // the verification models are built with the engine here, in Bun
  await initEngine();
  const outDir = join(ROOT, OUTPUT_DIR);
  await mkdir(outDir, { recursive: true });

  console.log(`\n  Media Capture — ${selected.length} scenes, ${THEMES.join(" and ")} theme\n`);
  console.log(`  Output → ${join(ROOT, MEDIA_DIR)}/<scene dir>\n`);

  // Build the app with the capture bridge baked into the renderer bundle.
  // VITE_CAPTURE_MODE is an import.meta.env var — Vite replaces it at compile
  // time, so it MUST be set when vite build runs (not at Electron runtime).
  console.log("  Building app (VITE_CAPTURE_MODE=1)...\n");
  execSync("bunx vite build", {
    cwd: DESKTOP_DIR,
    stdio: "inherit",
    env: { ...process.env, VITE_CAPTURE_MODE: "1" },
  });
  console.log("");

  // Launch Electron in capture mode via CDP (more reliable with newer Electron versions).
  // CSLOPE_CAPTURE is a runtime env var read by the Electron main process
  // to skip the splash screen and show the main window immediately.
  console.log("  Launching Electron...\n");
  const electronProc = spawn(
    electronPath,
    [
      DESKTOP_DIR,
      `--remote-debugging-port=${REMOTE_DEBUGGING_PORT}`,
      // Sharp images: the window is drawn at CAPTURE_DPR device pixels per
      // CSS pixel (the display must be large enough, see the README).
      `--force-device-scale-factor=${CAPTURE_DPR}`,
      // Chromium refuses to run as root with the sandbox on (e.g. in a
      // container under xvfb); opt out only where that is needed.
      ...(process.env.CSLOPE_CAPTURE_NO_SANDBOX ? ["--no-sandbox"] : []),
    ],
    {
      cwd: DESKTOP_DIR,
      env: {
        ...process.env,
        CSLOPE_CAPTURE: "1",
        VITE_DEV_SERVER_URL: "",
        ELECTRON_ENABLE_LOGGING: "1",
      },
      stdio: "inherit",
    },
  );

  const browser = await withTimeout(
    connectToCdp(REMOTE_DEBUGGING_PORT),
    30_000,
    "Connecting to Electron CDP endpoint",
  );

  let page: Page;
  try {
    page = await withTimeout(
      getFirstPage(browser),
      20_000,
      "Waiting for first Electron window",
    );

    // Forward renderer console output for debugging
    page.on("console", (msg) => {
      const type = msg.type();
      const text = msg.text();
      if (type === "error") console.error(`  [renderer] ${text}`);
      else console.log(`  [renderer] ${text}`);
    });
    page.on("pageerror", (err) => {
      console.error(`  [renderer error] ${err.message}`);
    });

    console.log("  Window acquired, waiting for page load...\n");
    await page.waitForLoadState("domcontentloaded");
    console.log("  DOM loaded.\n");

    // Start in the light theme (a clean Electron profile has no localStorage).
    await setTheme(page, "light");

    // A fixed CSS size, rendered at CAPTURE_DPR for sharp images.
    await setPixelRatio(page, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);

    // Wait for the capture bridge to be ready
    console.log("  Waiting for capture bridge...\n");
    await withTimeout(
      page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__CSLOPE_CAPTURE_READY__ === true,
        { timeout: 30_000 },
      ),
      35_000,
      "Waiting for __CSLOPE_CAPTURE_READY__",
    );

    console.log("  App launched and capture bridge ready.\n");

    // Process each scene
    let passed = 0;
    let failed = 0;

    for (const theme of THEMES) {
      await setTheme(page, theme);
      for (const scene of selected) {
        const label = `  [${scene.id}, ${theme}] ${scene.title}`;
        try {
          const png = await captureScene(page, scene, theme);
          const dir = join(ROOT, MEDIA_DIR, scene.output.dir ?? "generated");
          const filename = themedFilename(scene.output.filename, theme);
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, filename), png);
          console.log(`  ✓ ${label} → ${scene.output.dir ?? "generated"}/${filename}`);
          passed++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  ✗ ${label} — ${msg}`);
          failed++;
        } finally {
          // Close the dialog windows the scene opened.
          for (const p of page.context().pages()) if (p !== page) await p.close().catch(() => {});
          await page.keyboard.press("Escape").catch(() => {});
        }
      }
    }

    console.log(
      `\n  Done: ${passed} captured, ${failed} failed, ${selected.length * THEMES.length} total.\n`,
    );

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    await stopElectron(electronProc);
  }
}

async function connectToCdp(port: number): Promise<Browser> {
  const endpoint = `http://127.0.0.1:${port}`;
  while (true) {
    try {
      const res = await fetch(`${endpoint}/json/version`);
      if (!res.ok) {
        throw new Error(`CDP discovery HTTP ${res.status}`);
      }
      const data = (await res.json()) as { webSocketDebuggerUrl?: string };
      if (!data.webSocketDebuggerUrl) {
        throw new Error("CDP discovery missing webSocketDebuggerUrl");
      }
      return await chromium.connectOverCDP(data.webSocketDebuggerUrl);
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

async function getFirstPage(browser: Browser): Promise<Page> {
  while (true) {
    for (const context of browser.contexts()) {
      const pages = context.pages();
      if (pages.length > 0) {
        return pages[0];
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function stopElectron(proc: ChildProcess): Promise<void> {
  if (proc.killed || proc.exitCode !== null) return;
  proc.kill();
  const exited = await new Promise<boolean>((resolve) => {
    proc.once("exit", () => resolve(true));
    setTimeout(() => resolve(false), 2_000);
  });
  // A stale instance would keep the debugging port and be picked up by
  // the next run, which would then capture an old build.
  if (!exited && proc.exitCode === null) proc.kill("SIGKILL");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
