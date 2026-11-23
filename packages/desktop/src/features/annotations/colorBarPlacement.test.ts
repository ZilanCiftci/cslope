import { beforeEach, describe, expect, it } from "vitest";
import type { Annotation, MaterialRow, PaperAnnotation, PaperFrameSettings } from "../../store/types";
import { DEFAULT_MATERIAL, DEFAULT_RESULT_VIEW_SETTINGS, PLOT_MARGINS } from "../../store/defaults";
import { useAppStore } from "../../store/app-store";
import {
  COLOR_BAR_DEFAULT_Y,
  colorBarDefaultPosition,
  colorBarHeight,
  colorBarWidth,
  materialTableBox,
  RIGHT_INSIDE_FRAME,
  TOP_INSIDE_FRAME,
  type TextMeasure,
} from "./colorBarPlacement";
import { buildMaterialTableData, measureTable } from "../canvas/helpers";
import { getPaperDimensions } from "../view/paper";
import { annotationPxToTextPx, SHEET_LAYOUT_MM_PER_PX, textLayoutPx } from "../rendering/style-spec";

/** A fixed text measure (the tests' canvas measures nothing): 0.55 em a glyph, bold 0.6. */
const measure: TextMeasure = (text, px, bold) => text.length * px * (bold ? 0.6 : 0.55);

const A4: Pick<PaperFrameSettings, "paperSize" | "landscape"> = { paperSize: "A4", landscape: true };

const TABLE = DEFAULT_RESULT_VIEW_SETTINGS.annotations.find((a) => a.type === "material-table") as PaperAnnotation;

function materials(n: number): MaterialRow[] {
  return Array.from({ length: n }, (_, i) => ({
    ...DEFAULT_MATERIAL,
    id: `m${i}`,
    name: `Material ${i + 1}`,
    model: { kind: "mohr-coulomb", unitWeight: 18 + i * 0.5, cohesion: 5 + i, frictionAngle: 25 + i },
  }));
}

const frameBottom = 1 - PLOT_MARGINS.B - 0.01;

describe("color bar default position", () => {
  it.each([2, 6, 10])("with %i materials: at the right edge, just below the table as drawn", (n) => {
    const mats = materials(n);
    const box = materialTableBox(TABLE, mats, undefined, A4, measure);
    // The table hangs from its top-right anchor.
    expect(box.y).toBeCloseTo(TABLE.y, 9);
    expect(box.x + box.w).toBeCloseTo(TABLE.x, 9);
    const pos = colorBarDefaultPosition([TABLE], mats, undefined, A4, measure);
    expect(pos.x).toBe(RIGHT_INSIDE_FRAME);
    // Below the table, with a small gap (1.5 % of the paper, rounded).
    expect(pos.y).toBeGreaterThan(box.y + box.h);
    expect(pos.y - (box.y + box.h)).toBeCloseTo(0.025, 2);
    // The whole bar stays inside the plot frame.
    expect(pos.y + colorBarHeight(A4)).toBeLessThanOrEqual(frameBottom);
  });

  it("moves down as the table grows: 2, 6 and 10 materials", () => {
    const ys = [2, 6, 10].map((n) => colorBarDefaultPosition([TABLE], materials(n), undefined, A4, measure).y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
    // One body row at the default table's 10 px text (8.4 layout px): 15 layout px × 8.4 / 6, of 600 per min(paper) side on A4.
    const row = (15 * textLayoutPx(10)) / 6 / 600;
    expect(ys[2] - ys[1]).toBeCloseTo(4 * row, 2);
  });

  it("follows the table's text size and the paper's orientation", () => {
    const mats = materials(6);
    const small = colorBarDefaultPosition([{ ...TABLE, fontSizePx: 7 }], mats, undefined, A4, measure).y;
    const large = colorBarDefaultPosition([TABLE], mats, undefined, A4, measure).y;
    expect(small).toBeLessThan(large);
    // Portrait: the same table is a smaller part of the taller paper.
    const portrait = colorBarDefaultPosition([TABLE], mats, undefined, { paperSize: "A4", landscape: false }, measure).y;
    expect(portrait).toBeLessThan(large);
  });

  it("without a table: where it always went", () => {
    expect(colorBarDefaultPosition([], materials(3), undefined, A4, measure)).toEqual({
      x: RIGHT_INSIDE_FRAME,
      y: COLOR_BAR_DEFAULT_Y,
    });
  });

  it("left of the table at the top when there is no room below it", () => {
    const mats = materials(30);
    const box = materialTableBox(TABLE, mats, undefined, A4, measure);
    const pos = colorBarDefaultPosition([TABLE], mats, undefined, A4, measure);
    expect(pos.y).toBe(TOP_INSIDE_FRAME);
    expect(pos.x).toBeLessThan(box.x);
  });

  it("right of the table at its top when the table is at the left with no room below or beside it at the left (a benchmark's sheet)", () => {
    const mats = materials(10);
    // At the left under a title block, as a benchmark's sheet lays it out after a run.
    const left: Annotation = { ...TABLE, x: 0.45, y: 0.4 };
    const box = materialTableBox(left, mats, undefined, A4, measure);
    expect(box.x).toBeLessThan(0.1);
    const pos = colorBarDefaultPosition([left], mats, undefined, A4, measure);
    // Hung from its top-right corner: its left edge past the table's right, its top at the table's.
    expect(pos.x - colorBarWidth(A4, measure)).toBeGreaterThan(box.x + box.w);
    expect(pos.y).toBeCloseTo(box.y, 3);
    // Inside the plot frame (it went left of the table, off the paper, before).
    expect(pos.x - colorBarWidth(A4, measure)).toBeGreaterThanOrEqual(PLOT_MARGINS.L);
    expect(pos.x).toBeLessThanOrEqual(RIGHT_INSIDE_FRAME);
    expect(pos.y + colorBarHeight(A4)).toBeLessThanOrEqual(frameBottom);
  });

  it.each([
    ["A4", 0.2, 0.06],
    ["A4", 0.5, 0.5],
    ["A4", 0.94, 0.5],
    ["A1", 0.2, 0.06],
    ["A3", 0.94, 0.065],
  ] as const)("on %s with a table hung at %f, %f: the whole bar inside the plot frame", (paperSize, x, y) => {
    const paper = { paperSize, landscape: true } as const;
    const mats = materials(12);
    const pos = colorBarDefaultPosition([{ ...TABLE, x, y }], mats, undefined, paper, measure);
    expect(pos.x - colorBarWidth(paper, measure)).toBeGreaterThanOrEqual(PLOT_MARGINS.L);
    expect(pos.x).toBeLessThanOrEqual(1 - PLOT_MARGINS.R);
    expect(pos.y).toBeGreaterThanOrEqual(PLOT_MARGINS.T);
    expect(pos.y + colorBarHeight(paper)).toBeLessThanOrEqual(1 - PLOT_MARGINS.B);
  });

  it("is the same height in mm on every paper size: 75.25 mm, as on A4", () => {
    for (const paperSize of ["A4", "A3", "A1"] as const) {
      const { height } = getPaperDimensions(paperSize, true);
      expect(colorBarHeight({ paperSize, landscape: true }) * height).toBeCloseTo((200 + 11 + 4) * 0.35, 6);
    }
  });

  it("below the lowest of several tables, whatever their anchor", () => {
    const mats = materials(4);
    const low: Annotation = { ...TABLE, id: "t2", x: 0.94, y: 0.5, anchor: "bottom-right" };
    const box = materialTableBox(low, mats, undefined, A4, measure);
    expect(box.y + box.h).toBeCloseTo(0.5, 9);
    expect(colorBarDefaultPosition([TABLE, low], mats, undefined, A4, measure).y).toBeCloseTo(0.525, 3);
  });
});

describe("color bar default position on screen (#70)", () => {
  // The examples' table: 6 annotation px text (as px of the F label's unit) at the top right of the sheet.
  const EXAMPLE_TABLE: Annotation = {
    id: "t",
    type: "material-table",
    x: 0.94,
    y: 0.065,
    anchor: "top-right",
    fontSizePx: annotationPxToTextPx(6),
    tableColumns: ["model", "unitWeight", "cohesion", "frictionAngle"],
  };
  // The reporting tutorial's capture: the sheet 615 px high on screen.
  const TUTORIAL_SHEET_SCALE = 615 / 600;
  /** A canvas context that measures text as `measure` does (the tests' canvas measures nothing). */
  const measuringCtx = () => {
    let font = "";
    return {
      set font(f: string) {
        font = f;
      },
      get font() {
        return font;
      },
      measureText: (t: string) => {
        const px = Number(/([\d.]+)px/.exec(font)![1]);
        return { width: measure(t, px, font.startsWith("bold")) };
      },
    } as unknown as CanvasRenderingContext2D;
  };
  /** The bottom of the table as the canvas draws it at `sheetScale`, as a fraction of the paper height. */
  const drawnBottom = (table: Annotation, mats: MaterialRow[], sheetScale: number) => {
    const { columnKeys, header, rows } = buildMaterialTableData(table, mats, undefined);
    const { h } = measureTable(measuringCtx(), columnKeys, header, rows, sheetScale, textLayoutPx(table.fontSizePx!));
    const { height } = getPaperDimensions(A4.paperSize, A4.landscape);
    // Sheet px per paper height: the table's layout px are SHEET_LAYOUT_MM_PER_PX mm on every paper.
    const sheetH = (sheetScale * height) / SHEET_LAYOUT_MM_PER_PX;
    return table.y! + h / sheetH;
  };

  it("is below the table as drawn, which a small sheet draws at its paper size (as the PDF)", () => {
    const mats = materials(1);
    const paper = materialTableBox(EXAMPLE_TABLE, mats, undefined, A4, measure);
    const bottom = drawnBottom(EXAMPLE_TABLE, mats, TUTORIAL_SHEET_SCALE);
    // No screen-only least size: the drawn table takes the paper's share of the sheet.
    expect(bottom).toBeCloseTo(paper.y + paper.h, 9);
    const screen = materialTableBox(EXAMPLE_TABLE, mats, undefined, A4, measure, TUTORIAL_SHEET_SCALE);
    expect(screen.y + screen.h).toBeCloseTo(bottom, 9);
    const pos = colorBarDefaultPosition([EXAMPLE_TABLE], mats, undefined, A4, measure, TUTORIAL_SHEET_SCALE);
    expect(pos.x).toBe(RIGHT_INSIDE_FRAME);
    expect(pos.y).toBeGreaterThan(bottom);
    expect(pos.y - bottom).toBeCloseTo(0.025, 2);
  });

  it("is where the paper puts it on a sheet large enough for the table's own size", () => {
    const mats = materials(3);
    const scale = 2;
    expect(materialTableBox(EXAMPLE_TABLE, mats, undefined, A4, measure, scale).h).toBeCloseTo(
      materialTableBox(EXAMPLE_TABLE, mats, undefined, A4, measure).h,
      9,
    );
    expect(drawnBottom(EXAMPLE_TABLE, mats, scale)).toBeCloseTo(
      materialTableBox(EXAMPLE_TABLE, mats, undefined, A4, measure).y + materialTableBox(EXAMPLE_TABLE, mats, undefined, A4, measure).h,
      9,
    );
  });
});

describe("Color bar button", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
  });

  it("puts the bar below the sheet's table for the model's materials", () => {
    useAppStore.setState({ materials: materials(10) });
    const s = useAppStore.getState();
    const table = s.resultViewSettings.annotations.find((a) => a.type === "material-table")!;
    s.addAnnotation("color-bar");
    const bar = useAppStore.getState().resultViewSettings.annotations.find((a) => a.type === "color-bar")!;
    const box = materialTableBox(table, materials(10), undefined, s.resultViewSettings.paperFrame);
    expect(bar).toMatchObject({ x: RIGHT_INSIDE_FRAME, anchor: "top-right" });
    expect(bar.y).toBeGreaterThan(box.y + box.h);
    expect(bar.y).toBeLessThan(box.y + box.h + 0.03);
  });

  it("puts the bar below the table on a small sheet on screen, where the table has its paper size (as in the PDF)", () => {
    useAppStore.setState({ materials: materials(4) });
    const s = useAppStore.getState();
    const table = s.resultViewSettings.annotations.find((a) => a.type === "material-table")!;
    // The new table's 10 px text (8.4 layout px) at 7.56 px on screen: drawn at that size, its share of the paper unchanged.
    const sheetScale = 0.9;
    s.addAnnotation("color-bar", { sheetScale });
    const bar = useAppStore.getState().resultViewSettings.annotations.find((a) => a.type === "color-bar")!;
    const paper = materialTableBox(table, materials(4), undefined, s.resultViewSettings.paperFrame);
    const screen = materialTableBox(table, materials(4), undefined, s.resultViewSettings.paperFrame, undefined, sheetScale);
    expect(screen.h).toBeCloseTo(paper.h, 9);
    expect(bar.y).toBeGreaterThan(screen.y + screen.h);
  });
});
