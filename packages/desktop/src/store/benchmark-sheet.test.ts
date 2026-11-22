import { describe, expect, it } from "vitest";
import { VERIFICATION_CASES } from "@cslope/engine/verification";
import { useAppStore } from "./app-store";
import { annotationBoxes, boxesOverlap, isBenchmarkSheet, MODEL_BOTTOM_MM, worldBox, type BenchmarkSheetModel, type SheetBox } from "./benchmark-sheet";
import { PAPER_DIMENSIONS, PLOT_MARGINS } from "./defaults";
import type { ModelEntry, ViewLock } from "./types";
import { verificationModel, verificationModels } from "./verification-models";
import { boundsOf, paperContentBounds, paperContentOf } from "../features/view/extents";
import { REFERENCE_PAPER_WIDTH_PX } from "../features/view/viewLock";

/** The boxes on a benchmark's sheet: the title block's lines, the material table and the model with everything it draws. */
function sheetOf(
  m: Omit<BenchmarkSheetModel, "projectInfo"> & Pick<ModelEntry, "projectInfo" | "resultViewSettings" | "coordinates">,
  content = paperContentOf(m),
) {
  const rvs = m.resultViewSettings!;
  const lock = rvs.viewLock!;
  const { texts, tables } = annotationBoxes({ ...m, projectInfo: m.projectInfo! }, rvs.annotations, rvs.paperFrame);
  const worldPerPx = (lock.topRight[0] - lock.bottomLeft[0]) / (REFERENCE_PAPER_WIDTH_PX * (1 - PLOT_MARGINS.L - PLOT_MARGINS.R));
  const model = worldBox(paperContentBounds(content, worldPerPx)!, lock);
  const geometry = worldBox(boundsOf(m.coordinates)!, lock);
  const paperH = PAPER_DIMENSIONS[rvs.paperFrame.paperSize].h;
  const bottomMm = (1 - PLOT_MARGINS.B - (geometry.y + geometry.h)) * paperH;
  return { texts, tables, model, bottomMm, lock };
}

const anyOverlap = (as: SheetBox[], bs: SheetBox[]) => as.some((a) => bs.some((b) => boxesOverlap(a, b)));

describe("the sheet of a benchmark opened from Help › Benchmarks", () => {
  const models = verificationModels();

  it.each(models.map((m) => [m.name.split(" ")[0], m] as const))("%s: the table, the title block and the model do not overlap", (_, m) => {
    const { texts, tables, model, bottomMm } = sheetOf(m);
    expect(tables).toHaveLength(1);
    expect(anyOverlap(tables, texts), "table over the title block").toBe(false);
    expect(anyOverlap([...texts, ...tables], [model]), "block or table over the model").toBe(false);
    // Low on the sheet, about 1 cm above the bottom of the drawing area.
    expect(bottomMm).toBeCloseTo(MODEL_BOTTOM_MM, 6);
    // Everything inside the drawing area.
    for (const b of [model, ...tables]) {
      expect(b.x).toBeGreaterThanOrEqual(PLOT_MARGINS.L - 1e-9);
      expect(b.x + b.w).toBeLessThanOrEqual(1 - PLOT_MARGINS.R + 1e-9);
      expect(b.y).toBeGreaterThanOrEqual(PLOT_MARGINS.T - 1e-9);
    }
  });

  it("keeps the table at the top right beside a short block and moves it under a long one", () => {
    const tableY = (id: string) => models.find((m) => m.name.startsWith(`${id} `))!.resultViewSettings!.annotations.find((a) => a.type === "material-table")!.y;
    // V023's block is narrow enough for the table beside it.
    expect(tableY("V023")).toBe(0.065);
    // V038b's two-line title reaches under the table's place.
    expect(tableY("V038b")).toBeGreaterThan(0.2);
    expect(models.every((m) => isBenchmarkSheet(m.resultViewSettings!.annotations))).toBe(true);
  });

  it("draws the model across the width when there is room above it, as before", () => {
    // V038b, a wide dam: the width sets the scale (the model and its margins span the drawing area).
    const m = models.find((x) => x.name.startsWith("V038b "))!;
    const { model } = sheetOf(m);
    expect(model.w).toBeGreaterThan(0.8 * (1 - PLOT_MARGINS.L - PLOT_MARGINS.R));
  });

  it("leaves the website's plain plots and the user's models to the usual frame", () => {
    const c = VERIFICATION_CASES.find((x) => x.id === "V038b")!;
    expect(isBenchmarkSheet(verificationModel(c).resultViewSettings!.annotations)).toBe(false);
    expect(isBenchmarkSheet(useAppStore.getState().resultViewSettings.annotations)).toBe(false);
  });

  it("refits the sheet after a run so that the F label at the circle's centre stays clear of the block and the table", () => {
    useAppStore.getState().loadBenchmarks();
    const id = useAppStore.getState().models.find((m) => m.name.startsWith("V001 "))!.id;
    useAppStore.getState().switchModel(id);
    const s = useAppStore.getState();
    const before: ViewLock = s.resultViewSettings.viewLock!;
    const b = boundsOf(s.coordinates)!;
    // A circle whose centre (where the F label goes) lies high above the model, under the table's corner.
    const cx = b.xMax - 0.1 * (b.xMax - b.xMin);
    const cy = b.yMax + 0.6 * (before.topRight[1] - b.yMax);
    const surface = { cx, cy, radius: cy - b.yMin, fos: 1.2, entryPoint: [b.xMin, b.yMax], exitPoint: [b.xMax, b.yMin] } as never;
    useAppStore.setState({ result: { criticalSurface: surface } as never });
    const after = useAppStore.getState();
    expect(after.resultViewSettings.viewLock).not.toEqual(before);
    const sheet = sheetOf(after, paperContentOf(after));
    expect(anyOverlap([...sheet.texts, ...sheet.tables], [sheet.model])).toBe(false);
  });
});
