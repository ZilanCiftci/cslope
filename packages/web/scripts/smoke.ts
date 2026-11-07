/**
 * Smoke test of the built app: serves dist as Vercel does (scripts/
 * preview.ts, with the content security policy) and opens the page in
 * Chromium, in the light and the dark theme. It fails on a console error
 * (a script, a font or the WebAssembly the policy blocks), an uncaught
 * exception, a failed request or an accessibility violation (axe-core, on
 * the empty form and on a result). The first visit computes F of the
 * excavation's defaults at once (the pinned F); the embankment's first
 * visit asks for its empty strengths. It opens a filled-in section from its
 * link, waits for F with its label, changes a parameter and waits for the
 * new F; on the embankment it opens a layer and its color picker, moves the
 * layer down and waits for the new F. Then it runs T-ACADS Simple through the worker (window.cslopeWeb,
 * the developer check of main.tsx) and expects F 0.984, so that a policy
 * that blocks the engine, or a worker that does not start, fails the
 * build. It also checks that the engine is served as a hashed asset with a
 * long cache, and that a phone shows the page, with a result, without
 * scrolling sideways. The website's scripts/smoke.ts, for one page.
 *
 * Usage: bun run build && bun scripts/smoke.ts   (bun run smoke)
 * CHROMIUM_PATH points Playwright at an installed Chromium instead of its own.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, devices, type Browser, type Page } from "playwright";
import { startPreview } from "./preview";
import EXPECTED from "../src/templates/fixtures/expected.json";

/** The result card's text of a pinned F of the excavation's examples ("F 0.784"). */
const pinned = (name: keyof typeof EXPECTED) => `F ${EXPECTED[name].fos.toFixed(3)}`;

const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

/**
 * A filled-in section, as its link gives it (the address holds the
 * parameters): a crust over clay with a haul road.
 */
export const FILLED =
  "t=excavation&ground=0&H=4&slope=2&water=-1&layers=2&layer1.name=Crust&layer1.kind=mohr-coulomb&layer1.t=1.5&layer1.gamma=18&layer1.c=2&layer1.phi=32" +
  "&layer2.name=Clay&layer2.kind=undrained&layer2.t=18.5&layer2.gamma=16.5&layer2.su=18&layer2.suRate=1.2" +
  "&road=on&road.distanceFromCrest=2&road.width=4&road.height=0.5&road.gamma=20&road.c=0&road.phi=38&road.trafficLoad=20";

/** A filled-in embankment, as its link gives it ("t=embankment"): a crust over clay with a load on the crest. */
export const EMBANKMENT =
  "t=embankment&ground=0&h=3&B=10&slope=2&fill.gamma=20&fill.c=0&fill.phi=38&q=10&water=-1&layers=2" +
  "&layer1.name=Crust&layer1.kind=mohr-coulomb&layer1.t=1.5&layer1.gamma=18&layer1.c=3&layer1.phi=30" +
  "&layer2.name=Clay&layer2.kind=undrained&layer2.t=18.5&layer2.gamma=16&layer2.su=14";

/** A one-sided excavation with ponded water 2 m above its bottom (the example clay-5m-ponded). */
export const PONDED =
  "t=excavation&ground=10&H=5&slope=2&water=7&layers=2&layer1.kind=undrained&layer1.t=20&layer1.gamma=16&layer1.su=25" +
  "&layer2.kind=impenetrable&layer2.t=10&layer2.gamma=24&pond=1";

/** The value F of the result card, once it shows one ("F 1.234"). */
const fValue = (page: Page) => page.locator("#result").getByText(/^F \d+\.\d{3}$/);

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

/** Opens the page, empty and then filled in, and returns what is wrong with it. */
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
  const axe = async (where: string) => {
    for (const v of await axeViolations(page)) {
      problems.push(`axe ${v.id} (${v.impact}) ${where}: ${v.help} at ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`);
    }
  };
  page.on("console", onConsole);
  page.on("pageerror", onError);
  page.on("response", onResponse);
  page.on("requestfailed", onFailed);
  try {
    // The first visit: the excavation's defaults, complete, so that F comes at once.
    const res = await page.goto(base + "/", { waitUntil: "load" });
    if (res?.status() !== 200) problems.push(`status ${res?.status()}, expected 200`);
    try {
      await fValue(page).waitFor({ timeout: 30_000 });
      const f = await fValue(page).textContent();
      if (f !== pinned("defaults")) problems.push(`the first visit gave ${f}, expected ${pinned("defaults")}`);
      console.log(`  first visit: ${f}`);
      await axe("on the first visit");
    } catch (e) {
      problems.push(`the first visit: "${await page.getByRole("status").first().textContent()}" (${e instanceof Error ? e.message.split("\n")[0] : e})`);
    }

    // The embankment's first visit: no strengths, so it asks for them and does not run.
    await page.goto(base + "/?t=embankment", { waitUntil: "networkidle" });
    const status = page.getByRole("status").first();
    if (!/fill in \d+ empty fields/.test((await status.textContent()) ?? "")) problems.push(`the empty form says "${await status.textContent()}"`);
    await axe("on the empty form");

    // A link to a filled-in section: F within about a second, then a change and the new F.
    const started = Date.now();
    await page.goto(`${base}/?${FILLED}`, { waitUntil: "load" });
    try {
      await fValue(page).waitFor({ timeout: 30_000 });
      const first = await fValue(page).textContent();
      const label = await page.locator("#result").getByText("Minimum factor of safety", { exact: true }).count();
      if (!label) problems.push("F shows without its label");
      console.log(`  ${first} after ${Date.now() - started} ms (loading the page and the engine)`);
      await page.getByLabel("Excavation depth H (m)").fill("3");
      await page.waitForFunction((before) => {
        const el = [...document.querySelectorAll("p")].find((p) => /^F \d+\.\d{3}$/.test(p.textContent ?? ""));
        return el && el.textContent !== before && !el.closest(".opacity-50");
      }, first, { timeout: 30_000 });
      const second = await fValue(page).textContent();
      console.log(`  H 4 m → 3 m: ${first} → ${second}`);
      if (!new URL(page.url()).searchParams.get("H")?.startsWith("3")) problems.push(`the address did not follow the change: ${page.url()}`);
      // Two columns: the result stays in view while the form scrolls; the phone's bar is hidden.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const box = await fValue(page).boundingBox();
      const height = page.viewportSize()?.height ?? 0;
      if (!box || box.y < 0 || box.y + box.height > height) problems.push(`F is out of view after scrolling the form (at ${box?.y} of ${height} px)`);
      if (await page.getByRole("complementary", { name: "Result summary" }).isVisible()) problems.push("the phone's result bar shows on a wide screen");
    } catch (e) {
      problems.push(`no result: "${await page.getByRole("status").first().textContent()}" (${e instanceof Error ? e.message.split("\n")[0] : e})`);
    }
    const wasm = responses.find((r) => new URL(r.url).pathname.endsWith(".wasm"));
    if (!wasm) problems.push("the page did not load the engine's .wasm");
    else {
      const path = new URL(wasm.url).pathname;
      if (!/^\/assets\/[\w-]+-[\w-]{8}\.wasm$/.test(path)) problems.push(`the engine is served as ${path}, not as a hashed asset`);
      if (!/immutable/.test(wasm.headers["cache-control"] ?? "")) problems.push(`the engine's cache-control is "${wasm.headers["cache-control"]}", not immutable`);
    }
    await axe("with a result");

    // The embankment from its link: its template is chosen, F shows with its label.
    await page.goto(`${base}/?${EMBANKMENT}`, { waitUntil: "load" });
    try {
      if (!(await page.getByRole("heading", { level: 1, name: "Embankment on clay" }).count())) problems.push("the embankment's link does not open the embankment");
      if ((await page.getByRole("button", { name: "Embankment on clay" }).getAttribute("aria-pressed")) !== "true") problems.push("the picker does not show the embankment as chosen");
      await fValue(page).waitFor({ timeout: 30_000 });
      const f = await fValue(page).textContent();
      if (!(await page.locator("#result").getByText("Minimum factor of safety").count())) problems.push("the embankment's F shows without its label");
      console.log(`  embankment: ${f}`);
      await axe("on the embankment with a result");
      // A layer opened from its header (the accordion), checked by axe.
      const crust = page.getByRole("button", { name: /^Crust/ });
      await crust.click();
      if ((await crust.getAttribute("aria-expanded")) !== "true") problems.push("a layer's header does not open the layer");
      await axe("on the embankment with a layer open");
      // The layer's color picker, open, checked by axe; Escape closes it.
      await page.getByRole("button", { name: "Color", exact: true }).click();
      await page.getByRole("listbox", { name: "Color of Crust" }).waitFor({ timeout: 5_000 });
      await axe("with a layer's color picker open");
      await page.keyboard.press("Escape");
      // A move: the crust goes below the clay, the address follows with the thicknesses, and F is computed again.
      const before = await fValue(page).textContent();
      await page.getByRole("button", { name: "Move Crust down" }).click();
      await page.waitForFunction(() => new URLSearchParams(location.search).get("layer1.name") === "Clay", null, { timeout: 5_000 });
      const q = new URL(page.url()).searchParams;
      if (q.get("layer1.t") !== "18.5" || q.get("layer2.t") !== "1.5") problems.push(`after a move the address has the thicknesses ${q.get("layer1.t")}, ${q.get("layer2.t")}, expected 18.5, 1.5`);
      await page.waitForFunction((b) => {
        const el = [...document.querySelectorAll("#result p")].find((p) => /^F \d+\.\d{3}$/.test(p.textContent ?? ""));
        return el && el.textContent !== b && !el.closest(".opacity-50");
      }, before, { timeout: 30_000 });
      console.log(`  embankment, crust moved below the clay: ${before} → ${await fValue(page).textContent()}`);
      await page.getByRole("button", { name: "Excavation in clay with a haul road" }).click();
      await page.getByRole("heading", { level: 1, name: "Excavation in clay with a haul road" }).waitFor({ timeout: 5_000 });
      await page.waitForFunction(() => new URLSearchParams(location.search).get("t") === "excavation", null, { timeout: 5_000 });
    } catch (e) {
      problems.push(`the embankment: "${await page.getByRole("status").first().textContent()}" (${e instanceof Error ? e.message.split("\n")[0] : e})`);
    }

    // Ponded water from its link: the checkbox is on and F is the pinned one.
    await page.goto(`${base}/?${PONDED}`, { waitUntil: "load" });
    try {
      if (!(await page.getByRole("checkbox", { name: "Free water above ground (ponding)" }).isChecked())) problems.push("the ponded link does not check Free water above ground");
      await fValue(page).waitFor({ timeout: 30_000 });
      const f = await fValue(page).textContent();
      if (f !== pinned("clay-5m-ponded")) problems.push(`the ponded excavation gave ${f}, expected ${pinned("clay-5m-ponded")}`);
      console.log(`  ponded excavation: ${f}`);
      await axe("with ponded water");
    } catch (e) {
      problems.push(`ponded water: "${await page.getByRole("status").first().textContent()}" (${e instanceof Error ? e.message.split("\n")[0] : e})`);
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
async function checkPhone(browser: Browser, base: string, colorScheme: "light" | "dark", query: string): Promise<string[]> {
  const problems: string[] = [];
  const context = await browser.newContext({ ...devices["iPhone 13"], colorScheme });
  const page = await context.newPage();
  await page.goto(`${base}/?${query}`, { waitUntil: "load" });
  await fValue(page).waitFor({ timeout: 30_000 }).catch(() => problems.push("no result on the phone"));
  const bar = page.getByRole("complementary", { name: "Result summary" });
  if (!(await bar.isVisible())) problems.push("the result bar does not show on the phone");
  else if (!/^F \d+\.\d{3}/.test((await bar.textContent()) ?? "")) problems.push(`the result bar says "${await bar.textContent()}"`);
  for (const v of await axeViolations(page)) problems.push(`axe ${v.id} (${v.impact}) on the phone: ${v.help} at ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`);
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
    for (const colorScheme of ["light", "dark"] as const) {
      report(`phone (${colorScheme})`, await checkPhone(browser, server.url, colorScheme, FILLED));
      report(`phone, embankment (${colorScheme})`, await checkPhone(browser, server.url, colorScheme, EMBANKMENT));
    }
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
