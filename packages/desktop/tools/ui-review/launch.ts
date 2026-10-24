/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate() runs in the renderer without type imports */
// UI-review harness: launches the built app in
// capture mode under xvfb and returns the main page.
import { chromium, type Browser, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

export const ROOT = resolve(import.meta.dirname, "../../../..");
const DESKTOP = join(ROOT, "packages/desktop");
const electronPath = createRequire(join(DESKTOP, "package.json"))("electron") as unknown as string;
export const OUT = process.env.UI_OUT ?? join(tmpdir(), "cslope-ui-review");
mkdirSync(OUT, { recursive: true });

export async function launch(port = 9333): Promise<{ page: Page; browser: Browser; proc: ChildProcess }> {
  const proc = spawn(electronPath, [DESKTOP, `--remote-debugging-port=${port}`, "--force-device-scale-factor=1", "--no-sandbox"], {
    cwd: DESKTOP, env: { ...process.env, CSLOPE_CAPTURE: "1", VITE_DEV_SERVER_URL: "" }, stdio: "ignore",
  });
  let browser: Browser | null = null;
  for (let i = 0; i < 200 && !browser; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      const d = (await r.json()) as { webSocketDebuggerUrl: string };
      browser = await chromium.connectOverCDP(d.webSocketDebuggerUrl);
    } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  if (!browser) throw new Error("no CDP");
  let page: Page | undefined;
  for (let i = 0; i < 200 && !page; i++) { page = browser.contexts()[0]?.pages()[0]; if (!page) await new Promise((r) => setTimeout(r, 100)); }
  await page!.waitForLoadState("domcontentloaded");
  await page!.waitForFunction(() => (window as any).__CSLOPE_CAPTURE_READY__ === true, { timeout: 30000 });
  page!.on("pageerror", (e) => console.error("[pageerror]", e.message));
  return { page: page!, browser, proc };
}

export async function stop(browser: Browser, proc: ChildProcess) {
  await browser.close().catch(() => {});
  proc.kill(); await new Promise((r) => setTimeout(r, 500)); if (proc.exitCode === null) proc.kill("SIGKILL");
}

export const store = (page: Page) => (fn: string) => page.evaluate(fn);
export async function shot(p: Page, name: string, full = false) {
  await p.waitForTimeout(250);
  await p.screenshot({ path: join(OUT, `${name}.png`), fullPage: full });
  console.log("shot", name);
}
