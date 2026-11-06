/**
 * Smoke test of the built app: serves dist as Vercel does (scripts/
 * preview.ts, with the content security policy) and opens the page in
 * Chromium, in the light and the dark theme. It fails on a console error
 * (a script, a font or the WebAssembly the policy blocks), an uncaught
 * exception, a failed request or an accessibility violation (axe-core).
 * Then it runs T-ACADS Simple through the worker (window.cslopeWeb, the
 * developer check of main.tsx) and expects F 0.984, so that a policy that
 * blocks the engine, or a worker that does not start, fails the build. It
 * also checks that the engine is served as a hashed asset with a long
 * cache, and that a phone shows the page without scrolling sideways.
 * The website's scripts/smoke.ts, for one page.
 *
 * Usage: bun run build && bun scripts/smoke.ts   (bun run smoke)
 * CHROMIUM_PATH points Playwright at an installed Chromium instead of its own.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, devices, type Browser, type Page } from "playwright";
import { startPreview } from "./preview";

const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

/** T-ACADS Simple (the app's first example), as the worker's protocol test runs it: F 0.984. */
const T_ACADS_SIMPLE = {
  format: "cslope-analysis",
  formatVersion: 1,
  definition: {
    orientation: "ltr",
    coordinates: [
      [0, -15],
      [0, 0],
      [20, 0],
      [40, -10],
      [50, -10],
      [50, -15],
    ],
    materials: [{ name: "M1", model: { kind: "mohr-coulomb", unitWeight: 20, frictionAngle: 19.6, cohesion: 3 } }],
    analysisLimits: { entryLeftX: 17, entryRightX: 22, exitLeftX: 37, exitRightX: 43 },
  },
  options: {},
};

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

/** Opens the page and returns what is wrong with it. */
async function checkPage(page: Page, base: string): Promise<string[]> {
  const problems: string[] = [];
  const responses: { url: string; headers: Record<string, string> }[] = [];
  const onConsole = (m: { type(): string; text(): string }) => {
    if (m.type() === "error") problems.push(`console error: ${m.text()}`);
  };
  const onError = (e: Error) => problems.push(`uncaught: ${e.message}`);
  const onResponse = (r: { url(): string; headers(): Record<string, string> }) => responses.push({ url: r.url(), headers: r.headers() });
  const onFailed = (r: { url(): string; failure(): { errorText: string } | null }) =>
    problems.push(`request failed: ${r.url()} (${r.failure()?.errorText})`);
  page.on("console", onConsole);
  page.on("pageerror", onError);
  page.on("response", onResponse);
  page.on("requestfailed", onFailed);
  try {
    const res = await page.goto(base + "/", { waitUntil: "networkidle" });
    if (res?.status() !== 200) problems.push(`status ${res?.status()}, expected 200`);
    try {
      await page.getByRole("status").filter({ hasText: "Engine ready" }).waitFor({ timeout: 30_000 });
    } catch {
      problems.push(`the engine did not get ready: "${await page.getByRole("status").textContent()}"`);
    }
    const wasm = responses.find((r) => new URL(r.url).pathname.endsWith(".wasm"));
    if (!wasm) problems.push("the page did not load the engine's .wasm");
    else {
      const path = new URL(wasm.url).pathname;
      if (!/^\/assets\/[\w-]+-[\w-]{8}\.wasm$/.test(path)) problems.push(`the engine is served as ${path}, not as a hashed asset`);
      if (!/immutable/.test(wasm.headers["cache-control"] ?? "")) problems.push(`the engine's cache-control is "${wasm.headers["cache-control"]}", not immutable`);
    }
    for (const v of await axeViolations(page)) {
      problems.push(`axe ${v.id} (${v.impact}): ${v.help} at ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`);
    }
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onError);
    page.off("response", onResponse);
    page.off("requestfailed", onFailed);
  }
  return problems;
}

/** An analysis through the worker, from the page: T-ACADS Simple gives F 0.984. */
async function checkAnalysis(page: Page, base: string): Promise<string[]> {
  const problems: string[] = [];
  const onError = (e: Error) => problems.push(`uncaught: ${e.message}`);
  page.on("pageerror", onError);
  await page.goto(base + "/", { waitUntil: "networkidle" });
  try {
    const outcome = await page.evaluate(async (doc) => {
      const progress: number[] = [];
      const o = await (window as unknown as { cslopeWeb: { run(d: unknown, p: (n: number) => void): Promise<unknown> } }).cslopeWeb.run(doc, (n) => progress.push(n));
      return { ...(o as { kind: string; summary?: { fosText: string; fos: number } }), progress: progress.length };
    }, T_ACADS_SIMPLE);
    if (outcome.kind !== "complete") problems.push(`the analysis did not complete: ${JSON.stringify(outcome)}`);
    else if (outcome.summary?.fosText !== "0.984") problems.push(`T-ACADS Simple gave F ${outcome.summary?.fosText}, expected 0.984`);
    else if (!outcome.progress) problems.push("the run reported no progress");
    else console.log(`  T-ACADS Simple: F ${outcome.summary.fosText} after ${outcome.progress} progress messages`);
  } catch (e) {
    problems.push(`the analysis threw: ${e instanceof Error ? e.message : String(e)}`);
  }
  page.off("pageerror", onError);
  return problems;
}

/** On a phone, the page does not scroll sideways. */
async function checkPhone(browser: Browser, base: string): Promise<string[]> {
  const problems: string[] = [];
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();
  await page.goto(base + "/", { waitUntil: "networkidle" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) problems.push(`the page is ${overflow} px wider than the phone`);
  await context.close();
  return problems;
}

/** A path that is not the page gets a 404, with the policy. */
async function checkNotFound(page: Page, base: string): Promise<string[]> {
  const res = await page.goto(base + "/no-such-page");
  const problems: string[] = [];
  if (res?.status() !== 404) problems.push(`status ${res?.status()}, expected 404`);
  if (!res?.headers()["content-security-policy"]) problems.push("no content security policy on the 404 answer");
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
    for (const colorScheme of ["light", "dark"] as const) {
      const context = await browser.newContext({ colorScheme });
      const page = await context.newPage();
      report(`/ (${colorScheme})`, await checkPage(page, server.url));
      await context.close();
    }
    const context = await browser.newContext();
    report("analysis", await checkAnalysis(await context.newPage(), server.url));
    report("/no-such-page", await checkNotFound(await context.newPage(), server.url));
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
  console.log("\nThe page loads without errors or accessibility violations, and the engine runs in its worker.");
}

if (import.meta.main) await main();
