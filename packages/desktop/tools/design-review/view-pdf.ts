/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate() runs in the renderer without type imports */
/**
 * The result view and its PDF page side by side: for each model, the sheet
 * as the window shows it (light, and dark) and page 1 of "Export as PDF…"
 * from the same state, rendered with pdftoppm and put beside it. The view
 * previews the export, so the two should look the same.
 *
 *   CSLOPE_CAPTURE_NO_SANDBOX=1 xvfb-run -a -s "-screen 0 3000x2000x24" \
 *     bun packages/desktop/tools/design-review/view-pdf.ts [out dir]
 *
 * Models: V002, V038b and V085 as Help › Benchmarks opens them, and the
 * first example with its material table and a color bar. VIEW_PDF_ONLY=v002,user
 * picks some; VIEW_PDF_GRID=1 turns the grid on with a fixed spacing and minor
 * lines; DESIGN_REVIEW_SKIP_BUILD=1 reuses the last build. Needs
 * pdftoppm and ImageMagick's convert.
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initEngine } from "@cslope/engine";
import { VERIFICATION_CASES } from "@cslope/engine/verification";
import type { Page } from "playwright";
import { verificationModel } from "../../src/store/verification-models";
import { DESKTOP_DIR, OUT_DIR, launchApp, runAnalysis, setViewport, stopApp, store } from "./lib";

const OUT = process.argv[2] ?? join(OUT_DIR, "view-pdf");
const ONLY = process.env.VIEW_PDF_ONLY?.split(",").map((s) => s.trim().toLowerCase());
const SIZE = { width: 1440, height: 900 };
const DPR = 2;

type Case = { id: string; model: unknown | null };

async function cases(): Promise<Case[]> {
  await initEngine();
  const bench = (id: string): Case => {
    const c = VERIFICATION_CASES.find((v) => v.id === id)!;
    return { id: id.toLowerCase(), model: verificationModel(c, undefined, `${c.id} ${c.title}`, { titleBlock: true }) };
  };
  return [bench("V002"), bench("V038b"), bench("V085"), { id: "user", model: null }];
}

async function load(page: Page, model: unknown | null) {
  await page.evaluate((model) => {
    const s = (window as any).__CSLOPE_STORE__.getState();
    if (model) {
      s.loadProject({ models: [model], activeModelId: (model as any).id });
      return;
    }
    // A user's model: the first example, with its material table and a color bar.
    s.loadExamples();
    const first = (window as any).__CSLOPE_STORE__.getState().models[0];
    s.loadProject({ models: [first], activeModelId: first.id });
  }, model);
  await runAnalysis(page);
  await store(page, `(s) => { s.setMode("result"); if (!s.resultViewSettings.annotations.some((a) => a.type === "color-bar")) { s.addAnnotation("color-bar"); } s.setSelectedAnnotations([]); }`);
  // VIEW_PDF_GRID=1: the grid on, a fixed spacing of 2 m with minor lines (Layers › Grid).
  if (process.env.VIEW_PDF_GRID) {
    await store(page, `(s) => s.setResultViewSettings({ showGrid: true, gridSpacing: undefined, gridLineSpacing: 2, layerStyles: { ...s.resultViewSettings.layerStyles, grid: { subdivisions: 4 } } })`);
  }
  await page.waitForTimeout(800);
}

/** Page 1 of "Export as PDF…" as a PNG next to `png`. */
async function exportPdf(page: Page, pdfPath: string) {
  // The export saves through a blob URL: keep the PDF blob it is made of.
  await page.evaluate(() => {
    (window as any).__pdfBytes = null;
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      if (obj instanceof Blob && obj.type === "application/pdf") {
        void obj.arrayBuffer().then((b) => ((window as any).__pdfBytes = Array.from(new Uint8Array(b))));
      }
      return create(obj);
    };
  });
  await page.getByRole("button", { name: "Export as PDF", exact: true }).click();
  await page.waitForFunction(() => (window as any).__pdfBytes !== null, undefined, { timeout: 30_000 });
  const bytes = (await page.evaluate(() => (window as any).__pdfBytes)) as number[];
  writeFileSync(pdfPath, Uint8Array.from(bytes));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!process.env.DESIGN_REVIEW_SKIP_BUILD) {
    execSync("bunx vite build", { cwd: DESKTOP_DIR, stdio: "inherit", env: { ...process.env, VITE_CAPTURE_MODE: "1" } });
  } else if (!existsSync(join(DESKTOP_DIR, "dist", "index.html"))) {
    throw new Error("No build in packages/desktop/dist");
  }
  const all = await cases();
  const selected = ONLY ? all.filter((c) => ONLY.includes(c.id)) : all;
  const { browser, page, proc } = await launchApp(9333, DPR);
  try {
    for (const c of selected) {
      for (const theme of ["light", "dark"] as const) {
        await page.evaluate((theme) => localStorage.setItem("cslope-theme", theme), theme);
        await page.reload();
        await page.waitForFunction(() => (window as any).__CSLOPE_CAPTURE_READY__ === true, undefined, { timeout: 30_000 });
        await page.evaluate((theme) => (window as any).__CSLOPE_STORE__.getState().setTheme(theme), theme);
        await setViewport(page, DPR, SIZE.width, SIZE.height);
        await load(page, c.model);
        const canvas = page.locator("[data-testid='slope-canvas']");
        const view = join(OUT, `${c.id}-view-${theme}.png`);
        await canvas.screenshot({ path: view });
        if (theme === "light") {
          const pdf = join(OUT, `${c.id}.pdf`);
          await exportPdf(page, pdf);
          execFileSync("pdftoppm", ["-png", "-r", "150", "-f", "1", "-l", "1", "-singlefile", pdf, join(OUT, `${c.id}-pdf`)]);
          // Side by side at the same height.
          execFileSync("convert", [view, join(OUT, `${c.id}-pdf.png`), "-resize", "x1400", "+append", join(OUT, `${c.id}-view-and-pdf.png`)]);
        }
        console.log(`  ✓ ${c.id} ${theme}`);
      }
    }
  } finally {
    await stopApp(browser, proc);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
