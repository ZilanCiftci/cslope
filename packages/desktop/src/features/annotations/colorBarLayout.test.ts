import { describe, expect, it } from "vitest";
import { PLOT_MARGINS } from "../../store/defaults";
import { COLOR_BAR_FONT_PX, SHEET_LAYOUT_MM_PER_PX, styleFontPt, MM_PER_PT } from "../rendering/style-spec";
import { COLOR_BAR_FONT_LAYOUT_PX, colorBarLayout, colorBarTopLeft } from "./colorBarLayout";

describe("the color bar's layout", () => {
  it("has the sizes it had on A4 in annotation px, now in layout px (the same mm on every paper)", () => {
    const l = colorBarLayout(1, 30);
    expect([l.barW, l.barH, l.labelGap, l.tick, l.titleGap, l.plate]).toEqual([20, 200, 5, 3, 4, 4]);
    expect(l.fontSize).toBeCloseTo(11, 12);
    expect(l.w).toBeCloseTo(20 + 5 + 30, 12);
    expect(l.h).toBeCloseTo(200 + 11 + 4, 12);
  });

  it("has its text in px of the F label's unit: about 13.1 px, 10.9 pt, 3.85 mm", () => {
    expect(COLOR_BAR_FONT_PX).toBeCloseTo(13.095, 3);
    expect(styleFontPt(COLOR_BAR_FONT_PX)).toBeCloseTo(10.91, 2);
    expect(COLOR_BAR_FONT_LAYOUT_PX * SHEET_LAYOUT_MM_PER_PX).toBeCloseTo(styleFontPt(COLOR_BAR_FONT_PX) * MM_PER_PT, 12);
  });

  it("scales with the caller's unit", () => {
    const mm = colorBarLayout(SHEET_LAYOUT_MM_PER_PX, 10);
    expect(mm.barW).toBeCloseTo(7, 12);
    expect(mm.barH).toBeCloseTo(70, 12);
    expect(mm.w).toBeCloseTo(25 * SHEET_LAYOUT_MM_PER_PX + 10, 12);
  });
});

describe("colorBarTopLeft", () => {
  const paper = { x: 10, y: 20, w: 297, h: 210 };
  const layout = { w: 20, h: 75, plate: 1.4 };
  const frame = {
    left: paper.x + paper.w * PLOT_MARGINS.L,
    right: paper.x + paper.w * (1 - PLOT_MARGINS.R),
    top: paper.y + paper.h * PLOT_MARGINS.T,
    bottom: paper.y + paper.h * (1 - PLOT_MARGINS.B),
  };

  it("hangs the bar from its point by its anchor when its plate is inside the plot frame", () => {
    expect(colorBarTopLeft(200, 60, layout, "top-right", paper)).toEqual({ x: 180, y: 60 });
    expect(colorBarTopLeft(100, 60, layout, undefined, paper)).toEqual({ x: 100, y: 60 });
    expect(colorBarTopLeft(100, 160, layout, "bottom-left", paper)).toEqual({ x: 100, y: 85 });
  });

  it.each([
    ["left of the frame", 5, 60],
    ["right of the paper", 400, 60],
    ["above the frame", 200, 0],
    ["below the paper", 200, 300],
  ])("moves a bar %s inside the frame, its plate at the frame's edge", (_, ax, ay) => {
    const { x, y } = colorBarTopLeft(ax, ay, layout, "top-right", paper);
    expect(x - layout.plate).toBeGreaterThanOrEqual(frame.left - 1e-9);
    expect(x + layout.w + layout.plate).toBeLessThanOrEqual(frame.right + 1e-9);
    expect(y - layout.plate).toBeGreaterThanOrEqual(frame.top - 1e-9);
    expect(y + layout.h + layout.plate).toBeLessThanOrEqual(frame.bottom + 1e-9);
    const atEdge = [x - layout.plate - frame.left, frame.right - x - layout.w - layout.plate, y - layout.plate - frame.top, frame.bottom - y - layout.h - layout.plate];
    expect(atEdge.some((d) => Math.abs(d) < 1e-9)).toBe(true);
  });
});
