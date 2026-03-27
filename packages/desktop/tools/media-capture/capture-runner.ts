#!/usr/bin/env bun
/**
 * Media Capture Runner
 *
 * Builds the Electron app with VITE_CAPTURE_MODE=1 baked into the renderer,
 * then launches it via Playwright to iterate scene definitions and produce
 * deterministic PNG screenshots.
 *
 * Usage:  bun run packages/desktop/tools/media-capture/capture-runner.ts
 */

import { chromium, type Browser, type Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { scenes } from "../../../website/src/content/media-scenes";
import { captureScene } from "./store-capture";
import { VIEWPORT_WIDTH, VIEWPORT_HEIGHT, OUTPUT_DIR } from "./capture-config";

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

async function main() {
  const outDir = join(ROOT, OUTPUT_DIR);
  await mkdir(outDir, { recursive: true });

  console.log(`\n  Media Capture — ${scenes.length} scenes\n`);
  console.log(`  Output → ${outDir}\n`);

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
    [DESKTOP_DIR, `--remote-debugging-port=${REMOTE_DEBUGGING_PORT}`],
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

    // Force light theme (clean Electron profile has no localStorage)
    await page.evaluate(() => {
      localStorage.setItem("cslope-theme", "light");
      document.documentElement.dataset.theme = "light";
    });

    await page.setViewportSize({
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
    });

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

    for (const scene of scenes) {
      const label = `  [${scene.id}] ${scene.title}`;
      try {
        const png = await captureScene(page, scene);
        const outPath = join(outDir, scene.output.filename);
        await writeFile(outPath, png);
        console.log(`  ✓ ${label} → ${scene.output.filename}`);
        passed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${label} — ${msg}`);
        failed++;
      }
    }

    console.log(
      `\n  Done: ${passed} captured, ${failed} failed, ${scenes.length} total.\n`,
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
  await new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
    setTimeout(resolve, 2_000);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
