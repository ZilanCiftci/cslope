import { beforeEach, describe, expect, it } from "vitest";
import type { Annotation, MaterialRow, PaperAnnotation, PaperFrameSettings } from "../../store/types";
import { DEFAULT_MATERIAL, DEFAULT_RESULT_VIEW_SETTINGS, PLOT_MARGINS } from "../../store/defaults";
import { useAppStore } from "../../store/app-store";
import {
  COLOR_BAR_DEFAULT_Y,
  colorBarDefaultPosition,
  colorBarHeight,
  materialTableBox,
  RIGHT_INSIDE_FRAME,
  TOP_INSIDE_FRAME,
  type TextMeasure,
} from "./colorBarPlacement";
import { buildMaterialTableData, measureTable } from "../canvas/helpers";
import { getPaperDimensions } from "../view/paper";
import { MATERIAL_TABLE_MIN_TEXT_PX } from "../rendering/style-spec";

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
    // One body row at 8 px text: 20 px of 600 per min(paper) side.
    const row = 20 / 600;
    expect(ys[2] - ys[1]).toBeCloseTo(4 * row, 2);
  });

  it("follows the table's text size and the paper's orientation", () => {
    const mats = materials(6);
    const small = colorBarDefaultPosition([{ ...TABLE, fontSize: 6 }], mats, undefined, A4, measure).y;
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

  it("below the lowest of several tables, whatever their anchor", () => {
    const mats = materials(4);
    const low: Annotation = { ...TABLE, id: "t2", x: 0.94, y: 0.5, anchor: "bottom-right" };
    const box = materialTableBox(low, mats, undefined, A4, measure);
    expect(box.y + box.h).toBeCloseTo(0.5, 9);
    expect(colorBarDefaultPosition([TABLE, low], mats, undefined, A4, measure).y).toBeCloseTo(0.525, 3);
  });
});

describe("color bar default position on screen (#70)", () => {
  // The examples' table: 6 px text at the top right of the sheet.
  const EXAMPLE_TABLE: Annotation = {
    id: "t",
    type: "material-table",
    x: 0.94,
    y: 0.065,
    anchor: "top-right",
    fontSize: 6,
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
    const { h } = measureTable(measuringCtx(), columnKeys, header, rows, sheetScale, table.fontSize);
    const { width, height } = getPaperDimensions(A4.paperSize, A4.landscape);
    // Sheet px per paper height: the annotations scale with min(w, h) / 600.
    const sheetH = (600 * sheetScale * height) / Math.min(width, height);
    return table.y! + h / sheetH;
  };

  it("is below the table as drawn where its text is raised to the least size", () => {
    const mats = materials(1);
    // The table's text is below the least size at this scale: drawn larger than on paper.
    expect(6 * TUTORIAL_SHEET_SCALE).toBeLessThan(MATERIAL_TABLE_MIN_TEXT_PX);
    const paper = materialTableBox(EXAMPLE_TABLE, mats, undefined, A4, measure);
    const bottom = drawnBottom(EXAMPLE_TABLE, mats, TUTORIAL_SHEET_SCALE);
    expect(bottom).toBeGreaterThan(paper.y + paper.h + 0.03);
    // The box on screen is the drawn table.
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
    expect(6 * scale).toBeGreaterThanOrEqual(MATERIAL_TABLE_MIN_TEXT_PX);
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

  it("puts the bar below the table as drawn on a small sheet on screen", () => {
    useAppStore.setState({ materials: materials(4) });
    const s = useAppStore.getState();
    const table = s.resultViewSettings.annotations.find((a) => a.type === "material-table")!;
    // The new table's 8 px text at 7.2 px on screen: drawn at the least size.
    const sheetScale = 0.9;
    s.addAnnotation("color-bar", { sheetScale });
    const bar = useAppStore.getState().resultViewSettings.annotations.find((a) => a.type === "color-bar")!;
    const paper = materialTableBox(table, materials(4), undefined, s.resultViewSettings.paperFrame);
    const screen = materialTableBox(table, materials(4), undefined, s.resultViewSettings.paperFrame, undefined, sheetScale);
    expect(screen.h).toBeGreaterThan(paper.h);
    expect(bar.y).toBeGreaterThan(screen.y + screen.h);
  });
});
