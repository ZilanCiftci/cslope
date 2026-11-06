/**
 * Smoke test of the built site: serves dist as Vercel does
 * (scripts/preview.ts, with the content security policy) and opens every
 * page in Chromium, in the light and the dark theme. A page fails on a
 * console error (a hydration error, a script or font the policy blocks),
 * an uncaught exception, a failed request, an accessibility violation
 * (axe-core) or a request for data it does not need (the verification
 * table or the changelog outside their pages). It also checks that a
 * phone shows the verification results without scrolling sideways.
 *
 * Usage: bun run build && bun scripts/smoke.ts   (bun run smoke)
 * CHROMIUM_PATH points Playwright at an installed Chromium instead of its
 * own (as for scripts/render-og-image.ts).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { chromium, devices, type Browser, type Page } from "playwright";
import { startPreview } from "./preview";

const ROOT = join(import.meta.dirname, "..");

/** Every page the site serves: the sources of the rewrites in vercel.json. */
export function sitePages(): string[] {
  const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as { rewrites: { source: string }[] };
  return vercel.rewrites.map((r) => r.source);
}

/** Chunks that only one page may load. */
const ONLY_ON: { chunk: RegExp; page: string }[] = [
  { chunk: /\/assets\/Verification-[\w-]+\.js$/, page: "/verification" },
  { chunk: /\/assets\/Changelog-[\w-]+\.js$/, page: "/changelog" },
];

const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: unknown[] }[];
}

async function axeViolations(page: Page): Promise<AxeViolation[]> {
  // Evaluated by the browser's debugger, which the page's policy does not restrict.
  await page.evaluate(AXE);
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, o: object) => Promise<{ violations: AxeViolation[] }> } }).axe;
    const r = await axe.run(document, { resultTypes: ["violations"] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target })) }));
  });
}

/** Opens a page and returns what is wrong with it. */
async function checkPage(page: Page, base: string, path: string, expectStatus = 200): Promise<string[]> {
  const problems: string[] = [];
  const requests: string[] = [];
  const onConsole = (m: { type(): string; text(): string; location(): { url: string } }) => {
    // The browser reports the not-found page's own 404 as an error.
    if (expectStatus === 404 && m.location().url === base + path) return;
    if (m.type() === "error") problems.push(`console error: ${m.text()}`);
  };
  const onError = (e: Error) => problems.push(`uncaught: ${e.message}`);
  const onRequest = (r: { url(): string }) => requests.push(r.url());
  const onFailed = (r: { url(): string; failure(): { errorText: string } | null }) =>
    problems.push(`request failed: ${r.url()} (${r.failure()?.errorText})`);
  page.on("console", onConsole);
  page.on("pageerror", onError);
  page.on("request", onRequest);
  page.on("requestfailed", onFailed);
  try {
    const res = await page.goto(base + path, { waitUntil: "networkidle" });
    if (res?.status() !== expectStatus) problems.push(`status ${res?.status()}, expected ${expectStatus}`);
    for (const { chunk, page: only } of ONLY_ON) {
      const hit = requests.find((u) => chunk.test(new URL(u).pathname));
      if (hit && path !== only) problems.push(`loads ${new URL(hit).pathname}, which only ${only} needs`);
    }
    for (const v of await axeViolations(page)) {
      problems.push(`axe ${v.id} (${v.impact}): ${v.help} at ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`);
    }
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onError);
    page.off("request", onRequest);
    page.off("requestfailed", onFailed);
  }
  return problems;
}

/** On a phone, the first verification problem's cSlope result is on screen, and the page does not scroll sideways. */
async function checkPhone(browser: Browser, base: string): Promise<string[]> {
  const problems: string[] = [];
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();
  for (const path of ["/verification", "/"]) {
    await page.goto(base + path, { waitUntil: "networkidle" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) problems.push(`${path}: the page is ${overflow} px wider than the phone`);
  }
  await page.goto(base + "/verification", { waitUntil: "networkidle" });
  // The first problem's first analysis: its last cell is cSlope's result.
  const value = page.getByRole("region", { name: "Verification problems" }).locator("tbody tr").first().locator("td").last();
  const box = await value.waitFor({ timeout: 5000 }).then(
    () => value.boundingBox(),
    () => null,
  );
  const width = page.viewportSize()!.width;
  if (!box) problems.push("/verification: the first cSlope result is not visible on a phone");
  else if (box.x < 0 || box.x + box.width > width) problems.push(`/verification: the first cSlope result is outside the screen (x ${box.x}, width ${width})`);
  // The home page's examples: each problem's cell is wide enough for its title to wrap at word groups.
  await page.goto(base + "/", { waitUntil: "networkidle" });
  const cells = page.getByRole("region", { name: "Examples of published and computed factors of safety" }).locator("tbody td:first-child");
  for (const cell of await cells.all()) {
    const w = (await cell.boundingBox())?.width ?? 0;
    if (w < width / 2) problems.push(`/: an example's problem cell is ${Math.round(w)} px wide on a ${width} px phone`);
  }
  await context.close();
  return problems;
}

/** A page opened from another, without reloading: a lazily loaded page loads and renders. */
async function checkNavigation(page: Page, base: string): Promise<string[]> {
  const problems: string[] = [];
  const onError = (e: Error) => problems.push(`uncaught: ${e.message}`);
  page.on("pageerror", onError);
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Every problem and result" }).click();
  try {
    await page.getByRole("heading", { level: 1, name: "Every result, next to the published ones" }).waitFor({ timeout: 10_000 });
  } catch {
    problems.push("/ → /verification: the verification page did not appear");
  }
  page.off("pageerror", onError);
  return problems;
}

async function main() {
  const server = await startPreview({ port: 0 });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const failures: string[] = [];
  const report = (where: string, problems: string[]) => {
    for (const p of problems) failures.push(`${where}: ${p}`);
    console.log(`${problems.length ? "FAIL" : "ok  "} ${where}${problems.length ? `\n  ${problems.join("\n  ")}` : ""}`);
  };
  try {
    const pages = sitePages();
    for (const colorScheme of ["light", "dark"] as const) {
      const context = await browser.newContext({ colorScheme });
      const page = await context.newPage();
      for (const path of pages) report(`${path} (${colorScheme})`, await checkPage(page, server.url, path));
      report(`/no-such-page (${colorScheme})`, await checkPage(page, server.url, "/no-such-page", 404));
      await context.close();
    }
    const context = await browser.newContext();
    report("navigation", await checkNavigation(await context.newPage(), server.url));
    await context.close();
    report("phone", await checkPhone(browser, server.url));
  } finally {
    await browser.close();
    await server.close();
  }
  if (failures.length) {
    console.error(`\n${failures.length} problems.`);
    process.exit(1);
  }
  console.log("\nEvery page loads without errors or accessibility violations.");
}

if (import.meta.main) await main();
