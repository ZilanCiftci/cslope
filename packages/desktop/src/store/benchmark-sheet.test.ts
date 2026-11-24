import { describe, expect, it } from "vitest";
import { VERIFICATION_CASES } from "@cslope/engine/verification";
import { useAppStore } from "./app-store";
import {
  annotationBoxes,
  benchmarkSheetOf,
  boxClearOfShapes,
  boxesOverlap,
  drawnViewLock,
  isBenchmarkSheet,
  MODEL_BOTTOM_MM,
  sheetShapes,
  worldBox,
} from "./benchmark-sheet";
import { PAPER_DIMENSIONS, PLOT_MARGINS } from "./defaults";
import type { ModelEntry, PaperAnnotation } from "./types";
import { verificationModel, verificationModels } from "./verification-models";
import { boundsOf, paperContentBounds, paperContentOf } from "../features/view/extents";
import { getPaperDimensions, virtualPaperFrame } from "../features/view/paper";
import { colorBarHeight, colorBarWidth } from "../features/annotations/colorBarPlacement";
import { COLOR_BAR_PLATE_PAD, SHEET_LAYOUT_MM_PER_PX } from "../features/rendering/style-spec";
import { v085AfterRunWithColorBar } from "../test/v085-sheet";

type Sheet = Pick<ModelEntry, "projectInfo" | "materials" | "piezometricLine" | "resultViewSettings" | "coordinates" | "analysisLimits"> &
  Partial<Pick<ModelEntry, "result">>;

/** The boxes on a benchmark's sheet and what its model draws there. */
function sheetOf(m: Sheet, content = paperContentOf(m)) {
  const rvs = m.resultViewSettings!;
  const lock = rvs.viewLock!;
  const paper = rvs.paperFrame;
  const model = benchmarkSheetOf(m);
  const { texts, tables } = annotationBoxes(model, rvs.annotations, paper);
  const worldPerPx = (lock.topRight[0] - lock.bottomLeft[0]) / (virtualPaperFrame(paper.paperSize).w * (1 - PLOT_MARGINS.L - PLOT_MARGINS.R));
  const contentBox = worldBox(paperContentBounds(content, worldPerPx)!, lock);
  const geometry = worldBox(boundsOf(m.coordinates)!, lock);
  const bottomMm = (1 - PLOT_MARGINS.B - (geometry.y + geometry.h)) * PAPER_DIMENSIONS[paper.paperSize].h;
  const shapes = sheetShapes(model, content, lock, paper);
  return { texts, tables, contentBox, bottomMm, lock, shapes, paper };
}

const anyOverlap = (as: { x: number; y: number; w: number; h: number }[], bs: { x: number; y: number; w: number; h: number }[]) =>
  as.some((a) => bs.some((b) => boxesOverlap(a, b)));

describe("the sheet of a benchmark opened from Help › Benchmarks", () => {
  const models = verificationModels();

  it.each(models.map((m) => [m.name.split(" ")[0], m] as const))(
    "%s: the table is clear of the title block and of everything the model draws; the model under the block, 1 cm above the bottom",
    (_, m) => {
      const { texts, tables, contentBox, bottomMm, lock, shapes, paper } = sheetOf(m);
      expect(tables).toHaveLength(1);
      expect(anyOverlap(tables, texts), "table over the title block").toBe(false);
      // Over empty sky at most: clear by a few mm of the ground, its outline, the water, loads, markers.
      expect(boxClearOfShapes(tables[0], shapes, lock, paper, 2.5), "table over the model's drawing").toBe(true);
      // The model (with its symbols) under the title block.
      expect(anyOverlap(texts, [contentBox]), "title block over the model").toBe(false);
      // Low on the sheet, about 1 cm above the bottom of the drawing area.
      expect(bottomMm).toBeCloseTo(MODEL_BOTTOM_MM, 6);
      // Everything inside the drawing area.
      for (const b of [contentBox, ...tables]) {
        expect(b.x).toBeGreaterThanOrEqual(PLOT_MARGINS.L - 1e-9);
        expect(b.x + b.w).toBeLessThanOrEqual(1 - PLOT_MARGINS.R + 1e-9);
        expect(b.y).toBeGreaterThanOrEqual(PLOT_MARGINS.T - 1e-9);
        expect(b.y + b.h).toBeLessThanOrEqual(1 - PLOT_MARGINS.B + 1e-9);
      }
    },
  );

  it("keeps the table at the top right beside a short block, moves it down beside a long one, or over the sky", () => {
    const tableOf = (id: string) => models.find((m) => m.name.startsWith(`${id} `))!.resultViewSettings!.annotations.find((a) => a.type === "material-table")!;
    // V038b: the table at its paper size fits beside its title.
    expect(tableOf("V038b")).toMatchObject({ x: 0.94, y: 0.065 });
    // V021a's reference line runs under the table's place: the table moves down beside the block.
    expect(tableOf("V021a").y).toBeGreaterThan(0.2);
    expect(models.every((m) => isBenchmarkSheet(m.resultViewSettings!.annotations))).toBe(true);
  });

  it("draws the model across the width when there is room above it", () => {
    // V038b, a wide dam: the width sets the scale (the model and its margins span the drawing area).
    const m = models.find((x) => x.name.startsWith("V038b "))!;
    const { contentBox } = sheetOf(m);
    expect(contentBox.w).toBeGreaterThan(0.8 * (1 - PLOT_MARGINS.L - PLOT_MARGINS.R));
  });

  it("leaves the website's plain plots and the user's models to the usual frame", () => {
    const c = VERIFICATION_CASES.find((x) => x.id === "V038b")!;
    expect(isBenchmarkSheet(verificationModel(c).resultViewSettings!.annotations)).toBe(false);
    expect(isBenchmarkSheet(useAppStore.getState().resultViewSettings.annotations)).toBe(false);
  });

  it("moves the table after a run, not the F label at the circle's centre, when the label would fall under it", () => {
    useAppStore.getState().loadBenchmarks();
    // V038b: a low dam with sky above it, where the table can go.
    const id = useAppStore.getState().models.find((m) => m.name.startsWith("V038b "))!.id;
    useAppStore.getState().switchModel(id);
    const s = useAppStore.getState();
    const table = s.resultViewSettings.annotations.find((a) => a.type === "material-table")!;
    const box = sheetOf(s).tables[0];
    // A circle whose centre (where the F label goes) lies under the table's middle.
    const lock = s.resultViewSettings.viewLock!;
    const plotW = 1 - PLOT_MARGINS.L - PLOT_MARGINS.R;
    const plotH = 1 - PLOT_MARGINS.T - PLOT_MARGINS.B;
    const cx = lock.bottomLeft[0] + ((box.x + box.w / 2 - PLOT_MARGINS.L) / plotW) * (lock.topRight[0] - lock.bottomLeft[0]);
    const cy = lock.topRight[1] - ((box.y + box.h / 2 - PLOT_MARGINS.T) / plotH) * (lock.topRight[1] - lock.bottomLeft[1]);
    const b = boundsOf(s.coordinates)!;
    const surface = { cx, cy, radius: cy - b.yMin, fos: 1.2, entryPoint: [b.xMin, b.yMax], exitPoint: [b.xMax, b.yMin] } as never;
    useAppStore.setState({ result: { criticalSurface: surface } as never });
    const after = useAppStore.getState();
    const moved = after.resultViewSettings.annotations.find((a) => a.type === "material-table")!;
    expect([moved.x, moved.y]).not.toEqual([table.x, table.y]);
    // The model keeps its scale and place: the table found room elsewhere.
    expect(after.resultViewSettings.viewLock).toEqual(lock);
    // The label (a mark of the content) stays where the result puts it, clear of the table.
    const sheet = sheetOf(after, paperContentOf(after));
    expect(boxClearOfShapes(sheet.tables[0], sheet.shapes, sheet.lock, sheet.paper, 2.5)).toBe(true);
    expect(anyOverlap(sheet.tables, sheet.texts)).toBe(false);
  });
});

describe("a new color bar on a benchmark's sheet after a run", () => {
  it.each(["A4", "A1"] as const)(
    "V085 on %s: over empty sky inside the frame, clear of the model's box, its search limit markers, its F label and the text",
    (paperSize) => {
      const m = v085AfterRunWithColorBar(paperSize);
      const rvs = m.resultViewSettings!;
      const paper = rvs.paperFrame;
      expect(paper.paperSize).toBe(paperSize);
      const lock = drawnViewLock(rvs.viewLock!, paper);
      const bar = rvs.annotations.find((a): a is PaperAnnotation => a.type === "color-bar")!;
      // The bar with its plate, hung from its top-right corner (the sizes colorBarDefaultPosition places it by).
      const { width, height } = getPaperDimensions(paper.paperSize, paper.landscape);
      const pw = (COLOR_BAR_PLATE_PAD * SHEET_LAYOUT_MM_PER_PX) / width;
      const ph = (COLOR_BAR_PLATE_PAD * SHEET_LAYOUT_MM_PER_PX) / height;
      const w = colorBarWidth(paper);
      const h = colorBarHeight(paper);
      const box = { x: bar.x - w - pw, y: bar.y - ph, w: w + 2 * pw, h: h + 2 * ph };
      // Inside the plot frame, so drawn where it is stored.
      expect(box.x).toBeGreaterThanOrEqual(PLOT_MARGINS.L);
      expect(box.y).toBeGreaterThanOrEqual(PLOT_MARGINS.T);
      expect(box.x + box.w).toBeLessThanOrEqual(1 - PLOT_MARGINS.R);
      expect(box.y + box.h).toBeLessThanOrEqual(1 - PLOT_MARGINS.B);
      // Clear of the model's bounding box (its geometry, the ground and what lies under it).
      const model = worldBox(boundsOf(m.coordinates)!, lock);
      expect(boxesOverlap(box, model), `bar ${JSON.stringify(box)} over the model ${JSON.stringify(model)}`).toBe(false);
      // Clear of everything the model draws: the search limit markers, the F label, the ground, water and loads.
      const sheet = benchmarkSheetOf(m);
      const content = paperContentOf(m);
      const shapes = sheetShapes(sheet, content, lock, paper);
      expect(m.analysisLimits?.enabled).toBe(true);
      expect(boxClearOfShapes(box, shapes, lock, paper, 0), "bar over the model's drawing").toBe(true);
      // Clear of the title block and the material table.
      const { texts, tables } = annotationBoxes(sheet, rvs.annotations, paper);
      expect(anyOverlap([box], [...texts, ...tables])).toBe(false);
    },
  );
});
