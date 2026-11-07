/**
 * Captures the home page's screenshot of cSlope in the browser
 * (packages/web, app.cslope.com): the built web app, served as Vercel
 * serves it (its scripts/preview.ts), opened at the filled-in link the home
 * page gives (SITE.appExample), once the result shows, in the light and the
 * dark theme. Writes public/media/web/app.png and app-dark.png; then run
 * bun scripts/media-sizes.ts for the WebP variants and the sizes.
 *
 * Capture from the build of origin/main's packages/web, which is what
 * app.cslope.com serves:
 *
 *   (cd ../web && bun run build) && bun scripts/capture-web.ts
 *
 * CHROMIUM_PATH points Playwright at an installed Chromium instead of its own.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { startPreview } from "../../web/scripts/preview";
import { SITE } from "../src/site";

const OUT = join(import.meta.dirname, "..", "public/media/web");
/** A laptop's window, cut under F and its label; at twice its size, as the app's captures are. */
const VIEWPORT = { width: 1280, height: 700 };

async function main() {
  const server = await startPreview({ dist: process.argv[2] ?? "dist", port: 0 });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  mkdirSync(OUT, { recursive: true });
  try {
    const link = new URL(SITE.appExample);
    for (const colorScheme of ["light", "dark"] as const) {
      const context = await browser.newContext({ colorScheme, viewport: VIEWPORT, deviceScaleFactor: 2 });
      const page = await context.newPage();
      await page.goto(`${server.url}/${link.search}`, { waitUntil: "networkidle" });
      await page.locator("#result").getByText(/^F \d+\.\d{3}$/).waitFor({ timeout: 30_000 });
      // Let the drawing settle (fonts, the section's transition) before the shot.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      const file = join(OUT, colorScheme === "dark" ? "app-dark.png" : "app.png");
      await page.screenshot({ path: file });
      console.log(`${colorScheme}: ${file}`);
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

if (import.meta.main) await main();
