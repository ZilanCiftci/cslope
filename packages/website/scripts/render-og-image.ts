/**
 * Renders public/og-image.png (1200 × 630, the preview shown when a link
 * to the site is shared) from og-image.html with Chromium.
 *
 *   bun scripts/render-og-image.ts
 *
 * CHROMIUM_PATH points Playwright at an installed Chromium instead of its
 * own download; CSLOPE_CAPTURE_NO_SANDBOX=1 is needed when running as root.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import data from "../src/content/generated/verification.json";

const root = join(import.meta.dirname, "..");
const s = data.summary;
const html = readFileSync(join(root, "scripts/og-image.html"), "utf8")
  .replace("{{FIGURES}}", `${s.problems} verification problems · ${s.checks} reference values`)
  .replace(
    "{{FONTS}}",
    ["@fontsource-variable/inter/index.css", "@fontsource/ibm-plex-mono/400.css"]
      .map((css) => `<link rel="stylesheet" href="${pathToFileURL(join(root, "node_modules", css)).href}" />`)
      .join(""),
  )
  .replace("{{IMAGE}}", pathToFileURL(join(root, "public/media/generated/result-critical-surface.png")).href);
const page = join(root, "node_modules/.cache/og-image.html");
mkdirSync(join(page, ".."), { recursive: true });
writeFileSync(page, html);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: process.env.CSLOPE_CAPTURE_NO_SANDBOX ? ["--no-sandbox"] : [],
});
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await tab.goto(pathToFileURL(page).href, { waitUntil: "networkidle" });
await tab.screenshot({ path: join(root, "public/og-image.png") });
await browser.close();
console.log("public/og-image.png");
