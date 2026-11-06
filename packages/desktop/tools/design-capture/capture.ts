#!/usr/bin/env bun
/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate() runs in the renderer without type imports */
/**
 * Design screenshots of the desktop app: builds the renderer in capture
 * mode, starts the real Electron app, loads prepared models (models.ts) and
 * opens the File menu, the imports and exports, every material kind, the
 * dialogs with imported-data notices, options, loads, the edit and result
 * views and the PDF, and saves the images with an index.html contact sheet.
 * Each feature model is also run, and its factor of safety compared with
 * the engine's.
 *
 *   bun packages/desktop/tools/design-capture/capture.ts [output folder]
 *
 * See README.md (virtual display, sandbox). DESIGN_CAPTURE_SKIP_BUILD=1
 * reuses the last build; DESIGN_CAPTURE_PORT sets the debugging port.
 */

import type { Page } from "playwright";
import { existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildSlope, analyseSlope, initEngine } from "@cslope/engine";
import { buildSlopeDTOFromModel } from "../../src/store/helpers";
import { parseProjectFile, serializeProject } from "../../src/store/persistence";
import { modelToStix } from "../../src/features/project/stix/stix-write";
import { modelToSlim } from "../../src/features/project/sli/sli-write";
import { modelToGsz } from "../../src/features/project/gsz/gsz-write";
import type { AppState, ModelEntry } from "../../src/store/types";
import { FEATURE_MODELS, featureModel, designReviewModel } from "./models";
import {
  Rig,
  buildApp,
  launch,
  stop,
  setSize,
  growToContent,
  closeOthers,
  ribbonTab,
  clickNamed,
  openDialog,
  store,
  loadModels,
  catchDownloads,
  takeDownloads,
} from "./lib";
import { writeContactSheet } from "./contact-sheet";

const OUT = resolve(process.argv[2] ?? join(tmpdir(), "cslope-design-capture"));
const PORT = Number(process.env.DESIGN_CAPTURE_PORT ?? 9334);
const MAIN_W = 1600, MAIN_H = 1000;

/** A model as a saved project file opens: serialised and parsed again. */
function asOpened(models: ModelEntry[]): ModelEntry[] {
  const text = JSON.stringify(serializeProject({ activeModelId: models[0].id, models } as unknown as AppState));
  return parseProjectFile(text).models;
}

/** The factor of safety as the app's analysis worker computes it (one direction, no FEM). */
function engineFos(model: ModelEntry): number | null {
  const slope = buildSlope(buildSlopeDTOFromModel(model));
  slope.updateAnalysisOptions(model.options);
  analyseSlope(slope);
  return slope.search.find((s) => s.fos != null)?.fos ?? null;
}

// ── Files for the imports ──────────────────────────────────────────────

function writeImportFiles(rig: Rig) {
  const pick = (key: string) => featureModel(FEATURE_MODELS.find((f) => f.key === key)!);
  const files: Record<string, Uint8Array | string> = {
    "shansep-excavation.stix": modelToStix(pick("04-shansep-excavation")).bytes,
    "clay-over-aquifer.stix": modelToStix(pick("03-waternet")).bytes,
    "rapid-drawdown.slim": modelToSlim(pick("06-rapid-drawdown"), "rapid-drawdown").bytes,
    "bbar-fill.gsz": modelToGsz(pick("02-bbar-fill")).bytes,
    "simple.dxf":
      "0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\nGROUND\n90\n4\n70\n0\n10\n0\n20\n0\n10\n0\n20\n10\n10\n20\n20\n10\n10\n40\n20\n0\n0\nENDSEC\n0\nEOF\n",
  };
  const paths: Record<string, string> = {};
  for (const [name, data] of Object.entries(files)) paths[name] = rig.writeFile(`files/${name}`, data);
  return paths;
}

// ── Summary dialogs and native message boxes ──────────────────────────

/**
 * After an import or export: wait for its summary (an in-app dialog, or a
 * native message box in older builds), capture it and close it.
 */
async function captureSummary(rig: Rig, name: string, title: string) {
  const page = rig.page;
  const dialog = page.getByRole("dialog");
  const end = Date.now() + 20_000;
  while (Date.now() < end && !(await dialog.count()) && rig.lastNative === null) await page.waitForTimeout(200);
  if (rig.lastNative !== null) {
    rig.writeFile(`text/${name}.txt`, rig.lastNative);
    rig.note(`${title} (native message box)`, rig.lastNative.slice(0, 400));
    rig.lastNative = null;
    await page.waitForTimeout(800);
    await rig.shot(page, `${name}-after`, `${title}: after the message box`);
    return;
  }
  if (!(await dialog.count())) {
    await rig.shot(page, `${name}-no-summary`, `${title}: no summary appeared`);
    return;
  }
  const text = await dialog.first().innerText().catch(() => "");
  rig.writeFile(`text/${name}.txt`, text);
  await rig.shot(page, name, title);
  await clickNamed(page, "Close").catch(() => page.keyboard.press("Escape"));
  await page.waitForTimeout(400);
  await rig.shot(page, `${name}-after`, `${title}: after closing the summary`);
}

async function importFile(rig: Rig, menuItem: RegExp, path: string, name: string, title: string) {
  const page = rig.page;
  await closeOthers(page);
  await ribbonTab(page, "File");
  await clickNamed(page, "Import");
  const chooser = page.waitForEvent("filechooser", { timeout: 8000 });
  await clickNamed(page, menuItem);
  await (await chooser).setFiles(path);
  await captureSummary(rig, name, title);
}

async function exportFile(rig: Rig, menuItem: RegExp, name: string, title: string) {
  const page = rig.page;
  await closeOthers(page);
  await catchDownloads(page);
  await ribbonTab(page, "File");
  await clickNamed(page, "Export");
  await clickNamed(page, menuItem);
  await captureSummary(rig, name, title);
  for (const f of await takeDownloads(page, 3000)) {
    const path = rig.writeFile(`exports/${f.name}`, f.bytes);
    rig.say(`    exported ${f.bytes.length} bytes → ${path}`);
  }
}

// ── Dialog windows ─────────────────────────────────────────────────────

/** The row of the materials table with this material name. */
async function selectMaterial(d: Page, name: string) {
  const input = d.locator(`input[aria-label="Material name"][value="${name}"], input[value="${name}"]`).first();
  if (!(await input.count())) throw new Error(`No material "${name}" in the table`);
  const row = input.locator("xpath=ancestor::tr[1]");
  const cells = row.locator("td");
  // the model cell selects the row without starting to edit the name
  if ((await cells.count()) > 1) await cells.nth(1).click();
  else await row.click();
  await d.waitForTimeout(400);
}

/** The select of the material model (the one offering SHANSEP). */
async function modelSelect(d: Page) {
  const selects = d.locator("select");
  for (let i = 0; i < (await selects.count()); i++) {
    const labels = await selects.nth(i).locator("option").allInnerTexts();
    if (labels.some((l) => /shansep/i.test(l))) return selects.nth(i);
  }
  throw new Error("No material model select (with a SHANSEP option)");
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function notices(d: Page): Promise<string[]> {
  return d.getByRole("note").allInnerTexts().catch(() => []);
}

/** Undo in the main window (the dialogs edit the main window's model). */
async function undo(page: Page) {
  await page.bringToFront();
  await page.mouse.click(MAIN_W / 2, MAIN_H / 2 + 100).catch(() => {});
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(600);
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n  Design capture → ${OUT}\n`);
  await initEngine();
  if (!process.env.DESIGN_CAPTURE_SKIP_BUILD) {
    console.log("  Building the renderer (VITE_CAPTURE_MODE=1)…");
    buildApp();
  } else if (!existsSync(join(resolve(import.meta.dirname, "../.."), "dist", "index.html"))) {
    throw new Error("DESIGN_CAPTURE_SKIP_BUILD is set but there is no build in packages/desktop/dist");
  }
  const { browser, page, proc } = await launch(PORT);
  const rig = new Rig(page, OUT);
  page.on("pageerror", (e) => rig.say(`  [renderer error] ${e.message}`));
  page.on("dialog", async (d) => {
    rig.lastNative = d.message();
    await new Promise((r) => setTimeout(r, 1200));
    rig.grabScreen("native-message", `Native message box: ${d.message().split("\n")[0].slice(0, 80)}`, d.message().slice(0, 400));
    await d.accept().catch(() => {});
  });
  const t0 = Date.now();
  try {
    await page.evaluate(() => {
      localStorage.setItem("cslope-theme", "light");
      document.documentElement.dataset.theme = "light";
    });
    await setSize(page, MAIN_W, MAIN_H);
    const files = writeImportFiles(rig);
    const review = asOpened([designReviewModel()]);

    // ── File menu ──
    rig.section = "File menu";
    await rig.step("start", () => rig.shot(page, "start", "The app as it starts"));
    await rig.step("File tab", async () => {
      await ribbonTab(page, "File");
      await rig.shot(page, "file-ribbon", "File tab");
    });
    await rig.step("Import submenu", async () => {
      await ribbonTab(page, "File");
      await clickNamed(page, "Import");
      await rig.shot(page, "file-import-menu", "File › Import");
      await closeOthers(page);
    });
    await rig.step("Export submenu", async () => {
      await ribbonTab(page, "File");
      await clickNamed(page, "Export");
      await rig.shot(page, "file-export-menu", "File › Export");
      await closeOthers(page);
    });

    // ── Imports ──
    rig.section = "Import";
    await rig.step("import .stix (SHANSEP, earlier stage)", () =>
      importFile(rig, /stix/i, files["shansep-excavation.stix"], "import-stix-shansep", "Import .stix: SHANSEP excavation with an earlier stage"));
    await rig.step("materials after .stix import", async () => {
      const d = await openDialog(rig, "Materials", "materials-dialog", "openMaterialsDialog");
      await selectMaterial(d, "Soft clay");
      await growToContent(d);
      const n = await notices(d);
      await rig.shot(d, "import-stix-materials-shansep", "Define materials after the .stix import: SHANSEP with the imported earlier stage", n.join(" | ") || "no notice shown");
    });
    await rig.step("import .stix (head lines)", () =>
      importFile(rig, /stix/i, files["clay-over-aquifer.stix"], "import-stix-waternet", "Import .stix: clay over an aquifer (head lines)"));
    await rig.step("piezometric lines after .stix import", async () => {
      const d = await openDialog(rig, "Piezometric lines", "piezo-dialog", "openPiezoDialog");
      await growToContent(d);
      const n = await notices(d);
      await rig.shot(d, "import-stix-piezo", "Piezometric lines after the .stix import: head-line notice", n.join(" | ") || "no notice shown");
    });
    await rig.step("import .slim (rapid drawdown)", () =>
      importFile(rig, /sli/i, files["rapid-drawdown.slim"], "import-slim-drawdown", "Import .slim: rapid drawdown"));
    await rig.step("import .gsz (B̄ fill)", () => importFile(rig, /gsz/i, files["bbar-fill.gsz"], "import-gsz-bbar", "Import .gsz: B̄ under a fill"));
    await rig.step("import DXF", () => importFile(rig, /dxf/i, files["simple.dxf"], "import-dxf", "Import DXF: a ground line"));

    // ── The combined model: canvas and exports ──
    rig.section = "Edit view and exports (design review model)";
    await rig.step("load design review model", async () => {
      await closeOthers(page);
      await loadModels(page, review);
      await rig.shot(page, "edit-canvas", "Edit canvas: every new field in one model");
    });
    await rig.step("Model tab", async () => {
      await ribbonTab(page, "Model");
      await rig.shot(page, "model-ribbon", "Model tab");
    });
    for (const [re, ext] of [[/gsz/i, "gsz"], [/stix/i, "stix"], [/slim/i, "slim"]] as const) {
      await rig.step(`export .${ext}`, () => exportFile(rig, re, `export-${ext}`, `Export .${ext}: summary of what is not written`));
    }

    // ── Materials ──
    rig.section = "Define materials";
    for (const [name, what] of [
      ["Fill", "Mohr-Coulomb with rᵤ, B̄ load (fill) and a strength above the water line"],
      ["Soft clay", "SHANSEP with POP, yield stress from the earlier stage, Su min and B̄; earlier-stage notice"],
      ["Silt", "Mohr-Coulomb with a drawdown envelope and suction strength (φb)"],
      ["Rockfill", "Shear-normal function"],
    ] as const) {
      await rig.step(`material ${name}`, async () => {
        const d = await openDialog(rig, "Materials", "materials-dialog", "openMaterialsDialog");
        await selectMaterial(d, name);
        await growToContent(d);
        const n = await notices(d);
        await rig.shot(d, `material-${slug(name)}`, `Material "${name}": ${what}`, n.length ? `notices: ${n.join(" | ")}` : undefined);
      });
    }
    await rig.step("remove earlier stage, undo", async () => {
      await loadModels(page, review);
      const d = await openDialog(rig, "Materials", "materials-dialog", "openMaterialsDialog");
      await selectMaterial(d, "Soft clay");
      await clickNamed(d, /remove.*earlier stage/i);
      await d.waitForTimeout(800);
      await growToContent(d);
      const removed = await store<boolean>(page, "(s) => !s.earlierStage");
      await rig.shot(d, "material-shansep-earlier-stage-removed", "After “Remove earlier stage”", removed ? "earlier stage removed from the model" : "EARLIER STAGE STILL IN THE MODEL");
      await undo(page);
      const back = await store<boolean>(page, "(s) => !!s.earlierStage");
      rig.note("Undo after removing the earlier stage", back ? "Ctrl+Z restored the earlier stage" : "Ctrl+Z did NOT restore the earlier stage");
      const d2 = await openDialog(rig, "Materials", "materials-dialog", "openMaterialsDialog");
      await selectMaterial(d2, "Soft clay");
      await growToContent(d2);
      await rig.shot(d2, "material-shansep-after-undo", "Define materials after Ctrl+Z");
    });
    await rig.step("every material model", async () => {
      await loadModels(page, review);
      const d = await openDialog(rig, "Materials", "materials-dialog", "openMaterialsDialog");
      await selectMaterial(d, "Rockfill");
      const sel = await modelSelect(d);
      const options = await sel.locator("option").evaluateAll((os) => os.map((o) => ({ value: (o as HTMLOptionElement).value, label: o.textContent ?? "" })));
      for (const o of options) {
        await rig.step(`material model ${o.label}`, async () => {
          await (await modelSelect(d)).selectOption(o.value);
          await d.waitForTimeout(500);
          await setSize(d, 760, 900);
          await growToContent(d);
          await rig.shot(d, `material-kind-${slug(o.label)}`, `Material model: ${o.label}`);
        });
      }
    });

    // ── Water, options, loads ──
    rig.section = "Water, options and loads";
    await loadModels(page, review);
    await rig.step("piezometric lines", async () => {
      const d = await openDialog(rig, "Piezometric lines", "piezo-dialog", "openPiezoDialog");
      await growToContent(d);
      const n = await notices(d);
      await rig.shot(d, "piezo", "Piezometric lines: head-line notice and rapid drawdown note", n.join(" | ") || "no notice shown");
    });
    await rig.step("remove head lines, undo", async () => {
      const d = await openDialog(rig, "Piezometric lines", "piezo-dialog", "openPiezoDialog");
      await clickNamed(d, /remove.*head/i);
      await d.waitForTimeout(800);
      const removed = await store<boolean>(page, "(s) => !s.waternet");
      await growToContent(d);
      await rig.shot(d, "piezo-head-lines-removed", "After “Remove head lines”", removed ? "head lines removed from the model" : "HEAD LINES STILL IN THE MODEL");
      await undo(page);
      const back = await store<boolean>(page, "(s) => !!s.waternet");
      rig.note("Undo after removing the head lines", back ? "Ctrl+Z restored the head lines" : "Ctrl+Z did NOT restore the head lines");
      await closeOthers(page);
      await rig.shot(page, "canvas-after-undo", "Edit canvas after the undo");
    });
    await rig.step("options", async () => {
      const d = await openDialog(rig, "Options", "options-dialog", "openOptionsDialog");
      await growToContent(d);
      const text = await d.locator("body").innerText();
      const seen = [/seismic/i, /rapid drawdown/i].map((re) => `${re.source}: ${re.test(text) ? "shown" : "NOT FOUND"}`).join(", ");
      await rig.shot(d, "options", "Options: seismic coefficients and rapid drawdown", seen);
    });
    await rig.step("distributed loads", async () => {
      const d = await openDialog(rig, "Distributed loads", "udl-dialog", "openUdlDialog");
      await growToContent(d);
      await rig.shot(d, "udl", "Distributed loads: excess pore pressure per material");
    });
    await rig.step("line loads", async () => {
      const d = await openDialog(rig, "Line loads", "line-loads-dialog", "openLineLoadsDialog");
      await growToContent(d);
      await rig.shot(d, "line-loads", "Line loads: one inclined");
    });

    // ── Save and open: the project file keeps the result ──
    rig.section = "Project file round trip (engine, no UI)";
    await rig.step("round trip", async () => {
      for (const m of [...FEATURE_MODELS.map((f) => featureModel(f)), designReviewModel()]) {
        const before = engineFos(m), after = engineFos(asOpened([m])[0]);
        const same = before != null && after != null && Math.abs(before - after) < 0.0005;
        rig.note(`Save and open "${m.name}"`, `F ${before?.toFixed(3)} before, ${after?.toFixed(3)} after${same ? "" : "  ← MISMATCH"}`);
      }
    });

    // ── Feature models: edit view, run, result ──
    rig.section = "Feature models: run on their circle";
    for (const f of FEATURE_MODELS) {
      await rig.step(`run ${f.key}`, async () => {
        await closeOthers(page);
        const [model] = asOpened([featureModel(f)]);
        const expected = engineFos(model);
        await loadModels(page, [model]);
        await rig.shot(page, `${f.key}-edit`, `${f.title}: edit view`, f.feature);
        await run(rig);
        const fos = await store<number | null>(page, "(s) => s.result?.minFOS ?? null");
        const ok = fos != null && expected != null && Math.abs(fos - expected) < 0.0015;
        await rig.shot(page, `${f.key}-result`, `${f.title}: result`, `app F = ${fos?.toFixed(3) ?? "none"}, engine F = ${expected?.toFixed(3) ?? "none"}${ok ? "" : "  ← MISMATCH"}`);
      });
    }

    // ── Result view and PDF ──
    rig.section = "Result view and PDF (design review model, search)";
    await rig.step("run design review model", async () => {
      await closeOthers(page);
      await loadModels(page, review);
      await run(rig);
      const fos = await store<number | null>(page, "(s) => s.result?.minFOS ?? null");
      const expected = engineFos(review[0]);
      const ok = fos != null && expected != null && Math.abs(fos - expected) < 0.0015;
      await rig.shot(page, "result", "Result view after Run", `app F = ${fos?.toFixed(3) ?? "none"}, engine F = ${expected?.toFixed(3) ?? "none"}${ok ? "" : "  ← MISMATCH"} (all loads at once: a stress test, not a realistic slope)`);
    });
    await rig.step("Results tab", async () => {
      await ribbonTab(page, "Results");
      await rig.shot(page, "results-ribbon", "Results tab");
    });
    await rig.step("PDF", async () => {
      await catchDownloads(page);
      await ribbonTab(page, "Results");
      await clickNamed(page, "Export as PDF", ["menuitem", "button"]);
      const pdf = (await takeDownloads(page, 15_000)).find((f) => f.name.toLowerCase().endsWith(".pdf"));
      if (!pdf) throw new Error("No PDF was produced");
      const path = rig.writeFile("exports/report.pdf", pdf.bytes);
      rig.say(`    PDF ${pdf.bytes.length} bytes → ${path}`);
      try {
        execSync(`pdftoppm -r 80 -png "${path}" "${join(OUT, "img", "pdf-page")}"`, { stdio: "ignore" });
        for (const file of readdirSync(join(OUT, "img")).filter((n) => n.startsWith("pdf-page")).sort()) {
          const n = Number(file.match(/(\d+)\.png$/)?.[1]);
          rig.shots.push({ file: `img/${file}`, title: `PDF page ${n}`, section: rig.section, note: n === 1 ? "the plot" : "summary page" });
        }
      } catch {
        rig.note("PDF pages", `pdftoppm not available; open ${path}`);
      }
    });
  } finally {
    rig.say(`\n  ${rig.shots.filter((s) => s.file).length} images, ${rig.shots.filter((s) => s.error).length} failed steps, ${Math.round((Date.now() - t0) / 1000)} s`);
    writeContactSheet(rig);
    rig.say(`  Contact sheet: ${join(OUT, "index.html")}\n`);
    await stop(browser, proc);
  }
}

/** Press Run (the toolbar button; the store's action when it is missing) and wait for the result. */
async function run(rig: Rig) {
  const page = rig.page;
  try {
    await clickNamed(page, /run analysis and view results/i);
  } catch {
    rig.say("  - Run button not found; running through the store");
    await page.evaluate(() => (window as any).__CSLOPE_STORE__.getState().runAnalysis());
  }
  await page.waitForFunction(
    () => {
      const s = (window as any).__CSLOPE_STORE__.getState();
      return s.runState === "done" || s.runState === "error";
    },
    undefined,
    { timeout: 300_000 },
  );
  const state = await store<{ runState: string; error?: string }>(page, "(s) => ({ runState: s.runState, error: s.errorMessage })");
  if (state.runState === "error") throw new Error(`Analysis failed: ${state.error}`);
  await page.evaluate(() => (window as any).__CSLOPE_STORE__.getState().setMode("result"));
  await page.waitForTimeout(1200);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
