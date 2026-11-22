import { describe, expect, it } from "vitest";
import { gridLinePositions, sheetGridStyle } from "./sheet-grid";
import { sheetGridStep, sheetTickStep } from "../../utils/ruler";
import { normalizeLayerStyles } from "../results/layer-styles";

describe("the sheet's grid lines", () => {
  it("puts the major lines at the multiples of the step, the minor lines between them", () => {
    const { major, minor } = gridLinePositions(-3, 11, 5, 5, 10);
    expect(major).toEqual([0, 5, 10]);
    expect(minor.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([-3, -2, -1, 1, 2, 3, 4, 6, 7, 8, 9, 11]);
  });

  it("draws no minor lines when off, or closer than 1 mm on the paper", () => {
    expect(gridLinePositions(0, 10, 5, 0, 10).minor).toEqual([]);
    // 1 m minor step at 0.5 mm per m: 0.5 mm apart
    expect(gridLinePositions(0, 10, 5, 5, 0.5).minor).toEqual([]);
    expect(gridLinePositions(0, 10, 5, 5, 1).minor.length).toBeGreaterThan(0);
  });

  it("has its widths in mm on the paper: 0.1 mm by default, the minor lines half; a style scales them", () => {
    expect(sheetGridStyle(undefined)).toEqual({ majorMm: 0.1, minorMm: 0.05, subdivisions: 0 });
    expect(sheetGridStyle({ width: 2, minorWidth: 1, subdivisions: 4, color: "#336699" })).toEqual({
      majorMm: 0.2,
      minorMm: 0.1,
      subdivisions: 4,
      color: "#336699",
    });
  });

  it("reads only valid grid styles from a file", () => {
    expect(normalizeLayerStyles({ grid: { color: "#ABCDEF", width: 2, subdivisions: 4, minorWidth: 0.5, x: 1 } })).toEqual({
      grid: { color: "#abcdef", width: 2, subdivisions: 4, minorWidth: 0.5 },
    });
    expect(normalizeLayerStyles({ grid: { subdivisions: 1 } })).toBeUndefined();
    expect(normalizeLayerStyles({ grid: { subdivisions: 11 } })).toBeUndefined();
    expect(normalizeLayerStyles({ grid: { subdivisions: 2.5, width: 0 } })).toBeUndefined();
  });
});

describe("the labelled ticks and the grid", () => {
  it("automatic: the grid at the ticks", () => {
    expect(sheetTickStep(10)).toBe(10);
    expect(sheetGridStep(10)).toBe(10);
  });

  it("a tick spacing of the user's wins; the grid keeps its own", () => {
    expect(sheetTickStep(10, 5, 3)).toBe(5);
    expect(sheetGridStep(5, 3)).toBe(3);
  });

  it("a fixed grid without a tick spacing: the labels on grid lines, at least the automatic step apart", () => {
    // as dense as the automatic step or coarser: every grid line labelled
    expect(sheetTickStep(10, undefined, 20)).toBe(20);
    expect(sheetTickStep(10, undefined, 10)).toBe(10);
    // finer: every n-th line, the smallest multiple at least the automatic step
    expect(sheetTickStep(10, undefined, 2)).toBe(10);
    expect(sheetTickStep(10, undefined, 3)).toBe(12);
    expect(sheetGridStep(12, 3)).toBe(3);
    // a spacing too fine to draw is not taken (the automatic step)
    expect(sheetTickStep(10, undefined, 0.1)).toBe(10);
    expect(sheetGridStep(10, 0.1)).toBe(10);
  });
});
